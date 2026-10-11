# LUMEN 상품 등록 — 구현 검수 인계

상태: **코드 통합·회귀 검증 통과 / Claude 실서버 검수 전**. 이 파일 이름은 요청된 인계 규약이며 운영 완료를 뜻하지 않습니다. 2026-10-11, 별도 worktree `AMESCOTES-ERP-council`, 브랜치 `product-registration`. 기존 작업 checkout, aws-migration, 운영 DB, 배포, 실제 Cafe24/Shopify 상품은 변경하지 않았습니다.

## 기능과 경계
- LUMEN 메뉴 `상품·기준정보 → 상품 등록`, 경로 `/product-registration`. 상품 목록, 상태/시즌/검색, 기존 품목 읽기 전용, 컬러, 가격, 설명/번역, 분류/필터, SEO, 물류/배송, 독립 초기 재고, 프리오더, 이미지 원본/역할/순서/alt, 예약 시각(KST), 채널별 결과.
- 서버 세션 + 현재 활성 app_users.team으로 국내 MD·글로벌 MD·비주얼·콘텐츠·대표만 허용. 승인자/매핑 설정은 대표 전용. 본인 기여 상품 자기 승인 차단, 수정 후 재승인, 판 번호·품목 사실·이미지·코드표·사이즈 기준 근거를 묶음.
- 서버 행 선점/lease, 채널별 단계 저장·의도 선저장·불명확 생성 결과 재조회, 부분 성공 보존·실패 채널만 최대 3회 시도. 외부 쓰기는 환경값으로 기본 차단.
- 별도 자사몰관리 규칙 에이전트: 일일/주간 KST 최신 도래 일정 1회 보완, 실제 채널 조회·차이/SEO/JA/이미지/공개 검사, 상위 10건, 3일 이상 같은 문제만 대표 결정. 일반 직원 조직도나 비서실 버튼은 추가하지 않음.

## 변경 파일
| 영역 | 파일 |
|---|---|
| 공통 | shared/product-registration.ts |
| 등록·승인·예약 | server/product-registration.ts, server/product-registration-store.ts |
| 채널·인증·파일 | server/channels/cafe24-auth.ts, cafe24.ts, shopify-client.ts, shopify-files.ts, shopify-queries.ts, shopify.ts, common.ts, settings.ts, monitor.ts, index.ts |
| 비서실 연결 | server/shop-monitor.ts, server/index.ts, server/ceo.ts, server/ceo-console.html, server/agents.ts(보고 타입), server/org.ts(관련 팀 키) |
| 화면 | client/src/pages/ProductRegistration.tsx, client/src/components/product-registration/{form.ts,Images.tsx,Shipping.tsx,form.test.ts,images.test.ts,workflow.test.ts,review-captures.ts}, client/src/App.tsx, client/src/components/Layout.tsx |
| DB | db/15_product_registration.sql — **미적용** |
| 정비 스크립트 | scripts/cafe24-filter-tags-migrate.ts, docs/cafe24-filter-label-snippet.html — **미실행·미적용** |
| 검증 | server/product-registration.test.ts, product-registration-domain.test.ts, product-channels.test.ts, shop-monitor.test.ts, scripts/product-registration-ui-check.mjs |
| 인계 | .env.example, docs/PRODUCT_REGISTRATION_SURFACE.md, PRODUCT_REGISTRATION_MONITOR.md, PRODUCT_REGISTRATION_UI_REVIEW.md, CLAUDE_REVIEW_REQUEST/RESULT_PRODUCT_REGISTRATION_{IMPLEMENTATION,FINAL,POSTFIX,TARGETED}.md |

## 마이그레이션 / 설정
DB15는 product_registration_settings, product_listings, product_listing_images, product_listing_events, channel_tokens, product_shop_monitor_runs, product_shop_monitor_issues 및 선점·원자적 보고 RPC를 추가합니다. items 변경 없음. 브라우저 역할 anon/authenticated/PUBLIC 권한 없음, erp_server만 접근. 기존 team_agent_runs가 있는 DB에서 검수자가 적용·권한·PostgREST 스키마 로드를 검증해야 합니다. 이 작업에서 실행하지 않았습니다.

| 환경값 | 검수 시 의미 |
|---|---|
| PRODUCT_REGISTRATION_WRITES_ENABLED | 기본 false. 실서버 테스트 상품 검수 시에만 true |
| CAFE24_ERP_CLIENT_ID, CAFE24_ERP_CLIENT_SECRET | 기존 Claude MCP와 다른 ERP 전용 앱. 초기 토큰은 서버 전용 channel_tokens에 검수자가 등록 |
| PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED | 기본 false. 전용 앱의 OAuth 갱신 권한; 상품 쓰기와 별도 |
| CAFE24_PREORDER_LABEL_KEY | 실제 관리자 추가정보 필드 custom_optionN 확인 |
| SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_TOKEN | 기존 ERP의 검수된 스토어/API 토큰. 값은 보고서에 기록하지 않음 |
| SHOPIFY_API_VERSION | 2026-10 |
| SHOPIFY_LOCATION_ID, SHOPIFY_ONLINE_STORE_PUBLICATION_ID | 실제 활성 재고 위치와 Online Store publication GID |
| SHOPIFY_PUBLIC_DOMAIN | 실제 국제몰 공개 도메인, 읽기 점검 허용 경계 |
| PRODUCT_REGISTRATION_KRW_PER_USD | 품목 KRW 공급가를 Shopify USD 원가로 환산하는 검수된 환율 |
| PRODUCT_REGISTRATION_FILE_DELETE_AUDITED | 기본 false. 비상품 참조까지 별도 검수한 후 테스트 전용 파일 삭제 허용 |
| ANTHROPIC_API_KEY | 기존 서버 값 재사용. ANSWER_MODEL 문구 검사/번역; 모의 검증에서는 호출하지 않음 |
| PRODUCT_REGISTRATION_INPUT_USD_PER_M_TOKEN, PRODUCT_REGISTRATION_OUTPUT_USD_PER_M_TOKEN | 검수된 모델 단가 설정 시 토큰 기반 추정 비용 기록. 미설정 비용은 null이며 실제 청구라고 주장하지 않음 |

승인 전 실제 분류, 기존 custom.* 정의/타입/제약, metaobject/file/product 참조와 필터 매핑을 대표 설정에 등록·검증합니다. 임의 GID를 생성하지 않습니다. 다색 품목에 실제 색상 SKU가 없으면 등록 차단하며 스타일 번호로 대신하지 않습니다.

## 검증 기록
- 타입 검사 및 클라이언트·서버 빌드 통과(기존 번들 크기/동적 import 경고 있음).
- 최종 서버 회귀 **295/295**, UI 전송·이미지·실제 컴포넌트 모의 흐름 **10/10**, 합계 **305/305** 통과. 전부 로컬 모킹이며 운영 API/DB 실행 없음.
- UI 합성 모의 데이터, 모든 외부 요청 차단: 1440/390px 목록 Light/Dark·편집 화면 오류/가로 넘침 없음. 실제 저장·운영 API 성공을 뜻하지 않음.
- 독립 UI finish reviewer 최초 disposition `fix` → 기존 수정 3건 재판정 `ship`: 저장 전 표시, 모바일 검증 결과·이동, 채널 비교 스크롤 안내 반영. 이미지/오류 상태 추가 캡처 확인. 기존 디자인 상속; documenter No changes. 기존 CSS는 SF/Pretendard fallback이며 단일 Pretendard 구현으로 주장하지 않음.
- 실제 Claude 실행 4회: USD 0.91 + 1.80 + 1.20 + 0.65 = **USD 4.56**. 한정 최종 검토에서 수정판 지적 5건 모두 resolved(정적 판정). 낮은 심각도 후속과 미지원 범위는 TARGETED 결과에 남겼습니다. 실서버 검수 미실행.

## Claude 실서버 확인 5개 시나리오
1. **비공개 생성**: 별도 담당자/승인자, 대표 검수용 합성 테스트 품목·실제 색상 SKU·원본 사진 3장. LUMEN 외/직원 비서실 접근 거부, 자기 승인·stale revision·미확정 매핑 차단, 두 채널 최초 비공개와 각 필드/원가/SEO/JA/이미지 READY 재조회.
2. **예약 공개**: 미래 KST 시각·양 채널 예약, 1시간 전 검증, 다중 실행/재시작에도 한 번만 공개. 한 채널 실패 유도 시 성공 채널 유지·실패 채널만 제한 재시도, 알림·화면에 실제 결과 확인.
3. **두 채널 재조회와 비서실**: 규칙 에이전트 수동/일일/주간, OAuth 만료·조회 실패·404·직접 관리자 수정·누락 JA, 오래된 이슈/해결 이슈를 구분. 재고 숫자는 각각 표시하고 동일 재고로 맞추지 않음. 원자적 보고, 대표 전용 결정, 중복 실행·응답 유실 확인.
4. **수정 재승인·복구·프리오더**: 실제 판매 후 수량을 기록한 뒤 가격/설명/태그/사진 변경. 재승인/복구가 실재고·기존 공개 상태·원본 사진을 보존하고 변경만 반영하는지 확인. 날짜 종료는 정책·문구만 바뀌며 수량을 초기화하지 않음. 실제 입고/판매 한도는 아래 제한대로 차단·미확인이지 자동 성공이 아님.
5. **테스트 삭제·원본 보존**: 테스트 표시 불변, 실상품 삭제 차단. Shopify 전용 파일 연결 해제→다른 상품·비상품 참조 검수→전용 파일 삭제→상품 삭제, 원본/자매 사진 보존. Cafe24 휴지통 비우기/잔여 이미지 관리자 후처리 전까지 삭제대기 유지.

## 운영 검수 전 제한 / 남은 결정
- 프리오더 hard cap: CONTINUE 정책만으로 정확한 판매 한도를 보장할 수 없어 입력 시 채널 등록을 차단합니다. 채널별 실제 주문 집계·통제 계약 확정 필요.
- 실입고 자동 해제: 양수 채널 재고를 입고 증명으로 추정하지 않습니다. 운영 실입고의 연결·승인 증거 계약 확정 전에는 게이트/보고이며 자동 해제를 주장하지 않습니다. ERP 테스트 입고는 연결하지 않습니다.
- Cafe24 휴지통/이미지 후처리·필터 관리자 설정·외부 옛 필터 링크 검수는 Claude 담당. 태그 스크립트 기본 dry-run, --apply만 쓰기이며 이 작업에서 실행하지 않음.
- 기존 전상품 들여오기, Shopify 추가 판매 채널, 고객 HTML 렌더링 미리보기는 명세의 2단계.
- 상품 정합성 관련 팀 키는 추가했으나 협의 자동 생성까지 연동했다고 주장하지 않습니다. 점검 자체는 규칙 기반·모델 호출 없음.

## 최종 지적 처리·실행 결과

| 지적 | 조치 / 근거 |
|---|---|
| SKU·수정자 승인 | 다색 실제 고유 SKU 없으면 차단, 원작성자·중간 수정자 모두 자기 승인 차단. DB CHECK와 서버 양쪽 검사 |
| 오래된 원가·근거 범위 | 승인에 현재 정규화 품목 원가 사용, 해당 상품·자매가 사용한 매핑/분류/모델 사이즈만 hash. 무관 기준표 변경 제외 |
| 재승인 실재고 | 신규 생성 때만 수량 초기화. 재승인·프리오더 종료는 live 수량을 덮지 않음. Shopify USD 스토어만 허용 |
| 이미지 | 리비전과 독립된 이미지 키, ERP 소유 추가사진 PUT 교체/DELETE 제거, 원본·대표사진 보존. Cafe24 5MB/30MB/20개 사전 검사. 증명 없는 응답 유실/외부 사진은 차단 |
| 토큰 만료 | 고정 ERP OAuth URL만 별도 갱신 권한+DB선점. 상품 쓰기 OFF를 우회하지 않음 |
| 공개 상태·점검 | 재승인 후 실제 채널 공개 확인, 공개 상태 유지. 수정 중에도 previously_public 상품 일일 점검. SIZE의 불필요한 Shopify 참조 요구 제거, ERP 사이즈 기준·Cafe24 매핑 유지 |
| 대표 이미지 복구 | 완료된 대표 이미지와 미해결 업로드 시도를 별도로 보존. 완료 후 관리자 변경은 승인 재반영 가능; 응답 유실인 새 업로드 반복은 차단 |
| 프리오더 종료 순서 | queued 최초 SYNC 먼저 처리, 이후 staging·채널 ID 확인 뒤 날짜 종료. 미생성 상품 종료 쓰기 차단 |
| 프리오더 보류 안내 | staging 미완료·종료 어댑터 미연결·실입고 증거 미지원 사유를 프리오더 구역에서 표시. 보류 사유가 있으면 자동으로 펼침 |
| HTTP 시간초과 | 승인/공개/재시도/재반영은 DB에 명령 저장 후 HTTP202, 별도 worker. UI 대기·미완료 표시와 읽기 polling. 중간 요청 타임아웃으로 쓰기 재실행 금지 |
| 재반영 | 독립 승인자의 명시적 확인·현재 승인 hash 후 /reapply. 파일/생성 의도/초기재고 근거 보존. 새 수정은 기존 재승인 흐름 |
| lease 해제 | 성공한 저장을 해제 실패로 오류 응답하지 않음. TTL 복구·CAS 보호 |
| 번역·비용 | 같은 모델 자매 컬러 요약까지 문구 검사, 제안만 제공. 비용 미확정은 null |
| 운영 런타임·규모 | 기준표를 서버 bundle에 포함해 Docker에 source data 파일이 없어도 사용. 목록 품목 1회 배치 조회, 1,000건 초과 keyset pagination, 미확인 개별 품목은 차단 표시 |
| 접근·링크 | 메뉴도 서버 권한 응답 후 표시. 비서실 링크는 ws=LUMEN으로 열며 직원에게 비서실 노출 없음 |

Claude 수정판 지적 5건에 회귀 테스트를 추가해 통과했고, 실제 한정 재검토에서도 5건 모두 resolved입니다. 상세 결과·UncertainWrite 운영 확인 절차는 `CLAUDE_REVIEW_RESULT_PRODUCT_REGISTRATION_TARGETED.md`에 있습니다. 지원되지 않는 실입고 증거·정확한 hardcap은 위 제한대로 운영 차단입니다. **완료·운영 승인 선언 없음**.
## 통합 ERP 후속 검증

2026-10-11 대표 선택: **코드 통합·검증 후 클로드가 운영 적용**. 상품 등록 기능 검수와 전체 ERP의 운영 완료는 다릅니다. 통합본 변경·선행 마이그레이션·샘플 수락 담당 설정·564건 회귀와 35건 격리 SQL 검증·운영 보류사항은 `ERP_FINAL_ACCEPTANCE_2026-10-11.md` 및 Claude 최종 재검토 문서를 함께 확인하십시오. 이 절은 앞의 과거 실행 기록을 대체하지 않습니다.
