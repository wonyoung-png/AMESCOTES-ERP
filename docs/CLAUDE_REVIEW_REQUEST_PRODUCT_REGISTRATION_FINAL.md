# 실제 구현 교차검토 요청

대표 지시: 모르면 클로드 점검해서 완성. 읽기 전용으로 검토하십시오. 운영 API·DB·배포·파일 수정·키 읽기 금지.

프로젝트 C:/Users/이원영 AMES/AMESCOTES-ERP-council, product-registration 브랜치. 기존 ERP checkout은 건드리지 않았습니다.

## 읽을 대상
- docs/TASK_PRODUCT_REGISTRATION.md, docs/PRODUCT_REGISTRATION_FIELDS_v1.md, docs/CLAUDE_REVIEW_RESULT_PRODUCT_REGISTRATION.md
- shared/product-registration.ts
- server/product-registration.ts, server/product-registration-store.ts, server/product-registration.test.ts
- server/channels/*.ts (특히 cafe24.ts, shopify.ts, monitor.ts, common.ts)
- server/shop-monitor.ts, server/shop-monitor.test.ts
- db/15_product_registration.sql
- client/src/pages/ProductRegistration.tsx, client/src/components/product-registration/*.tsx 및 form.ts
- server/index.ts, server/ceo.ts의 새 기능 연결부, server/ceo-console.html의 자사몰 관리 연결부

## 검증할 실무 흐름
LUMEN 품목 읽기 → 작성·사진·번역/검증 → 독립 승인 → 두 채널 비공개 등록 → 예약/즉시 공개 → 채널별 부분 실패 재시도 → 수정 재승인 → 테스트 삭제·원본 보존 → 규칙 기반 비서실 점검·대표 결정 보고.

중점: 작성자/수정자 자기 승인 차단, 품목 읽기 전용, 필드 누락, SKU 색상 구분, KRW 공급가를 USD cost로 잘못 보내는지, 재승인/동기화가 공개 상품을 숨기는지, 멱등 단계 및 저장 실패 이후 중복 상품 방지, 프리오더 종료와 한도 및 실제 입고 근거, 이미지 READY와 원본 파일 보호, 실제 외부값 점검이 거짓 drift를 만드는지, DB lease 및 원자적 보고, 직원에게 비서실 노출 여부.

## 현재 실행 근거 (검토자는 재실행하지 않음)
tsc 및 클라이언트+서버 빌드 통과. 전체 테스트 214개 중 213 통과, 이미지 재정렬 테스트 1건은 수정 담당자가 원인 확인 중. UI 로컬 목킹으로 데스크톱/모바일·라이트/다크 확인, 실제 저장이나 운영 API 호출 없음.

정적 검토와 실제 운영 검증을 반드시 구분하십시오. 실서버 검수 전 완료 선언 금지. 확인된 P1/P2만 경로·영향·최소 수정으로 제시하고, 명세상 아직 구현되지 않은 기능은 별도 목록으로 명시하십시오. 라이브 검증 부재를 승인으로 표현하지 마십시오.
