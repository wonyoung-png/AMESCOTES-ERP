# Cafe24 분리본 실제 재검토 결과

2026-10-12 공통 Invoke-ClaudeReview.ps1 실제 읽기 전용 실행, **USD 0.44**.

- Claude 판정: 코드상 P0/P1 해소. 실제 연결은 별도 미확인이라 완료 판정 불가.
- 확인: 기존 상품등록용 키/테이블/claim 유지, 광고용 키·테이블·claim 분리, 승인된 새 client ID 일치, 광고만 갱신 응답 검증, 서울 시간대·좁은 권한·몰 일치 검사, 기존 전역 쓰기 차단 유지.
- P3 권고 반영: none navigation 허용, same-site/cross-site 차단, null 사용자/opt-in OFF/다른 owner state 거부 테스트 추가.
- 실제 변경 이후: 최초 키 '보기'가 표시되지 않았으나 AX 버튼 직접 클릭으로 새 키 확인 성공. 원문 출력 없이 RSA-OAEP-SHA256 암호화 후 우리 서버의 root 전용 폴더에 stage, 0600. 전송용 개인키만 삭제, 새 앱 키 유지. SSM 836e7a2c-7839-4c91-91e0-2fd42a5ef8f3 Success, 기존 앱/운영 env/DB 변경 false.
- 인증키 대화·리뷰·Git 미포함. 앱 설치/OAuth/token 발급/16번 운영 SQL 미실행.
- 잔여 P2: state는 단일 앱 프로세스 메모리라 재시작 중 연결 실패→새 흐름으로 재시도. 초기 연결과 갱신 opt-in 함께 켜짐. 불확실한 OAuth 및 scope 검증 실패/DB 저장 실패는 신앱만 재인가하는 운영자 복구 필요; 기존 운영 앱 재발급 금지.
- 반드시 운영 적용 전 callback code/state 접속 로그 제거, 실제 paid-order 조회 및 데이터 범위 대조. 깨끗한 redirect만으로 연결 검증 완료라 보고하지 않음.
- 비용 합계: 이번 인증 검토 **USD 1.81** (0.43+0.36+0.58+0.44). 이전 설정 검토와 별도.
