# TASK — LUMEN 상품 등록: ERP 한 곳에서 카페24 + 쇼피파이 동시 등록·예약 공개

대표 지시(2026-10-11). 현재 MD가 카페24·쇼피파이 관리자에서 따로 등록 → 이미지·내용 불일치, 오타, 상품별 일관성 저하. **ERP를 상품 정보의 유일한 원본**으로 만들고, 여기서 두 채널에 같은 내용으로 등록·수정·예약 공개한다.

- 작업 위치: 이 워크트리, 브랜치 `product-registration` (base `origin/aws-migration`). 커밋은 브랜치에만. **push·배포·DB 적용·실제 채널 쓰기 금지** (검수자 Claude가 함).
- 입력 항목 전수 목록과 근거: `docs/PRODUCT_REGISTRATION_FIELDS_v1.md` (실제 운영 상품 LOG MIDDLE BAG 카페24 #1961 / Shopify 10336760496449 저장값 전수 조회 + 10/11 API 복제 테스트 결과). **이 문서의 항목을 빠짐없이 구현한다.**
- 먼저 읽을 것: `client/src/components/Layout.tsx`(lumenOnly 메뉴), `client/src/App.tsx`, `server/index.ts`, `server/auth.ts`(권한·restAsServer), `server/work.ts`(업무 카드·알림·모델 상수), `server/subscriptions.ts`(서버 주기 작업·카드 생성 선례), `server/agent-scheduler.ts`(컨테이너 내 스케줄러), `server/daily-bridge.ts`, 품목 마스터(`items` 테이블, `pages/ItemMaster.tsx`), 기존 마이그레이션 작성 관례(새 DB엔 `authenticated` 역할 없음 → 조건부, `erp_server` 권한).

## 00. 구조 결정 — 상품 리스트(마스터)와 자사몰 등록 분리 (대표 질문 10/11에 대한 답)

- **분리하되 원본은 하나.** 3층 구조:
  1. **LUMEN 상품 리스트 = 기존 품목 마스터(`items`, 실데이터)**: 스타일·컬러·SKU·소재·사이즈·원가·도매가/RRP·대표 이미지 등 *채널과 무관한 사실*. 라인시트(`pages/LineSheet.tsx`, 이미 `fetchItems`·`fetchBoms` 사용)와 해외영업이 이걸 쓴다.
  2. **자사몰 등록(`product_listings`, 이번 작업)**: 품목을 골라 *채널에만 필요한 것*(카페24 분류·해시태그·SEO, 쇼피파이 컬렉션·메타필드, 채널 가격, 상세 HTML, 번역, 예약 공개, 프리오더)만 추가. 품목의 사실값은 복사하지 않고 **참조**(item_id)해서 화면에 보여주고, 품목이 바뀌면 "채널에 반영 필요" 표시.
  3. **라인시트**: 품목 마스터를 그대로 사용(이번 작업에서 수정하지 않음).
- 이유: 품목에 채널 전용 필드까지 넣으면 품목 마스터가 비대해지고 OEM/AETALOOF와 공용인 테이블이 오염된다. 반대로 등록 화면에 사실값을 따로 입력하면 라인시트와 자사몰 내용이 또 어긋난다.
- items 테이블은 **읽기만**(품목만 실데이터 — 대표 지시). items 에 없는 사실값(예: 무게·HS코드)은 listing 에 두되 2단계에서 품목으로 옮길 후보로 표시.

## 0. 범위

- **LUMEN 워크스페이스에만** 노출: Layout `상품·기준정보` 그룹에 `{ path: '/product-registration', label: '상품 등록', lumenOnly: true }`. AETALOOF·OEM에는 안 보임.
- 권한(서버 판단): 현재 세션엔 role 만 있으므로 `app_users.team` 을 읽어 판단한다. 작성 = team ∈ {국내 MD, 글로벌 MD, 비주얼·콘텐츠} 또는 CEO_EMAILS. 승인·공개 = CEO_EMAILS 또는 설정 테이블 `product_registration_settings.approver_ids`(대표만 수정). **작성자 본인은 같은 건 승인 불가.** 공개된 상품의 수정도 다시 승인을 거친다(고객 화면 변경).
- 이번 범위: 신규 등록 + 등록한 상품 수정 + 예약 공개 + 채널 반영 확인 + 테스트 상품 완전 삭제. **기존 400여 개 상품 들여오기는 2단계(별도 명세).**

## 1. 데이터 (마이그레이션 SQL 1개, 조건부·멱등)

- `product_listings` — 상품 1건(=컬러 1개, 채널 상품 1개와 1:1), **item_id(품목 참조) 필수**. 필드는 FIELDS 문서 §1 전부: 식별(sku, barcode, style_name, color_en, sister_listing_ids, is_test), 이름 KO/EN, 가격(krw, retail_krw, usd, supply), 설명(summary_ko, simple_ko, detail_html_ko, mobile_detail_html_ko(비우면 PC와 동일), desc_en, desc_ja, details_en, details_ja, care_ko, part_description_refs), 분류(cafe24_category_nos[], shopify_collection_ids[], taxonomy_category_id, google_category), 필터(material, color, size, design — **코드값으로 저장**, 채널별 변환은 어댑터), 컬러칩·목록이미지 메타필드 참조, 검색 태그(tags_ko[], tags_en[]), SEO(meta_title_ko, meta_title_en, meta_desc_ko, meta_desc_en, meta_keywords, handle — **JA 제목·메타는 두지 않음**: JA 원칙상 제목 영문 유지, 설명만 JA), 물류(weight_g, origin_cafe24, origin_shopify — **채널별 따로**(7/31 결정), hscode, made_date, 카페24 배송 설정 묶음), 재고(cafe24_qty, shopify_qty — 채널 독립, 서로 맞추지 않음), 판매(naverpay, market_sync, shopify_channels[] — 1단계는 온라인 스토어만), **프리오더(§3.5)**, 상태, 예약(publish_at timestamptz, publish_channels[]), 채널 결과(cafe24_product_no, shopify_product_id, step_keys jsonb(멱등 키), last_sync_at, last_sync_result jsonb).
- `product_listing_images` — listing_id, 순서, 역할(main|list|extra|detail_view), **원본 파일은 영구 저장소에 보관**(컨테이너 디스크 금지 — 배포 시 사라짐. 기존 ERP 첨부 저장 방식이 있으면 재사용, 없으면 Shopify Files 를 원본 저장소로 쓰고 그 URL 은 ERP 내부용으로만 보관), 폭·높이, alt_en/ko(자동 생성 후 수정 가능), 채널별 업로드 결과(cafe24 경로들, shopify media id).
- `product_listing_events` — 감사 기록: 누가 언제 무엇을(작성·수정·검증·승인·공개·실패·삭제), 변경 전후 값 요약.
- 상태값: `작성중 → 검증통과 → 승인대기 → 승인(비공개 등록됨) → 예약됨 → 공개됨`, 실패 시 `오류`. 수정은 `공개됨` 상태에서도 가능(변경분만 재송신).
- 품목 마스터 `items` 와는 sku/style_no 로 연결만(읽기). items 데이터는 수정하지 않는다(품목만 실데이터 — 대표 지시).

## 2. 화면 (`client/src/pages/ProductRegistration.tsx` 1개 + 필요한 컴포넌트)

- 목록: 상태·예약일·채널 반영 결과·마지막 오류. 필터: 상태, 시즌.
- 편집: FIELDS 문서 순서대로 섹션(기본·가격·설명 KO/EN/JA·이미지·분류·필터·검색어·SEO·물류·재고·판매 채널·예약). 필수 항목 표시, 저장은 임시저장 가능.
- 자매 컬러: 같은 모델의 다른 컬러를 선택하면 공통 항목(설명·사이즈·소재·분류·SEO 틀) 복사 → 컬러별 항목만 수정.
- 이미지: 드래그 업로드, 순서 변경, 역할 지정, **3:4 비율이 아니면 경고**, 10MB 초과 거부, alt 자동 생성(`{상품명} - Atelier de LUMEN`).
- **채널 미리보기**: 카페24 상품명·SEO 제목(`{상품명} | {카테고리 한글명} | 아뜰리에 드 루멘`), 쇼피파이 SEO 제목(`{상품명} | {Category EN}`), 필터 태그·메타필드 변환 결과를 표로 보여준다(고객 화면 HTML 렌더링은 2단계).
- 검증 결과 패널: §4 규칙 위반 목록, 클릭 시 해당 입력칸으로 이동.
- 예약: 날짜·시간(KST) 선택, 채널(카페24/쇼피파이/둘 다). 과거 시각 거부.
- 버튼: 임시저장 / 검증 / 승인 요청 / (승인자) 승인 → 비공개 등록 / 예약 / 지금 공개 / 수정 반영 / 테스트 상품 완전 삭제(테스트 표시된 것만).

## 3. 채널 어댑터 (`server/channels/cafe24.ts`, `server/channels/shopify.ts`, 라우트 `server/product-registration.ts`)

공통: 모든 외부 쓰기는 **멱등**(listing id + 단계 키), 재시도(429·5xx 지수 백오프, 카페24 초당 2건 이하), 쓰기 후 **재조회로 값 대조**, 결과를 last_sync_result 와 events 에 기록. 토큰·키는 env 에서만 읽고 로그·응답·프롬프트에 넣지 않는다.

### 카페24 (`atlm1224.cafe24api.com/api/v2/admin`, 헤더 `X-Cafe24-Api-Version: 2026-03-01`)
- 생성: `POST /products` body `{shop_no:1, request:{...}}` — `display:'F', selling:'F'` 로 생성(비공개). **request 안에 product 래퍼 넣지 말 것**(200 나와도 무시됨).
- 태그: 생성 body 에 product_tag 넣지 말고 `POST /products/{no}/tags {shop_no, request:{tags:[...]}}`. **카페24 API는 밑줄(_)을 지운다** → 필터 코드값은 밑줄 없는 형태(`COWLEATHER`, `MATERIALALL`)로 보낸다(§6 필터 교체와 짝). 태그 반영 확인은 60~90초 뒤 `products/{no}?fields=product_tag`.
- 대표 이미지: `POST /products/{no}/images {shop_no, request:{detail_image: base64, image_upload_type:'A'}}` (목록·작은 이미지 자동). **`POST /products/images` 금지**(편집기 폴더에 흔적만 남음).
- 추가 이미지: `POST /products/{no}/additionalimages {shop_no, request:{additional_image:[base64...]}}`.
- 상세 HTML 의 DETAIL VIEW 이미지: 2단계(현재는 기존 `/web/upload/atlm/detailview/` 경로 문자열 입력 허용).
- SEO: `PUT /products/{no}/seo {shop_no, request:{meta_title, meta_description, meta_keywords, meta_author:'Atelier de LUMEN', search_engine_exposure:'T'}}`.
- 분류: 카테고리별 `POST /categories/{no}/products {shop_no, request:{product_no:[no]}}`.
- 추가정보(목록라벨 등): `additional_information:[{key, value}]`. 관련상품: `relational_product` (자매 컬러, interrelated 는 승인 시 'T').
- 재고: `PUT /products/{no}/variants/{code}/inventories {shop_no, request:{use_inventory:'T', quantity}}`.
- 공개: `PUT /products/{no} {display:'T', selling:'T'}` → 재조회 + `https://atlm.kr/product/detail.html?product_no={no}` 200 확인.
- 완전 삭제(테스트 전용): `DELETE /products/{no}` 는 휴지통행 → 휴지통 비우기·이미지 파일 삭제는 API가 없으므로 **삭제 대기 목록에 남기고 Claude가 관리자 화면에서 처리**(이번 범위에서 자동화하지 않음, 화면에 안내).
- **인증**: 로컬 Claude MCP 와 같은 카페24 앱 토큰을 공유하면 refresh 토큰 회전으로 서로 무효화된다. ERP 전용 카페24 앱(별도 client_id/secret) 사용을 전제로 env `CAFE24_ERP_CLIENT_ID/SECRET` + 토큰은 DB 1행(`channel_tokens`)에 저장, 갱신은 서버 한 곳에서만(잠금). 앱 발급 전에는 어댑터가 '미연결'을 반환하고 화면에 표시.

### 쇼피파이 (Admin GraphQL, 기존 ERP 앱 토큰 env 재사용 — 없으면 `SHOPIFY_ADMIN_TOKEN`)
- 생성·수정: `productSet(input, synchronous:true)` — status `DRAFT`, vendor `Atelier de LUMEN`, tags, category(택소노미 ID), seo, collections(수동 컬렉션만; 스마트 컬렉션은 태그로 자동 편입 — 수 분 지연), metafields(FIELDS 문서의 custom.* 전부 + `mm-google-shopping`/`mc-facebook` google_product_category 는 `single_line_text_field`), productOptions/variants(sku, price, taxable, inventoryItem{tracked, countryCodeOfOrigin, measurement.weight}).
- 이미지: **ERP 원본 파일을 `stagedUploadsCreate` → `files`(originalSource=staged URL)로 새로 업로드**. 기존 Shopify CDN URL을 originalSource 로 쓰면 **원본 상품의 같은 MediaImage 를 공유**하게 되어 삭제 시 원본 사진이 지워질 위험 — 금지.
- JA 번역: `translationsRegister` 로 **body_html 과 metafield custom.product_details 만**(메모리 ja_product_translation_setup: title·meta_title 은 영문 유지, 일본어 등록 금지). digest 는 `translatableResource` 로 조회.

### 3.5 품절 시 예약 발송(프리오더) — 대표 지시 10/11
- 입력: 프리오더 사용 여부, 예약 발송일(날짜), 고객 표기 문구(KO/EN 자동 생성 후 수정: KO `*2ND: 10/14(수) 예약배송`, EN `PRE ORDER SHIP FROM OCT 14`), 프리오더 판매 한도 수량(선택), 종료 조건(입고 처리 시 자동 해제 / 날짜).
- 쇼피파이: variant `inventoryPolicy: CONTINUE`(재고 0이어도 주문 가능) + metafield `custom.preorder_label` = EN 문구(현재 운영 상품이 이 방식 — 상세에 빨간 "PRE ORDER SHIP FROM OCT 14" 표시). 해제 시 `DENY` + 라벨 삭제.
- 카페24: `summary_description`(한줄 요약)과 `simple_description` 맨 앞 줄에 KO 문구, `additional_information` 목록라벨텍스트, 재고 0일 때 판매 지속은 재고 설정(`use_inventory`/품절 처리 옵션 — 실제 API 필드는 Codex 가 문서로 확인, 확정 못 하면 '품절 시 판매' 설정 방법을 보고하고 구현 보류). 해제 시 문구 제거.
- 예약 발송일이 지나도 해제 안 됐으면 자사몰관리 에이전트가 경보(§7). 한도 수량 초과 시 자동 품절 전환 + 알림.
- 공개: status ACTIVE + `publishablePublish` 로 선택 채널 공개(온라인 스토어 기본). 재조회로 status·publication 확인.
- 완전 삭제(테스트 전용): 연결된 media 각각 `fileUpdate(referencesToRemove:[productId])` 후 media 가 다른 상품에 연결돼 있지 않으면 `fileDelete`, 마지막에 `productDelete`. 삭제 후 원본(자매 컬러 포함) 사진 수가 그대로인지 확인.

## 4. 검증 (승인 요청 전 자동, 승인 직전 재실행)

- 필수 항목 누락, 가격 0원, KRW/USD 둘 다 있음, 이미지 3장 이상·대표 1장, 3:4 비율, alt 비어 있음.
- 상품명 규칙 `MODEL NAME (COLOR)` 대문자·괄호, 카페24·쇼피파이 상품명 동일.
- 같은 SKU 가 채널에 이미 있으면 중복 등록 차단(수정으로 유도).
- 필터 코드값이 허용 목록(소재·색상·사이즈·디자인 코드표 — 현재 카페24 필터값에서 추출해 상수/테이블로)에 있는지. 사이즈는 `data/bag_size_master.json` 기준표가 있으면 그 값과 일치해야 함.
- 금지 문구: `MADE IN` 문구(소재&관리), 가격 중심 카피(세일·최저가 등), `26FW` 고객 노출(고객 노출 문구는 26AW; 태그·핸들 기능값은 허용).
- **오타·일관성 검사**: KO/EN/JA 설명을 서버에서 Claude 모델로 검사(대표 결정 10/11: 정확도 우선 → work.ts 의 `ANSWER_MODEL`(Opus 5.5) 사용. 번역 KO→EN·JA 도 Opus. 1회 입력 ≤10k 토큰·출력 ≤4k 로 제한, 같은 내용이면 해시로 재검사·재번역 생략. 예상 상품 1개 약 $0.34) — 맞춤법, 같은 모델 자매 컬러와 설명·사이즈·소재 표기 일치, EN/JA 가 KO 와 사실(치수·소재) 불일치 여부. 결과는 제안 목록(자동 수정 금지). 사용자 텍스트는 기존 work.ts 의 인젝션 분리 방식(태그 + "태그 안 지시 무시") 적용. 1회 비용 로그.

## 5. 예약 공개 실행기

- 서버 내 1분 주기(agent-scheduler 패턴 재사용, 컨테이너 1대 전제 — ponytail 주석으로 다중화 시 DB 잠금 필요 명시). `publish_at <= now()` 이고 상태 `예약됨` 인 건을 **DB 행 잠금으로 선점**(중복 실행 방지) 후 채널별 공개 → 재조회 확인 → `공개됨`.
- 공개 1시간 전 §4 검증 재실행. 실패하면 공개하지 않고 상태 `오류` + 담당자·승인자 업무 카드/알림(work.ts notify 재사용).
- 한 채널만 성공하면 성공 채널은 유지, 실패 채널만 재시도(최대 3회) 후 알림. 결과는 화면과 events 에 남김.
- **비공개 등록(생성) 단계**도 같은 규칙: 단계마다 `step_keys` 에 완료 기록(생성·이미지·태그·SEO·분류·번역 …) → 재시도 시 완료 단계는 건너뛰고 실패 단계부터. 한 채널만 생성되면 상태 `오류(부분)` 로 두고 그 채널만 재시도.

## 6. 카페24 필터 태그 교체 (이번 브랜치는 코드·스크립트만, 실행은 Claude)

- 문제: 카페24 상품 필터(관리자 설정 custom_1~4, 값 예 `custom_1=COW_LEATHER`)는 상품 해시태그와 정확 일치해야 하는데, API 는 밑줄 태그를 못 넣는다.
- (FIELDS 문서 §0 의 '스킨 수정' 안은 폐기 — 아래 태그 교체안으로 확정.) 실행 전 Codex 리뷰 + 대표 고지(고객 화면 변화 없음을 스크린샷으로 확인), 기존 `custom_1=COW_LEATHER` 형태 링크가 외부(광고·SNS)에 쓰이는지 확인해 보고.
- 해결(대표 승인): 필터값을 밑줄 없는 코드로 교체. ① 기존 전 상품에 밑줄 없는 태그를 **추가**하는 스크립트 `scripts/cafe24-filter-tags-migrate.ts` (dry-run 기본, `--apply` 시 실행, 기존 밑줄 태그는 지우지 않음, 0.5초 간격·429 재시도, 결과 CSV) ② 관리자 필터값 교체는 Claude 가 관리자 화면에서 수행 ③ 스킨 표시명: 현재 스킨은 값의 `_`→공백 변환으로 "COW LEATHER" 를 표시 → 밑줄 없는 값도 같은 표시명이 나오도록 코드표 기반 표시명 매핑 스니펫을 `docs/cafe24-filter-label-snippet.html` 로 작성(적용은 Claude, 고객 화면 변화 없어야 함).
- 코드표(소재·색상·사이즈·디자인)는 서버 상수 1곳에서 채널별 변환(카페24 태그값, 쇼피파이 메타오브젝트 ID)을 관리.

## 7. 정기 점검 에이전트 (대표 지시 10/11)

대표 지시 보강: **비서실에 '자사몰관리 에이전트'를 하나 만들고, 정해진 시각에 자사몰(카페24 atlm.kr·쇼피파이 intl)을 모니터링**한다.
- 구현: 조직도에 비서실 팀이 없고 기존 팀 에이전트 스케줄러·`running` 잠금은 조직도 팀 전용이며 보고 작성이 모델을 부른다(`org.ts`, `agents.ts:216,250,256`). 그래서 **별도 러너 `server/shop-monitor.ts`** 를 만든다: 규칙 기반 점검(모델 호출 없음), 자체 잠금, 결과는 `team_agent_runs` 형식(team=`자사몰관리`)으로 저장해 대표 콘솔 비서실 에이전트 목록·보고·'결정할 것'에 그대로 나오게 한다(ceo.ts 가 team_agent_runs 를 읽는 경로 재사용, 필요한 최소 수정만). 협의가 필요하면 기존 council 의 경보 종류 키 방식(`RELATED_TEAMS` 는 경보 키 → 팀 목록)으로 '상품 정합성' 키를 추가해 국내 MD·글로벌 MD·비주얼·콘텐츠 연결.
- 일정: 대표 콘솔에서 바꿀 수 있는 설정값(기본: 매일 09:00 일일 점검, 매주 월 09:30 전수 점검, KST). 1분 틱 + 실행 기록 키(일정 id + 날짜)로 중복 방지, 놓친 실행은 다음 틱에 1회 보완. 수동 [지금 점검] 버튼(대표만).
- 재고는 차이로 보지 않는다(채널 독립 운영) — 수치만 표시.
- 사이즈 기준표는 `atlm-slack-bot/data/bag_size_master.json`(대표 확정 98스타일)을 이 저장소 `data/bag_size_master.json` 으로 가져와 쓴다(Claude 가 복사해 둠).
- 주기: 일일 = 가벼운 점검(예약 공개 실패·오류 상태·24시간 내 공개 예정 건 사전 검증 결과·공개 중 상품 상세페이지 응답), 주간 = 아래 전수 점검.
- 전수 점검 항목(ERP 등록 상품 기준, 외부는 읽기만):
  - ERP 값 ↔ 카페24·쇼피파이 실제 값 차이(상품명·가격·설명 해시·이미지 수·분류/컬렉션·필터 태그/메타필드·SEO) → **관리자 화면에서 직접 고친 흔적** 감지
  - 필터 태그 누락(소재·색상·사이즈·디자인), SEO 제목/설명 비어 있음, alt 누락, 깨진 이미지 URL(HEAD 404)
  - 공개 상태인데 상세페이지 비정상(카페24 detail.html 비 200, 쇼피파이 ACTIVE 인데 온라인 스토어 미공개)
  - JA 번역 누락
- 결과: 팀 에이전트 보고에 건수·상위 10건, 각 건에 [ERP 값으로 되돌리기] 제안(실행은 담당자 승인 후, 자동 수정 금지). 대표 콘솔 '결정할 것'에는 같은 문제가 3일 이상 방치된 것만.
- 비용: 규칙 기반 비교만(모델 호출 없음). 문구 품질 재검사는 하지 않는다(등록 시 검사로 충분).
- 2단계(기존 상품 들여오기) 이후 대상이 전 상품으로 넓어진다 — 지금은 ERP로 등록한 상품만.

## 8. 테스트·완료 기준

- `server/product-registration.test.ts`: 검증 규칙(§4, 모델 호출 모킹), 상태 전이, 예약 실행기 선점·중복 방지·부분 실패, 카페24 요청 바디(래퍼 없음, 태그 별도 엔드포인트, 밑줄 제거 코드값), 쇼피파이 이미지가 staged upload 경로만 쓰는지, 완전 삭제 순서(fileUpdate→fileDelete→productDelete), 권한(LUMEN 외·작성자 승인 불가), 정기 점검 사실 생성(차이 감지·누락·404, 모델 호출 없음). 외부 API 는 모킹.
- `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/tsx --test server/*.test.ts`, 클라이언트 빌드 통과.
- 보고(한국어 짧게): 변경 파일, 마이그레이션 파일명, 필요한 env 목록, Claude 가 실서버에서 확인할 시나리오 5개(테스트 상품 비공개 등록→예약 공개→두 채널 재조회→수정 반영→완전 삭제·원본 보존 확인).


## 다음 작업 (대표 지시 10/11)
이 작업 완료(PRODUCT_REGISTRATION_DONE.md 작성) 직후 **바로** `docs/TASK_SHOP_INSIGHT_AND_ADS_AGENTS.md` §2 메타 광고 분석(분석 전용·데일리·질문하기·모델별 결론→최종 결론)을 착수한다. 완료 시 `docs/ADS_ANALYSIS_DONE.md`.
