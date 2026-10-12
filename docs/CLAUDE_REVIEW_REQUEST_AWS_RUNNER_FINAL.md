# AWS 전용 러너 실제 이전 후 검토

읽기 전용 검토입니다. 비밀키/.env/auth.json/운영 개인정보 접근과 운영 명령은 금지입니다.
대상: deploy/aws-runner/Dockerfile, compose.yml, scripts/aws-ads-runner-model-smoke.mjs, prepare-aws-ads-runner.py, scripts/macmini/ads-runner.sh, ads-runner-launch.mjs.

최신 대표 승인으로 계정 기기 코드 로그인을 켜고 AWS 전용 새 ChatGPT 인증을 만들었습니다. Mac 공용 인증 캐시는 복사하지 않았습니다. 전송용 개인키는 삭제했습니다. AWS auth.json uid1000/mode0600 확인, login status ChatGPT 확인. 실제 hardened 컨테이너에서 실제 Codex independent 및 cross_review를 localhost 합성 API로 실행했고 두 단계 통과했습니다(SSM 6529c589-9ff0-4694-8d9f-dd369b5e635c). 운영 DB에 가짜 분석 기록을 만들지 않았습니다.
OS 표준 ca-certificates 설치 후 실제 이미지 sha256:dbb435296a7bb0a0d2bd6d1636b8a15e8864442cd81c6aa470ea151d41997558. TLS 우회 없음.
전환 직전 analysis OFF, 진행 jobs0, ERP healthy 확인. Mac launchctl disable gui/501/kr.atlm.ads-runner와 bootout 실행 후 disabled 및 서비스 부재 확인. 다른 Mac Codex 프로세스/인증/원본 plist는 유지.
AWS ames-ads-runner 상시 컨테이너 실행 확인, read-only root, uid1000, restart unless-stopped. 모든 compose 명령에 --project-directory /opt/app/ads-runner 명시. API heartbeat cleared/2026-10-11T23:54:51.137Z 확인. 별도 프로세스 재시작 복구 검증 진행 중입니다. 논리 ID macmini는 기존 운영 API 호환 식별자이고 실제 호스트는 AWS입니다.
카페24 기존 앱 App URL과 반환주소 daily.ameserp.kr 저장 및 재조회 일치, 권한 동일, 키 재발급 없음. 신규 앱 설치/OAuth와는 별개입니다. 기존 daily 주문 count GET은 별도 python core import에서 LocalProtocolError로 실패했습니다. 주소 변경 성공과 실조회 성공을 구분해야 합니다.
운영 ERP 앱 배포/DB 적용/aws-migration push 및 Meta 쓰기 없음. 광고 분석 전체 활성화나 신규 Cafe24 앱 연결 완료를 주장하지 않습니다.
보안 경계, 샌드박스, 인증 독립성, 실모델 smoke의 누락/과장, 프로세스 복구와 rollback 위험을 P0/P1 중심으로 검토해주세요. 실제 실행은 위 증거에 한정하고 추가 테스트를 수행했다고 표현하지 마세요.
