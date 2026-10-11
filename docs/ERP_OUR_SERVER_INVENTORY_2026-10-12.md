# 우리 서버 이전 대조

대표 지시: 2026-10-12 “서버는 전부 지금 우리서버로 옮겨라”. 실행 중인 서비스와 코드만 보고 이전 완료 여부를 구분한다. 옛 서버 종료·기존 운영 앱 재발급·맥미니 이동을 임의로 하지 않는다.

## 실제 현재 서버

AWS ames-new / ap-northeast-2 / i-0cf424d627db8b063 / /opt/app.
SSM 00b669b5-c2c0-4e48-8d66-e7cc25b6a45d Success.

| 서비스 | 실행 위치 | 상태 |
|---|---|---|
| ERP·비서실·광고 분석 API | app-app-1 / 우리 AWS | healthy |
| 주문·판매 수집/PMS 통합 연계 | app-daily-1 / 우리 AWS | healthy |
| 인사 서비스 | app-hr-1 / 우리 AWS | healthy |
| ERP PostgreSQL | app-db-1 / 우리 AWS | healthy |
| REST API | app-postgrest-1 / 우리 AWS | running |
| HTTPS 라우팅 | app-caddy-1 / 우리 AWS | running / Caddy2.11.7 |
| Codex 분석 작업 러너 | 맥미니 | 이전 범위 질문 중; AWS 이전 완료로 보고하지 않음 |

현재 ERP HEAD 및 배포 성공 marker 모두 a62ee0f330baf486fefa1872ab4bff3a96554daa, 자동 배포 타이머 active. 운영 ERP env에서 Railway·Supabase 연결 URL 없음. client/server 런타임 소스에서도 과거 연결 URL 없음(Railway란 단어는 인쇄 fallback 주석에만 존재). scripts/legacy-supabase는 수동 옛 가져오기 도구이지 현재 실행 서버의 증거가 아니다.

추가 실제 대조 SSM 2ed7d114-eae7-40b4-985c-d64f830676a5 Success: ERP/daily/hr 컨테이너 env의 legacy endpoint key 모두0, ERP→daily 내부호스트, daily→postgrest 내부호스트, daily 인증 반환호스트 daily.ameserp.kr. 이는 개발자센터의 기존 앱 주소도 자동 변경됐다는 뜻이 아니다.

검증: 격리 SQL54/54(새 16번 포함), 신규 인증4/4 및 관련28/28, tsc 및 build 통과. 처음 넓은 명령은 통합 브라우저 runtime/SQL env 미설정으로 실패했으며 해당 실패를 코드 성공으로 숨기지 않았다. SQL을 명시적 격리 runtime으로 재실행 통과했고, 실 브라우저 전체 체인은 이번에 미실행.

최종 명시적 단위 범위 client/server/shared/scripts(별도 PostgreSQL 브라우저 전체체인 제외) 순차 **719/719** 통과. SQL54는 별도 격리 범위로 단위 수에 합산하지 않는다. 타입 검사·최종 빌드·git diff --check 통과. 운영 앱은 여전히 a62이며 본 인증 코드가 반영됐다고 보고하지 않는다.

추가 로그 보강: Caddy 설정 safe_access_log에서 요청 URI의 code/state만 삭제, 접속 로그는 유지. 설치 Caddy2.11.7에서 수정 파일 adapt 성공 및 4개 로그 필터/기존 upstream 보존 확인(SSM c6017363-45b2-49f6-a3b2-458801b9eaeb). 실제 운영 파일 변경/로그 모의 query 검증은 아직 미실행.

## 남은 작업 구분

- 신규 AMESCOTES ERP 조회 앱: 생성·order/store READ·ERP callback 저장, 키 우리 서버 private stage까지 완료. 서비스 적용·16번 토큰 테이블·OAuth·실 주문 조회 미완료.
- 기존 ATLM ERP 앱은 app-daily가 사용하며 callback 설정이 과거 Railway를 가리키는 것을 개발자 화면에서 앞서 확인. 실행 중인 수집 서버 이전과 별개로 개발자센터 callback/AppURL 정리가 필요한지 실제 일치 확인 필요. 기존 앱 변경 금지 결정이 있으므로 확인 없이 주소를 바꾸거나 키 재발급하지 않는다.
- 외부 Cafe24/Shopify/Meta/LLM API 자체는 공급자 서비스이며 회사 실행 서버 이전 대상과 혼동하지 않는다.
- 기존 서버 종료/과금 해지는 기존 작업·데이터·접속 로그·복구 여부가 확인된 뒤 별도 승인 대상. 현재 서버 정상 실행만으로 이전 서버 제거까지 완료했다고 주장하지 않는다.

## 운영 적용 전 검수자 체크

1. 신규 리뷰 결과의 정적 P0/P1 해소와 실제 테스트 증거 확인.
2. 운영 백업 후 db/16_ads_commerce_tokens.sql 적용(대표가 기존에 지정한 Claude 운영 적용 단계). 기존 상품등록 토큰 테이블과 권한에 변화 없는지 대조.
3. root0600 /opt/app/backups/ads-commerce-20261012/cafe24-app.private.json만 읽어 CAFE24_ADS_CLIENT_ID/SECRET 배치. 값 로그 출력·Git 포함·리뷰 전달 금지. ADS OAuth opt-in만 허용, PRODUCT writes/OAuth gate false 유지.
4. scripts/prepare-ads-shopify-auth.py는 기존 Shopify daily 앱 키를 host env에 재사용하되 값 출력 금지, 서로 다른 기존 값 발견 시 중단. 키 회전 때 daily/ERP 함께 갱신.
5. callback code/state query를 Caddy 로그에서 제거한다. 검수자 Claude 운영 적용 단계에서 `docker exec app-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`를 실행한다. compose up만으로 reload됐다고 판정하지 않는다. 실행 중 설정의 네 로그 필터와 모의 query 로그에서 code/state 값 삭제를 확인한 뒤에만 최초 OAuth. 사이트 로그 전체를 끄지 않고, upstream 장애/error-log 위험도 확인한다.
6. 정상 자동 배포 및 runtime 환경/건강 확인, 신규 앱 설치·실 paid-order GET 조회 후 연결 성공 판정.
7. 시장/UTM/재고 매핑 미확인 항목은 명시하고 실제 독립3모델→교차1회→최종결론→비서실 보고 실행 검증. Meta writes 0 유지. 아직 피드백만 남은 상태가 아니다.
