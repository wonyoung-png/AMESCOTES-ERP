# 운영 전환 필수 지적 수정 재검토

이전 실제 결과의 P1 네 건을 scripts/ads-rollout-switch.sh에서 수정했습니다. 읽기 전용으로 이 파일과 scripts/ads-rollout-rehearsal.sh, 아래 범위만 집중 검토하십시오. 배포/DB/비밀/개인정보 읽기 금지.

1. 함수정의 세미콜론 추가, extension 소속 제외. 기존핵심 payment/settlement 함수 proacl 권한 복원SQL 포함. 새테이블/열/함수/인덱스는 롤백시 남기되 구앱보호트리거와기존함수/ACL만정확복구하는정책입니다.
2. 별도 DB에서 복구SQL 성공검증 후 운영 전환. sha256확인, 운영 기존이미지/소스/원격HEAD동일검사. 복구hash동일검증은 추가 보강 전입니다.
3. 현재Caddy ERP/CEO POST/PUT/PATCH/DELETE 임시503차단. 현재대표만사용, 직원공개차단유지. 이 창에서는 저장을 재시도해야 하며 회사원장업무자동생성은 하지않습니다. 기존server/watch는조회및업무카드생성이고샘플/금액원장자동수정은없음. 해당주요경로 직접점검의범위는판정에서구분하십시오.
4. DB커밋뒤database-ready파일을Codex가읽고2분안에normal fast-forward push. 동일deploy.lock과쓰기차단유지, push실패/다른원격커밋이면기존함수·ACL복구. 해당원격커밋확인후잠금만풀어자동배포를기다림. 성공은실제.deployed/erp SHA+health+이미지변경모두필수. 10분실패면타이머중단및maintenance유지,검수된revert를force없는fast-forward로만push하고복구후재개. 중간쓰기를막기위한임시Caddyfile은autoscript가copy하지만Caddy프로세스는명시reload까지임시설정을유지합니다. origin/aws-migration과병합본의compose/Caddyfile diff는없음을Codex가직접확인했습니다.

준비 실제백업·빌드 및 별도DB복원/마이그레이션재현성공, 기존원장5테이블행수전후동일. 타입/빌드/전체735건통과. 대표님직접배포·DB승인확인,비활성분석/외부상품쓰기금지/직원공개차단유지. 수정판실행차단P0/P1을반환하십시오. 정적검토를운영승인증거로과장하지마십시오.
