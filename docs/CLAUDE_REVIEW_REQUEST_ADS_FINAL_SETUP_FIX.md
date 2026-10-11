# 피드백 전 설정 보강 — 지적 반영 재검수

공통 실행기 읽기 전용. 비밀/.env/개인정보/운영실행금지. 이전검토USD0.65. 대표전체세팅+운영권한있음,광고GET만/상품쓰기금지/직원금지 유지.

직전P1:
1. installer 순서: 새커밋을 **ads-rollout-20261011 비운영브랜치에만 먼저push**, 서버그브랜치fetch(HEAD원래3e유지), git show SHA로installer/newhelper읽기. DB/app반영은아직없음. 기존HEAD=deployed3e일때installer만교체한뒤aws-migration normalpush. 운영브랜치먼저올리지않으므로그지적은해당없음. 실제실행도그순서고정. 설치된legacyhash=b6d8513f29cd54945decf29fc07a69b90306a8b9aaba82dbe7dc7d1d9f4de759를검사.
2. composeup실패도 restore_previous 실행, 실제돌고있는image digest를prev태그로보존.
3. 기동/health실패SHA는.deployed/n.failed기록하여같은SHA재기동금지. build실패만기존서비스유지하며retry. 새SHA수정시재시도. scripts/auto-deploy.test.mjs는실제쉘을임시폴더안mock으로실행,성공/buildfail/upfail/healthfail+동일실패SHA재시도차단5/5통과.

P2수정: plist존재검사쓰기전에이동; runner토큰은배포전준비→자동app교체→실제인증idlepoll→등록순서. 0600강화는root호스트.env의민감키보호로기존접근정책훼손없는지직접운영점검(그룹제3자읽기필요없음). key/cipher는성공등록후우리것만삭제예정. GUI재로그인후실행조건은명시하며자동로그인보안설정은변경금지.

만료알림: OFF여도하루1회 GETaccount_status로실제연결확인(토큰헤더고정host,response오류원문미출력). verifiedexpiry config갱신이옛snapshot보다우선,실제freshauth로옛실패덮음. 저장오류는다음30초retry하고유료분석을막지않음. disabled /jobs/next는job:null. server/ads-council.test.ts23/23통과(날짜/재시도/새expiry/실제authGET계약포함).

추가매핑검토: scripts/ads-market-setup.mjs/.test.mjs 9/9. 캠페인·adset모든페이지GET만,이름prefix lm-kr/gl/us와실제geo국가가일치해야verified. mixed/미확인geo거부. 전체페이지없으면실패. 결과는서버private증거JSON에저장후Codex가직접대조,그후확인된mapping만env등록. SKU/재고위치·budget단위는추정하지않고미확인표시. 실제Meta1차GET캠페인25,adset처음100이후morePagestrue였으므로최종전체pagination증거없이는설정하지않음.

위수정P0/P1차단만판정. 실운영/유료분석미실행을성공주장하지말것. 실제Cafe24ERP앱/Shopify인증발급은별도승인질문대기이며승인없으면실행금지.
