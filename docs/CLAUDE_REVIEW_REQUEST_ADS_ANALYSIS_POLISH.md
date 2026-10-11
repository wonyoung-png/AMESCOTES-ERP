# 마지막 작은 권고 2건 확인

C:/Users/이원영 AMES/AMESCOTES-ERP-ads. Read-only 소스와메모리만; 테스트/모델/API/비밀값/파일쓰기/운영 금지. 이전 ROAS 필수1건해결·이전3건해결·새차단없음 판정을 다시광범위탐색하지말고 아래2개변경만확인:

server/ads-council.ts groundedText(v,s,limit=700), action.reason 호출에서limit240전달. 검증전4000사전상한→숫자치환→700또는240최종상한, 경계수치제거. 별도의 .slice240 제거. council.test의697/237자+3.25 경계시험.

server/ads-context.ts alerts.sort에서auth_unavailable/token_renewal/account_status/account_disabled를12개상한앞으로우선순위, 원본alerts는변경없음(filter.map으로만든새배열sort). context.test의ROAS경보20개와accountstop가0번째보존. scope/숫자변조없음.

docs/CLAUDE_REVIEW_RESULT_ADS_ANALYSIS.md와위2소스/테스트부분만읽기. focused74통과와전체668통과는Codex실행이며Claude실행아님. 모든sourcefreeze후전체회귀재실행중. 두권고해결/미해결, 새필수차단있으면보고·없으면명시. 운영승인아님.
