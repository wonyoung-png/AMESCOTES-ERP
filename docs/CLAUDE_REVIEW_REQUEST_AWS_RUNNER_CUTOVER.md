# AWS 러너 및 카페24 주소 변경 교차검토

읽기전용. 수정/운영명령/비밀/.env/auth.json/PII 읽기금지. 대표최신명시지시: 카페24 기존앱 주소변경과 맥미니러너 우리AWS이전 같이실행. 기존앱키·권한유지, 상품/주문/광고변경금지. ERPapp배포/SQL적용은이번범위아님.

카페24실변경완료: 기존daily사용앱ATLMERP의AppURL=https://daily.ameserp.kr,redirect=https://daily.ameserp.kr/api/cafe24/callback, 저장성공/재조회동일/선택권한배열동일. 서버실runtime redirect와clientid일치확인,키보기/재발급안함.

대상 deploy/aws-runner/Dockerfile,compose.yml,scripts/prepare-aws-ads-runner.py, 기존 scripts/macmini/ads-runner.sh 및 ads-runner-launch.mjs. 4GB/aarch64/26GB여유우리AWS서버,기존업무앱무변경. Codex0.162.1현재Mac동일pin+Node24+실제쉘worker그대로사용. 별도컨테이너nonrootuid1000/readOnlyroot/dropALL/noNewPrivs/768m/0.5cpu/pid96/noports/hostnet/dockersock/ERPenv,본인privateconfig와Codex캐시만mount. Codexchildenvwhitelist로runner/Meta/AWScredential미상속,exec read-only/toolspluginsdisabled/high/gpt6.1sol기존계약보존.

기존API heartbeat는논리runnerId=macmini를확인하므로AWS도논리ID그대로사용(물리호스트와구분문서화),ERPAPI/lease/schema변경없이교체. 분석OFF실확인→source배치/build→기존Mac인증캐시를서버publickeyhybridenvelope로암호화전송(credential원문stdout/SSM명령/리뷰/Git금지)→AWS loginstatus및합성fixture로실Codex2단계실행→이전Mac activejob0/analysisOFF확인→launchctlbootout→AWS컨테이너기동→실API heartbeat/idle조회검증→자동재시작확인. 새이미지추가만하며기존app컨테이너수동교체/운영DB마이그레이션안함. 실패하면AWS중지하고Macbootstrap복구,둘을동시에productionpoll하지않음. Cachecopy는공식OpenAI headless guide지원,새auth범위확장없고동일회사서버만,Mac캐시원본삭제안함. 인증자동회전충돌없게cutover후AWS만model실행.

P0/P1와cutover누락만검토. 실제모델fixture출력은서버API에가짜run으로저장하지않고테스트서버만사용. 운영3모델분석은명세전체별도검증이지이전성공의증거로혼동안함. 준비script는기존config있으면덮어쓰지않음. 아직AWSbuild/auth/model/cutover미실행,테스트예정으로표시.
