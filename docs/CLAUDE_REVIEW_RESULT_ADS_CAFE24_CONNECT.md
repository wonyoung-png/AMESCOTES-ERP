# Cafe24 신규 조회 앱 실제 Claude 교차검토

2026-10-12 공통 읽기 전용 실행기, 비용 **USD 0.58**. 정적 검토이며 Claude는 테스트/운영 명령을 실행하지 않음.

## 판정 및 반영

- 초기 판정: 서버 반영/OAuth 실행 금지, P0 토큰/키 저장소 공유, P1 갱신 응답 검증 누락 및 연결 시작 경로 없음.
- P0 반영: 신규 CAFE24_ADS_CLIENT_ID/SECRET와 ads_channel_tokens(cafe24_ads), 전용 claim 함수로 분리. 기존 channel_tokens(cafe24_erp)·상품등록·모니터 경로 유지. 연결 route는 승인된 새 앱의 공개 client_id 일치도 확인.
- P1 반영: 광고 전용 갱신 응답에 narrow scopes/mall/token/Asia-Seoul expiry 검증 적용. 상품등록 갱신은 기존 계약 유지.
- P1 반영: 주소창/북마크 최상위 navigation의 sec-fetch-site=none 허용, cross-site/same-site 외부 시작은 차단. ERP 인증 세션·state-cookie·owner·만료 검증은 유지. 연결 완료는 깨끗한 ERP 주소로 복귀; 새 UI 화면은 불필요하게 추가하지 않음.
- P2: 재연결/갱신 저장 실패는 운영자 복구 절차 필요. proxy callback query 로그는 실제 설정 검증 필요. no-referrer/no-store 및 모델/보고서로 code/token 전달하지 않음.
- Codex 별도 검사: 초기 신규 테스트2/2와 tsc 통과. 수정본 관련26/26 및 tsc 통과. 전체/SQL 검증·최종 재검토는 별도 결과에 기록.
- 실제 외부 변경 범위: AMESCOTES ERP 조회 앱 생성 및 order/store READ, FrontAPI disabled, ERP HTTPS callback 설정 저장. 기존 ATLM ERP 앱 변경 없음. 앱 설치/토큰 발급/운영 신규 migration 미실행. ClientSecret은 '보기'에서 표시되지 않아 아직 확보되지 않음.
- 비용 누계: 이번 인증 경계 검토 0.43+0.36+0.58 = **USD 1.37**. 이전 설정 검토비와 별도.
