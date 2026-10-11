# 주문 조회 인증 허용 후 교차검토

대표님이 직전 “주문 조회용 인증 발급·토큰 갱신만 허용?”에 “가용해.”라고 답해 허용으로 이해한다고 명시했고, 인증 범위만 진행. 광고/상품 쓰기·직원공개 금지는 유지.

공통 읽기전용검토, 비밀/.env/운영개인정보읽기·명령실행·운영쓰기금지. 대상 server/channels/shopify-client.ts, shopify-client-auth.test.ts, server/ads-orders.ts, scripts/prepare-ads-shopify-auth.py. 공식 https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant 확인.

기존daily 서버는 SHOPIFY_CLIENT_ID/SECRET/SHOPIFY_SHOP로 client_credentials 발급,24h메모리캐시. ERP원래static토큰만지원해새getter추가: ADS_COMMERCE_AUTH_ENABLED=true와credentials가있어야가능,static토큰은기존대로우선,고정myshopifyhost검증,고정OAuth URL만 POST,local authRuntime writecapability,상품mutationgatefalse유지. client내token캐시/동시grant단일promise/expiryvalidation/실패원문출력없음. per-client 캐시이므로새reader 생성시다시grant가능하며작업당페이지호출마다는발급안함. 500/네트워크불명확OAuthPOST자동재시도금지. 관련79/79+tsc통과,유료모델/실제토큰발급아직미실행.

host 준비helper는현재daily컨테이너EnvJSON을server내memory로만읽어기존Appcredentials를ERPhost.env에연결,민감값출력0. 0700backup/0600env,기존다른key값덮어쓰지않고불일치면변경전실패,상품쓰기false/기존상품OAuthrefreshfalse 유지,ADS_COMMERCE_AUTH_ENABLED=true만허용. 기존앱키회전·Shopify앱권한변경없음. 검토후opsbranchpush/fetchhelper단계→env준비→운영aws정상push자동배포만.

카페24developer SSO로그인 실제성공,기존 “ATLM ERP” 앱발견(8/1생성),주문/상점read scope있지만callback옛Railway. ClientSecret숨김상태이며아직읽거나저장/재발급안함. 새ERPcallback주소추가허용은별도native질문대기(보안민감UI변경ataction승인). 외부MCP/다른앱토큰은공유금지. 카페24전용콜백/초기인증연결은미진행. 이변경P0/P1및원래상품쓰기금지경계확인.
