# AWS 러너 보안 보강 후 제한 검토

읽기 전용. 비밀/.env/auth 캐시/PII 접근 및 운영 명령 금지입니다.
대상 deploy/aws-runner/network-guard.sh, ames-ads-network-guard.service, scripts/macmini/ads-runner.sh 및 test.mjs, scripts/aws-ads-runner-model-smoke.mjs, scripts/aws-ads-runner.test.mjs.
이전 FINAL 리뷰(P1 5건)를 검증해 필요한 변경만 적용했습니다. 새 코드에 대해 새 P0/P1 회귀와 미해결 범위를 간결히 확인해주세요. 운영 ERP 배포/DB 변경은 금지 상태이며 실제 전체 광고 workflow 미완료는 유지합니다.

- worker에 --json 이벤트를 읽되 외부 로그에 출력하지 않는 2MiB 한도를 추가했습니다. turn.completed 필수, item.type reasoning/agent_message 외 항목이 나오면 ERP 결과 제출을 실패로 차단합니다. 도구 호출 이후 영향을 되돌리는 기능은 아니며 원래 shell/unified_exec/plugin/MCP/web 비활성화 플래그가 실행 방어입니다.
- 결과에 정확한 runner token 또는 JWT 패턴이 있으면 출력 제출을 차단합니다. 모든 종류 credential을 탐지한다고 주장하지 않습니다.
- 실제 모델 smoke에 프롬프트 주입 질문을 넣었습니다. 이벤트 검사 통과 시 도구 호출0을 확인합니다. 현재 AWS 신규 이미지 실모델 재검증 진행 중이므로 그 성공을 아직 주장하지 않습니다.
- dedicated network 실제 CIDR172.27.0.0/16을 확인해 해당 source만 DOCKER-USER에서 IMDS/RFC1918 차단, INPUT에서 host TCP 차단합니다. DNS UDP/TCP53만 예외입니다. 기존 ERP 네트워크는 변경하지 않습니다. IPv6 지원은 사용하지 않습니다. service는 Docker 시작 전에 규칙을 적용합니다. 네트워크 재생성 시 CIDR 재검증을 런북에 기록합니다.
- 실제 IMDS/호스트TCP 요청 모두 connection denied를 확인했으나 최초 정책은 내부 DNS까지 차단했습니다. DNS 예외를 보강했고 public runner API200을 다시 검증 중입니다.
- 33/33 관련 합성 회귀 통과. Docker enabled/guard enabled 확인. 기존 auto-deploy의 image prune은 docker image prune -f(미사용 dangling만)임을 확인했습니다. 검증된 활성 러너 이미지는 실행 컨테이너가 참조합니다.
- Mac disabled/서비스 부재, dedicated AWS auth600/1000, 실Codex 이전 버전 2단계 성공 및 restart후API200/heartbeat 확인 증거는 기존 결과 문서를 참고합니다. 고의 강제 종료/호스트 재부팅은 추가로 진행하지 않았습니다.
- 대표가 직접 이전 및 AWS 전용 로그인/기기 코드 활성화를 승인했고, 신규 러너만 별도 브랜치 push/설치했습니다. ERP 앱/DB와 aws-migration 브랜치는 변경하지 않았습니다.
