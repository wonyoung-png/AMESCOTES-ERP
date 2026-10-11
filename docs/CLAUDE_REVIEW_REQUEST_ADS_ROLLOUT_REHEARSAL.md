# 별도 DB 재현 단계 검토

scripts/ads-rollout-rehearsal.sh만 집중 검토. scripts/ads-rollout-prepare.sh가 생성한 서버 내0700 백업을 네트워크/포트 없는 새 PostgreSQL컨테이너에 복원해 신규 마이그레이션 전체를 단일 트랜잭션으로 재현합니다. 기존 운영 DB/app/코드/원격aws-migration은 변경하지 않습니다. 사용자 개인정보는 서버 내부에만 남고 stdout/모델에 노출하지 않습니다. 별도 컨테이너는 완료/오류시 stop하며 복구 가능한 상태로 보존합니다.

실행 전 차단 P0/P1 및 전체BEGIN/COMMIT 제거 방식(PL/pgSQL 함수 본문 손상 여부), 복원 시 선행 역할/함수/데이터 무결성 검사를 봐주십시오. 실제 운영 전환/롤백은 아직 별도 검수 전이며 이 검토를 배포 승인으로 쓰지 않습니다. 최신 대표님 승인 및 이전 검토는 ADS_ROLLOUT_EXECUTION.md와 CLAUDE_REVIEW_RESULT_ADS_ROLLOUT_PREPARE.md에 있습니다. 메모리/.env/비밀/개인정보/외부서비스는 읽거나 실행하지 마십시오. 귀하는 읽기 전용 리뷰어입니다.
