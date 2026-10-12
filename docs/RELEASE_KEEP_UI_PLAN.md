# 운영 배포 범위와 실서버 선행 확인

대표님은 2026-10-12 '클로드와 검토하고 배포해'로 Codex의 운영 코드 배포를 허용했다. Claude 공통 실행기는 읽기 전용 검토만 실행하며 운영 쓰기 권한은 부여하지 않는다.

배포 기준은 원격·실운영·배포 성공 marker 모두 afe1279c13f08ed1d5caa7550a52cd339dd6df46. release branch erp-release-keep-ui-20261012는 해당 SHA에서 새로 생성했다. 구독 기능은 이미 운영 기준에 있으므로 재복사/재마이그레이션하지 않음. 과거 검증본 서버 광고·채널 인증 차이는 이번 배포에 포함하지 않는다.

수정: 기존 설정 화면에 샘플 수락 담당 지정/복구 추가, 이메일형 reviewer ID, 대표 전용 invalid context 복구, Railway 루트 설정 원본 보관, Caddy 로그 민감 query/Referer 제거 및 두 진입점 통일, 셸 현재 도메인 연결, 자동 배포 Caddy validate/reload 실패 보호. 원래 client 245개 보존 대조, 설정 화면 한 부분 외 기존 UI/라우트/글꼴/BOM 변경 없음.

실서버 SSM 조회:
- ames-new 계정539257524621, instance i-0cf424d627db8b063, ap-northeast-2, Online.
- 운영 source와 .deployed/erp 모두 afe1279, source clean.
- 운영 Caddyfile 및 auto-deploy.sh는 해당 source 파일과 diff 없음.
- 운영 compose는 source와 동일. 이번 compose 내용은 변경하지 않음.
- 운영 Caddy ROOT_DOMAIN=ameserp.kr, ERP_HOST=erp.ameserp.kr이며 .env 두 키의 비어있지 않음만 확인.
- 샘플 RPC 4개, 구독 계약 컬럼7개와 answer_subscription_check 존재. 분류 제약 정의는 한글 출력 인코딩 문제로 별도 ASCII boolean SQL 확인 예정.
- ERP_PRIVATE_MODE=true, ADS_ANALYSIS_ENABLED=false, 상품/monitor enabled 키 unset 유지.
- erp-auto-deploy.timer active. /healthz 및 https://erp.ameserp.kr/healthz 200.
- bare https://ameserp.kr/는 서버측 TLS curl 실패35: 기존 상태이며 ERP_HOST는 erp.ameserp.kr. 이번 작업으로 해결됐다고 보고하지 않음.

적용 계획:
1. 릴리스 branch만 commit/push. 원격 aws-migration은 아직 변경하지 않음.
2. 운영 deploy.lock 하에서 릴리스 후보를 별도 worktree로 받아 실제 Caddy validate, schema boolean/기존 config 동일 여부 재검사. 운영 앱 변경 없음.
3. Claude에게 선행 확인 결과와 후보 범위를 재검토받고 필수 결함 해소 판정 확인.
4. deploy.lock 하에서 이전 앱 image tag/Caddy/compose/auto script/marker 보관하고 보호 auto-deploy.sh만 먼저 설치.
5. 원격 aws-migration으로 릴리스를 fast-forward push. 기존 2분 타이머가 자동 배포하게 함. 수동 배포 service 호출 없음.
6. marker/source/image/health/기존 화면 청크/대표 및 비로그인 접근 확인. 실패 시 lock 하에서 앱 이미지와 프록시 복구, 새로운 revert commit으로 원격을 복원. 삭제·force push 없음.

DB·OAuth·토큰·도메인·비밀번호 변경 없음, daily/hr/db 재기동 의도 없음, 실 상품/광고 쓰기 없음. 직원 접근 금지 유지.
현재 release 자체 검사17/17, 전체 함수/mock631/631, check/build pass. 원래 preserve worktree632와 다른 source 기준이므로 합산하지 않음.
