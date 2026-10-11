# 수정 5건 한정 최종 재검토

읽기 전용. 키·개인정보·셸·API·DB·파일수정·배포 금지. 기존 POSTFIX 결과에서 아래 5건만 현재 코드와 회귀 테스트로 재판정하십시오. 광범위한 신규 기획/디자인 점검은 하지 않습니다. 실제 테스트 실행이나 운영 승인을 주장하지 마십시오.

대상: docs/CLAUDE_REVIEW_RESULT_PRODUCT_REGISTRATION_POSTFIX.md, server/product-registration.ts, server/product-registration.test.ts, server/shop-monitor.ts, server/shop-monitor.test.ts, server/channels/cafe24.ts, server/product-channels.test.ts, client/src/pages/ProductRegistration.tsx, client/src/components/product-registration/workflow.test.ts.

1. A: SIZE는 Cafe24 검증 매핑만 요구하고 Shopify는 ERP 사이즈 마스터 사용. 불필요한 Shopify_ref 필수 제거.
2. #8: previously_public=true 상품은 작성중/재승인 중에도 일일 실제 공개 점검 유지.
3. #9: 승인 근거는 해당 상품/자매에서 사용한 코드·분류·모델 사이즈만 포함. 무관 매핑/모델 변경은 무효화하지 않음.
4. B: Cafe24 대표 이미지 완료 기록과 미해결 업로드 의도를 구분. 완료 뒤 관리자 변경은 명시적 재반영으로 복구, 불확실한 새 업로드는 반복 방지 유지.
5. C: 프리오더 종료보다 이미 큐에 든 최초 SYNC 우선. 미생성 채널 ID에는 종료 쓰기하지 않고 안전 차단.

각 항목 resolved/partial/unresolved, 파일/줄 근거, 남는 실제 결함만 보고하십시오. 정확한 hardcap/권위있는 실입고 기반 자동 해제는 명세 충족이라고 하지 않고 차단·미지원으로 인계합니다. 실제 실서버 검수는 Claude 운영 담당에게 별도로 남습니다.
