-- 팀 에이전트 점검 기록 — 팀마다 하루 한 번(또는 대표가 누를 때) 업무를 훑고 남기는 보고.
-- 지우지 않고 쌓는다. 회사 지도는 팀별 가장 최근 것을 보여주고, 나중에 "지난주 MD 팀 어땠어?"의 근거가 된다.
create table if not exists public.team_agent_runs (
  id          text primary key,
  team        text not null,
  created_at  timestamptz not null default now(),
  status      text not null,          -- work | idle | warn | report  (규칙으로 정한다, AI 가 아니라)
  headline    text not null,          -- 지도에 보일 한 줄
  summary     text,                   -- 3~5줄 보고
  needs       jsonb not null default '[]'::jsonb,  -- 대표가 볼 것 [{text, cardId}]
  stats       jsonb not null default '{}'::jsonb,  -- 숫자 근거 {open, overdue, doneToday, ...}
  model       text,
  trigger     text not null default 'schedule'     -- schedule | manual
);
create index if not exists team_agent_runs_team_idx on public.team_agent_runs (team, created_at desc);

revoke all on public.team_agent_runs from anon;
grant all on public.team_agent_runs to erp_server;
notify pgrst, 'reload schema';
