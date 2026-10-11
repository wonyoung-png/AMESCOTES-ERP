# TASK — 구독 계약 조건(자동갱신·해지 통보 기한) 감시

대표 지시(10/11): ShopMy처럼 "6개월 자동갱신, 종료 45일 전 통보해야 해지"인 계약은 기한을 놓치면 6개월치가 또 나간다. 담당 팀(예: ShopMy=MD팀)이 미리 확인해 해지 요청할 수 있게 ERP가 계속 체크해야 한다.

작업 위치: 이 워크트리, 브랜치 `subscription-contract`(base origin/aws-migration). 커밋은 브랜치에만. push·배포·DB 적용 금지(검수자 Claude가 함).
먼저 읽을 것: server/subscriptions.ts, supabase/migration_subscription_watch.sql(answer_subscription_check RPC), server/watch.ts(구독 부분), 구독 관리 화면(클라이언트에서 subscriptions 쓰는 파일 grep).

## 1. 데이터 (새 마이그레이션 SQL, 조건부·멱등)
subscriptions 에 컬럼 추가:
- auto_renew boolean default false
- term_end_on date  (현재 계약 종료일)
- renewal_months int (갱신 단위, 예 6)
- notice_days int   (종료 며칠 전까지 통보, 예 45)
- notice_by date generated (term_end_on - notice_days) 또는 서버 계산
- owner_team text   (담당 팀, ORG 팀명 기준. owner_id 없으면 팀장에게)
- cancel_requested_at timestamptz, cancel_requested_by text

## 2. 감시 (server/subscriptions.ts runSubscriptionUsageChecks 확장, 새 파일 만들지 말 것)
- auto_renew 이고 notice_by 가 D-30, D-7 이내로 들어오면 담당자(owner_id→owner_team 팀장→경영지원) 에게 업무 카드: "{서비스} 해지 통보 기한 {notice_by} (D-n). 계속/해지 요청 중 선택". 같은 구독·같은 단계(D-30/D-7)는 1회만.
- 응답에 '해지 요청' 추가: 기존 answer 값 '안 씀' 을 그대로 쓰되, 계약형(auto_renew)이면 경영지원 팀장에게 "해지 통보 처리" 카드 생성 + cancel_requested_at 기록 + status '해지 예정'.
- notice_by 가 지났는데 응답·해지요청 없으면 대표에게 알림(기존 escalate 패턴 재사용) + term_end_on 을 renewal_months 만큼 미뤄 다음 주기로 넘김(자동갱신된 것으로 간주).
- watch.ts 경영지원 facts 에 "해지 통보 기한 30일 이내 N건" 추가.

## 3. 화면
- 구독 등록/수정 폼에 위 필드(자동갱신 체크, 계약 종료일, 갱신 개월, 통보 일수, 담당 팀). 목록에 "통보 기한" 열(D-n 표시, 30일 이내 강조).

## 4. 시드(실데이터, 마이그레이션 말고 별도 sql 파일 seed_shopmy.sql 로만 작성 — 적용은 Claude)
ShopMy (ShopMyShelf, 월 약 67만, 카드 ****2200): auto_renew true, term_end_on 2027-02-05, renewal_months 6, notice_days 45 → 통보 기한 2026-12-22, owner_team 'MD', 메모 "Launch Package, 8/5 DocuSign(원채은). 8~10월 귀속매출 $864(bella 1명) vs 구독료 약 207만". 이미 같은 서비스 행이 있으면 UPDATE.

## 5. 완료 기준
- server/subscriptions.test.ts(없으면 신규): notice_by 계산, D-30/D-7 1회성, 기한 경과 시 다음 주기 이월, '안 씀'→해지요청 카드. DB 호출은 모킹.
- `./node_modules/.bin/tsc --noEmit` 와 `./node_modules/.bin/tsx --test server/*.test.ts` 통과.
- 보고(한국어 짧게): 변경 파일, 마이그레이션 파일명, 실서버에서 확인할 시나리오 3개.
