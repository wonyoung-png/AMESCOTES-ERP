# Shopify 인증 경계 지적 반영

읽기 전용. .env/비밀/실자료읽기·명령·운영쓰기금지. 대상 이전요청의shopify-client.ts/test.ts,ads-orders.ts/test.ts,prepare-ads-shopify-auth.py.

직전P1반영: shopifyClient(rt,allowCredentialGrant=false) default로상품adapter/monitor는기존대로고정토큰없으면미연결. 광고reader만 true로명시. 광고optinclient는write=true일때무조건차단,document는query로시작하고mutation/subscription단어없는것만허용(고정서버쿼리만사용). PRODUCT_WRITES가나중에true로바뀌어도ads권한으로productmutation불가. defaultcaller광고flagtrue미연결/optin write true차단,write=false로mutation위장해도네트워크전차단테스트추가. 관련81/81이전통과+최종재실행예정,원래상품adapter/monitor수정없음.

P2 helper는기존static token있으면덮어쓰지않고stage자체실패. 성공시STATIC_TOKEN_PRESENT=false출력. ShopifyGETscope기존앱직접진단성공(대표주문조회인증허용),tokenexpires86399,readorders/products/inventorytrue,상품쓰기0,토큰값출력0.

P3backup지적은현재구조에서는비해당: /opt/app/backups는실제Git /opt/app/src/erp 밖. 기존host.env600/컨테이너env_file이라원래접근권한600유지. 기존daily와ERP는같은Shopify앱키이므로키회전시양쪽동시갱신기록예정. cache는client내한번/페이지호출별grant안함,질문·market새client별authPOST정해진조회당1회만이므로globalcache추가미진행(요청context별환경·transport오염방지). 500/네트워크불확실OAuth재시도없음·429거절만재시도 기존request재사용. 실패원문절대출력없음.

Authscope는Shopifyprovider발급시변경불가하나adcallerquery강제·writecapability차단으로기존상품API에권한전파안함. P0/P1해소만판정. 검토후환경준비/자동배포/실제질문은연결상태미확인을명시해진행(명세오류/데이터없음보고계속조항). 카페24callback변경승인아직대기,ClientSecret미열람,scope확장안함.
