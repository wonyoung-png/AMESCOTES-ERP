# B2B OEM 워크플로우 구현 스펙

> 이 문서는 ATLM ERP를 **B2B OEM 전용**으로 전환하기 위한 7개 작업의 상세 구현 스펙이다.
> 모든 작업은 이카운트 6단계 워크플로우(수주→발주→납기→입고→원가→결산)에 정합되도록 설계됨.
> B2C(W컨셉/29CM/자사몰) 관련 모든 코드는 제거 또는 B2B로 전환한다.

## 공통 원칙

1. **projectCode = orderNo**: 수주 시 생성된 코드를 모든 하위 전표(발주서·구매·전표·결산)에 강제로 전파. 빈 값 차단.
2. **B2C 흔적 일소**: 채널 enum, SalesRecord/Settlement B2C 필드, 사이드바 메뉴 모두 제거.
3. **Vendor.type**: 기존 enum 유지 — `'바이어'`(=B2B 클라이언트), `'공장'`, `'자재업체'`. 새 타입 추가 불필요.
4. **데이터 모델 변경은 store.ts에 집중**: 마이그레이션 헬퍼 함수 추가해 기존 localStorage 데이터 정리.

---

## 작업 1 — SalesManagement → OemOrderEntry 전환

### 목표
B2C 채널 매출 입력 화면을 B2B 클라이언트 PO 등록 화면으로 전환.

### 파일
- `client/src/pages/SalesManagement.tsx` → **`client/src/pages/OemOrderEntry.tsx`로 리네임**
- `client/src/App.tsx`: 라우트 `/sales` → `/oem-orders` 변경, import도 변경
- `client/src/components/Layout.tsx`: 사이드바 메뉴 라벨 "매출 관리" → "수주 관리(OEM)"

### 제거할 코드 (SalesManagement.tsx)
```typescript
// 제거
const CHANNELS: SettlementChannel[] = ['W Concept', '29CM', '자사몰', '해외T/T', 'B2B직납', '기타'];
const CHANNEL_COLORS: Record<string, string> = { ... };
// channel, channelOrderNo 필드 입력 폼 제거
```

### 추가할 필드 (OEM 수주 입력)
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `projectCode` | string | ✅ | 오더번호 (예: `NW-2026-03`). buyer 코드 + 연도 + 일련번호 자동생성 |
| `buyerId` | string | ✅ | Vendor.type='바이어' 중 선택 |
| `clientPoNo` | string | ⬜ | 클라이언트 발급 PO번호 |
| `styleId` | string | ✅ | 완제품 (ItemMaster에서 선택) |
| `qty` | number | ✅ | 수주 수량 |
| `unitPriceKrw` | number | ✅ | 클라이언트 단가 (KRW) |
| `orderDate` | string | ✅ | 수주일 |
| `deliveryDate` | string | ✅ | 납기일 (클라이언트 약속일) |
| `season` | Season | ⬜ | 시즌 태그 |
| `memo` | string | ⬜ | 비고 |

### 신규 인터페이스 (store.ts)
```typescript
export interface OemOrder {
  id: string;
  projectCode: string;        // = orderNo, 모든 하위 전표 연결 키
  buyerId: string;
  buyerName: string;
  clientPoNo?: string;
  styleId: string;
  styleNo: string;
  styleName: string;
  qty: number;
  unitPriceKrw: number;
  totalAmountKrw: number;     // qty * unitPriceKrw, 자동 계산
  orderDate: string;
  deliveryDate: string;
  season?: Season;
  status: '수주' | '발주중' | '생산중' | '입고완료' | '납품완료' | '취소';
  memo?: string;
  createdAt: string;
  updatedAt?: string;
}

// 헬퍼
export function generateProjectCode(buyerCode: string): string {
  // 예: 'NW' + '2026' + '-' + 3자리 일련번호 → 'NW2026-001'
}
```

### store.ts 함수
- `getOemOrders(): OemOrder[]`
- `saveOemOrder(order: OemOrder)`
- `deleteOemOrder(id: string)`

### UI 핵심 동작
- 거래처 선택 시: Vendor.type='바이어'인 항목만 드롭다운에 표시
- 거래처 선택 시: 해당 vendor의 `code` 필드 읽어 projectCode 자동 prefix 생성
- 품목 선택: ItemMaster에서 완제품만 필터링

---

## 작업 2 — store.ts 모델 정리

### 목표
B2C 흔적을 모델에서 완전 제거하고 B2B용으로 리팩토링.

### 파일
- `client/src/lib/store.ts`

### 제거할 인터페이스/타입
```typescript
// 제거
export type SettlementChannel = ...
export interface SalesRecord { ... }    // B2C 매출 기록
export interface Settlement { ... }     // B2C 정산 (VendorReceivable로 전환)
// CHANNELS, CHANNEL_COLORS 상수
```

### 신규/리팩토링 인터페이스
```typescript
// 1. OemOrder — 작업 1에서 정의

// 2. VendorReceivable (기존 Settlement 대체)
export interface VendorReceivable {
  id: string;
  projectCode: string;          // 어느 수주에서 발생한 채권인지
  buyerId: string;
  buyerName: string;
  amountKrw: number;
  issuedDate: string;           // 채권 발생일 (납품완료일)
  dueDate: string;              // 입금 약속일
  receivedDate?: string;        // 실수금일
  status: '미수' | '일부수금' | '완납' | '연체';
  taxInvoiceNo?: string;        // 세금계산서 번호
  memo?: string;
}

// 3. VendorPayable (신규 — 채무)
export interface VendorPayable {
  id: string;
  projectCode: string;          // 어느 수주의 발주에서 발생한 채무인지
  vendorId: string;             // 자재업체 or 공장
  vendorName: string;
  poId?: string;                // 발주서 ID (ProductionOrder.id)
  amountKrw: number;
  issuedDate: string;           // 채무 발생일 (입고일/세금계산서일)
  dueDate: string;              // 지급 약속일
  paidDate?: string;            // 실지급일
  status: '미지급' | '일부지급' | '완납' | '연체';
  taxInvoiceNo?: string;
  paymentMethod?: '계좌이체' | '법인카드' | '현금';
  memo?: string;
}
```

### 마이그레이션 헬퍼
```typescript
// 기존 localStorage의 'salesRecords', 'settlements' 키 데이터 삭제
export function migrateB2CToB2B(): void {
  localStorage.removeItem('salesRecords');
  localStorage.removeItem('settlements');
  // 만약 보존 필요시 export 후 삭제
}
```

App.tsx의 main 진입점에서 1회 실행 후 localStorage에 `migrationV2Done = true` 마커 저장.

---

## 작업 3 — ProductionOrders 1:N 발주서 분리 확장

### 목표
한 수주(OemOrder)에 여러 발주서(원단/부자재/봉제/공장)를 묶을 수 있게 확장. 모든 발주서는 동일 projectCode 공유.

### 파일
- `client/src/pages/ProductionOrders.tsx`
- `client/src/lib/store.ts` (ProductionOrder 인터페이스 수정)

### ProductionOrder 인터페이스 수정
```typescript
export interface ProductionOrder {
  id: string;
  poNo: string;                 // 발주서 번호 (자체 채번)
  projectCode: string;          // 🔑 OemOrder.projectCode와 1:N 연결 키 (필수)
  oemOrderId: string;           // OemOrder.id 참조

  // 발주 대상
  vendorId: string;             // 자재업체 or 공장
  vendorName: string;
  vendorCategory: '원단' | '부자재' | '봉제' | '완제품공장' | '기타';

  // 발주 내용
  items: ProductionOrderItem[]; // 발주 품목 N건 (한 발주서 내에서)
  totalAmountKrw: number;

  // 일정
  orderDate: string;
  expectedReceiveDate: string;
  actualReceiveDate?: string;

  // 상태
  status: '발주작성' | '발주확정' | '입고중' | '입고완료' | '취소';

  // 부대비용 (선택, 입고 시 PurchaseMatching에서 분배)
  freight?: number;
  customs?: number;
  inspection?: number;

  memo?: string;
  createdAt: string;
}

export interface ProductionOrderItem {
  id: string;
  itemName: string;
  spec?: string;
  qty: number;
  unit: string;
  unitPriceCny?: number;
  currency: Currency;
  amountKrw: number;
  receivedQty?: number;         // 실입고량
}
```

### UI 핵심 동작
1. **수주 선택 드롭다운**: OemOrders 목록에서 선택 → projectCode 자동 채움
2. **"발주서 추가" 버튼**: 동일 projectCode로 N장 발주서 추가 생성
3. **발주서 그룹 뷰**: projectCode별로 그룹핑된 카드 뷰. 각 카드 안에 N개 발주서 리스트
4. **검증**:
   - projectCode 빈 값 차단
   - vendorCategory와 vendor.type/materialTypes 일관성 검증 (원단 발주는 자재업체이면서 materialTypes='원단'인 곳만)

### 기존 코드 처리
- 기존 ProductionOrder의 `orderNo` 필드는 `poNo`로 리네임
- 기존 데이터에 `projectCode`가 없으면 → 마이그레이션 시 'LEGACY-{orderNo}'로 채움

---

## 작업 4 — PurchaseMatching 부대비용 분배 로직

### 목표
입고 시 부대비용(관세·운임·검사비)을 입력하면 발주 품목의 착지원가에 자동 분배. Step 5 마진 계산의 정확도 보장.

### 파일
- `client/src/pages/PurchaseMatching.tsx`
- `client/src/lib/store.ts` (PurchaseItem 인터페이스 보강)

### PurchaseItem 인터페이스 확장
```typescript
export interface PurchaseItem {
  // ... 기존 필드들
  poId?: string;                // 발주서 ID 참조 (1:N 연결)
  projectCode: string;          // 🔑 강제 필드

  // 부대비용 (입고 단위로 분배됨)
  freightShare?: number;        // 운임 분배액 (KRW)
  customsShare?: number;        // 관세 분배액 (KRW)
  inspectionShare?: number;     // 검사비 분배액 (KRW)
  landedCostKrw: number;        // 착지원가 = 단가KRW + 부대비용분배

  // 기존
  amountKrw: number;            // 단가 × 수량 (부대비용 제외)
}
```

### 분배 알고리즘
입고 단위로 부대비용 총액을 가져와서, **품목별 금액 비중**대로 안분.

```typescript
function distributeOverhead(
  items: PurchaseItem[],
  freight: number,
  customs: number,
  inspection: number
): PurchaseItem[] {
  const totalAmount = items.reduce((s, i) => s + i.amountKrw, 0);
  if (totalAmount === 0) return items;

  return items.map(item => {
    const ratio = item.amountKrw / totalAmount;
    const fr = freight * ratio;
    const cu = customs * ratio;
    const ins = inspection * ratio;
    return {
      ...item,
      freightShare: Math.round(fr),
      customsShare: Math.round(cu),
      inspectionShare: Math.round(ins),
      landedCostKrw: item.amountKrw + Math.round(fr + cu + ins),
    };
  });
}
```

### UI 변경
- 입고 등록 모달 상단에 "부대비용" 섹션 추가 — 운임/관세/검사비 3필드
- 저장 시 distributeOverhead 호출 후 PurchaseItem 배열 저장
- 테이블에 "착지원가" 컬럼 추가 표시

### 검증
- 발주서 ID가 빈 값이면 저장 차단 (1:N 연결 강제)
- projectCode는 발주서에서 자동 상속 (수동 입력 불가)

---

## 작업 5 — VendorPayables 신설 + SettlementManagement → VendorReceivables 전환

### 목표
거래처별 채무(미지급) 화면 신설하고, 기존 채권 화면(SettlementManagement)을 B2B 클라이언트 미수금으로 리팩토링.

### 파일
- `client/src/pages/SettlementManagement.tsx` → **`client/src/pages/VendorReceivables.tsx`로 리네임**
- `client/src/pages/VendorPayables.tsx` **신규 생성**
- `client/src/App.tsx`: 라우트 추가
- `client/src/components/Layout.tsx`: 사이드바 메뉴 2개 (채권 / 채무)

### VendorReceivables 화면 (기존 SettlementManagement 전환)
- 데이터 소스: `VendorReceivable` 인터페이스 (작업 2에서 정의)
- 채널 필터 제거. 대신 **buyer 필터** 추가
- 미수금 잔액, 입금예정일, 상태(미수/일부수금/완납/연체) 표시
- 세금계산서 번호 컬럼 추가
- 자동 채권 생성: ProductionOrder.status가 '입고완료' & OemOrder.status가 '납품완료'로 전환되는 시점에 VendorReceivable 자동 생성

### VendorPayables 화면 (신규)
- 데이터 소스: `VendorPayable` 인터페이스 (작업 2에서 정의)
- 거래처 필터 (자재업체 / 공장)
- 미지급 잔액, 지급예정일, 상태(미지급/일부지급/완납/연체) 표시
- "지급 처리" 버튼 → PaidDate 입력 + paymentMethod 선택 + ExpenseEntry(지출전표)로 자동 연결
- 자동 채무 생성: PurchaseItem 저장 시 자동으로 VendorPayable 생성 (vendor별로 누적)

### 핵심 자동화 로직
```typescript
// PurchaseItem 저장 후 호출
export function syncPayableFromPurchase(purchase: PurchaseItem): void {
  const existing = getPayables().find(p =>
    p.vendorId === purchase.vendorId &&
    p.projectCode === purchase.projectCode &&
    p.status !== '완납'
  );

  if (existing) {
    existing.amountKrw += purchase.landedCostKrw;
  } else {
    savePayable({
      id: genId(),
      projectCode: purchase.projectCode,
      vendorId: purchase.vendorId!,
      vendorName: purchase.vendorName!,
      poId: purchase.poId,
      amountKrw: purchase.landedCostKrw,
      issuedDate: purchase.purchaseDate,
      dueDate: addDays(purchase.purchaseDate, 30), // 기본 30일
      status: '미지급',
    });
  }
}
```

---

## 작업 6 — Layout 사이드바 정리

### 목표
B2C 메뉴 제거하고 B2B 워크플로우 순서대로 사이드바 재정렬.

### 파일
- `client/src/components/Layout.tsx`

### 새 메뉴 구조 (워크플로우 순서)
```
📊 대시보드

—— OEM 워크플로우 ——
1️⃣ 수주 관리 (OEM)         → /oem-orders
2️⃣ 발주 관리                → /production-orders
3️⃣ 납기 관리                → /deadline
4️⃣ 입고 / 구매              → /purchase
5️⃣ 원가 / 이익              → /cost
6️⃣ 채권 (받을 돈)           → /receivables
6️⃣ 채무 (줄 돈)             → /payables

—— 마스터 ——
📦 품목 마스터              → /items
🧾 BOM 관리                 → /bom
🏢 거래처 마스터            → /vendors

—— 기타 ——
💼 샘플 관리                → /samples
📄 서류 출력                → /documents
💰 전표 등록                → /expense
⚙️ 환율 / 설정              → /settings
```

### 제거 메뉴
- "매출 관리" (= 구 SalesManagement, 작업 1에서 OemOrderEntry로 전환)
- "정산 관리" (= 구 SettlementManagement, 작업 5에서 VendorReceivables로 전환)

### 라벨 정렬 원칙
- 워크플로우 순서대로 번호 prefix 부여 (1️⃣ ~ 6️⃣)
- 마스터/기타는 별도 섹션으로 분리

---

## 작업 7 — projectCode 강제 검증

### 목표
모든 등록/수정 폼에서 projectCode 미입력 또는 빈 값 차단.

### 적용 대상 폼
1. OemOrderEntry — 자동생성이지만 빈 값 검증 추가
2. ProductionOrders 발주서 입력 폼 — OemOrder 선택 필수
3. PurchaseMatching 입고 등록 — 발주서 선택 시 자동 상속, 수동 차단
4. ExpenseEntry 지출전표 — projectCode 필드 추가 + 필수
5. VendorPayables/Receivables 수동 등록 시 — OemOrder 선택 필수

### 공통 검증 헬퍼
```typescript
// client/src/lib/validators.ts (신규)
export function validateProjectCode(code: string | undefined): string | null {
  if (!code || code.trim() === '') {
    return '프로젝트 코드(수주번호)는 필수입니다.';
  }
  if (!/^[A-Z]{2,5}\d{4}-\d{3}$/.test(code)) {
    return '프로젝트 코드 형식이 잘못되었습니다. (예: NW2026-001)';
  }
  // 실존 OemOrder인지 확인
  const exists = getOemOrders().some(o => o.projectCode === code);
  if (!exists) {
    return '존재하지 않는 프로젝트 코드입니다.';
  }
  return null;
}
```

### 폼 적용 예시
```tsx
const handleSubmit = () => {
  const err = validateProjectCode(form.projectCode);
  if (err) {
    toast.error(err);
    return;
  }
  // 저장 진행
};
```

### 대시보드 경고 패널
- 대시보드에 "projectCode 누락 전표 N건" 경고 카드 추가
- 클릭 시 해당 전표 목록으로 이동

---

## 완료 기준 체크리스트

작업을 모두 마쳤다면 다음 시나리오로 end-to-end 테스트:

1. ✅ 거래처 마스터에서 바이어 "NOTHING WRITTEN" 등록 (code: NW)
2. ✅ 수주 관리에서 NW를 선택해 PO 생성 → projectCode `NW2026-001` 자동 생성
3. ✅ 발주 관리에서 `NW2026-001`에 발주서 3장 추가 (원단 다산 / 부자재 창성 / 봉제공장 칭다오)
4. ✅ 납기 관리에서 `NW2026-001`의 발주서 3장 모두 미입고 상태로 표시되는지 확인
5. ✅ 입고 처리: 다산 자재 입고 + 운임/관세 입력 → 착지원가 자동 분배 확인
6. ✅ VendorPayables에 다산 채무가 자동 생성됐는지 확인
7. ✅ 원가 관리에서 `NW2026-001`의 누적 원가가 발주 + 부대비용 합계와 일치하는지 확인
8. ✅ 모든 단계에서 projectCode 빈 값 입력 시도 시 차단되는지 확인
9. ✅ 채권 화면에서 `NW2026-001`의 매출 채권이 보이는지 확인 (납품완료 후)
10. ✅ 사이드바에서 B2C 메뉴(매출/정산)가 완전히 사라졌는지 확인

---

## 작업 진행 시 권장 흐름

```
1. 브랜치 생성: git checkout -b feat/b2b-workflow-step1
2. 작업 1 완료 → 빌드 확인 → 커밋 → push → master 머지
3. 작업 2 동일 방식으로 진행
4. (이하 반복)
```

각 작업마다 별도 브랜치로 진행하면 중간에 막혀도 master는 항상 안정.
