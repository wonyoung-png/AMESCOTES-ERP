# ATLM 통합 ERP — 설계서 v1 (Design Lock)

> **범위:** OEM + 브랜드 **생산** 업무 (Phase 1)  
> **상태:** 2026-07-10 확정  
> **기준 문서:** `기획서.md`, `개발_가이드.md`, 대화 설계 감사  
> **UI 참고:** BGROW OS (`https://os.bgrow.co.kr`), `design/샘플_전체UI_24탭.html`

---

## 1. 사업 구조

| 사업 | 내용 | ERP에서의 표현 |
|------|------|----------------|
| **OEM (AMESCOTES)** | 타 브랜드 제조·납품 (B2B) | 바이어 = `vendors` |
| **LUMEN** | 자체 브랜드 B2C+해외홀세일 | 납품거래처로 등록, `workspace: LUMEN` |
| **AETALOOP** | 자체 브랜드 B2C+해외홀세일 | 납품거래처로 등록, `workspace: AETALOOP` |

**원칙**
- 생산 파이프라인 **1개** (OEM·브랜드 공유)
- 1제품 = 1스타일번호, 브랜드 전용 (다브랜드 공유 없음)
- 품목코드 LUMEN/AETALOOP 규칙은 **임시 시작**, 추후 확정

---

## 2. 시스템 경계

### ERP가 하는 것 (Phase 1)

- 샘플 · 품목 · BOM · 원가
- 브랜드 묶음 발주 · 승인 워크플로우
- 생산발주 · 작업지시서 · 자재구매
- 입고 (부분입고 포함) · OEM 출고 · 거래명세표
- 미수금 · 미지급 · 불량 차감 이월
- 생산비용 분석 (기간·품목·공장 필터)
- 3PL 입고 ↔ 발주번호 연동

### ERP가 하지 않는 것 (Phase 1)

- B2C·쇼룸·홀세일 **출고지시·재고 운영** → **이지어드민**
- 채널 판매 수집 · 운영캘린더 · CS · AI 리오더 예측
- 세금계산서 **세무 신고** (데이터 export는 가능)
- 작업지시서 엑셀 양식 1:1 복제 (추후)

### 이지어드민 연동

| 항목 | 주체 | 연동 |
|------|------|------|
| 3PL 실재고 (바코드) | 이지어드민 | ERP → 이지어드민 입고 전송 |
| B2C·쇼룸·홀세일 출고 | 이지어드민 | — |
| MD 발주 화면 재고 참고 | 이지어드민 | API **또는** 엑셀/수동 (둘 다 지원) |

**1차 추천:** 입고 확정 시 ERP → 이지어드민 **단방향** 전송. 재고 조회는 API 가능 시 API, 아니면 엑셀/수동 + 「최종 동기화 시각」 표시.

### OEM vs 브랜드 물류

| | OEM | 브랜드 |
|---|-----|--------|
| 완제품 | 중국 **직출고** (바이어 지정창고) | **3PL 입고** |
| 우리 창고 | 없음 | 없음 |
| 출고 | ERP: 출고·인보이스·명세 | 이지어드민 출고지시 |
| 세금계산서 | 바이어에 발행 (미수금 기준) | 브랜드팀 납품 시 **발행 안 함** |

---

## 3. 워크스페이스

```
[공유 DB]
  거래처 · 품목 · 샘플 · BOM · 발주 · 자재
        │ workspace / brand 필터
  [OEM]  [LUMEN]  [AETALOOP]  [전체]
```

- 생산팀은 **OEM 워크스페이스**에서 LUMEN/AETALOOP도 바이어와 동일하게 생산 처리
- 브랜드 MD는 **자기 워크스페이스(LUMEN 또는 AETALOOP)에서만** 묶음 발주·승인 — **브랜드 간 발주서 혼합 없음**

---

## 4. OEM 생산 워크플로우

```
거래처 → 샘플 → 품목 → BOM/원가
    ↓
생산발주 등록
    ↓
작업지시서 / 공장발주서 → 공장 전달  (모든 발주 공통)
    ↓
┌─────────────────┬──────────────────┐
│ 사입자재         │ 공장 완사입       │
│ (isHqProvided)  │ (not hqProvided) │
│ 우리 구매발주    │ 수량만 전달       │
│ → 공장 전달      │ 구매 없음         │
│ [자재구매 탭]    │                  │
└─────────────────┴──────────────────┘
    ↓
공장 생산
    ↓
입고 (부분입고 옵션, receipt_logs)
    ↓
출고 (직출고)
    ↓
거래명세표 → 미수금 (세금계산서 발행일 기준)
```

---

## 5. 브랜드 생산 워크플로우

브랜드도 **샘플 → 품목 → BOM** 동일.

```
MD: 묶음 발주서 작성 (주 1~2회, **해당 브랜드만** — LUMEN / AETALOOP **각각 별도 발주서**, SKU A~G × 컬러/수량)
    + @멘션으로 생산 담당자에게 납기 입력 요청 (승인 단계 아님, MD 화면 참고정보)
    ↓
승인 R3 (6단계, 신규·리오더 동일)
  ① MD 작성
  ② 생산 납기 입력 (@멘션, 참고)
  ③ MD 재확인
  ④ MD팀장
  ⑤ 디자인팀장
  ⑥ 대표
    ↓ (반려 시: 해당 단계만 수정 후 재제출)
생산팀: 묶음 발주를 공장별로 분할 (1건에 공장 여러 개 가능)
    ↓
생산발주 자동 생성 (SKU/공장별) + 작업지시서 자동 변환
    ↓
[이하 OEM과 동일: 사입/완사입 → 생산 → 3PL 입고]
    ↓
이지어드민: 바코드 실수량 · 출고지시
```

### 브랜드 내부 납품

- OEM팀이 브랜드팀에 납품하는 것과 **동일 파이프라인**
- **세금계산서 없음**
- **생산비용 체크** 기능 필요 (아래 §9)

---

## 6. 승인 엔진

| 항목 | 규칙 |
|------|------|
| 단계 | R3 6단계 (신규·리오더·디테일 변경 모두 동일) |
| 담당 | **역할 기반** — 직원 등록 후 `md` / `md_lead` / `design_lead` / `ceo` / `production` 역할 부여 |
| 납기 | 승인 단계 ❌ · `@담당자 납기입력` → 생산 입력 → MD 화면 참고 |
| 반려 | **해당 단계만** 수정 후 재제출 |
| 완료 후 | 생산팀 Inbox · 묶음 발주 분할 · 생산발주 자동 생성 |

---

## 7. 데이터 모델 (핵심)

### 신규 테이블

```sql
-- MD 묶음 발주 (주 1~2회, **워크스페이스 1개 고정** — LUMEN 또는 AETALOOP, 혼합 불가)
brand_order_batches (
  id, workspace,
  project_no text not null,    -- LUM-260610-01 → projects
  title, week_label,
  status,                    -- draft | in_approval | approved | split | done
  approval_step,             -- 1~6
  expected_dely,             -- 생산팀 입력 (참고)
  dely_requested_to,         -- @멘션 대상
  created_by, created_at, updated_at
)

brand_order_lines (
  id, batch_id,
  style_no, style_name,
  color_qtys jsonb,
  factory_id, factory_name,
  production_origin text,        -- domestic | china
  is_employee_purchase boolean default false,
  memo
)

approval_logs (
  id, batch_id, step, action,  -- approve | reject | comment
  actor_id, actor_name, comment, created_at
)

receipt_logs (                -- 부분입고
  id, order_id, qty, defect_qty, defect_note,
  received_date, memo, created_at
)

defect_carryovers (
  id, style_no, order_no, vendor_id,
  amount_krw, reason, defect_date,
  status,                    -- pending | applied
  applied_statement_id, created_at
)

payables (                    -- 미지급
  id, vendor_id, source_type, source_id,
  amount_krw, due_date, status, ...
)
```

### 기존 테이블 확장

```sql
vendors (
  + payment_terms jsonb      -- { type: 'next_month', day: 15|30 } 수금·지급 공통
  + workspace text
)

items (
  + workspace text           -- OEM | LUMEN | AETALOOP
  + lifecycle_status text default 'active'  -- new | active | markdown | discontinued (브랜드)
)

production_orders (
  + project_no text not null
  + source_batch_id text
  + source_line_id text
  + workspace text
  + production_origin text      -- domestic | china
  + is_employee_purchase boolean default false
)

materials (
  + item_code text           -- M01, Z01 (합산 정본)
)
```

### 관계

```
projects 1 ──N── production_orders
projects 1 ──N── oem_orders | brand_order_batches (원천)
projects 1 ──N── trade_statements | payables | receivables
brand_order_batch 1 ──N── brand_order_lines
brand_order_batch 1 ──N── approval_logs
brand_order_batch 1 ──N── production_orders  (승인·분할 후 SKU/공장별)
production_order  1 ──N── receipt_logs
production_order  0 ──1── trade_statements     (OEM)
```

**코드 규칙**
- 거래처 정본 코드: `vendors.code` 단일
- 자재 통합발주 합산: `materials.item_code` 기준
- **프로젝트번호:** 모든 전표·발주·정산의 **공통 연결 키** (§7.1)

### 7.1 프로젝트번호 — 전사 통합 스파인 (2026-07-10 확정)

> **원칙:** 브랜드 리오더뿐 아니라 **OEM 거래처 수주·발주**에도 동일하게 부여.  
> 프로젝트 1건 = **실제 매입·매출·손익**을 끝까지 추적하는 단위.

```
[프로젝트 생성]  OEM 수주 | 브랜드 묶음발주 | (기획전 연동 선택)
       │
       ├── 생산발주 (N건)
       ├── 자재구매 (사입)
       ├── 입고·생산원가
       ├── 출고·거래명세 (OEM 매출)
       ├── 미수금·미지급
       └── (브랜드) 채널 정산 매출 · 기획전 비용
              ↓
       [프로젝트 손익 대시보드]
```

#### 번호 형식 (유형별 자동 발급)

| 유형 | 형식 | 예시 | 생성 시점 |
|------|------|------|----------|
| **OEM 수주** | `{바이어코드}{YYYY}-{NNN}` | `NW2026-001` | 거래처 PO·수주 등록 |
| **브랜드 발주** | `{브랜드코드}-{YYMMDD}-{NN}` | `LUM-260610-01` | MD 묶음발주·리오더 확정 |
| **기획전** (선택) | `{브랜드코드}-CP-{YYMMDD}-{NN}` | `LUM-CP-260701-01` | 기획전 선발주 시 |

- `LUM` / `AET` = LUMEN / AETALOOP
- OEM은 기존 `WORKFLOW.md` 규칙 유지 (`NW2026-001`)
- **한 프로젝트에 여러 생산발주** 가능 (공장 분할·SKU별)
- 기획전은 `campaign_id`로 프로젝트에 **연결** (별도 번호 또는 CP 접두)

#### `projects` 마스터

```sql
projects (
  id,
  project_no text unique not null,   -- NW2026-001 | LUM-260610-01
  project_type,                      -- oem | brand_batch | campaign
  workspace,                         -- OEM | LUMEN | AETALOOP
  counterparty_id,                   -- OEM: buyer vendor_id / 브랜드: null
  campaign_id,                       -- optional
  title, status,
  order_date, delivery_date,
  created_by, created_at
)
```

#### `project_no` 필수 연결 (빈 값 차단)

| 전표·기록 | 연결 |
|----------|------|
| `oem_orders` | 프로젝트 **원천** (OEM) |
| `brand_order_batches` / `reorder_batches` | 프로젝트 **원천** (브랜드) |
| `production_orders` | N:1 프로젝트 |
| `materials` / 자재구매 | 매입 |
| `receipt_logs` | 입고·생산원가 |
| `trade_statements` | OEM **매출** |
| `payables` | **매입**·미지급 |
| `receivables` | 미수금 |
| `defect_carryovers` | 불량 차감 |
| ~~`channel_settlement_lines`~~ | ~~프로젝트~~ → **제품 손익 탭** (§2.5) |
| `campaigns` | 기획전 손익 (별도 화면) |

#### 프로젝트 손익 vs 제품 손익 vs 기획전 손익 (2026-07-10 확정)

**3개 화면 분리** — 한 화면에 섞지 않음.

| 화면 | 목적 | 핵심 질문 |
|------|------|----------|
| **프로젝트 손익** | 생산·거래 단위 | BOM 대비 **실제 원가** 얼마나 싸게/비싸게 만들었나? (OEM은 매출·매입 포함) |
| **제품 손익** | 상품코드·채널 단위 | 이 SKU **팔면 얼마 남나?** 채널별 마진? |
| **기획전 손익** | 캠페인 단위 | 이 기획전 **성과** 어땠나? (별도 체크) |

#### 프로젝트별 손익 (P&L) — **생산·OEM 중심**

```
┌─ NW2026-001 · NAVY WALLET · NW 바이어 ─────────────────┐
│  매출    거래명세 합계              ₩12,400,000          │
│  매입    자재 + 공임 + 후가공       ₩ 8,200,000          │
│  차감    불량 이월                  ₩   150,000          │
│  손익    마진 ₩4,050,000 (32.7%)                         │
└──────────────────────────────────────────────────────────┘

┌─ LUM-260610-01 · 6월 2주차 리오더 ─────────────────────┐
│  BOM 표준원가/개                   ₩  52,000               │
│  실제 생산원가/개 (입고 기준)       ₩  48,500  ▼ 6.7%    │
│  차이 사유 drill-down              [자재↑] [공임↓]       │
│  총 생산 수량                       350개                  │
│  총 원가 차이 (절감)                ₩1,225,000             │
│  ※ 채널 매출은 「제품 손익」탭에서 조회                    │
└──────────────────────────────────────────────────────────┘
```

| 구분 | 프로젝트 손익에 포함 |
|------|---------------------|
| **OEM** | 매출(거래명세) + 매입(자재·공임) + 불량차감 |
| **브랜드** | **BOM vs 실제 생산원가** 비교만 (매출 제외) |
| **공통** | `project_no`로 생산발주·입고·자재구매 drill-down |

---

## 8. 상태 머신

### brand_order_batch.status

```
draft → in_approval → approved → split → done
              ↓ reject (해당 step 유지, 수정 후 재제출)
```

### production_order.status

```
발주생성 → 생산중 → 입고완료 (전량) | 생산중+부분입고 (일부)
```

### trade_statement / receivable

```
미청구 → 청구완료 → 수금완료
연체: 계산서 발행일 + payment_terms 초과 & 미수금 > 0
```

---

## 9. 생산비용 분석 (브랜드 내부)

세금계산서 없이 **생산비용 가시화**.

| 필터 | 옵션 |
|------|------|
| 기간 | 주별 · 월별 · 분기별 · 연도별 · 커스텀 |
| 품목 | 스타일번호 / 브랜드 |
| 공장 | vendor_id |

**집계 소스:** `production_orders` × BOM (`factory_unit_price_krw` × qty) + 사입자재 실구매액 + 물류 CBM 배분  
**패킹자재:** BOM 본체와 **분리** — 원가 화면에서 **옵션 토글**로 포함/제외 (§9.1)

### 9.1 패킹자재 (행택·더스트백 등) — 2026-07-10 확정

> 브랜드를 **납품 거래처**처럼 관리할 때 **제품 BOM에 패킹자재가 들어가지 않음**.

| 항목 | 규칙 |
|------|------|
| 마스터 | `packing_materials` 별도 (코드·단가·품목명) |
| 재고 | **이지어드민** (ERP는 조회만) |
| 원가 계산 | **옵션** `include_packing_in_cost` — 켜면 합산, 끄면 제외 |
| 적용 화면 | 프로젝트 손익 · 제품 손익 · 생산비용 분석 |
| BOM | 제품 BOM 라인에 **넣지 않음** (패킹은 부자재 마스터 + 토글) |

```sql
packing_materials (
  id, workspace, code, name,
  unit_cost_krw, vendor_id,
  memo
)

-- 스타일별 기본 패킹 구성 (선택)
packing_sets (
  id, style_no,
  lines jsonb   -- [{ packing_material_id, qty }]
)

-- 원가·손익 화면 공통 옵션
cost_view_options (
  include_packing_in_cost boolean default false
)
```

---

## 10. 정산 규칙

| 항목 | 규칙 |
|------|------|
| **미수금** | 세금계산서 **발행일** + 거래처 `payment_terms` → 입금 예정일 → 연체 알림 |
| **미지급** | 거래처 등록 시 **동일 payment_terms** 구조 · 다음달 입출금 예측 |
| **불량 차감 이월** | 납품 완료 후 불량 → `defect_carryovers` 저장 → 다음 정산 시 명세에 자동 반영 |
| **물류 CBM** | OEM·브랜드 동일 로직 (BOM/입고 연동) |

---

## 11. 이지어드민 연동 스펙

### 모드 (설정에서 선택)

| 모드 | 용도 |
|------|------|
| `api` | 입고 확정 → API 전송 · 재고 조회 API |
| `excel` | 엑셀 export/import |
| `manual` | ERP 입고만 기록, 이지어드민 수동 반영 |

### ERP → 이지어드민 (입고)

```json
{
  "order_no": "LLL6F92-R2",
  "style_no": "LLL6F92SB",
  "qty": 100,
  "received_date": "2026-07-10",
  "workspace": "LUMEN"
}
```

### 이지어드민 → ERP (재고, 2차)

품목별 3PL 가용재고 — API 또는 엑셀.

---

## 12. Phase 1 구현 범위

> **우선순위:** 브랜드 운영(1A) > 생산 최소선(1B). 상세는 `DESIGN_BRAND_OPS.md` §0·§9.

### 1A — 브랜드 운영 (최우선) ✅

- BGROW 셸 + LUMEN / AETALOOP 워크스페이스
- 채널 판매 (Cafe24 · Shopify API)
- W컨셉/29CM 월마감 AI 파싱 · **실판매가**
- 기획전 **campaign-pl** (BGROW 이식)
- 이지어드민 재고 조회 (API + 엑셀/수동)
- 채널 미수금 (payment_terms)
- Inbox · MD 대시보드

### 1B — 생산 백본 (필수 최소) ✅

- Supabase 단일 데이터 소스
- LUMEN / AETALOOP **각각** 브랜드 발주 + R3 승인
- 생산발주 · 3PL 입고 · 생산비용
- OEM 기존 6단계 유지 (대개편 없음)
- 미지급 · 불량 차감 이월

### Phase 2+ ⏳

- 작업지시서 엑셀 양식 1:1 이식
- AI 발주 수량 예측
- 운영캘린더 · 기획전
- 채널 판매 · CS · 쇼룸
- 슬랙 알림
- 이지어드민 실시간 양방향 API
- LUMEN/AETALOOP 코드 규칙 확정

---

## 13. 화면 목록 (Phase 1)

| 그룹 | 화면 | 신규/개조 |
|------|------|:---:|
| 셸 | Inbox, 워크스페이스 전환, BGROW 레이아웃 | 신규 |
| 제조 | 거래처 · 품목 · 자재 · 샘플 · BOM | 개조 |
| 제조 | **브랜드 묶음 발주** | **신규** |
| 제조 | 생산발주 (+ 분할 UI) | 개조 |
| 제조 | 자재구매 | 개조 |
| 제조 | **입고·출고** (OEM/3PL 분리) | 신규 |
| 분석 | **생산비용** (기간·품목·공장) | **신규** |
| 분석 | **프로젝트 손익** (BOM vs 실제원가 · OEM 매출) | **신규** |
| 정산 | 거래명세표 · 미수금 · **미지급** | 개조 |
| 설정 | 환율 · 이지어드민 연동 모드 | 개조 |

---

## 14. 기술 부채 (개발 전 처리)

1. `store.ts` localStorage → Supabase 전면 이전
2. Dashboard·TradeStatement 등 `store.getOrders()` → `useQuery` 통일
3. 발주 확정 로직 단일 함수화 (materials + purchase_items)
4. `BomManagement` 등 대형 파일 분리 (빌드 스플리팅)
5. `vendors.code` / `vendorCode` → `code` 단일화

---

## 15. E2E 테스트 시나리오

### OEM

1. 바이어 등록 → 샘플 → 품목 → BOM (사입+완사입)
2. 생산발주 → 작업지시서 → 사입자재 구매 → 공장 생산
3. 부분입고 100/500 → 잔량 생산중 → 전량 입고
4. 출고 → 거래명세표 → 미수금 (계산서일+익월15)

### 브랜드

1. LUMEN 품목·BOM → MD 묶음 발주 (SKU 3개, 공장 2개)
2. @납기 입력 → R3 6단계 승인
3. 생산팀 공장별 분할 → 생산발주 3건 자동
4. 3PL 입고 (발주번호 연동) → 이지어드민 (API 또는 수동)
5. 생산비용 월별·공장별 조회 (세금계산서 없음)

---

## 16. 미결 (Phase 2, 지금 답 불필요)

- 작업지시서 엑셀 필드 매핑 (양식 변경 예정)
- 브랜드 내부 납품 단가 = BOM 원가 vs delivery_price (생산비용 화면은 BOM 기준으로 1차 구현)
- ECOUNT 컷오버 시점
- RBAC 상세 (팀장·디자인·대표 계정 매핑)

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-07-10 | B12 · production_origin · brand_order_lines 확장 |
| 2026-07-10 | §9.1 패킹자재 분리·원가 옵션 토글 |
| 2026-07-10 | v1 Design Lock — OEM+브랜드 생산 범위 확정 |
