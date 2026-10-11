# 비서실 원본 링크 마지막 연결 확인

C:/Users/이원영 AMES/AMESCOTES-ERP-ads. 읽기전용 소스/대표메모리만. API/모델/운영/테스트/비밀값/쓰기금지. 이전필수/권고해결판정을유지하며이번연결변경만검토:

server/ceo-console.html adsOfficeRows가?ws=LUMEN&market=lm-gl&run=id 원본링크를생성했으나 UI가쿼리를무시했음. client/src/pages/AdsAnalysis.tsx adsRouteTarget은알려진market만허용하고run영숫자_-100자검증. 초기useRef target으로시장상태선택, index조회권한확인뒤 runSelection으로detail GET.100건밖과거기록도detailGET, 다른candidate를임시표시않음. 기존서버 GET/runs/:id는인증및run.market===query.market검사유지. workspace는기존ERPcontext/auth그대로. 재조회/시장변경은초기target을재사용하지않음. 화면배치/스타일추가없음.

대상 client/src/pages/AdsAnalysis.tsx/test.ts 신규adsRouteTarget/init/preferred선택부분, server/ads-council.ts GET/runs/:id 기존인증/시장검사부분, server/ceo-console.html adsOfficeRows부분. 그외광범위탐색불필요. mock브라우저회귀에해외원본및index밖oldID연결/국내조회0건추가; 실제테스트실행은Codex몫. 실제신규토큰값/운영API미실행.

연결오류해결/미해결과새차단있으면경로최소수정으로보고,없으면없다고명시. 운영검수항목구별.
