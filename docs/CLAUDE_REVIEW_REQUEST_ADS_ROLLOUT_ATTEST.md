# 실제 배포 완료 증명 긴급 읽기 전용 검토

대표는 Codex 직접 운영 적용 승인. 광고 쓰기/상품 쓰기/직원 공개 금지 유지. 비밀키 및 운영 개인정보 읽기 금지.

실제 DB7마이그레이션 원자 적용 성공, 격리 실제백업/복구증명 성공, 자동파이프라인으로 앱교체 성공. 목표SHA3e8089e95af4b2c72b7eea6175523ce18bbadd63. 서버health200,새image실행,restarts0. 운영배포로그14:17배포완료,systemdexit0. 기존도구6회검토USD3.77.

발견: 설치된 /opt/app/auto-deploy.sh는 구형이며 소스HEAD변경감지만 사용, `.deployed/erp`기록기능 없음. 저장제한/복구를 담당하는 진행중switch는 repo의 신형배포기 상태기록을 기대하여 최대10분대기 중. live DB와 app는 정상이며 기존app로 되돌리는 건 올바르지 않음. 시간초과시 timer disable,maintenanceheld,abortmarker이므로 그런 경우 attest실행거부.

검토대상 scripts/ads-rollout-attest.sh 와 scripts/ads-rollout-switch.sh. attest는 공통deploylock아래 실제새앱 healthy,소스·원격 정확SHA,신규DB7개,내외health,모든dist파일이 별도 사전빌드한 pinned이미지와 일치하는지를 증명한 뒤 확인된 .deployed/erp만 기록. 배포/앱교체/DB변경 없음. switch가 이를 읽고 정상Caddy복원/저장제한해제. marker위조나HEAD만추측으로 성공표시하지 않음. 기존auto-deploy스크립트는 이작업에서변경않음.

P0/P1 안전 문제를 판단하고 최소 수정 제안. 실제 운영에쓰기/실행/커밋/배포 권한없음. 긴 로그나 다른자료 읽지말고 위2파일만검토. 이 질문은 실제최종운영증명검토이며 시안검수 아님.
