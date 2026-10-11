# 대표 피드백 전 최종 ERP 통합 준비 점검

대표 지시: 수정 ERP가 완성되면 Claude Code 최종 점검→필요 수정→최종본 업데이트까지 하고 대표는 피드백만 한다. 기존 필수 기능을 없애지 않는다. 직원 공개·재무자료 입력·법인원장은 뒤로 둔다.

읽기 전용. 셸·키·개인정보·DB·외부 API·배포·파일 수정 금지. 테스트 실행으로 주장하지 말 것. 현재 제품 등록 작업의 aws-migration push/배포/DB/실제 상점 쓰기 금지는 해제됐다고 추정하지 않는다.

## 현재 증거
- C:/Users/이원영 AMES/AMESCOTES-ERP-flow-opt : erp-flow-optimization, 2cfe619. 샘플 완료→팀장 수락→단건/월합산 기존 명세표 청구, 자재발주, 작업지시, 불량/경비 미지급·비서실 연결. 로컬 검증 문서 있음. 운영 미적용.
- C:/Users/이원영 AMES/AMESCOTES-ERP-council : product-registration, 577e9f7. 상품 등록·양 채널·대표 전용 자사몰관리. 305/305 모의 테스트/타입/빌드 통과, 운영 미적용. 2cfe619는 이 브랜치 조상이 아니므로 아직 하나의 통합판이 아님.
- localhost4184 HTML 시안은 실 ERP가 아님.

## 읽을 문서와 소스
flow-opt/docs/ERP_WORKFLOW_IMPLEMENTATION_2026-10-11.md, ERP_OEM_WORKFLOW_CONTRACT_2026-10-11.md (위 절대경로를 사용).
flow-opt/server/sample-workflow.ts, defect-approval.ts, expense-payable.ts, report-evidence.ts, index.ts.
flow-opt/client/src/components/SampleWorkflowActions.tsx, WorkCardActions.tsx; client/src/pages/SampleManagement.tsx, ProductionOrders.tsx; client/src/lib/sampleWorkflow.ts, workOrderBom.ts, hqMaterialCart.ts.
council/docs/PRODUCT_REGISTRATION_DONE.md, CLAUDE_REVIEW_RESULT_PRODUCT_REGISTRATION_TARGETED.md; council/server/index.ts, ceo.ts, agents.ts, shop-monitor.ts; council/client/src/App.tsx, components/Layout.tsx, pages/ProductRegistration.tsx.
우선 위 범위만 읽고 실제 문제 근거가 필요한 연결 파일만 추가. 광범위한 새 기능 제안·디자인 변경 금지.

## 질문
1. 샘플→사진 완료→팀장 수락→청구→상품/BOM→공장 발주/작업지시→입출고→불량 차감→월말 지급·자금→대표 보고의 정적 코드 결함/누락을 우선순위 최대5개로 보고.
2. 두 수정판을 통합할 때 server/index, agents/report, 권한, 메뉴/상품 의미, migration 선행 조건 충돌 여부. 상품 등록은 기존 품목 마스터를 읽고 신규 별도 업무 원장을 만들지 않는지.
3. 피드백 전 반드시 필요한 코드 수정과 별도 운영 검증/미지원 범위를 구분. 이미 검증했다고 주장하는 문서 오류도 확인.
4. 아직 운영 승인·완료라고 할 수 없는 이유와 최종 인계 체크리스트를 짧게 제시.

비용은 공통 실행기의 실제 비용만 기록한다. 검토 결과 자체는 운영 업데이트 허가가 아니다.
