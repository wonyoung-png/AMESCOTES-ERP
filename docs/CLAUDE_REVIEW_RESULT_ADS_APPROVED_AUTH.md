# 주문조회 인증 실제 Claude 교차검토 1차

2026-10-12 / 공통읽기전용실행기 / **USD0.43**. 요청 ADS_APPROVED_AUTH.md. P0없음/P1: 전역adsflag가공용Shopifyclient상품·monitor까지연결할수있음. P2: static토큰우선이면새auth가조용히무시됨. P3: 실패구분/캐시범위/키회전/helper접근정책 권고. Claude는테스트·운영·공식웹문서를실행/조회하지않았음.

반영: defaultcaller credential grant불가, ads-orders만명시허용. adsoptin은query만/write=false만가능,globalwritesflip에도merchantmutation차단. static토큰있는hoststage거부/없음성공출력. 관련경계테스트및adsreader통합테스트추가. 공식Shopifyclientcredentialdoc/2026-10queryschema검증은Codex가직접완료. 백업은실제Gitworktree밖이고.env600이므로권한지적은현재호스트구조상비해당; 키회전동시갱신필요는운영메모에남김.

대표님승인은주문조회용auth발급·토큰갱신이며상품/광고쓰기금지유지. 실제ShopifyauthPOST+GETscope성공/상품쓰기0,키·토큰값출력0. 카페24ATLMERP앱기존발견/oldRailwaycallback변경승인별도대기. 새adapter운영반영전재검토중.
