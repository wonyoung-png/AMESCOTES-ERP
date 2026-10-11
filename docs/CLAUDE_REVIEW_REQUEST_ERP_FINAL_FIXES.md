# ERP 최종 통합 필수 지적 재검토

대상 프로젝트: C:/Users/이원영 AMES/AMESCOTES-ERP-council. product-registration 브랜치에 erp-flow-optimization(2cfe619)을 로컬 통합 중이며 수정은 모두 동결했습니다.
대표 권한 결정: 코드 통합·검증 후 Claude 운영 담당이 적용. 이번 실행은 읽기 전용 검토이며 운영 적용 담당과는 다릅니다. 테스트/DB/외부 서비스 실행 금지, 비밀/운영 개인정보 읽기 금지.

기존 docs/CLAUDE_REVIEW_RESULT_ERP_FINAL_READINESS.md의 필수 지적이 실제로 해소됐는지만 소스 확인해 주세요. 새 요구 기능을 광범위하게 발굴하지 말고 최대 3개 수정 필수 오류만 제시하세요. 알려진 미구현 범위는 운영 인계 보류사항으로 유지합니다.

1. server/index.ts: sample-workflow, defect-approval, expense-payable 및 product-registration/shop-monitor 라우트가 함께 연결됐는지.
2. server/sample-workflow.ts, supabase/migration_sample_workflow.sql: 이름/직책 추정 대신 대표 명시 reviewer 설정 또는 유일한 활성 대표 기본값; 저장된 샘플 담당자/대표만 수락·청구. sample-workflow SQL 테스트 참조.
3. client/src/lib/dbQueries.ts, productionOrderPersistence.ts, syncFromDb.ts, store.ts 및 pages/ProductionOrders.tsx: 필드 한정 공장 전달/컨펌 저장, DB 원본 버전 CAS, 신규 insert가 기존 입출고를 덮지 않는지. productionOrderPersistence.test.ts 참조.
4. components/SampleWorkflowActions.tsx: 원가 자동 청구 제거, 명시 청구금액만 사용.
5. supabase/migration_sample_settlement.sql: 기존 settlement RPC 보존, 샘플 양방향 연결 검증·고정금액 검증·원자적 상태 변경, 샘플 청구와 잠금 순서 충돌 여부. supabase/tests/sample-settlement.test.mjs 실제 격리 SQL 테스트 참조.
6. lib/phase1.ts 및 pages/PayablesManagement.tsx: 미분류 과거 불량을 임의 차감으로 표시하지 않음.
7. server/report-evidence.ts, ceo.ts: incomplete 자사몰 보고는 unknown이며 대표 확정 판단에서 제외.

Codex 실행 증거: 전체 서버/클라이언트 회귀 560/560 통과, tsc 및 build 통과. settlement 추가 격리 SQL 21/21 통과 보고(전체 SQL 재실행 중). 운영 DB/실제 채널 E2E는 미실행. 정적 검토를 실행 검증으로 표현하지 마세요.

출력: 수정 필수 오류(파일·영향·근거) 또는 기존 지적별 해소 여부; 운영 인계 보류사항을 완료로 오인할 위험이 있는지 짧게 판정. 전체 ERP 완료/운영 배포 승인이라고 표현하지 마세요.
