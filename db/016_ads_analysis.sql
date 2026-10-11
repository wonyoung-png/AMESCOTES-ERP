-- Analysis only. Does not grant access to commerce, ad mutations or employee/CEO tables.
begin;
create table if not exists public.ads_analysis_runs (
 id text primary key, trigger_key text not null unique, market text not null check(market in ('lm-kr','lm-gl')),
 actor_id text not null, day date not null, kind text not null check(kind in ('daily','question')),
 status text not null default 'queued' check(status in ('queued','planning','independent','cross_review','finalizing','completed','failed')),
 payload jsonb not null, lease_owner text, lease_until timestamptz, next_check_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.ads_analysis_runs add column if not exists next_check_at timestamptz not null default now();
create table if not exists public.ads_analysis_budget(day date primary key,reserved_usd numeric not null default 0 check(reserved_usd>=0));
create table if not exists public.ads_analysis_jobs (
 id text primary key,run_id text not null references public.ads_analysis_runs(id),phase text not null check(phase in ('independent','cross_review')),
 task jsonb not null, status text not null default 'pending' check(status in ('pending','claimed','completed','failed','expired')),
 runner_id text,claim_token text,expires_at timestamptz not null, result jsonb,error text,
 created_at timestamptz not null default now(),unique(run_id,phase)
);
create table if not exists public.ads_analysis_notices (id text primary key,payload jsonb not null,updated_at timestamptz not null default now());
revoke all on public.ads_analysis_runs,public.ads_analysis_budget,public.ads_analysis_jobs,public.ads_analysis_notices from public,anon;
do $$begin if exists(select 1 from pg_roles where rolname='authenticated') then
 execute 'revoke all on public.ads_analysis_runs,public.ads_analysis_budget,public.ads_analysis_jobs,public.ads_analysis_notices from authenticated';
end if;end$$;
grant select,insert,update on public.ads_analysis_runs,public.ads_analysis_budget,public.ads_analysis_jobs to erp_server;
grant select on public.ads_analysis_notices to erp_server;
grant insert,update on public.ads_analysis_notices to erp_server;
create or replace function public.ads_open_run(p_run jsonb,p_key text,p_actor text,p_cap numeric) returns jsonb
language plpgsql set search_path=public as $$declare old public.ads_analysis_runs%rowtype; used numeric;
begin
 if p_cap<=0 or p_cap>100 or p_run->>'market' not in ('lm-kr','lm-gl') or p_run->>'kind' not in ('daily','question')
 or length(p_run->>'question') not between 1 and 2000 or p_run->>'id' !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'invalid_ads_run';end if;
 perform pg_advisory_xact_lock(hashtextextended('ads-open:'||p_key,0));
 select * into old from public.ads_analysis_runs where trigger_key=p_key;
 if found then if old.actor_id<>p_actor or old.market<>p_run->>'market' or old.payload->>'question'<>p_run->>'question' then raise exception 'ads_request_conflict';end if; return to_jsonb(old);end if;
 insert into public.ads_analysis_budget(day) values((p_run->>'day')::date) on conflict do nothing;
 select reserved_usd into used from public.ads_analysis_budget where day=(p_run->>'day')::date for update;
 -- Four bounded Opus calls, no automatic retries after uncertain model invocation.
 if used+0.60>p_cap then raise exception 'ads_daily_cap';end if;
 update public.ads_analysis_budget set reserved_usd=reserved_usd+0.60 where day=(p_run->>'day')::date;
 insert into public.ads_analysis_runs(id,trigger_key,market,actor_id,day,kind,payload)
 values(p_run->>'id',p_key,p_run->>'market',p_actor,(p_run->>'day')::date,p_run->>'kind',p_run)
 returning * into old;return to_jsonb(old);
end$$;
create or replace function public.ads_claim_run(p_owner text) returns jsonb language plpgsql set search_path=public as $$declare r public.ads_analysis_runs%rowtype;
begin
 select * into r from public.ads_analysis_runs where status not in ('completed','failed') and next_check_at<=now() and (lease_until is null or lease_until<now()) order by created_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update public.ads_analysis_runs set lease_owner=p_owner,lease_until=now()+interval '120 seconds' where id=r.id returning * into r;
 return to_jsonb(r);
end$$;
create or replace function public.ads_renew_run(p_id text,p_owner text) returns boolean language plpgsql set search_path=public as $$
begin
 update public.ads_analysis_runs set lease_until=now()+interval '120 seconds'
 where id=p_id and lease_owner=p_owner and lease_until>now() and status not in ('completed','failed');
 if not found then raise exception 'ads_lease_lost';end if;return true;
end$$;
create or replace function public.ads_save_run(p_id text,p_owner text,p_expected text,p_run jsonb,p_job jsonb default null) returns jsonb
language plpgsql set search_path=public as $$declare r public.ads_analysis_runs%rowtype;
begin
 select * into r from public.ads_analysis_runs where id=p_id for update;
 if not found or r.lease_owner is distinct from p_owner or r.lease_until<=now() or r.status<>p_expected then raise exception 'ads_lease_lost';end if;
 if p_run->>'id'<>r.id or p_run->>'market'<>r.market or p_run->>'question'<>r.payload->>'question' or p_run->>'day'<>r.day::text then raise exception 'ads_scope_changed';end if;
 if r.payload ? 'snapshot' and p_run->'snapshot' is distinct from r.payload->'snapshot' then raise exception 'ads_snapshot_changed';end if;
 if p_job is not null then
   insert into public.ads_analysis_jobs(id,run_id,phase,task,expires_at)
    values(p_job->>'id',r.id,p_job->>'phase',p_job->'task',(p_job->>'expires_at')::timestamptz)
    on conflict(run_id,phase) do nothing;
 end if;
 update public.ads_analysis_runs set payload=p_run,status=p_run->>'status',updated_at=clock_timestamp(),lease_owner=null,lease_until=null,
 next_check_at=case when p_expected in ('independent','cross_review') and p_run->>'status'=p_expected then now()+interval '30 seconds' else now() end
 where id=r.id returning * into r;
 return to_jsonb(r);
end$$;
create or replace function public.ads_begin_call(p_id text,p_owner text,p_stage text) returns boolean language plpgsql set search_path=public as $$
begin
 if p_stage not in ('plan','independent','cross_review','final') then raise exception 'invalid_ads_stage';end if;
 update public.ads_analysis_runs set payload=jsonb_set(payload,'{calls}',coalesce(payload->'calls','{}'::jsonb)||jsonb_build_object(p_stage,'attempted'))
 where id=p_id and lease_owner=p_owner and lease_until>now() and not(coalesce(payload->'calls','{}'::jsonb) ? p_stage);
 if not found then raise exception 'ads_call_already_attempted';end if;return true;
end$$;
create or replace function public.ads_claim_job(p_runner text,p_token text) returns jsonb language plpgsql set search_path=public as $$declare j public.ads_analysis_jobs%rowtype;
begin
 if length(p_runner) not between 1 and 100 or length(p_token)<20 then raise exception 'invalid_runner';end if;
 update public.ads_analysis_jobs set status='expired' where status in ('pending','claimed') and expires_at<=now();
 select j0.* into j from public.ads_analysis_jobs j0 join public.ads_analysis_runs r on r.id=j0.run_id
 where j0.status='pending' and j0.expires_at>now() and r.status not in ('completed','failed') order by j0.created_at,j0.id for update of j0 skip locked limit 1;
 if not found then return null;end if;
 update public.ads_analysis_jobs set status='claimed',runner_id=p_runner,claim_token=p_token where id=j.id returning * into j;
 return to_jsonb(j);
end$$;
create or replace function public.ads_finish_job(p_id text,p_runner text,p_token text,p_result jsonb,p_error text default null) returns jsonb
language plpgsql set search_path=public as $$declare j public.ads_analysis_jobs%rowtype;
begin
 select * into j from public.ads_analysis_jobs where id=p_id for update;
 if not found or j.runner_id is distinct from p_runner or j.claim_token is distinct from p_token or j.expires_at<=now() then raise exception 'ads_job_stale';end if;
 if j.status in ('completed','failed') then
  if j.result is distinct from p_result or j.error is distinct from p_error then raise exception 'ads_result_conflict';end if;return to_jsonb(j);
 end if;
 if j.status<>'claimed' or not exists(select 1 from public.ads_analysis_runs r where r.id=j.run_id and r.status not in ('completed','failed')) then raise exception 'ads_job_stale';end if;
 update public.ads_analysis_jobs set result=p_result,error=p_error,status=case when p_error is null then 'completed' else 'failed' end where id=j.id returning * into j;return to_jsonb(j);
end$$;
create or replace function public.ads_score_run(p_id text,p_score jsonb) returns boolean language plpgsql set search_path=public as $$
begin
 update public.ads_analysis_runs set payload=jsonb_set(payload,'{score}',p_score),updated_at=clock_timestamp()
 where id=p_id and status='completed' and not(payload ? 'score') and created_at<=now()-interval '14 days';return found;
end$$;
revoke all on function public.ads_open_run(jsonb,text,text,numeric),public.ads_claim_run(text),public.ads_save_run(text,text,text,jsonb,jsonb),public.ads_claim_job(text,text),public.ads_finish_job(text,text,text,jsonb,text),public.ads_score_run(text,jsonb) from public,anon;
grant execute on function public.ads_open_run(jsonb,text,text,numeric),public.ads_claim_run(text),public.ads_save_run(text,text,text,jsonb,jsonb),public.ads_claim_job(text,text),public.ads_finish_job(text,text,text,jsonb,text),public.ads_score_run(text,jsonb) to erp_server;
revoke all on function public.ads_begin_call(text,text,text) from public,anon;
grant execute on function public.ads_begin_call(text,text,text) to erp_server;
revoke all on function public.ads_renew_run(text,text) from public,anon;
grant execute on function public.ads_renew_run(text,text) to erp_server;
notify pgrst,'reload schema';
commit;
