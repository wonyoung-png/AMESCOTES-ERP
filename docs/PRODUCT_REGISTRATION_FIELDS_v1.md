# ERP 상품 등록(카페24 + 쇼피파이 동시) — 입력 항목 전수 목록 v1

작성 2026-10-11 · 근거: 실제 운영 상품 LOG MIDDLE BAG (VINTAGE BROWN) 카페24 #1961 / Shopify 10336760496449 의 저장값 전수 조회 + API 복제 테스트(카페24 #2094, Shopify 15411188564289 DRAFT)

## 0. 테스트 결과 요약

| 항목 | 카페24 API | Shopify API |
|---|---|---|
| 기본정보·가격·설명·이미지(대표+추가 7) | ✅ | ✅ (alt 포함) |
| 분류/컬렉션 | ✅ 13개 분류 | ✅ 수동 3 + 스마트 2(태그 규칙으로 수 분 뒤 자동 편입 확인) = 원본과 동일 5개 |
| SEO(메타 제목·설명·키워드·작성자) | ✅ `/products/{no}/seo` | ✅ seo + JA 번역 |
| 검색 해시태그 | ⚠️ **밑줄(_) 태그 불가** — API가 `COW_LEATHER`→`COWLEATHER`로 바꿈 | ✅ |
| 필터(소재·색상·사이즈·디자인) | ⚠️ 위 밑줄 태그가 스킨 필터 구동값 → **API만으로는 필터에 안 잡힘** | ✅ 메타오브젝트(product_material 등) 참조로 동작 |
| 예약 공개 | ❌ API 예약 기능 확인 안 됨 → ERP 예약 실행기로 시각에 진열/판매 전환 | ✅ `publishablePublish(publishDate)` 지원. ERP 예약 실행기로 통일 권장 |

**결정 필요(필터)**: ① 스킨 필터가 `COWLEATHER`처럼 밑줄 없는 태그도 인식하도록 스킨 수정(비노출 변경, 권장) ② 관리자 화면 자동입력(브라우저 자동화, 깨지기 쉬움).

## 1. ERP 공통 입력 (한 번 입력 → 두 채널로 변환)

| 구분 | 항목 | 필수 | 카페24 | Shopify | 비고 |
|---|---|---|---|---|---|
| 식별 | 상품코드(SKU) | ● | custom_product_code | variant.sku | 카페24 기준 코드 |
| | 바코드 | ○ | — | variant.barcode | |
| | 모델/스타일명 | ● | (상품명 일부) | | LOG MIDDLE |
| | 컬러명(EN) | ● | 상품명 괄호 | metafield product_current_color | VINTAGE BROWN |
| | 자매 컬러 상품 | ○ | relational_product | metafield product_options | 같은 모델 다른 색 |
| 이름 | 상품명 KO/EN | ● | product_name / eng_product_name | title | 표기 규칙: `MODEL (COLOR)` |
| 가격 | 판매가 KRW | ● | price, retail_price | — | |
| | 판매가 USD | ● | — | variant.price | |
| | 공급가(원가) | ● | supply_price | (inventoryItem.cost) | |
| 설명 | 한줄 요약 KO | ● | summary_description | — | 예: 예약배송 문구 |
| | 간단 설명 KO | ● | simple_description | — | |
| | 상세 HTML KO | ● | description / mobile_description | — | DETAIL VIEW 블록 |
| | 상세 설명 EN | ● | — | descriptionHtml | |
| | 상세 설명 JA | ● | — | 번역 body_html | 제목은 영문 유지 원칙 |
| | 제품정보·사이즈 EN | ● | payment_info(KO 스펙) | metafield product_details | 소재·안감·무게·내부 구성·사이즈 |
| | 소재 & 관리 KO | ● | shipping_info | metafield payment_delivery / exchange_refund(공통 메타오브젝트) | MADE IN 문구 넣지 않음(7/28 결정) |
| | 부위 설명 | ○ | — | metafield product_part_description(메타오브젝트 목록) | |
| | 선주문 라벨 | ○ | additional_information(목록라벨텍스트) | metafield preorder_label | 예: PRE ORDER SHIP FROM OCT 14 |
| 이미지 | 대표 이미지 | ● | detail_image(+목록·작은 이미지 자동) | media 1번 | |
| | 목록용 이미지 | ○ | list_image | metafield list_image | |
| | 추가 이미지(착용·디테일) | ● | additionalimages | media 2~n | |
| | 이미지 alt | ● | (SEO meta_alt) | media.alt | `상품명 - Atelier de LUMEN` |
| 분류 | 카테고리 | ● | category[] (BAG·SHOP·시즌·드롭 등 13개) | collections(수동) + 태그로 스마트 컬렉션 | 대분류 매핑표 필요 |
| | 상품 분류(택소노미) | ● | classification_code | category(…핸드백 > 숄더백) | |
| | 구글 상품 카테고리 | ● | — | mm-google-shopping / mc-facebook = 3032 | |
| 필터 | 소재 | ● | 태그 COW_LEATHER 등 + MATERIAL_ALL | metafield product_material | ⚠️ 카페24 밑줄 |
| | 색상 | ● | 태그 BROWN + COLOR_ALL | metafield product_color_chip | |
| | 사이즈 | ● | 태그 MEDIUM + SIZE_ALL | (사이즈 기준표 bag_size_master) | |
| | 디자인 | ● | 태그 DESIGN_ALL | metafield product_design | |
| 검색 | 검색 해시태그 KO/EN | ● | product_tag (LOG, 로그미들백 …) | tags(26FW, BAG, LOG …) | 카페24 검색은 태그 정확 일치 |
| SEO | 메타 제목 | ● | meta_title `상품명 | 가죽 숄더백 | 아뜰리에 드 루멘` | seo.title `상품명 | Leather Shoulder Bag` + JA | |
| | 메타 설명 | ● | meta_description | seo.description + JA | |
| | 메타 키워드 | ● | meta_keywords | — | |
| | 검색엔진 노출 | ● | search_engine_exposure=T | (기본) | |
| | URL 핸들 | ● | — | handle | |
| GEO | 구조화 데이터 | 자동 | head JSON-LD(스킨) | 테마 Product JSON-LD 스니펫 | 상품명·가격·이미지·재고에서 자동 생성 — 입력값 정확성만 보장 |
| | llms.txt·사이트맵 | 자동/확인 | 사이트맵 자동, llms.txt 수동 갱신 대상 | 사이트맵 자동 | 신상품 묶음 단위로 llms.txt 갱신 여부 결정 필요 |
| 물류 | 무게 | ● | product_weight | inventoryItem.measurement | |
| | 원산지 | ● | made_in_code / origin_place | countryCodeOfOrigin | 채널별 상이 허용(7/31 결정) |
| | HS코드 | ● | hscode | harmonizedSystemCode | |
| | 제조일 | ○ | made_date | — | |
| | 배송 설정 | ● | shipping_* (개별 배송비 등) | (스토어 공통) | |
| 재고 | 채널별 초기 재고 | ● | variants inventories | inventory 수량 | 채널 재고는 독립 운영 |
| | 재고 추적 | ● | use_inventory | inventoryItem.tracked | |
| 판매 | 네이버페이 | ● | use_naverpay | — | |
| | 판매 채널 | ● | (카페24 단일) | 공개 채널(온라인 스토어·POS·Google·Meta·TikTok·Pinterest·Reddit 등) | |
| | 마켓 연동 | ○ | market_sync | — | |
| | 시즌 태그 | ● | (분류) | tags 26FW / 26FW 1ST | 고객 노출은 26AW 표기 원칙 |

## 2. 예약 공개 (미리 등록)

| 항목 | 내용 |
|---|---|
| 입력 | 공개 예정 날짜·시간(KST), 채널 선택(카페24/쇼피파이/둘 다) |
| 등록 시점 | 두 채널 모두 **비공개 상태로 미리 생성**(카페24 진열·판매 안 함, Shopify DRAFT) → 검수 |
| 공개 시점 | ERP 예약 실행기가 정해진 시각에 카페24 진열·판매 ON, Shopify ACTIVE + 채널 공개 → 실제 페이지 재조회로 확인 → 실패 시 담당자 알림 |
| 사전 점검(공개 1시간 전) | 필수 항목 누락, 이미지 수, 가격 0원, 필터 태그·메타필드, SEO, 재고 0 여부 |

## 3. 남은 확인

- 카페24 밑줄 태그 처리 방식 결정(스킨 수정 vs 관리자 자동입력)
- 카페24 관리자 상품 예약 진열 기능 존재 여부(있으면 그걸 우선 사용)
- 테스트 상품 2개 삭제(카페24 #2094 + 이미지 파일, Shopify 15411188564289) — 확인 후
