# LUMEN 광고 분석 — 코드 검수 인계

> 최신 운영 상태: `ADS_ANALYSIS_FEEDBACK_SETUP_2026-10-12.md` 참조. 앱·DB·러너 인증/상시 실행·국내/해외 캠페인 매핑·분석OFF 만료 알림을 운영 확인했습니다. 커머스 신규 인증 승인 및 실제3모델 분석 검증이 남아 자동 분석은 OFF입니다. 아래는 코드 인계 당시 기록입니다.

## 상태·범위

대표 지시 2026-10-11. `TASK_SHOP_INSIGHT_AND_ADS_AGENTS.md` §2 광고 분석만 구현합니다. §1 인사이트 자동 변경, 광고 제작/수정/켜기/끄기는 구현하지 않습니다. 고객 자사몰 화면 변경 없음. 운영 배포·DB 적용·실제 Meta/Shopify/Cafe24/모델 호출 및 맥미니 설치는 **미실행**입니다. 운영 담당 Claude의 검수가 남아 있어 운영 기능 완료라고 판정하지 않습니다.

- 작업 공간: 별도 `AMESCOTES-ERP-ads`, 브랜치 `shop-insight-agents`.
- 기준: 통합 product-registration `782ab47`. 명세가 지정한 기능 브랜치를 사용했으며 aws-migration은 수정·push·배포하지 않습니다.
- 테스트는 합성 데이터·localhost mock·새 메모리 PostgreSQL(WASM)만 사용합니다. 실제 비밀값/.env를 열거나 출력하지 않았습니다.

## 구현

| 기능 | 코드 |
|---|---|
| LUMEN > 광고 분석: 국내/해외, 오늘/질문/기록, 독립3칸+최종, 검토 전후/근거, 실제 진행 단계/경과 시간 | client/src/pages/AdsAnalysis.tsx, client/src/App.tsx, client/src/components/Layout.tsx |
| Opus 계획→동일 스냅샷→Claude/Codex 독립→각1회 교차→Opus 최종; 기본 OFF·일 예산 한도 | server/ads-council.ts, shared/ads-analysis.ts |
| 유료 계획 전 연결·용량 검사, 원본 보존/동일한 제한 분석 컨텍스트, 제외 범위 명시 | server/ads-context.ts, server/ads-context.test.ts |
| 영속 큐·중복 접수·예산 예약·lease 갱신·단계CAS·스냅샷 불변·불확실 모델 호출 재실행 금지 | db/016_ads_analysis.sql |
| Meta 고정 호스트 GET, 토큰 헤더, 제한된 재시도/페이지/응답 크기, 규칙 경보·추천 응답 변환 | server/ads-data.ts |
| 실제 결제 주문 읽기, 통화별 집계·시장 구분, 고객 개인 필드 미요청·미저장 | server/ads-orders.ts |
| 맥미니30초 풀, GPT-6.1 SOL high·read-only·도구 차단·최대220초,5분 미참여 fallback | scripts/macmini/ads-runner.sh, kr.atlm.ads-runner.plist.template |
| 09시KST daily 같은 실행 흐름,14일 후 채점·최근4주 집계, 비서실 요약3줄+경보/갱신 알림 | server/ads-council.ts, server/index.ts, server/ceo.ts, server/ceo-console.html |

추가 테스트: server/ads-council.test.ts, ads-data.test.ts, ads-orders.test.ts, db/ads-analysis.integration.test.mjs, client/src/pages/AdsAnalysis.test.ts, scripts/macmini/ads-runner.test.mjs. 화면 계약/디자인 확인은 ADS_ANALYSIS_SURFACE.md 및 ADS_ANALYSIS_DESIGN_CHECK.md입니다.

## 계산·판단 경계

- Meta Insights: 최근14완료일+직전14일, 캠페인/광고세트/광고 원자료. 권고는 캠페인/광고세트만 허용합니다. 주문 집계 구간은 명시 UTC 일 경계이며 Meta 날짜 지표는 계정 시간대 기준입니다. 운영 검수에서 계정 시간대와 날짜 구간 해석을 확인해야 합니다.
- Meta 의견은 지원되는 매핑된 추천 응답의 텍스트 변환뿐입니다. 미지원 추천 모양/권한/기회 점수·이상 신호·추세는 미확인으로 남기며 가짜 Meta LLM 판단을 만들지 않습니다.
- 같은 factId/정확한 값을 검증합니다. 검증되지 않은 숫자를 제거하고 낮은 근거는 확신도 미확인으로 표시합니다. 정책 권고는 조언이며 실행 기능이 없습니다.
- 분석 컨텍스트는 광고 단위/하루/7일 근거를 제외하고 핵심현재6지표·이전3지표·정책최대3개를 사용합니다. 캠페인24·광고세트40·계정16, 합계최대80개 근거·총28000자 이내입니다. 실제9지표×2기간에서도 광고세트3개 이상 분석하는 회귀가 있습니다. 지출 상위 일부 단위만 남길 때 출처와 최종/독립 결론에 범위 제한을 명시합니다. 전 계정 결론으로 과장하지 않습니다. 원본 스냅샷은 감사 자료로 그대로 보존합니다. 유료 계획 전 연결/용량 준비 검사는 모델 없는 읽기이며 이후 계획→독립→1회 교차→최종 순서는 유지합니다.
- 실제 주문과 Meta 구매 이벤트는 다른 지표입니다. UTM이 없는 기간의 광고기여 주문을 0으로 만들지 않습니다. 누락·한도·권한 실패는 partial/unavailable입니다.
- ROAS가 없는 고지출 단위도 실제 집행액을 모델에 제공하고 원본 경보/비서실에 미제공으로 표시합니다. 구매0건·ROAS0으로 보충하거나 분석에서 조용히 지우지 않습니다.
- Shopify는 실제 결제/비테스트 주문과 국가 enum·마지막 방문 UTM만 읽습니다. Cafe24는 운영자가 검증한 **단일 시장 shop** 매핑을 요구합니다. 혼합 국가는 미확인, Cafe24 UTM은 지원 근거가 없어 미확인입니다. 모든 개인 이름·연락처·상세 주소는 요청/저장하지 않습니다.
- 2주 채점은 기존 `Documents/meta_ai_truth/score.py`처럼 후속 시장/단위의 집행액 가중 평균 ROAS 대비 확대 ≥평균, 축소 <평균을 비교합니다. 미집행·불완전 평균·유지 의견은 채점하지 않습니다. **광고를 변경한 인과 효과·매출 기여 증명은 아닙니다.** 최근4주 보고는 채점된 판단의 적중 집계입니다.
- 기록 목록은 최근100건의 요약, 4주 집계는 점수만 별도 조회합니다. 알림은 최신1건 만료/출처/시각만 읽으며 전체 스냅샷은 선택한 상세 ID에서만 조회합니다. Shopify 준비된 비메타 유입은 원문 없는 non_meta로 식별하고 미준비/잘못된Meta캠페인만 미확인으로 남깁니다.

## DB 인계

추가 마이그레이션 `db/016_ads_analysis.sql`은 ads_analysis_runs/budget/jobs/notices 4개 테이블과 광고 전용 RPC만 만듭니다. 운영 적용은 **Claude 담당**입니다. 기존 anon/erp_server 역할과 PostgREST 구성을 확인하고 백업 후 검수하십시오. browser 역할에 직접 테이블/RPC 권한을 주지 않습니다. 기존 회사 원장·재무 기록·광고·상품 테이블을 변경하지 않습니다.

## 필요한 설정 — 실제 값 기재 금지

| 설정 | 조건 |
|---|---|
| META_ADS_TOKEN / META_AD_ACCOUNT_ID | 서버에 이미 있다고 대표가 전달. 값을 읽지 않았음. ads_read만 사용 |
| META_ADS_API_VERSION | 기본 v26.0, 공식 SDK 근거. 실제 계정에서 필드/권한 검수 |
| META_ADS_DATA_ACCESS_EXPIRES_ON | 기본2026-11-24. 재연장 후 운영자가 검증한 새 데이터 접근 만료일만 갱신. /me 성공으로 자동 연장 추정 금지 |
| META_ADS_MARKET_MAPPINGS | lm-kr/lm-gl별 verified:true, campaignIds. 서로 중복 금지. 선택 adsetProducts에 SKU/location/lowStockThreshold, budgetMinorDivisor는 통화 단위 확인 후 설정 |
| ANTHROPIC_API_KEY | 기존 모델 인증, claude-opus-5-5. 프롬프트·로그로 전달 금지 |
| ADS_ANALYSIS_ENABLED | 기본 비활성. DB/매핑/러너 검수 후 운영 담당이 true로 활성화. 비활성 시 수동 요청도 차단 |
| ADS_DAILY_CAP_USD | 기본5, 허용0.6~100. 1회0.60USD 보수 예약, 확인된 실제 호출 비용과 구분. 불확실 호출은 재실행하지 않음 |
| ADS_RUNNER_TOKEN | 서버/맥미니 동일 랜덤32자 이상, 외부 보안 주입. plist/repo/argv에 넣지 않음 |
| ADS_API_URL / ADS_RUNNER_ID | 맥미니 HTTPS ERP origin, runner ID 기본macmini. 템플릿 절대 경로/PATH를 운영자가 교체 |
| Shopify 기존 인증 | SHOPIFY_SHOP_DOMAIN 또는 SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN 또는 SHOPIFY_ACCESS_TOKEN. API2026-10/read_orders 및 필요한 국가·UTM 조회 권한 |
| Cafe24 기존 ERP OAuth 저장소 | 읽기 전용 token(false), 자동갱신/저장 금지. 만료 시 재연결을 별도 운영 담당이 처리 |
| CAFE24_ADS_MARKET_MAPPINGS | [{verified:true,mallId:기존등록몰,shopNo:확인값,market:lm-kr또는lm-gl,singleMarket:true}]. 다른 몰/중복shop/미확인시장 거부 |

맥미니는 Node≥22, 해당 옵션을 지원하는 Codex CLI와 로그인, 고정 LaunchAgent 외부 token 설정이 필요합니다. 실제 설치·로그인은 미실행. 러너는 개인 설정/규칙/플러그인/셸/웹 검색을 끄고 분석 JSON만 생성합니다. 상품등록 쓰기 플래그가 켜져 있어도 이 주문 리더는 강제로 쓰기·OAuth 갱신을 끕니다. Shopify POST는 GraphQL **query** 전송만이며 Meta 전송은 모두 GET입니다.

## 운영 담당 Claude 검수 시나리오

1. 선행 역할/DB016·실제 market/SKU/stock pool·통화단위·채널 shop 매핑 확인. 직원에게 비서실 링크/자료 노출 없음, 권한 없는 사용자 API403.
2. 활성화 전 수동 접수503, 활성화 후 국내/해외 질문 각각1건: 계획/스냅샷ID/독립 의견/1회 교차/최종·원문 근거 일치. 잘못된 수치·광고단위 실행 제외.
3. 맥미니 진짜 폴링과 독립/교차 응답 확인. 러너 중단/5분 지연 후 Codex 미참여 표시, 늦은 결과 거부. 광고 쓰기 호출0건은 운영 네트워크에서도 확인.
4. KST09시 두 시장1일1건, 재시작·중복 클릭·2개 서버 경쟁에 중복 비용 없음. 장시간 수집 중 lease갱신, 소유권 상실/응답 유실 때 모델 재호출 없음. 일 예산 초과 질문 차단.
5. 실제 Meta spend/CPA/frequency/CTR/ROAS와 원본 계정 대조, 재고SKU+위치 검증. Shopify/Cafe24 paid 주문·통화별 결제액 대조. 미확인UTM≠0/누락자료≠정상 확인.
6. 만료2026-11-24 기준 KST2026-11-10부터 비서실 갱신 알림, 실제 인증 실패/계정 정지/품절 경보. 토큰·개인정보가 프롬프트/로그/응답에 없는지 확인.
7. 14일 후 같은 단위의 후속ROAS 근거와 4주 집계 확인. 기존 채점 원칙과 대조하며 실제 광고 변경 효과로 주장하지 않음.
8. 실제 비서실 해외 원본 링크→같은market/run기록,100건밖과거ID,OEM에서LUMEN링크전환,없는ID/다른시장ID404 및 권한없는사용자403. 링크오류안내/과거본문날짜도함께확인.
9. PostgREST 실제JSON필드projection과목록/집계/알림성능, SHARE_PASS Basic인증과러너Bearer연결, Cafe24조회날짜ISO형식/별도토큰갱신, ShopifyUTM권한, 무구매MetaROAS미제공, 실제최대모델입력16000토큰/Opus단가를확인. 미확인자료는활성화승인근거로사용않음.

## 최종 실행 증거

2026-10-11, 이브랜치에서Codex가직접실행. 외부실제API/운영DB/실제분석모델/맥미니설치는0건. Claude검토모델실행은아래비용에별도로포함됩니다.

| 확인 | 결과/범위 |
|---|---|
| 최종 전체회귀 | 소스동결후669/669 통과, 실패/취소/건너뜀0. 위격리SQL53·보조스크립트13과중복없이합계735건통과 |
| 격리SQL | 53/53 통과(광고18+기존35). 새메모리PGlite,운영DB변경없음 |
| 보조업무스크립트 | 13/13 통과 |
| 광고집중회귀 | 74/74 통과, 전체회귀의부분집합 |
| 실제React 모킹브라우저 | 4/4 통과, 포함UI 1건에서시장/권한/진행/양테마/모바일/원본링크확인. 실제ERP운영결과아님 |
| 맥미니스크립트 | 27/27 mock 통과,전체회귀에포함. 진짜Codex추론/LaunchAgent는미실행 |
| Meta안전성 | 모킹전송모두GET,쓰기0,고정호스트/토큰헤더/페이지/취소회귀. 실제서버네트워크검수남음 |
| 타입/빌드 | npm run check 및 npm run build exit0. 기존mixedimport/500k번들경고는남아있음 |
| Claude 실제교차검토 | 6회,총USD4.30. 필수지적수정·최종읽기전용판정새차단없음. 상세CLAUDE_REVIEW_RESULT_ADS_ANALYSIS.md |
| 시각종료검수 | 동일6합성캡처의단계표시1건수정뒤finish reviewer ship(그1건범위). 이후레이아웃변경없음,링크동작만추가테스트 |

Impeccable기준으로기존의미토큰/양테마/공통컴포넌트를계승하고실제진행단계만표시하도록정리했습니다. 기존전역font-sans의SF우선순위와Pretendard결정간드리프트는신규폰트정책으로승격하거나이번기능에서전역수정하지않았으며 ADS_ANALYSIS_DESIGN_CHECK.md에기록했습니다. 새래스터/광고소재없음. 테스트캡처·.impeccable캐시는커밋제외입니다.

Shopify2026-10의두실제GraphQL query문은공식schema검증통과했습니다. 메타기회점수/이상신호/추세는검증된지원응답이없으면미확인,토큰권한성공만으로데이터접근만료연장을추정하지않습니다. 실제최대token측정은미실행이며mock16001은유료create0건증거만입니다.

## 공식 기술 근거

- [Opus5.5 모델ID/요금](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide)
- [Meta 공식 SDK AdAccount 읽기 메서드](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py)
- [Meta 공식 SDK 추천 구조](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccountrecommendations.py)
- [Shopify2026-10 Orders](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/orders), [CustomerJourneySummary](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/CustomerJourneySummary)
- [Cafe24 GET 조회 방식](https://apidocs.cafe24.com/en/docs/guide/how-to-use-get-api), [주문 필드 근거](https://apidocs.cafe24.com/en/docs/2026-06-01/admin/get-orders)
