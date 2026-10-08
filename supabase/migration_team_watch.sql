-- 팀 에이전트 감시 기준 — 대표가 대표 콘솔에서 팀마다 "이 팀에서 꼭 볼 것"을 한글로 적는다.
-- 행이 없으면 server/org.ts DEFAULT_RULES 를 쓴다. 대표 콘솔(서버)만 읽고 쓴다.
create table if not exists public.team_watch (
  team        text primary key,
  rules       text not null check (char_length(rules) <= 2000),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

revoke all on public.team_watch from anon;
grant all on public.team_watch to erp_server;
notify pgrst, 'reload schema';
