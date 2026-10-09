# 구독 감시 설계

## 결정

- 1단계 수집 방식은 **클로브 또는 카드사에서 내려받은 엑셀·CSV 수동 업로드**로 한다.
- 클로브 공식 안내에서 법인카드 승인내역 통합 조회와 엑셀 다운로드는 확인했다.
  - 클로브 카드 이용내역 소개: https://clobe.ai/blog/clobe-ai-best-feature-top-5
  - 클로브 데이터 연동 안내: https://docs.clobe.ai/data-connect/data-integration-start/
- 클로브 MCP 주소는 공개되어 있지만, ERP 서버가 카드 승인 원장을 안정적으로 동기화할 공개 REST API·웹훅과 서비스 계정 인증 계약은 공개 문서에서 확인하지 못했다.
- 카드사별 API와 금융결제원 오픈뱅킹은 제휴·심사·인증 구축이 필요해 1단계 범위를 넘는다. 수동 업로드는 외부 키 없이 즉시 운영하고 원본 파일을 저장하지 않는 가장 작은 안전한 경로다.

## 1단계 구조

| 영역 | 설계 |
|---|---|
| DB | `card_transactions`, `subscription_candidates`, `subscriptions`, `subscription_usage_checks` 신규 테이블. 모두 `anon`, `authenticated`, `PUBLIC` 권한 회수 후 `erp_server`만 허용 |
| 민감정보 | 카드번호는 서버 입력 경계에서 끝 4자리만 추출. 원본 파일·전체 카드번호·승인번호는 저장하지 않음 |
| 업로드 | 브라우저에서 CSV/XLSX의 첫 시트를 읽어 승인일·가맹점·금액·통화·카드번호 열을 표준화해 서버 전송. 서버가 재검증·중복 제거 |
| 발견 | 가맹점명을 대문자/공백 기준으로 정규화. 월이 서로 다른 2개월 이상이면 후보. 광고 결제(`FACEBK`, `META`, `GOOGLE ADS` 등)는 제외하고 `SHOPIFY*숫자`는 `SHOPIFY`로 묶음 |
| 확정 | 후보를 확정할 때 구독 목록 생성. 중복 저장은 상태값으로 막고 후보 기록은 유지 |
| 사용 확인 | 서버 점검 시 매월 1회 또는 결제 5일 전 담당자에게 `work_cards`와 `notifications` 생성. 담당자 없음, `안 씀`·`모름`, 7일 무응답은 대표 결정 대상으로 연결 |
| 화면 | `/subscriptions`에 월 합계, 카테고리 합계, 7일 안 결제, 달력형 결제일, 중복 의심, 후보, 목록, 업로드를 제공 |
| 권한 | 서버에서 대표 또는 `경영지원`/`경영관리` 팀만 허용. 메뉴도 같은 기준으로 숨김 |
| 대표 콘솔 | 구독 확인 카드의 담당자를 대표로 지정해 기존 `결정할 것`에 포함 |
| 에이전트 | `server/watch.ts`의 경영지원 데이터에 검토 필요 건수·월 합계·7일 안 결제 예정 추가 |

## 업무 흐름

1. 경영지원이 클로브/카드사 파일을 업로드한다.
2. 서버가 허용 필드만 저장하고 반복 가맹점을 후보로 갱신한다.
3. 대표/경영지원이 후보를 확정하며 서비스명·담당자·용도·분류를 보완한다.
4. 일일 에이전트 실행 때 확인 시점인 구독의 업무 카드가 한 번만 생성된다.
5. 담당자는 업무 카드에서 `계속 씀 / 안 씀 / 모름`으로 답한다. 위험 답변과 7일 무응답은 대표 카드로 전환한다.

## 위험과 한계

- 카드사마다 열 이름·날짜·금액 형식이 달라 자동 매핑이 실패할 수 있다. 화면에서 열 매핑 결과와 오류 행을 알려야 한다.
- 가맹점명만으로 반복 결제를 판단하므로 정기 구매를 구독으로 오인할 수 있다. 후보는 자동 확정하지 않는다.
- 외화 합계는 환율 환산 없이 통화별로 분리한다. 화면의 대표 월 합계는 KRW만 표시한다.
- 업로드 공백 기간에는 다음 결제일과 평균 금액이 부정확할 수 있다.
- 서버 점검이 실행되지 않으면 업무 카드도 생성되지 않는다. 현재 에이전트 일일 실행 주기에 연결한다.

## 2단계 계획

- 클로브에 거래 원장용 공식 API·웹훅·서비스 계정 계약 가능 여부를 문의하고 제공되면 증분 동기화로 교체한다.
- 사용량 자동 확인 후보와 필요 키: Anthropic Admin API 키, OpenAI 조직 관리자 키, Slack 관리자 OAuth, Google Workspace 도메인 위임 서비스 계정, Adobe User Management API 자격 증명.
- 자동 사용량은 결제 데이터와 별도 증거로 저장하며, API 장애를 `미사용`으로 판정하지 않는다.

## 구현 완료 요약

### 변경 파일

- DB: `supabase/migration_subscription_watch.sql`
- 서버: `server/subscriptions.ts`, `server/subscription-detection.ts`, `server/subscription-detection.test.ts`, `server/watch.ts`, `server/agents.ts`, `server/index.ts`
- 화면: `client/src/pages/SubscriptionManagement.tsx`, `client/src/App.tsx`, `client/src/components/Layout.tsx`, `client/src/components/WorkCardActions.tsx`
- 검사 환경: `server/compression.d.ts`, `tsconfig.json`, `.gitignore`
- 문서: `docs/SUBSCRIPTION_WATCH_DESIGN.md`

### 최종 결정

- 1단계는 클로브/카드사 엑셀·CSV 업로드로 구현했다. 공개 거래 API 계약이 확인되기 전에는 자동 수집을 붙이지 않는다.
- 원본 파일과 전체 카드번호는 저장하지 않고, 승인일·가맹점·금액·통화·카드 끝 4자리만 서버 검증 후 저장한다.
- 후보는 2개월 이상 반복 결제로 만들되 사람이 확정해야 구독이 된다. 확정 뒤 업로드에도 최근·평균 금액을 갱신한다.
- 담당자 사용 확인은 기존 업무 카드·알림을 재사용하고, 위험 답변과 7일 무응답은 대표에게 올린다.

### 검증 결과

- `npx vite build --configLoader runner`: 성공. 공유 `node_modules`가 읽기 전용 연결이라 기본 설정 로더 대신 쓰기 없는 로더를 사용했다.
- 서버 esbuild 번들: 성공.
- `npm run check`: 성공, 오류 0개.
- 자동 발견 샘플 테스트: 성공. `SHOPIFY*숫자` 두 달 결제는 후보 1건, `FACEBK` 광고비는 제외됨.

### 남은 일

- DB 마이그레이션은 지시대로 만들기만 했고 적용하지 않았다. 적용 전 운영 DB 백업과 검수가 필요하다.
- 실제 클로브/카드사 파일의 열 이름 표본으로 업로드 매핑을 확인해야 한다.
- 클로브 거래 API·웹훅·서비스 계정 제공 여부는 클로브 측 계약 문의가 필요하다.
- 2단계 사용량 API 키와 관리자 권한은 아직 연결하지 않았다.
- 커밋·푸시·배포는 하지 않았다.

## Review fixes

- 구독·카드 내역 권한과 메뉴 노출은 `대표` 역할이 아니라 `CEO_EMAILS` 또는 `경영지원`/`경영관리` 팀으로 판정한다.
- 대표 담당자·사용 확인 대리 응답도 `CEO_EMAILS`의 계정만 허용한다.
Review fixes 2

## Review fixes 3

- 사용 확인 답변을 `answer_subscription_check` RPC로 묶어 구독·업무 카드·확인 기록을 하나의 DB 트랜잭션에서 잠그고 갱신한다.
- 같은 확인에 같은 답을 재시도하면 기존 결과를 반환하고, 대표 알림은 처음 처리된 위험 답변에만 발송한다.
- RPC 실행 권한은 `erp_server`에만 부여하고 `PUBLIC`·`anon`·`authenticated`에서는 회수했다.
