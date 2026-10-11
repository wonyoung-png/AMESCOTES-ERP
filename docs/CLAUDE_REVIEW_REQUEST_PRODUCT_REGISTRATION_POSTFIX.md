# 최종 수정판 재검토

읽기 전용. 테스트/셸/API/DB/배포/파일 수정/키 읽기 금지. 비용 한도는 공통 실행기에서 USD5.

## 대상
- docs/CLAUDE_REVIEW_RESULT_PRODUCT_REGISTRATION_FINAL.md, docs/PRODUCT_REGISTRATION_DONE.md, server/channels/README.md
- server/product-registration.ts, product-registration-store.ts, product-registration.test.ts
- server/channels/cafe24.ts, cafe24-auth.ts, shopify.ts, shopify-files.ts, monitor.ts, common.ts
- server/shop-monitor.ts, db/15_product_registration.sql
- client/src/pages/ProductRegistration.tsx, server/ceo-console.html의 상품 등록 링크/자사몰 연결

직전 Claude 지적 번호 1~12를 지금 파일 기준 resolved/partial/unresolved로만 재판정하십시오. 바뀐 코드에서 새로 생긴 실제 P1/P2는 최대3개만. 추측이나 이미 수정된 이전판 지적을 반복하지 말고 해당 줄 근거를 확인하십시오.

주요 수정: 실제색상SKU없는 다색품목차단, 품목사실만 승인해시+사이즈기준, 중간수정자전체 자기승인차단, 승인된현재원가전송, 승인/공개/재시도비동기큐, 실재고초기화1회, 공개상태유지, stable이미지파일·ERP소유사진만연결교체, OAuth상품쓰기분리, Shopify사이즈custom필드없는경우ERP기준만검사, 승인후명시적ERP값재반영, lease해제실패TTL복구, 3:4경고.

지원되지 않는 두 기능은 명시적으로 차단·보류: 정확한프리오더hardcap, 권위있는실입고증거기반자동해제. 양수재고는입고가아니므로자동해제로추정하지않음. Cafe24휴지통관리자정리·비상품파일참조검수와스킨필터변경은실서버검수자에게남김. 이한계를 구현성공으로세지않음.

실서버확인은미실행이며이검토는배포허가가아닙니다. 남는운영차단항목과코드수정필수항목을구분하고 비용줄은실행기실제값만사용합니다.
