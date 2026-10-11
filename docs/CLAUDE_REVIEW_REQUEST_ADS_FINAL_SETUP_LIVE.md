# 실제 운영 검증 후 최종 설정 재검수

읽기 전용. .env/개인정보/비밀키 읽기·운영 쓰기·상품/광고 쓰기 금지. 주요 대상 scripts/macmini/install-ads-runner.py, ads-runner-launch.mjs, ads-runner.sh, scripts/auto-deploy.test.mjs 및 CLAUDE_REVIEW_RESULT_ADS_FINAL_SETUP.md. 이번 검토에서는 새 외부 인증 실행을 요청하지 않습니다.

Codex 실제 증거: 전체 순차 테스트705/705, 격리 SQL53/53, 타입/빌드 통과. 최초 무제한 병렬 테스트는 Windows 자원 부족으로 실패했고 순차 재실행으로 통과. 자동 운영 배포6e05c59 완료, image9b9a6c...healthy/restarts0, HEAD와.deployed 일치. Meta 전체 캠페인25/adset101를3 GET으로 수집, 국내21/해외4/거부0, lm-us는 US만 추가 제한. 광고쓰기0. 실행앱 runner토큰/매핑있음. 분석OFF에서도 meta_token cleared/expiry2026-11-24/checkedAt2026-10-11T16:00:42.572Z 실제저장. 무인증분석403/runner401/REST401. helper 검토blob동일, compose/Caddy 기존동일, 수동배포기호출없음. 교체 중502 한 차례는 실제일시전환 상태이며 최종healthy 확인.

맥미니 HTTP인증GET200 job:null 실제통과, LaunchAgent등록. 그러나 상시실행 후exit2 발견: gitarchive 기존 ads-runner.sh가CRLF라 /bin/sh의 set -eu\r 실패. sh -n만으로 탐지되지 않았음. 실제runtime파일을LF정규화하고 installer가 read_bytes().replace(b'\r\n',b'\n')로저장하도록 수정. node launcher--once 실제종료0, 상시재기동은별도최종확인중. scripts/auto-deploy.test.mjs에 installer정규화계약추가. 이것이 필요최소변경인지 P0/P1검토. bootstrap key/cipher는직접HTTP인증확인후우리임시파일만삭제했으며 runner.json0600/runtime0700/agentplist0600유지. GUI로그인후실행조건유지,자동로그인권한변경없음.

Cafe24ERP전용앱키/token없고 Shopify기존앱인증발급필요: 대표승인질문대기. ADS_ANALYSIS_ENABLED=false, 실제3모델유료독립분석/교차검토/최종보고는미실행. 직원공개금지유지. 이 상태를 피드백만남았다고 판정하면안됨. 결과보고는최종확인된범위만.
