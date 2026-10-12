# Claude 실제 재검토와 필수 절차 보완

2026-10-12 공통 실행기로 실제 읽기 전용 재검토 성공. 비용 USD0.46, 최초0.82와 합계USD1.28. Claude는 운영 명령이나 테스트를 실행하지 않았으며 Codex의 실제 SSM 증거 보고와 코드만 검토했다.

판정: P1 세 운영선행조건 해소. 추가 코드 배포 차단 결함 없음. 실행 전 A1~A3 절차 필수.

- A1: rollback은 merge를 무작정 revert하지 않는다. 승인 변경cf3f2bb와 대조기준ac70900 변경만 되돌리고, 기존 운영31ab72d와 모든 runtime/deploy 파일 트리가 동일한지 확인한다. 구독 '고정비 아님'과 기타 concurrent 변경 유지.
- A2: Caddy rollback은 별도 영구 보관 사본을 cp로 기존 bind file에 덮어쓴 뒤 /etc/caddy/Caddyfile로 reload한다. mv/install로 inode를 바꾸지 않는다. 매 실행 덮어써지는 Caddyfile.previous를 원복 기준으로 사용하지 않는다.
- A3: 운영lock 하에서 source/marker/origin 모두31ab72d, installed script sourcecmp0 재확인. timer ExecStart가 /opt/app/auto-deploy.sh인지 확인 후 같은 디렉터리에서 임시 script를 원자적으로 교체.

P2 잔여: Caddy는 app보다 먼저 바뀜, build실패 재시도 부하, shell은 sourcecheckout 변경 즉시 반영됨. 이번 Caddy diff는 라우팅 보존·로그 보호이고 운영환경 검증 통과. 앱실패 시 프록시도 원복하는 별도 절차 준비.
P3: RPC signature/grants 실제 동작, 안내 문구 보강 후속. 샘플→비서실 실제 종단간 검증 미실행 상태 유지.

대표의 직접 사용 피드백은 배포검증과 구분하며 실제 배포 SHA/이미지/health/브라우저를 확인하기 전 완료로 보고하지 않는다.
