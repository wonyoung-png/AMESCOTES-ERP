# TASK — 에이전트 협의(Council): 보고 전에 유관 팀 에이전트끼리 대화해 결론 도출

대표 승인(10/10). 지금: 팀 에이전트(server/agents.ts) → 각자 대표에게 보고. 바꿀 것: **여러 팀이 얽힌 사안은 보고 전에 관련 에이전트끼리 협의 → 비서실장이 결론 1건으로 보고.**

작업 위치: 이 워크트리(`C:\Users\이원영 AMES\AMESCOTES-ERP-council`, 브랜치 `agent-council`, base `origin/aws-migration`). **커밋은 브랜치에만, push·배포·DB 적용 금지** (검수자 Claude 가 함).
먼저 읽을 것: server/agents.ts, server/watch.ts, server/org.ts, server/ceo.ts, server/ceo-console.html, server/work.ts(모델 상수), 기존 마이그레이션 SQL 위치·작성 관례(새 DB엔 `authenticated` 역할 없음 — 조건부로).

## 1. 협의를 여는 조건 (규칙, AI 아님)
- 팀 에이전트 점검(runAgents) 결과에서 **다른 팀이 얽힌 항목**을 찾는다:
  - watch.ts alert/fact 중 org.ts 규칙상 연관 팀이 지정된 것(예: 재고·품절 ↔ MD·마케팅·물류, 생산 지연 ↔ 생산·MD, 기획전 ↔ 마케팅·MD·CS). 연관 매핑은 org.ts 에 `RELATED_TEAMS` 상수로 추가(팀명은 ORG 기준).
  - 업무 카드 중 shared_teams 가 2팀 이상이거나, 대표 지시(directive)가 다른 팀 산출물에 의존하는 것.
- 같은 사안(동일 근거 키)은 하루 1회만 협의(중복 방지 키 저장).
- 한 번 점검에서 협의는 최대 3건. ponytail 주석으로 상한 근거.

## 2. 협의 진행 (server/council.ts 신규)
- 참가자 = 발의 팀 + 연관 팀(최대 3팀). 각 참가자는 **자기 팀 facts·카드 근거만** 받는다(다른 팀 원자료 비공개 — 의견 텍스트만 공유).
- 라운드 1: 각 팀 에이전트가 의견 JSON `{position, evidence:[근거 id/수치], ask_others:[...]}`.
- 라운드 2: 다른 팀 의견을 보고 보완/반박 `{agree:[], disagree:[{point, why}], revised_position}`. **최대 2라운드 고정.**
- 정리: 비서실장(ANSWER 모델, work.ts 상수 재사용)이 `{conclusion, open_disagreements:[], ceo_decisions:[{question, options}], actions_by_team:[{team, action}]}`.
- 규칙: 근거 없는 수치·추측 금지(프롬프트+출력 검증: evidence 가 입력 facts/카드 id 에 없으면 그 문장 제거 표시). 사용자 텍스트는 기존 work.ts 의 인젝션 분리 방식 재사용. 모델 호출은 Promise.all 로 라운드 내 병렬, 타임아웃·재시도 기존 패턴.
- 비용 로그: 기존 `[agents] usage` 형식으로 협의 id 별 in/out 토큰 합계.

## 3. 저장 (마이그레이션 SQL)
- `agent_councils(id, created_at, topic, trigger_key unique per day, teams text[], status 'open'|'concluded'|'failed', conclusion jsonb, cost jsonb)`
- `agent_council_messages(id, council_id, round int, team, content jsonb, created_at)`
- 권한: 서버 역할만 읽기/쓰기(기존 team_agent_runs 와 동일 정책).

## 4. 대표 보고 (권한 = 기존 ceo.ts 대표 확인 그대로)
- 협의 결론은 **'결정할 것'** 에 1건으로 올라가고, 관련 팀의 개별 보고는 그 협의로 묶여 중복 표시 안 함.
- 대표 콘솔에 "협의" 화면: 목록(주제·참가팀·결론 한 줄·대표 결정 필요 수) → 상세(라운드별 팀 발언 타임라인 + 결론 + 이견 + 결정 질문 + 팀별 액션 제안).
- 결론은 **제안까지만**. 대표가 [이 안으로 지시] 누르면 기존 POST /api/ceo/directive 경로로 팀별 지시 카드 생성. 자동 실행 없음.
- [지금 협의] 수동 실행 버튼(대표만).

## 5. 테스트·완료 기준
- `server/council.test.ts`: 협의 열림 조건(연관 팀 매핑·중복 키·상한 3), 2라운드 고정, 근거 없는 evidence 걸러짐, 결론 JSON 스키마 — 모델 호출은 모킹.
- `npm run check` 와 기존 테스트 전부 통과.
- 보고: 변경 파일, 마이그레이션 파일명, 실서버에서 Claude 가 확인할 시나리오 3개(예: 재고 경보→MD·마케팅·물류 협의), 예상 비용(협의 1건 토큰 추정). 한국어 짧게.
