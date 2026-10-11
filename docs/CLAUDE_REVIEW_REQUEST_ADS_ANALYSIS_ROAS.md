# 3차 추가 필수1건 수정 확인 — ROAS 미제공

C:/Users/이원영 AMES/AMESCOTES-ERP-ads. Read-only 소스/대표메모리만. API/모델/테스트/운영/파일수정/배포/비밀값 읽기 금지. 요청 FIXES의 3건이 모두 해결됐다는 이전 정적 결과를 유지하고 아래 변경만 좁혀 확인하십시오.

이전 조건부 필수: 현재ROAS 없는 고지출광고가projection에서통째로빠짐. 수정 ads-context.ts는 실제current spend를항상선택하고 ROAS는존재할때만선택. previous도측정spend만보존가능, 미제공은0으로보충않음. analysis_roas partial출처와ads-data.ts buildAdsAlerts의roas_unavailable 경보는집행액 factId근거만사용, 구매0/성과저조단정없음. 선택상한/같은ID/hash는유지. ads-context.test.ts 가장비싼missingentity 유지/실제로제공ROAS0구분, ads-data.test.ts 경보회귀추가.

이전P2 groundedText 숫자잘림: 수치검증전700상한을4000으로늘리고치환후700최종상한·경계수치토큰제외, 697자+3.25가3.2로남지않는테스트. council.test최대입력은80근거스냅샷으로증강, mock16001paidcreate0. 실제최대token카운팅은미실행·운영검수사항, 진짜토큰합격주장금지.

대상 server/ads-context.ts/test.ts, server/ads-data.ts/test.ts(추가경보부분), server/ads-council.ts/test.ts(groundedText/최대입력테스트부분), docs/CLAUDE_REVIEW_RESULT_ADS_ANALYSIS.md. 그외광범위탐색불필요. 현재Codex실행74/74focusedpass, 전체667/667은이변경직전통과·최종다시실행예정. 읽기전용실제실행·비밀값출력0건.

필수1건 해결/미해결과수정으로새롭게생긴차단결함이있을때만보고. 없으면그대로명시. 운영검수와코드결함구별.
