# PMS → ERP 통합 계획

10/8 대표 결정: PMS(atlm-daily-check, FastAPI+SQLite)를 없애고 LUMEN·AETALOOF 기능을 전부 ERP(Express+React+PostgreSQL)로 옮긴다.
브랜치 `pms-merge`. **서버 이전(다른 세션)이 끝나기 전에는 배포하지 않는다.**

## 원칙

1. **탭 단위로 옮긴다.** 옮긴 탭은 ERP 사이드바가 ERP 페이지로 바로 가고, PMS 쪽 그 탭은 끈다.
2. **데이터 먼저, 화면 다음.** PMS SQLite → PostgreSQL 로 한 번 옮기고(`scripts/pms_export.py` → `scripts/pms-import.mjs`),
   그 탭의 수집(크론)을 ERP 로 옮기는 순간 PMS 크론은 끈다. **같은 크론이 두 곳에서 돌면 안 된다** —
   할인 캠페인·진열 순서·29CM/W컨셉 재고·고객 태그 정리가 실제 쇼핑몰에 두 번 쓰인다.
3. **쇼핑몰에 쓰는 기능은 맨 마지막**, 처음엔 미리보기(dry-run)로만.
4. 브랜드는 키 접두어(`aetaloof::이름`) 대신 `brand` 칼럼 (`lumen` | `aetaloof`).

## 1단계 — 기반 (이 브랜치에서 시작)

| 할 일 | 파일 |
|---|---|
| 테이블: 시트·메타·캐시·판매·크론 기록 | `supabase/migration_pms_core.sql` |
| PMS 데이터 내보내기 (PMS 컨테이너 안에서) | `scripts/pms_export.py` |
| ERP DB 로 넣기 | `scripts/pms-import.mjs` |
| 시트 읽기·쓰기 API (`/api/brand-ops/sheet/:name`) | `server/brand-ops.ts` (다음) |
| 범용 시트 화면 (PMS SheetTab 대응) | `client/src/pages/BrandSheet.tsx` (다음) |
| 외부 연동 클라이언트: Shopify·카페24·이지어드민 | `server/integrations/*` (다음) |
| 크론 실행기 + 상태 기록 (PMS health.watch 대응, 실패를 성공으로 기록하던 구멍 메우기) | `server/cron.ts` (다음) |

## 탭 순서 (조사: 10/8)

| 순서 | 탭 | 크기 | 쇼핑몰 쓰기 |
|---|---|---|---|
| 2 | 일일점검 (수집 08:30·00:05, 픽셀 :07/:27/:47) | M | ⚠ 수집 중 Shopify 고객 태그 제거 |
| 3 | 채널별 매출 | S | — |
| 4 | 시트형: 상품 리스트·재고관리·상품 손익·미출고·일정 목록·국가별 주간·주간·일회성·점검 가이드·채널 플랜 | M | ⚠ 재고관리 수집이 29CM·W컨셉 재고 동기화 |
| 5 | 상품 성과 + sales (00:20) | M | — |
| 6 | 상품관리 (리오더·시즌 계획·상품 수명, 10:30·06:00) | L | — |
| 7 | 주문관리 + 배송비 분석 | M | — |
| 8 | 업로드 캘린더 | S | — |
| 9 | 매출분석·체크아웃 퍼널·AI 유입 구매 | S | — |
| 10 | 사이트 진단 | S | — |
| 11 | 브랜드 분석 | L | — |
| 12 | 상품 콘텐츠 | M | ⚠ 상품 상태 변경 |
| 13 | 채널 대조 | S | ⚠ 상품명 변경 |
| 14 | 할인 캠페인 (10분 크론) · 자사몰관리 (05:30 크론) · 상세페이지 교정 · 이미지 생성 | L | ⚠⚠ 가격·진열·상세·이미지 |

## 옮길 때마다 확인

- PMS 와 ERP 화면 숫자가 같은지 (같은 날짜·브랜드로 대조)
- 그 탭의 크론을 PMS 에서 껐는지
- 필요한 키(.env 이름만): SHOPIFY_TOKEN/SHOP, CAFE24_*, EZADMIN_*, FEDEX_*, OPENAI/HF/GEMINI/FAL, SONAR_API_KEY, PAGESPEED_KEY, PLAN_SHEET_ID, PARTNER_KEY_29CM, WCONCEPT_*

## 알려진 PMS 버그 (옮기면서 고친다)

- `sales_cron`·`watchdog_cron` 이 예외를 삼켜 실패해도 '정상'으로 기록됨
- 매출분석 '캠페인 성과' 화면이 응답 형식 불일치로 비어 있음
