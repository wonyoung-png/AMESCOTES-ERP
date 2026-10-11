# 마지막 1건: 작업지시서 연속 저장 CAS 재검토
읽기 전용. 프로젝트 C:/Users/이원영 AMES/AMESCOTES-ERP-council.
이전 CLAUDE_REVIEW_RESULT_ERP_FINAL_FIXES.md가 발견한 마지막 1건만 확인. 다른 업무 범위를 새로 검토하지 마세요.
소스: client/src/pages/ProductionOrders.tsx의 woAcknowledged/patchWorkOrder, client/src/pages/ProductionOrders.transmission.test.mjs의 queue 테스트, client/src/lib/dbQueries.ts의 upsertOrder.
수정: 각 초안의 앞선 저장 Promise를 WeakMap으로 연결, 해당 predecessor가 성공한 원본 버전만 다음 저장에 전달. 실패한 predecessor는 후속 초안 저장을 막고, 성공 후 현재 화면에 확인 버전 전달. 신선한 서버 값을 읽어 CAS를 우회하지 않음.
질문: 빠른 연속 입력에서 둘 다 저장되는가? 앞선 실패/외부 변경을 우회하지 않는가? 실무자가 다른 발주를 열어도 서로의 버전을 섞지 않는가? 구체적인 수정 필수 오류가 없으면 resolved로 판정하세요.
Codex 실제 실행: 회귀 564/564, 관련 47/47, 타입·빌드 통과. Claude는 실행하지 말고 정적 검토만 하세요. 운영 완료/배포 승인이 아니며 운영은 별도 Claude 담당입니다. 최대 1개 필수 지적 또는 resolved, 짧게.
