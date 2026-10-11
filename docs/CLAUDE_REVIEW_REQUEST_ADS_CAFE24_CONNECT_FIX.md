# 조회 앱 경계 수정 재검토

읽기 전용, 비밀·.env·운영 개인정보·운영 명령/수정 금지. 직전 Cafe24 결과의 대상과 db/16_ads_commerce_tokens.sql, cafe24-connect.test.ts 추가 테스트 확인.

P0: CAFE24_ADS_CLIENT_ID/SECRET, ads_channel_tokens(cafe24_ads), ads_commerce_token_claim을 별도 생성. 상품등록 channel_tokens/cafe24_erp/기존claim은 변경하지 않음. 기존 dbTokenStore와 전용 dbAdsTokenStore는 factory의 고정 테이블·channel·claim만 공유, 선택값이 외부입력 아님. ads-orders만 ADS keys를 국소적으로 기존 auth에 넘기고 별도 tokenstore사용. route는 새승인앱 publicclientid일치 강제. 운영schema적용/키배치/설치/OAuth미실행.

P1: cafe24Auth optional validateNext는 ads reader가 cafe24ReadToken을 주입한경우만 적용. 갱신 mall/scopes/token/시간대검증 후저장, 상품쓰기허용범위없는 새앱만통과. 테스트 valid/invalidrefresh저장횟수및timezone검사.

P1: authorize는 same-origin 또는 none(주소창/북마크)만허용, same-site/cross-site차단. CEO세션재검증·cookie/nonce/owner일회용유지. 별도UI추가없이 기존광고분석으로 cleanredirect, 현재 실연결 상태success 표시한적없음. UI새디자인과 실제연결확인분리.

남은 P2는 운영검수체크리스트에 남김: 최초 인증확인 실패시 재발급하지않고 사용자확인, refresh후DB저장실패는 신앱한정 복구; proxyquerylog확인필수(코드에로그없음/Caddy는accesslog있으므로실토큰발급전query제외필요). 관련테스트재실행예정. 지금 정적P0/P1해소/남은실연결차단만 판정. 운영 배포·DB 적용은 기존 대표지시대로 검수자Claude담당, 직접운영적용하지않음.
