# 마지막 전환 지적 재검토 (파일만)

scripts/ads-rollout-switch.sh의 직전 P1 두 건을 수정했습니다. 귀하는 읽기 전용 검토자이며 `.env`/비밀/개인정보/운영실행금지입니다. 아래수정의실행차단여부만검토하고같은범위새P0/P1을보고하십시오.

- Caddy respond 순서 문제: ERP snippet의 handle/handle_path만 route{}로 감싸 explicit order로 respond를 먼저 적용. log는route밖. CEO reverse_proxy도route{}. 실제reload후 ERP API/REST·CEO 세가상미존재경로POST503검사,실패시DBcommit전중단. 픽셀경로 /api/pixel/* 제외로추적손실방지(금액/샘플업무쓰기아님).
- 늦은push: DBcommit후remote확인전의모든실패 cleanup에서타이머를멈추고switch-aborted를기록후기존함수/권한복구. Codex는push직전 aborted없음+database-ready+본SSM InProgress를확인. fetch실패재시도. timer가멈추므로뒤늦은push가운영반영되지않음. 성공확인후만잠금해제. 자동배포실패시타이머중지+maintenance지속,force없는사전준비revert e9ed585(운영1ceb614와동일tree)로만복구.
- trap을Caddy수정전에설치. 실패시기존파일복원. exit9는임시설정파일도재보존하여재시작시차단유지.
- 복구후기존핵심두함수정의hash/ACL(role이름기준)/기존여섯trigger정의hash 비교추가,함수owner복원. 이비교가실패하면운영쓰기를시작하지않음. 새테이블/열/새함수/인덱스는롤백에도유지하고레거시함수/보호trigger만복원하는정책입니다.

범위:입력샘플/원장쓰기잠깐503차단,새분석은비활성,직원접근막음,외부상품/광고쓰기0. 준비·재현 실제통과,본스위치는아직미실행. 승인최신대표‘응’이며자동배포파이프라인유지. 이미검토된관련파일외다른리팩토링제안은하지말고실제차단만판정하십시오.
