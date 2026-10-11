# CRLF 근본 수정·러너 연결 가시성 최종 검수

공통 읽기 전용. 비밀/.env/운영개인정보읽기/명령/운영쓰기 금지. 대상 .gitattributes, scripts/macmini/ads-runner.sh, ads-runner.test.mjs, install-ads-runner.py, scripts/auto-deploy.test.mjs, server/ads-council.ts/test.ts, server/ceo-console.html/test.ts, CLAUDE_REVIEW_RESULT_ADS_FINAL_SETUP_LIVE.md.

직전P1반영: *.sh text eol=lf, 원본 LF 정규화 및 git add --renormalize 해당runner파일만. 테스트원본read의replaceAll제거+CR없음 직접assert, exactembedded/actualshelltest32/32통과. installer방어정규화는유지. 현재맥미니 실제runtimeLF확인,launcher--once 종료0,agent25371running을이후또조회running동일확인. 원본정규화SHA와운영파일SHA직접대조할예정.

직전P2연결가시성반영: auth검증및runnerID문자검증이후 macmini의GETpoll을 분당1회 notices.codex_runner로lastseen저장(기존테이블추가DDL없음). 분석OFF시heartbeat외lease나모델호출없고job:null. 저장실패503/재시도가능. 대표summary는notices조회결과에서runner상태별도반환:5분내connected,그후stale,없음/잘못된값/미래시각unavailable. 작업최대220+10초동안폴링중단되므로5분기준이의도적. 비서실화면은접속시각·연결/지연/미확인표시및모델참여와별개명시,escape유지. 관련HTTP/경계/시계/UI테스트31/31/타입검사통과. 새앱은아직운영반영전이며최종검토후정상aws-migrationpush+자동배포만사용.

P0/P1차단만확인. 이변경이중복입력/사업자료에영향주지않는지검토. heartbeat는특수운영상태이며직원업무카드/재무/상품/광고에쓰기없음. MetaGET만/상품쓰기금지/직원공개금지 유지. 인증승인대기/3모델실제미실행은차단항목으로남김. 실제운영성공으로추정금지.
