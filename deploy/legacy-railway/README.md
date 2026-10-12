# Railway 배포 설정 보관

Railway는 더 이상 운영 배포 대상이 아닙니다. 기존 설정은 `.disabled` 확장자로 보존해 루트 자동 탐지를 차단합니다. 앱·업무 기능을 삭제한 것이 아닙니다.

현재 배포 기준은 `Dockerfile`과 `deploy/migrate/docker-compose.yml`, 도메인 변수 `ROOT_DOMAIN=ameserp.kr`, `ERP_HOST=erp.ameserp.kr`입니다. `deploy/Caddyfile.server`는 호환 진입점이며 `deploy/migrate/Caddyfile`과 동일한 구성을 유지합니다.

실제 배포·환경값 변경·DB 적용은 운영 담당 Claude가 검토 후 수행합니다. 보관 파일을 다시 루트로 복사하거나 실행하지 않습니다.
