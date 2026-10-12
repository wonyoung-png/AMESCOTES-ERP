# 실제 배포 선행조건 조치 재검토

첫 검토 CLAUDE_REVIEW_RESULT_RELEASE_KEEP_UI.md(P1 운영선행 확인)을 근거로 다음을 실제 수행했다. 읽기 전용으로 필요한 코드/문서만 재검토하고 비밀·환경값·개인자료는 읽지 말 것.

실행 증거: ames-new AWS539257524621/i-0cf424d627db8b063의 SSM 조회로 source/marker/remote afe1279 확인. 준비 중 다른 작업31ab72d(구독 고정비 아님 상태)가 운영에 배포됨. 최초preflight guard는 쓰기 전에 SHA 불일치로 중단. 새31ab72d를 release에 merge해 보존; 배포 후보ac709006528950cd127004c856c24a54b08f75b2.

이 서버의 실제 Caddyfile/auto-deploy.sh는 source와 diff0, compose는 cmp0. ROOT_DOMAIN/ERP_HOST .env key 존재True, 실행Caddy 값은 우리 도메인/정식ERP호스트와 일치. 다음 DB 읽기 boolean이 t,t,t로 통과: 구독 계약7컬럼, 임대·리스 분리 제약 및 통합분류 없음, answer_subscription_check+샘플4RPC 존재. 마이그레이션 실행0.

SSM0dcc57ae-b9ca-4c55-917f-ba8a4d3af512 성공Code0: 운영deploy.lock 획득, sourceclean31ab72d guard 및 configcmp0 후 별도 candidateworktree만 생성. 실제 app-caddy-1에서 후보Caddy validate 결과 Valid configuration. bash-n pass. PREFLIGHT_PASS 출력. 운영 앱/프록시 변경0.

신규 releaseworktree 전체client보존기준31ab72d으로 갱신해3/3pass. 이번 change목록에는 subscription server/UI/SQL 수정없음(이미운영base), 기존App/Layout/CSS/BOM/품목/자재도diff0. 참고 docs/RELEASE_KEEP_UI_PLAN.md, scripts/preserve-addons.test.mjs. 바뀐 구성은 최초검토대상(샘플 담당설정/대표복구/민감로그/호스팅/auto실패보호) 그대로.

추후 실행 순서(아직 수행 전): deploy.lock하에서 source가31ab72d이고clean/configcmp0임을 재확인; 기존앱이미지 별도tag, Caddy/compose/auto-script/marker를 /opt/app/.deployed/keep-ui-20261012에 보관; 보호auto-script만 install. env/compose/db 변경없음. 그 후 releasebranch를aws-migration에 fast-forward push(충돌/최신변경시중단), 기존active2분timer로 자동기동. 수동service/build/up호출없음. 타서비스의 source가원래와같으면재기동없음. 실패하면lock하에서Caddy/앱이미지복구, 필요하면추가revertcommit으로원격복원(force/삭제없음).

질문: 최초P1세조건이 해소됐는지, 위 순서에 여전히 운영배포차단결함이 있는지. shellerp접두어는실제ERP_HOST=erp.ameserp.kr와 일치함. callbacklog완전해결/실사용종단간완료/미완성신규기능완료를 주장하지 않음. sample_lead_required 안내P3는기존서버가실패표시·활성제품개발선택복구가능하므로후속권고로유지.
