# 신규 조회 앱 인증 연결 보안 검토

실제 읽기 전용 교차검토를 요청한다. 비밀키/운영 개인정보/.env 읽기, 수정/커밋/운영 명령 금지. 대상 server/channels/cafe24-connect.ts 및 .test.ts, cafe24-auth.ts, server/ads-orders.ts, ads-council.ts의 라우터 연결 부분.

대표 승인: 기존 ATLM ERP 앱은 app-daily 운영 서비스가 쓰므로 절대 변경/재사용하지 않음. 새 AMESCOTES ERP 조회 앱 생성 및 주문/상점 읽기만 ERP 연결 허용. 실제 새 앱 생성·저장 완료: appURL ERP HTTPS, callback fixed ERP /api/ads-council/cafe24/callback, order/store READ, FrontAPI disabled, Asia/Seoul. Cafe24 필수 Application 읽기+쓰기 제거 불가이나 상품/주문 쓰기 권한 없음. ClientSecret 미열람, 아직 서버 반영/OAuth 실행 없음.

신규 코드: CEO email+role 매번 DB 인증, same-origin authorize, 10분 HttpOnly Secure Lax cookie+서버 bounded map+owner, 일회용 callback consume before POST, fixed scope/URL/mall, no auto retry uncertain auth POST, 기존 channel_tokens schema 빈 auth row만 seed(ignore duplicate), 기존 lease로 claim→초기 연결만(기존 live token 있으면 중단)→validate narrow scope/token/timezone→save, clean callback redirect, raw error/code/key 출력 없음. 광고 전용 CAFE24_ADS_OAUTH_REFRESH_ENABLED optin으로 기존refresh module호출, globalproduct OAuth/merchant writes false유지. 기존refresh module이 제공한 토큰 시간/범위 검증도 확인해 신규apprefresh 안전성 판단. 신규 SQL 스키마 없음. Meta GET only 보존.

P0/P1 및 실제 시나리오 누락 검토: 직원/guest 차단, nonce replay/expiry/owner/cookie, CSRF, pendingMap exhaustion, 기존daily token충돌, OAuth uncertain persistence, callback query로그 위험, 운영 토큰 조기 갱신 때 scope/expiry 검증. 필요한 수정만 근거와 파일 위치로 제시. 실행하지 않은 테스트를 성공이라 말하지 말 것. 현재 단위 테스트 별도 실행 중.
