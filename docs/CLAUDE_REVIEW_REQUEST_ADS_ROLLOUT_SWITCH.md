# 운영 전환 안전성 — 읽기 전용 검토

scripts/ads-rollout-switch.sh 및 scripts/ads-rollout-rehearsal.sh의 **차단 P0/P1**을 집중 검토하십시오. 대표님의 Codex 직접 배포/DB 적용 승인은 ADS_ROLLOUT_EXECUTION.md, 선행 검토 결과는 CLAUDE_REVIEW_RESULT_ADS_ROLLOUT_PREPARE.md에 있습니다. 공통 실행기의 귀하는 여전히 읽기 전용입니다.

준비 단계 실제 성공: 운영1ceb614 보존, 서버 내0700 DB/역할/설정/이미지 백업과 별도 image prebuild 성공, 준비 전후 운영 이미지와HEAD동일. 지급/입고/정산/알림 함수 정확한 인자와 production_orders.updated_at/defect_qty/shipped_qty, samples.sample_unit_price/image_urls/buyer_id/billing_statement_id 직접 확인. 병합본 회귀669건,격리SQL53건,타입/빌드통과. 최신구독subscriptions.ts diff없음,watch.ts는신규운영점검추가.

전환 계획: 실제백업→포트/네트워크없는별도DB 복원→전체 신규DDL 단일트랜잭션 재현→기존함수/트리거 보존복구SQL 별도DB실행 검증→fresh backup→운영DDL 단일commit→곧바로aws-migration fast-forward push→자동배포확인. 수동자동배포실행금지, 동일deploy.lock사용. 광고비활성·직원공개차단·상품외부쓰기false 유지. 원격운영브랜치가진행됐거나app이미지가변하면중단.

DB와push사이 실패/동시타이머/롤백 정의 보존의 실제위험을 특정해주십시오. 스위치스크립트는 아직실행전이며 DB재현성공과 이검토수정 완료 전 실행하지않습니다. 운영 DB/모델 호출 성공을추정하지마십시오. 비밀값/개인정보 읽기금지.
