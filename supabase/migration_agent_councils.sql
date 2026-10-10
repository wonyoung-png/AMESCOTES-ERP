-- 여러 팀이 얽힌 사안을 대표 보고 전에 최대 2라운드 협의한 기록.
create table if not exists public.agent_councils (
  id text primary key,
  created_at timestamptz not null default now(),
  trigger_day date not null default ((now() at time zone 'Asia/Seoul')::date),
  topic text not null,
  trigger_key text not null,
  teams text[] not null,
  status text not null check (status in ('open', 'concluded', 'failed')),
  conclusion jsonb,
  directed_at timestamptz,
  directed_cards jsonb not null default '{}'::jsonb,
  cost jsonb not null default '{}'::jsonb,
  unique (trigger_day, trigger_key)
);
create table if not exists public.agent_council_messages (
  id text primary key,
  council_id text not null references public.agent_councils(id) on delete cascade,
  round int not null check (round in (1, 2)),
  team text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.agent_councils add column if not exists directed_at timestamptz;
alter table public.agent_councils add column if not exists directed_cards jsonb not null default '{}'::jsonb;
create index if not exists agent_councils_created_idx on public.agent_councils (created_at desc);
create index if not exists agent_council_messages_council_idx on public.agent_council_messages (council_id, round, created_at);
revoke all on public.agent_councils, public.agent_council_messages from anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.agent_councils, public.agent_council_messages from authenticated;
  end if;
end $$;
grant all on public.agent_councils, public.agent_council_messages to erp_server;
notify pgrst, 'reload schema';
