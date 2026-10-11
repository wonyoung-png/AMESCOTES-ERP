# Shopify 인증 경계 재검토 결과

- 실행: 2026-10-12, 공통 Invoke-ClaudeReview.ps1, 실제 읽기 전용 검토.
- 비용: USD 0.36 (같은 인증 작업 1차 0.43 + 재검토 0.36 = USD 0.79).
- Claude 판정: 앞선 P0/P1 정적 지적 해소, 환경 준비→자동 배포→연결 미확인을 명시한 실제 질문 검증 진행 가능.
- 반영: 상품/모니터 기본 client는 자격증명 grant 금지. 광고 reader만 명시적 opt-in, query 강제 및 mutation/write 차단.
- 반영: static token이 있으면 환경 준비 중단. 성공 시 static token 없음 출력.
- Codex 검증: 관련 81/81, 전체 단위 713/713, tsc 및 build 통과.
- 기존 Shopify 운영 앱과 token 병행: 실제 서버의 2회 인증 발급 및 두 토큰 조회 성공, 같은 현재 토큰 반환. 상품 쓰기 0건. SSM 9748633b-206b-4a56-9ae6-21ab327f0323.
- 남은 P2: 불확실한 OAuth 오류는 공개 결과에서 일반 조회 실패로 축약되지만 재시도하지 않음. 환경 반영 후 실제 컨테이너 확인 필요. 기존 앱 키 회전 시 daily/ERP 양쪽 동시 갱신 필요.
- backup 지적: 실제 /opt/app/backups는 /opt/app/src/erp Git 밖이므로 .gitignore 대상 아님. env 0600 유지.
- 범위 밖: 운영 배포와 모델 실제 참여는 이 결과만으로 성공 판정하지 않음. 신규 Cafe24 앱/콜백은 별도 검토 대상.
