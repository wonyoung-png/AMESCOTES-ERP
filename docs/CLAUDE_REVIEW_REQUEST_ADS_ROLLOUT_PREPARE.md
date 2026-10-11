# 운영 사전 준비 집중 검토

이전 실제 검토 결과 docs/CLAUDE_REVIEW_RESULT_ADS_ROLLOUT.md를 참조하십시오. 대표님은 Codex 직접 배포·DB 적용에 명시적으로 ‘응’으로 승인했습니다(ADS_ROLLOUT_EXECUTION.md). 그보다 오래된 담당 메모리는 이번 요청에 한해 변경됐습니다. 귀하는 읽기 전용 검토자입니다.

scripts/ads-rollout-prepare.sh의 고정 SHA·현재 체크아웃 검사·배포 잠금·DB/설정/기존 이미지 백업·선행함수 확인·별도 pinned worktree prebuild가 기존 운영 앱/DB를 변경하지 않는지 검토하십시오. 이 스크립트는 DB 변경이나 운영 컨테이너 교체가 전혀 없는 **준비 단계**입니다. 후속 원자적 DB+자동배포 전환/롤백 검수가 통과하기 전에는 운영 전환하지 않습니다. 따라서 준비 단계에 실행을 막을 실제 P0/P1만 지적하십시오.

추가 확인: 현재 병합본 server/subscriptions.ts는 origin/aws-migration과 변경 없음. server/watch.ts는 운영 업무 점검 확장뿐이며 구독 배정 코드를 삭제하지 않았습니다. scripts/macmini/ads-runner.test.mjs의 CRLF 정규화 후 27/27 통과, 변경은 테스트 입력의 줄바꿈만입니다. 타입/빌드 및 격리SQL53/53 통과.

비밀값/.env/개인정보 및 이전 비용큰 세션은 읽지 마십시오. scripts/ads-rollout-prepare.sh와 위 문서/명시 소스만 확인하고 비용줄 포함 결과를 반환하십시오.
