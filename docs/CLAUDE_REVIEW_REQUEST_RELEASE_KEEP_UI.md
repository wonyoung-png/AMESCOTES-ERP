# 실제 운영 배포 전 읽기 전용 검토

대표 최신 지시: 클로드와 검토하고 Codex가 배포. 기존 ERP UI/기능 유지 + 신규 기능 추가. DB 변경/실 채널 쓰기 금지.

범위: docs/ERP_KEEP_ORIGINAL_UI_2026-10-12.md, docs/ERP_PRESERVE_ADDONS_HANDOFF_2026-10-12.md, client/src/components/SampleReviewerSettings.tsx, SampleReviewerSettings.test.mjs, client/src/pages/ExchangeSettings.tsx, SubscriptionManagement.tsx, WorkCardActions.tsx, server/sample-workflow.ts 및 test, server/subscriptions.ts, scripts/preserve-addons.test.mjs, deploy/migrate/Caddyfile, auto-deploy.sh, docker-compose.yml, deploy/shell/index.html, supabase/migration_subscription_last_paid.sql 및 category_split.sql. 환경변수/비밀/개인자료 읽지 말 것.

검토 대상 코드가 로컬 latest aws-migration(afe1279)보다 과거 base(1bdbd1f)이며 서버 광고/쇼핑몰 인증에 추가 차이가 있음. 과거 base를 운영에 통째로 올리지 않음. 최신 원격/운영 SHA를 먼저 확인 후 최신 운영 기반 별도 release worktree에 위 승인 변경만 적용할 계획. unrelated ads/channels를 덮어쓰거나 원격 force push 하지 않음.

로컬 회귀632/check/build 통과 기록은 실운영 검증 아님. 배포 전에 실Caddy validate, DB schema/RPC 존재를 읽기 전용 확인, 백업 이미지/설정 확보, private mode 유지, scheduler/상품등록 활성화 값 변화 없음 확인. ERP만 교체하고 daily/hr/db는 재기동하지 않을 계획. 자동 배포와 deploy.lock 충돌을 피하고 최종 실제 이미지+SHA+health로 성공 판단, 실패 시 직전 앱/프록시 복구.

질문: 1) 기존 UI·양식·품목/자재/BOM/샘플→수락→명세→생산→입출고→비서실 연결 보존 여부 2) 샘플 담당 복구에서 대표 외 권한/ready:false 차단 3) 구독 source 복구와 운영 schema 의존성 4) Caddy 실제 배포 순서와 환경 변수 부족 위험 5) 변경 파일별 운영 배포를 막아야 하는 P1/P2 코드 결함. 미확인 운영 항목과 코드 결함 구분. 실제 테스트 실행·운영 승인으로 과장하지 말 것. 파일/근거/수정안으로 짧게 답변.
