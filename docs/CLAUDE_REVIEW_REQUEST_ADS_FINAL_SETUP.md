# 피드백 전 운영 설정 보강 검수

대표님 지시: 피드백전단계까지 모두세팅. Codex 운영 적용 권한 있음. 기존업무/직원공개 금지, Meta GET만·광고쓰기0, 실제상품쓰기/OAuth갱신금지 유지. 카페24전용앱 없음(인증만별도승인질문대기), 매핑미확인은 활성화차단. 새배포/app·DB7통합은3e8089e로실제healthy,735테스트통과, 이전운영검토7회USD4.04.

읽기 전용으로 다음 파일만 검토. .env/개인정보/비밀키/운영실행/커밋금지.
- server/ads-council.ts startAdsAnalysisScheduler와 새 disabled notice 테스트: 분석OFF여도 KST11월10일만료카드가 DB/비서실에서동작. 모델/외부분석호출없음, startup/day별한번쓰기, 오류시재시도. 실제자동분석 활성화는아직안함.
- scripts/macmini/ads-runner-launch.mjs,install-ads-runner.py,기존ads-runner.sh. RSA-OAEP encryptedtoken만서버SSM출력, Mac개인키는생성기기밖으로안나옴. decryptedtoken는memory/0600privateJSON만사용,argv/plist/로그/모델전달안함. OS재로그인/재부팅후wrapper로지속연결. 기존플리스트나타인변경덮어쓰기거부.
- scripts/prepare-ads-runner-token.py: .env백업privatemode,기존token재사용(임의rotate안함),empty만생성,기존키값노출0. crypto실패하면hostenv도안씀.
- deploy/migrate/auto-deploy.sh, scripts/install-ads-deployer.sh: 실제서버legacyhelper는HEAD만보고state/retry없음. 이미repo신형은기동실패/health실패에oldimage복구하고deployedSHA정확기록,다음주기retry. 해당helper를기존hash검증+공통lock+old백업+atomic교체. 수동auto-deploy실행은금지. unrelated daily/hr는state없고HEAD원격동일이면skip(배포baseline지어내지않음),다음실제변경부터state기록. ERPstate는앞선전체dist+package.json/DB/health증명으로3e이미기록됨.

P0/P1 운영반영차단,누락/중복업무입력/비서실권한경계,기존데이터보존,secret전송/지속실행 위험을확인. 실제운영실행했다고주장하지말고 정적판정+필수수정만보고.
