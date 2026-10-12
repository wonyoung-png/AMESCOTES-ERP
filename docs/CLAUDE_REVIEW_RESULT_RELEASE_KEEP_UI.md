# 실제 Claude 운영 배포 전 검토

2026-10-12 공통 Invoke-ClaudeReview.ps1 실행 성공. 비용 USD 0.82.
검토 요청: CLAUDE_REVIEW_REQUEST_RELEASE_KEEP_UI.md. 읽기 전용 정적 검토이며 Claude는 git/테스트/운영 조회를 실행하지 않음.

최초 판정: 아직 배포하면 안 됨. P1 3건은 아래 운영 확인·순서 조건이며 통과 전 배포 차단.

1. 구독 운영 DB의 last_paid_on, 분류 제약(임대/리스), 계약 컬럼, answer_subscription_check RPC 확인. 누락 시 DB 변경 금지에 따라 릴리스 제외.
2. 저장소 자동 배포 스크립트가 운영에 자동 설치되지 않으므로 push 전에 deploy.lock을 확보하고 새 보호 스크립트를 설치해야 함.
3. 운영 Caddyfile 수동 블록과 비교, ROOT_DOMAIN/ERP_HOST 존재 확인, 실제 Caddy validate 필요. compose 의존 서비스 재기동 위험을 확인해야 함.

P2: shell bind mount는 소스 변경 즉시 반영되므로 Caddy/app 별도 상태로 검수. erp 접두어가 실제 ERP_HOST와 일치하는지 확인. 앱 롤백 시 Caddy 설정도 복구. 비교 baseline을 실제 최신 운영 source에 맞춤.
P3: sample_lead_required 때 대표 기본 담당으로 복구 실패 가능, 제품개발 담당 지정 안내 보강 권고.

샘플 대표 복구/ready:false 권한 차단은 정적 코드상 결함 없음. 실 샘플→명세→생산→입출고→비서실 종단간 시험은 검토 범위 밖.

Codex 조치 진행: 실제 운영/원격 afe1279를 확인하고 동일 SHA 기반 새 release worktree 구성. 과거 검증 branch 전체를 통합하지 않고 승인 파일만 반영. core client 파일 보존 검사17건과 check/build pass. 운영 DB 일부는 존재 확인됐으나 모든 조건 확인 전 최종 배포 승인으로 주장하지 않음.
