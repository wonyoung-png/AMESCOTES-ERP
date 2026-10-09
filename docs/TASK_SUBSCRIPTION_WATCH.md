# 작업 지시서 — 구독 감시 (Subscription Watch)

발주: 대표(10/9). 기획·검수: Claude. 구현: Codex.
브랜치 `subscription-watch` (이 worktree). **push·배포·aws-migration 병합 금지** — 커밋까지만. 검수 후 Claude 가 합친다.

## 배경
10/9 법인카드 6/1~10/8 점검 결과 매달 반복 결제가 많고, 실제로 안 쓰는데 돈만 나가던 구독이 있었다
(Influencity 월 54만·사용량 0, Cursor 사용량 0, Klaviyo 미사용인데 결제 중, Midjourney 2계정 중복 등).
AI 도구만 월 300~350만원. 대표 요구: "구독료만 계속 나가고 사용을 하는지 안 하는지 감시하는 것도 ERP에".

## 먼저 할 일 (구현 전, 결과를 `docs/SUBSCRIPTION_WATCH_DESIGN.md` 로)
1. 카드 결제 데이터를 ERP 로 가져올 방법 조사·결정. 후보:
   - 클로브(app.clobe.ai) — 회사 회계·카드 수집 서비스. 공개 API/웹훅/엑셀 내보내기 유무 확인 (웹 검색).
   - 카드사 엑셀 업로드 (가장 단순한 1단계 대안).
   - 정하지 못하면 1단계는 엑셀/CSV 업로드로 하고 이유를 적는다.
2. 기존 ERP 구조에 어떻게 붙일지: 테이블, API, 화면 위치, 업무 카드(work_cards)·알림(notifications)·대표 콘솔(server/ceo.ts '결정할 것')·팀 에이전트(server/agents.ts, server/watch.ts 의 '경영지원' 팀) 연결.
3. 위험·한계와 단계 계획.

## 기능 요구 (1단계 = 이번 구현)
1. **구독 목록** (테이블 예: `subscriptions`): 서비스명, 가맹점명 패턴(카드 내역 매칭용), 카드 끝 4자리, 금액(최근·평균), 통화, 주기(월/연), 다음 결제 예상일, 담당자(app_users id), 용도, 상태(사용 중/검토 필요/해지 예정/해지됨), 메모, 최근 사용 확인일·확인 결과.
2. **자동 발견**: 업로드된 카드 승인 내역에서 같은 가맹점이 2개월 이상 반복되면 '구독 후보'로 제안 (정규화: 'FACEBK *XXXX' 같은 광고 결제는 광고비로 분류해 제외, 'SHOPIFY* 숫자' 묶기 등). 대표/경영지원이 확정하면 목록에 들어간다.
3. **사용 확인**: 매월 1회(또는 결제 예정일 5일 전) 담당자에게 업무 카드 "이 구독 계속 쓰나요? (서비스·금액·다음 결제일)" — 답: 계속 씀 / 안 씀 / 모름. '안 씀'·'모름'·7일 무응답 → 대표 콘솔 '결정할 것'에 올라감. 담당자가 없으면 바로 대표에게.
4. **화면**: ERP 안 '구독 관리' 페이지(경영지원·대표만). 월별 합계, 다음 결제 달력 형태(대표 지시: 실사용자가 쓰던 형태 — 결제일 캘린더), 카테고리별(AI 도구·마케팅·업무 도구·인프라) 합계, 중복 의심(같은 서비스 여러 카드) 표시.
5. **대표 콘솔·에이전트**: 경영지원 팀 에이전트 감시 데이터(server/watch.ts)에 "검토 필요 구독 n건, 이번 달 구독 합계, 7일 안 결제 예정" 추가.

## 2단계 (이번엔 설계만)
관리 API 가 있는 서비스는 실제 사용량 자동 확인: Anthropic Admin API, OpenAI usage, Slack 좌석, Google Workspace 라이선스, Adobe User Management. 키가 필요한 것은 목록으로.

## 지켜야 할 규칙 (레포 CLAUDE.md 포함)
- 이 레포 CLAUDE.md 를 먼저 읽을 것. 기존 기능 제거 금지. DROP/DELETE 금지(상태값으로 처리).
- 새 테이블은 anon·authenticated·PUBLIC 권한 회수, erp_server 만 (예: supabase/migration_pms_core.sql·migration_team_watch.sql 패턴). 마이그레이션 파일만 만들고 **DB 에 적용하지 말 것**.
- 카드 내역은 민감 정보: 카드번호는 끝 4자리만 저장, 화면·API 는 경영지원·대표만 (서버에서 역할 검사).
- 주소 하드코딩 금지 (client/src/lib/hosts.ts, 서버 ERP_HOST·ROOT_DOMAIN).
- 새 컬럼 → client/src/lib/tableColumns.ts 화이트리스트 등 레포 규칙 따름.
- 직원 쪽 화면 변화는 '구독 관리' 메뉴(권한자만)와 사용 확인 업무 카드뿐.
- 완료 조건: `npx vite build` 성공, 서버 esbuild 번들 성공, `npm run check` 에서 새 오류 없음, 자동 발견 로직에 작은 테스트(샘플 카드 내역 → 구독 후보) 하나.
- 끝나면 커밋하고(push 금지) 변경 파일·결정 사항·남은 일을 `docs/SUBSCRIPTION_WATCH_DESIGN.md` 끝에 요약.
