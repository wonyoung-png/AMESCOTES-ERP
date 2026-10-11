-- 자동갱신 계약 감시. 운영 DB에는 검수 후 별도로 적용한다.
alter table public.subscriptions add column if not exists auto_renew boolean not null default false;
alter table public.subscriptions add column if not exists term_end_on date;
alter table public.subscriptions add column if not exists renewal_months integer;
alter table public.subscriptions add column if not exists notice_days integer;
alter table public.subscriptions add column if not exists owner_team text;
alter table public.subscriptions add column if not exists cancel_requested_at timestamptz;
alter table public.subscriptions add column if not exists cancel_requested_by text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_renewal_months_positive') then
    alter table public.subscriptions add constraint subscriptions_renewal_months_positive check (renewal_months is null or renewal_months > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_notice_days_nonnegative') then
    alter table public.subscriptions add constraint subscriptions_notice_days_nonnegative check (notice_days is null or notice_days >= 0);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'notice_by') then
    alter table public.subscriptions add column notice_by date generated always as
      (case when term_end_on is not null and notice_days is not null then term_end_on - notice_days else null end) stored;
  end if;
end $$;

alter table public.subscription_usage_checks add column if not exists notice_stage text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_checks_notice_stage_valid') then
    alter table public.subscription_usage_checks add constraint subscription_checks_notice_stage_valid
      check (notice_stage is null or notice_stage in ('D-30','D-7'));
  end if;
end $$;
create unique index if not exists subscription_checks_notice_stage_once_idx
  on public.subscription_usage_checks (subscription_id, notice_stage) where notice_stage is not null;
create index if not exists subscriptions_notice_idx on public.subscriptions (notice_by) where auto_renew;

create or replace function public.answer_subscription_check(
  p_check_id text, p_answer text, p_actor_id text, p_actor_name text,
  p_ceo_id text default null, p_ceo_name text default null
) returns jsonb language plpgsql as $$
declare
  v_check public.subscription_usage_checks%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_now timestamptz := now();
  v_risky boolean;
  v_cancel boolean;
begin
  if p_answer not in ('계속 씀','안 씀','모름') then raise exception 'bad_answer'; end if;
  select * into v_check from public.subscription_usage_checks where id = p_check_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_check.answered_at is not null then
    if v_check.answer = p_answer then
      return jsonb_build_object('check_id', v_check.id, 'answer', v_check.answer, 'newly_answered', false, 'cancel_requested', false);
    end if;
    raise exception 'already_answered:%', v_check.answer;
  end if;
  select * into v_subscription from public.subscriptions where id = v_check.subscription_id for update;
  if not found then raise exception 'subscription_not_found'; end if;
  perform 1 from public.work_cards where id = v_check.work_card_id for update;
  if not found then raise exception 'work_card_not_found'; end if;

  v_cancel := p_answer = '안 씀' and v_subscription.auto_renew;
  v_risky := p_answer <> '계속 씀';
  update public.subscriptions set
    last_usage_checked_at = v_now, last_usage_result = p_answer,
    status = case when v_cancel then '해지 예정' when v_risky then '검토 필요' else status end,
    cancel_requested_at = case when v_cancel then v_now else cancel_requested_at end,
    cancel_requested_by = case when v_cancel then p_actor_id else cancel_requested_by end,
    updated_at = v_now
  where id = v_check.subscription_id;

  update public.work_cards set status = 'done', reply_text = p_answer,
    replied_by_name = p_actor_name, replied_at = v_now, done_at = v_now,
    done_by_name = p_actor_name, updated_at = v_now
  where id = v_check.work_card_id;
  update public.subscription_usage_checks set answer = p_answer, answered_at = v_now where id = v_check.id;
  return jsonb_build_object('check_id', v_check.id, 'answer', p_answer, 'newly_answered', true, 'cancel_requested', v_cancel);
end $$;

revoke all on function public.answer_subscription_check(text,text,text,text,text,text) from public, anon;
do $$ begin if exists (select 1 from pg_roles where rolname = 'authenticated') then
  revoke all on function public.answer_subscription_check(text,text,text,text,text,text) from authenticated;
end if; end $$;
grant execute on function public.answer_subscription_check(text,text,text,text,text,text) to erp_server;
