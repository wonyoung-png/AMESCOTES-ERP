-- 업무 피드 1,000건/일과 팀 에이전트 일일 조회용
CREATE INDEX IF NOT EXISTS work_cards_created_at_idx
  ON work_cards (created_at DESC);

CREATE INDEX IF NOT EXISTS team_agent_runs_trigger_created_idx
  ON team_agent_runs (trigger, created_at DESC);
