// AMESCOTES ERP — Data Store v2
// 핵심 철학: "이미 만드는 파일을 올리면 자동으로 연결된다"
// localStorage + Supabase 동시 저장 (쓰기 시 둘 다, 읽기 시 localStorage 우선)

import { supabase } from './supabase';

// camelCase → snake_case 변환 헬퍼 (최상위 키만)
function toSnakeCase(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()),
      v,
    ])
  );
}

// Supabase 저장 (실패해도 앱에 영향 없음)
async function sbUpsert(table: string, data: Record<string, any>): Promise<void> {
  try {
    const { error } = await supabase.from(table).upsert(toSnakeCase(data));
    if (error) console.warn(`[store] ${table} upsert 실패:`, error.message);
  } catch (e) {
    console.warn(`[store] ${table} upsert 오류:`, e);
  }
}

async function sbUpdate(table: string, id: string, patch: Record<string, any>): Promise<void> {
  try {
    const { error } = await supabase.from(table).update(toSnakeCase(patch)).eq('id', id);
    if (error) console.warn(`[store] ${table} update 실패:`, error.message);
  } catch (e) {
    console.warn(`[store] ${table} update 오류:`, e);
  }
}

async function sbDelete(table: string, id: string): Promise<void> {
  try {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) console.warn(`[store] ${table} delete 실패:`, error.message);
  } catch (e) {
    console.warn(`[store] ${table} delete 오류:`, e);
  }
}

export type Currency = 'KRW' | 'USD' | 'CNY';
export type Season = '25FW' | '26SS' | '26FW' | '27SS';
export type Category = '숄더백' | '토트백' | '크로스백' | '클러치' | '백팩' | '파우치' | '키링' | '지갑' | '기타';
export type BomCategory = '원자재' | '지퍼' | '장식' | '보강재' | '봉사·접착제' | '포장재' | '철형' | '후가공';
export type BomSectionKey = '원자재' | '지퍼' | '장식' | '보강재' | '봉사·접착제' | '포장재' | '철형' | '후가공';
export type MaterialCategory = '원자재' | '지퍼' | '장식' | '보강재' | '봉사·접착제' | '포장재' | '철형' | '후가공';
export type VendorType = '바이어' | '자재거래처' | '공장' | '해외공장' | '물류업체' | '기타';
export type BillingType = '월별합산' | '건별즉시';
export type ItemStatus = 'TEMP' | 'ACTIVE' | 'INACTIVE';
export type ErpCategory = 'HB' | 'SLG';
export type MaterialType = '완제품' | '원재료' | '부재료';
export type SampleLocation = '내부개발실' | '중국공장';
export type SampleRound = number;  // 1, 2, 3, 4, 5차... 제한 없음
export type TradeStatementStatus = '미청구' | '청구완료' | '수금완료';
export type TaxType = '과세' | '면세';
export type OrderStatus = '발주생성' | '샘플승인' | '생산중' | '선적중' | '통관중' | '입고완료' | '지연';
export type SampleStage = '1차' | '2차' | '3차' | '4차' | '최종승인' | '반려';
export type SampleBillingStatus = '미청구' | '청구완료' | '수금완료';
export type SettlementStatus = '정상' | '주의' | '위험' | '완납';
export type SettlementChannel = 'W Concept' | '29CM' | '자사몰' | '해외T/T' | 'B2B직납' | '기타';
export type ExpenseType = '법인카드' | '계좌이체' | '현금';
export type ExpenseCategory = '자재구매' | '물류비' | '샘플비' | '임가공비' | '기타제조원가' | '판관비' | '기타';


// ─── 자재 마스터 ───
export interface Material {
  id: string;
  name: string;           // 자재명
  nameEn?: string;        // 영문명
  category: MaterialCategory;
  spec?: string;          // 스펙 (두께, 사이즈 등)
  unit: string;           // 단위 (SF, YD, EA, M, L, 콘 등)
  unitPriceCny?: number;  // 단가 (CNY)
  unitPriceUsd?: number;  // 단가 (USD)
  unitPriceKrw?: number;  // 단가 (KRW, 국내 자재)
  priceCurrency?: 'CNY' | 'USD' | 'KRW'; // 주 표시 통화
  vendorId?: string;      // 주 공급업체
  imageUrl?: string;      // 이미지 (base64 또는 URL)
  memo?: string;
  createdAt: string;
}

// ─── 품목 마스터 ───
export interface ItemColor {
  name: string;           // 컬러명 (예: 블랙, 브라운)
  leatherColor?: string;  // 가죽/원단 컬러
  decorColor?: string;    // 장식 컬러
  threadColor?: string;   // 실 컬러
  girimaeColor?: string;  // 기리매 컬러
}

export interface Item {
  id: string;
  styleNo: string;
  name: string;
  nameEn?: string;
  season: Season;
  category: Category;
  customCategory?: string;         // 세부 카테고리 직접입력 (기타 선택 시)
  erpCategory?: ErpCategory;       // HB / SLG
  materialType?: MaterialType;     // 완제품 / 원재료 / 부재료 (항상 완제품으로 자동 설정)
  itemStatus?: ItemStatus;         // TEMP / ACTIVE / INACTIVE
  material: string;
  boxSizeL?: number;
  boxSizeW?: number;
  boxSizeH?: number;
  packagingSizeStr?: string;       // 포장사이즈 (예: 54×14×61)
  // 판매가(salePriceKrw) 제거됨 — 납품가(deliveryPrice) 기반 마진 계산으로 전환
  deliveryPrice?: number;          // 납품가 (KRW, 바이어에게 납품하는 가격)
  targetSalePrice?: number;        // 목표 납품가 (바이어 요청가, 하위 호환성 유지)
  baseCostKrw?: number;
  marginAmount?: number;           // 마진금액 = 납품가 - BOM원가
  marginRate?: number;             // 마진율 = 마진금액 / 납품가 × 100
  colors?: ItemColor[];            // 컬러 목록
  buyerId?: string;                // 바이어 1:1 연결
  imageUrl?: string;
  hasBom: boolean;
  createdAt: string;
  memo?: string;
}

// ─── BOM / 사전원가 ───
// 중국원가표 구조: 구분(섹션) > 품목 > 규격 > 단위 > 단가(CNY) > NET소요량 > LOSS율 > 소요량 > 제조금액 > 본사제공
export type BomSubPart = '바디' | '안감' | '트림1' | '트림2' | '기타';

// ─── 컬러별 BOM ───
export interface ColorBom {
  color: string;     // 컬러명 (예: '블랙', '브라운')
  lines: BomLine[];  // 원자재만 (기본 BOM에서 복사 후 수정 가능)
}

export interface BomLine {
  id: string;
  category: BomCategory;   // 섹션 구분
  subPart?: BomSubPart;     // 품목 부위 (원자재 구분 시만 사용)
  itemName: string;         // 품목
  color?: string;           // 컬러 (원자재에만 사용, 예: '블랙', '브라운', '전체')
  spec?: string;            // 규격
  unit: string;             // 단위
  customUnit?: string;      // 단위 직접입력 (unit === '직접입력' 시)
  unitPriceCny: number;     // 단가 (CNY/USD/KRW, 선택 통화 기준)
  netQty: number;           // NET 소요량
  lossRate: number;         // LOSS율 (0.05 = 5%)
  // 계산값 (자동)
  // 소요량 = netQty * (1 + lossRate)
  // 제조금액(CNY) = unitPriceCny * 소요량
  isHqProvided: boolean;    // 본사제공 여부
  isVendorProvided?: boolean; // 업체(공장)제공 여부 — 생산마진 미포함
  vendorName?: string;      // 본사제공 시 자재업체명
  vendorId?: string;        // 본사제공 시 자재업체 ID
  isNewVendor?: boolean;    // 새로 등록된 업체 (기본 정보 미입력)
  memo?: string;            // 비고
}

// 후가공비 행 (별도 구조: NET수량 * 단가)
export interface PostProcessLine {
  id: string;
  name: string;             // 품목명 (칼라불박, 자수, 인쇄 등)
  netQty: number;           // NET 수량
  unitPriceCny: number;        // 단가 (CNY)
  // 금액 = netQty * unitPrice
  memo?: string;
}

// P&L 가정값
export interface BomPnlAssumptions {
  discountRate: number;       // 할인율 (기본 5%)
  platformFeeRate: number;    // 플랫폼 수수료율 (기본 30%)
  sgaRate: number;            // 인건비/판관비율 (기본 10%)
  confirmedSalePrice?: number; // 확정 판매가 (직접 입력)
}

export interface Bom {
  id: string;
  styleId: string;
  styleNo: string;
  styleName: string;
  styleNameEn?: string;
  lineName?: string;          // 라인명
  designer?: string;          // 담당 디자이너
  size?: string;              // 사이즈
  boxSize?: string;           // 포장사이즈 (예: 54*14*61)
  brandNo?: number;           // 브랜드 번호
  version: number;
  season: Season;
  lines: BomLine[];           // 원자재~포장재 섹션 행들 (사전원가)
  postProcessLines: PostProcessLine[]; // 후가공비 행들
  processingFee: number;      // 임가공비 (CNY) — 사전원가
  logisticsCostKrw?: number;  // 물류비 (KRW, PCS 배분 후)
  packagingCostKrw?: number;  // 포장/검사비
  packingCostKrw?: number;    // 패킹재
  productionMarginRate?: number; // 생산마진율 (기본 16%)
  snapshotCnyKrw: number;     // 적용 환율 (CNY→KRW)
  snapshotUsdKrw?: number;    // 적용 환율 (USD→KRW)
  pnl?: BomPnlAssumptions;    // P&L 가정값
  sourceFileName?: string;    // 업로드한 엑셀 파일명 (사전원가)
  // ─── 사후원가 필드 ───
  preMaterials?: BomLine[];       // 사전원가 자재 (lines와 동일, 호환성)
  postMaterials?: BomLine[];      // 사후원가 자재
  preProcessingFee?: number;      // 사전원가 임가공비 (processingFee와 동일)
  postProcessingFee?: number;     // 사후원가 임가공비
  currency?: 'CNY' | 'USD' | 'KRW';
  manufacturingCountry?: '중국' | '한국' | '기타';
  exchangeRateCny?: number;       // 사후원가 CNY 환율
  exchangeRateUsd?: number;       // 사후원가 USD 환율
  postDeliveryPrice?: number;     // 사후원가용 납품가 (직접입력)
  postSourceFileName?: string;    // 사후원가 업로드 파일명
  colorBoms?: ColorBom[];     // 컬러별 BOM (원자재만 별도 관리)
  createdAt: string;
  updatedAt: string;
  memo?: string;
}

// ─── 생산 발주 ───
export interface HqSupplyItem {
  bomLineId: string;
  itemName: string;
  spec?: string;
  unit: string;
  requiredQty: number;
  unitPrice?: number;
  currency?: Currency;
  vendorId?: string;
  purchaseStatus: '미구매' | '구매완료' | '발송완료';
  memo?: string;
}

export interface OrderAttachment {
  name: string;
  url: string;
  type: 'PI' | 'PL' | 'BL' | '기타';
}

// 컬러별 수량 항목
export interface ColorQty {
  color: string;
  qty: number;
}

export interface ProductionOrder {
  id: string;
  orderNo: string;
  styleId: string;
  styleNo: string;
  styleName: string;
  season: Season;
  revision: number;
  isReorder: boolean;
  qty: number;
  colorQtys?: ColorQty[];         // 컬러별 수량 (합계 = qty)
  vendorId: string;
  vendorName: string;
  orderDate?: string;           // 발주일 (등록일)
  status: OrderStatus;
  milestones?: any[];           // 하위 호환성 유지 (deprecated)
  bomId?: string;
  hqSupplyItems: HqSupplyItem[];
  attachments: OrderAttachment[];
  postCostId?: string;
  logisticsCostId?: string;
  tradeStatementId?: string;      // 연결된 거래명세표 ID
  deliveryDate?: string;          // 바이어 납기일 (납품 목표일)
  // BOM 연동 발주 필드
  factoryUnitPriceCny?: number;   // 공장단가 (CNY) — BOM 임가공비에서 자동 설정
  factoryUnitPriceKrw?: number;   // 공장단가 (KRW 환산) — 표시용
  factoryCurrency?: 'CNY' | 'USD' | 'KRW'; // 공장단가 통화 선택
  bomType?: 'post' | 'pre' | 'manual'; // BOM 연동 유형 (사후원가/사전원가/수동입력)
  // 입고 정보
  receivedQty?: number;           // 실제 입고 수량
  defectQty?: number;             // 불량 수량
  defectNote?: string;            // 불량 비고
  receivedDate?: string;          // 입고일
  // 리오더 네고 이력
  negoHistory?: {
    requestedPrice: number;   // 네고 요청단가
    currency: string;         // 통화 (CNY/USD/KRW)
    savedAmount: number;      // 총 절감금액 (KRW)
    savedRate: number;        // 절감률 (%)
    memo: string;             // 메모
    date: string;             // 저장일
  }[];
  createdAt: string;
  updatedAt: string;
  memo?: string;
}

// ─── 샘플 관리 ───
export interface SampleRevisionNote {
  round: SampleRound;
  date: string;
  note: string;
}

export interface SampleMaterialCheckItem {
  id: string;
  itemName: string;
  isReady: boolean;
  memo?: string;
}

// 자재 요청 항목
export interface SampleMaterialRequest {
  itemName: string;
  vendor?: string;      // 업체 (자재거래처 목록에서 선택 또는 직접입력)
  customVendor?: string; // 직접입력 시 업체명
  color?: string;       // 컬러
  qty: number;
  unit: string;
  imageUrl?: string;    // 자재 이미지 URL (base64)
}

// 샘플 첨부 문서 (PDF, 엑셀 등)
export interface SampleDocument {
  name: string;
  url: string;          // base64 데이터 URL
  fileType: 'pdf' | 'excel' | 'image';
}

export interface Sample {
  id: string;
  styleId: string;
  styleNo: string;
  styleName: string;
  buyerId?: string;                // 바이어 (품목의 바이어와 동일하게 연결)
  season: Season;
  stage: SampleStage;
  location?: SampleLocation;       // 내부개발실 / 중국공장
  round?: SampleRound;             // 1, 2, 3, 4, 5... 제한 없음
  roundName?: string;              // 작업방식 예: "가봉", "직봉", "수정 직봉"
  color?: string;                  // 컬러 예: "블랙", "카멜", "RED"
  assignee?: string;               // 작업담당자 (내부)
  salesPerson?: string;            // 영업담당자 (외부/영업)
  requestDate: string;
  expectedDate?: string;
  receivedDate?: string;
  revisionNote?: string;
  revisionHistory?: SampleRevisionNote[];  // 차수별 수정 요청 히스토리
  sampleUnitPrice?: number;        // 샘플 단가 (본생산과 다름)
  costCny: number;
  costKrw?: number;
  approvedBy?: string;
  imageUrls: string[];
  documents?: SampleDocument[];                    // 첨부 문서 (PDF, 엑셀 등)
  materialChecklist?: SampleMaterialCheckItem[];  // 자재 준비 체크리스트
  materialRequests?: SampleMaterialRequest[];      // 자재 요청 목록
  billingStatus: SampleBillingStatus;             // 청구 상태 (접수 후 명세표 발행 시 업데이트)
  billingStatementId?: string;
  billingDate?: string;
  collectedDate?: string;
  createdAt: string;
  memo?: string;
}

// ─── 사후원가 ───
export interface PostCostLine {
  id: string;
  category: BomCategory;
  itemName: string;
  spec?: string;
  unit: string;
  unitPriceCny: number;
  netQty: number;
  lossRate: number;
  qty?: number;
  amountCny?: number;
  isHqProvided: boolean;
  isVendorProvided?: boolean; // 업체제공 여부
  hasQtyError?: boolean;
  hasAmountError?: boolean;
  hasPriceWarning?: boolean;
  priceWarningMsg?: string;
}

export interface PostCost {
  id: string;
  orderId: string;
  orderNo: string;
  styleNo: string;
  version: number;
  lines: PostCostLine[];
  processingFee: number;
  parsedCnyKrw?: number;
  appliedCnyKrw: number;
  appliedUsdKrw: number;
  totalMaterialCny?: number;
  totalFactoryCostCny?: number;
  totalCostKrw?: number;
  createdAt: string;
  updatedAt: string;
  sourceFileName?: string;
}

// ─── 물류비 배분 ───
export interface LogisticsLine {
  freightName: string;
  amountKrw: number;
  allocationMethod: 'CBM비율' | 'Invoice금액비율' | 'CT수량' | 'PCS균등';
}

export interface LogisticsAllocation {
  orderId: string;
  orderNo: string;
  styleNo: string;
  qty: number;
  ctQty: number;
  cbm: number;
  invoiceAmountUsd: number;
  allocatedKrw: number;
  perPcsKrw: number;
}

export interface LogisticsCost {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  vendorName: string;
  totalKrw: number;
  lines: LogisticsLine[];
  allocations: LogisticsAllocation[];
  sourceFileName?: string;
  createdAt: string;
}

// ─── 자재 구매 매칭 ───
export interface PurchaseItem {
  id: string;
  orderId: string;
  orderNo: string;
  purchaseDate: string;
  itemName: string;
  qty: number;
  unit: string;
  unitPriceCny: number;
  currency: Currency;
  appliedRate: number;
  amountKrw: number;
  vendorId?: string;
  vendorName?: string;
  paymentMethod: ExpenseType | '기타';
  purchaseStatus: '미구매' | '구매완료' | '발송완료';
  statementNo?: string;
  memo?: string;
  createdAt: string;
}

// ─── 거래처 마스터 ───
export interface ContactHistory {
  id: string;
  date: string;
  type: '전화' | '이메일' | '방문' | '기타';
  content: string;
  by: string;
}

export interface Vendor {
  id: string;
  name: string;
  nameEn?: string;
  nameCn?: string;           // 중문명
  code?: string;             // 코드 (스타일번호/전표번호 자동생성용, 예: AT, OS, LLL)
  companyName?: string;      // 사업자 회사명 (계산서 발급용)
  bizRegNo?: string;
  address?: string;          // 사업장 주소 (퀵/택배 발송용)         // 사업자등록번호 (000-00-00000 형식)
  vendorCode?: string;       // 거래처 코드 (전표번호용, 예: LLL)
  type: VendorType;
  customType?: string;       // 거래처 유형 "기타" 선택 시 직접 입력값
  materialTypes?: ('장식' | '원단' | '가죽' | '기타')[];  // 자재거래처 자재 유형 (복수 선택)
  customMaterialType?: string;   // 자재유형 "기타" 선택 시 직접 입력값
  country: string;
  currency: Currency;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  billingEmail?: string;     // 세금계산서 수신 이메일 (담당자 이메일과 별도 관리)
  wechatId?: string;         // 위챗ID
  leadTimeDays?: number;     // 평균 리드타임 (일)
  processingUnitCost?: number; // 임가공 단가 (공장인 경우)
  billingType?: BillingType; // 청구 방식
  settlementCycle?: string;
  commissionRate?: number;
  ttCondition?: string;
  bankInfo?: {
    beneficiary?: string    // 수취인 (회사명)
    address?: string        // 주소
    bankName?: string       // 은행명
    bankAccount?: string    // 계좌번호
    bankCode?: string       // 은행 코드
    branchCode?: string     // 지점 코드
    bankAddress?: string    // 은행 주소
    swiftCode?: string      // SWIFT CODE
  };
  contactHistory: ContactHistory[];
  memo?: string;
  createdAt: string;
}

// ─── 거래명세표 ───
export interface TradeStatementLine {
  id: string;
  description: string;       // 품목/내역
  qty: number;
  unitPrice: number;         // 단가 (KRW)
  taxType: TaxType;          // 과세 / 면세
  taxRate: number;           // 세율 (0.1 = 10%, 0 = 면세)
  memo?: string;
}

export interface TaxInvoiceData {
  issued: boolean;           // 발행 여부
  issuedAt?: string;         // 발행일시 (ISO)
  taxInvoiceNo?: string;     // 계산서 번호
  supplyAmount: number;      // 공급가액
  taxAmount: number;         // 세액 (10%)
  totalAmount: number;       // 합계금액
  buyerCompanyName: string;  // 매입자 상호
  buyerBizRegNo: string;     // 매입자 사업자등록번호
  buyerAddress: string;      // 매입자 주소
  buyerEmail?: string;       // 매입자 이메일
  memo?: string;             // 비고
}

export interface TradeStatement {
  id: string;
  statementNo: string;       // YYYYMM-거래처코드-순번 (예: 202603-LLL-001)
  vendorId: string;
  vendorName: string;
  vendorCode: string;
  issueDate: string;
  lines: TradeStatementLine[];
  status: TradeStatementStatus;
  taxInvoiceNo?: string;
  taxInvoice?: TaxInvoiceData;
  collectedDate?: string;
  memo?: string;
  createdAt: string;
}

// ─── 자재 발주 장바구니 ───
export interface CartItem {
  materialName: string    // 자재명
  spec?: string           // 규격
  unit: string            // 단위
  qty: number             // 소요수량 (여러 발주에서 합산)
  stockQty?: number       // 보유 재고 수량 (수동 입력, 기본 0)
  // 발주필요수량 = qty - (stockQty ?? 0) (계산값, 저장 불필요)
  vendorName?: string     // 구매업체
  isHqProvided: boolean   // 본사제공 여부
  orders: { styleNo: string; styleName: string; qty: number }[] // 담긴 발주 목록
}

// ─── 사용자 / 인증 ───
export type UserRole = '대표' | '생산관리팀장' | '부관리 주임' | '사원' | '영업과장';

export interface AppUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

// ─── 정산 / 미수금 ───
export interface Settlement {
  id: string;
  buyerId?: string;
  buyerName: string;
  channel: SettlementChannel;
  invoiceNo?: string;
  invoiceDate: string;
  dueDate: string;
  billedAmountKrw: number;
  collectedAmountKrw: number;
  collectedDate?: string;
  status: SettlementStatus;
  memo?: string;
  createdAt: string;
}

// ─── 지출 전표 ───
export interface Expense {
  id: string;
  expenseDate: string;
  expenseType: ExpenseType;
  category: ExpenseCategory;
  description: string;
  amountKrw: number;
  orderId?: string;
  orderNo?: string;
  vendorId?: string;
  vendorName?: string;
  hasTaxInvoice: boolean;
  taxInvoiceNo?: string;
  supplyAmount?: number;
  taxAmount?: number;
  taxInvoiceDate?: string;
  createdAt: string;
  memo?: string;
}

// ─── 매출 (간단 버전) ───
export interface SalesRecord {
  id: string;
  saleDate: string;
  channel: SettlementChannel;
  buyerName: string;
  styleNo?: string;
  styleName?: string;
  qty: number;
  unitPriceKrw: number;
  totalKrw: number;
  season?: Season;
  memo?: string;
  createdAt: string;
}

// ─── 시스템 설정 ───
export interface SystemSettings {
  currentSeason: Season;
  ddayAlertDays: number;
  usdKrw: number;
  cnyKrw: number;
  exchangeHistory: { id: string; date: string; usdKrw: number; cnyKrw: number; memo?: string }[];
}

// ─────────────────────────────────────────────
// Storage Keys
// ─────────────────────────────────────────────
// ── Seed 데이터 ──
const SEED_VENDORS = [{"id": "v1", "name": "아뜰리에드루멘", "code": "AT", "companyName": "(주)아뜰리에드루멘", "type": "바이어", "country": "한국", "currency": "KRW", "contactName": "이원영", "contactPhone": "010-0000-0000", "contactEmail": "wonyoung@atlm.kr", "memo": "", "contactHistory": [], "createdAt": "2026-01-01T00:00:00.000Z"}, {"id": "v2", "name": "오에스브랜드", "code": "OS", "companyName": "(주)오에스브랜드", "type": "바이어", "country": "한국", "currency": "KRW", "contactHistory": [], "createdAt": "2026-01-02T00:00:00.000Z"}, {"id": "v3", "name": "라노브랜드", "code": "LN", "companyName": "(주)라노브랜드", "type": "바이어", "country": "한국", "currency": "KRW", "contactHistory": [], "createdAt": "2026-01-03T00:00:00.000Z"}, {"id": "v4", "name": "창성", "type": "자재거래처", "materialTypes": ["장식"], "country": "한국", "currency": "KRW", "contactHistory": [], "createdAt": "2026-01-04T00:00:00.000Z"}, {"id": "v5", "name": "아이금속", "type": "자재거래처", "materialTypes": ["장식"], "country": "한국", "currency": "KRW", "contactHistory": [], "createdAt": "2026-01-05T00:00:00.000Z"}, {"id": "v6", "name": "세화", "type": "자재거래처", "materialTypes": ["원단"], "country": "한국", "currency": "KRW", "contactHistory": [], "createdAt": "2026-01-06T00:00:00.000Z"}, {"id": "v7", "name": "한일금속", "type": "자재거래처", "materialTypes": ["장식"], "country": "한국", "currency": "KRW", "contactHistory": [], "createdAt": "2026-01-07T00:00:00.000Z"}, {"id": "v8", "name": "홍콩기오치트레이딩", "nameEn": "HONGKONG GIOCH TRADING LIMITED", "type": "공장", "country": "중국", "currency": "USD", "contactHistory": [], "bankInfo": {"beneficiary": "HONGKONG GIOCH TRADING LIMITED", "address": "161 Queen's Road Central, HK", "bankName": "OCBC Wing Hang Bank Limited", "bankAccount": "035-802-796132-831", "bankCode": "035", "branchCode": "802", "bankAddress": "161 Queen's Road Central, HK", "swiftCode": "WIHBHKHHXXX"}, "createdAt": "2026-01-08T00:00:00.000Z"}];
const SEED_ITEMS = [{"id": "item01", "styleNo": "TEST01", "name": "테스트상품01", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 150000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-01T00:00:00.000Z"}, {"id": "item02", "styleNo": "TEST02", "name": "테스트상품02", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 150000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-02T00:00:00.000Z"}, {"id": "item03", "styleNo": "TEST03", "name": "테스트상품03", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 150000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-03T00:00:00.000Z"}, {"id": "item04", "styleNo": "TEST04", "name": "테스트상품04", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 150000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-04T00:00:00.000Z"}, {"id": "item05", "styleNo": "TEST05", "name": "테스트상품05", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 150000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-05T00:00:00.000Z"}, {"id": "item06", "styleNo": "TEST06", "name": "테스트상품06", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 150000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-06T00:00:00.000Z"}, {"id": "item07", "styleNo": "TEST07", "name": "테스트상품07", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 150000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-07T00:00:00.000Z"}, {"id": "item08", "styleNo": "TEST08", "name": "테스트상품08", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 150000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-08T00:00:00.000Z"}, {"id": "item09", "styleNo": "TEST09", "name": "테스트상품09", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 150000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-09T00:00:00.000Z"}, {"id": "item10", "styleNo": "TEST10", "name": "테스트상품10", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 150000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-10T00:00:00.000Z"}, {"id": "item11", "styleNo": "TEST11", "name": "테스트상품11", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 225000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-11T00:00:00.000Z"}, {"id": "item12", "styleNo": "TEST12", "name": "테스트상품12", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 225000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-12T00:00:00.000Z"}, {"id": "item13", "styleNo": "TEST13", "name": "테스트상품13", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 225000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-13T00:00:00.000Z"}, {"id": "item14", "styleNo": "TEST14", "name": "테스트상품14", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 225000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-14T00:00:00.000Z"}, {"id": "item15", "styleNo": "TEST15", "name": "테스트상품15", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 225000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-15T00:00:00.000Z"}, {"id": "item16", "styleNo": "TEST16", "name": "테스트상품16", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 225000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-16T00:00:00.000Z"}, {"id": "item17", "styleNo": "TEST17", "name": "테스트상품17", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 225000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-17T00:00:00.000Z"}, {"id": "item18", "styleNo": "TEST18", "name": "테스트상품18", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 225000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-18T00:00:00.000Z"}, {"id": "item19", "styleNo": "TEST19", "name": "테스트상품19", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 225000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-19T00:00:00.000Z"}, {"id": "item20", "styleNo": "TEST20", "name": "테스트상품20", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 225000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-20T00:00:00.000Z"}, {"id": "item21", "styleNo": "TEST21", "name": "테스트상품21", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 300000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-21T00:00:00.000Z"}, {"id": "item22", "styleNo": "TEST22", "name": "테스트상품22", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 300000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-22T00:00:00.000Z"}, {"id": "item23", "styleNo": "TEST23", "name": "테스트상품23", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 300000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-23T00:00:00.000Z"}, {"id": "item24", "styleNo": "TEST24", "name": "테스트상품24", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 300000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-24T00:00:00.000Z"}, {"id": "item25", "styleNo": "TEST25", "name": "테스트상품25", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 300000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-25T00:00:00.000Z"}, {"id": "item26", "styleNo": "TEST26", "name": "테스트상품26", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 300000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-26T00:00:00.000Z"}, {"id": "item27", "styleNo": "TEST27", "name": "테스트상품27", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 300000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-27T00:00:00.000Z"}, {"id": "item28", "styleNo": "TEST28", "name": "테스트상품28", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 300000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item29", "styleNo": "TEST29", "name": "테스트상품29", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 300000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item30", "styleNo": "TEST30", "name": "테스트상품30", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 300000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item31", "styleNo": "TEST31", "name": "테스트상품31", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 375000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item32", "styleNo": "TEST32", "name": "테스트상품32", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 375000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item33", "styleNo": "TEST33", "name": "테스트상품33", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 375000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item34", "styleNo": "TEST34", "name": "테스트상품34", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 375000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item35", "styleNo": "TEST35", "name": "테스트상품35", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 375000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item36", "styleNo": "TEST36", "name": "테스트상품36", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 375000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item37", "styleNo": "TEST37", "name": "테스트상품37", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 375000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item38", "styleNo": "TEST38", "name": "테스트상품38", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 375000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item39", "styleNo": "TEST39", "name": "테스트상품39", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 375000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item40", "styleNo": "TEST40", "name": "테스트상품40", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 375000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item41", "styleNo": "TEST41", "name": "테스트상품41", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 450000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item42", "styleNo": "TEST42", "name": "테스트상품42", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 450000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item43", "styleNo": "TEST43", "name": "테스트상품43", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 450000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item44", "styleNo": "TEST44", "name": "테스트상품44", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 450000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item45", "styleNo": "TEST45", "name": "테스트상품45", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 450000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item46", "styleNo": "TEST46", "name": "테스트상품46", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 450000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item47", "styleNo": "TEST47", "name": "테스트상품47", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 450000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item48", "styleNo": "TEST48", "name": "테스트상품48", "season": "26SS", "category": "크로스백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 450000, "buyerId": "v3", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item49", "styleNo": "TEST49", "name": "테스트상품49", "season": "26SS", "category": "숄더백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 450000, "buyerId": "v1", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}, {"id": "item50", "styleNo": "TEST50", "name": "테스트상품50", "season": "26SS", "category": "토트백", "erpCategory": "HB", "materialType": "완제품", "itemStatus": "ACTIVE", "material": "소가죽", "salePriceKrw": 450000, "buyerId": "v2", "hasBom": false, "colors": [], "createdAt": "2026-01-28T00:00:00.000Z"}];
const SEED_SAMPLES = [{"id": "smp01", "styleId": "item01", "styleNo": "TEST01", "styleName": "테스트상품01", "buyerId": "v1", "season": "26SS", "stage": "1차", "location": "내부개발실", "round": 1, "assignee": "이담당", "requestDate": "2026-02-01", "expectedDate": "2026-03-11", "costCny": 35, "costKrw": 6685, "imageUrls": [], "revisionHistory": [], "materialChecklist": [], "billingStatus": "미청구", "createdAt": "2026-02-01T00:00:00.000Z"}, {"id": "smp02", "styleId": "item02", "styleNo": "TEST02", "styleName": "테스트상품02", "buyerId": "v2", "season": "26SS", "stage": "2차", "location": "중국공장", "round": 2, "assignee": "김담당", "requestDate": "2026-02-02", "expectedDate": "2026-03-12", "costCny": 40, "costKrw": 7640, "imageUrls": [], "revisionHistory": [], "materialChecklist": [], "billingStatus": "미청구", "createdAt": "2026-02-02T00:00:00.000Z"}, {"id": "smp03", "styleId": "item03", "styleNo": "TEST03", "styleName": "테스트상품03", "buyerId": "v3", "season": "26SS", "stage": "3차", "location": "내부개발실", "round": 3, "assignee": "이담당", "requestDate": "2026-02-03", "expectedDate": "2026-03-13", "costCny": 45, "costKrw": 8595, "imageUrls": [], "revisionHistory": [], "materialChecklist": [], "billingStatus": "미청구", "createdAt": "2026-02-03T00:00:00.000Z"}, {"id": "smp04", "styleId": "item04", "styleNo": "TEST04", "styleName": "테스트상품04", "buyerId": "v1", "season": "26SS", "stage": "최종승인", "location": "중국공장", "round": 1, "assignee": "김담당", "requestDate": "2026-02-04", "expectedDate": "2026-03-14", "costCny": 50, "costKrw": 9550, "imageUrls": [], "revisionHistory": [], "materialChecklist": [], "billingStatus": "미청구", "createdAt": "2026-02-04T00:00:00.000Z"}, {"id": "smp05", "styleId": "item05", "styleNo": "TEST05", "styleName": "테스트상품05", "buyerId": "v2", "season": "26SS", "stage": "반려", "location": "내부개발실", "round": 2, "assignee": "이담당", "requestDate": "2026-02-05", "expectedDate": "2026-03-15", "costCny": 55, "costKrw": 10505, "imageUrls": [], "revisionHistory": [], "materialChecklist": [], "billingStatus": "미청구", "createdAt": "2026-02-05T00:00:00.000Z"}, {"id": "smp06", "styleId": "item06", "styleNo": "TEST06", "styleName": "테스트상품06", "buyerId": "v3", "season": "26SS", "stage": "1차", "location": "중국공장", "round": 3, "assignee": "김담당", "requestDate": "2026-02-06", "expectedDate": "2026-03-16", "costCny": 60, "costKrw": 11460, "imageUrls": [], "revisionHistory": [], "materialChecklist": [], "billingStatus": "미청구", "createdAt": "2026-02-06T00:00:00.000Z"}, {"id": "smp07", "styleId": "item07", "styleNo": "TEST07", "styleName": "테스트상품07", "buyerId": "v1", "season": "26SS", "stage": "2차", "location": "내부개발실", "round": 1, "assignee": "이담당", "requestDate": "2026-02-07", "expectedDate": "2026-03-17", "costCny": 65, "costKrw": 12415, "imageUrls": [], "revisionHistory": [], "materialChecklist": [], "billingStatus": "미청구", "createdAt": "2026-02-07T00:00:00.000Z"}, {"id": "smp08", "styleId": "item08", "styleNo": "TEST08", "styleName": "테스트상품08", "buyerId": "v2", "season": "26SS", "stage": "3차", "location": "중국공장", "round": 2, "assignee": "김담당", "requestDate": "2026-02-08", "expectedDate": "2026-03-18", "costCny": 70, "costKrw": 13370, "imageUrls": [], "revisionHistory": [], "materialChecklist": [], "billingStatus": "미청구", "createdAt": "2026-02-08T00:00:00.000Z"}, {"id": "smp09", "styleId": "item09", "styleNo": "TEST09", "styleName": "테스트상품09", "buyerId": "v3", "season": "26SS", "stage": "최종승인", "location": "내부개발실", "round": 3, "assignee": "이담당", "requestDate": "2026-02-09", "expectedDate": "2026-03-19", "costCny": 75, "costKrw": 14325, "imageUrls": [], "revisionHistory": [], "materialChecklist": [], "billingStatus": "미청구", "createdAt": "2026-02-09T00:00:00.000Z"}, {"id": "smp10", "styleId": "item10", "styleNo": "TEST10", "styleName": "테스트상품10", "buyerId": "v1", "season": "26SS", "stage": "반려", "location": "중국공장", "round": 1, "assignee": "김담당", "requestDate": "2026-02-10", "expectedDate": "2026-03-20", "costCny": 80, "costKrw": 15280, "imageUrls": [], "revisionHistory": [], "materialChecklist": [], "billingStatus": "미청구", "createdAt": "2026-02-10T00:00:00.000Z"}];

const KEYS = {
  materialCart: 'ames_material_cart',
  items: 'ames_items',
  materials: 'ames_materials',
  boms: 'ames_boms',
  orders: 'ames_orders',
  samples: 'ames_samples',
  postCosts: 'ames_postcosts',
  logisticsCosts: 'ames_logistics',
  purchaseItems: 'ames_purchases',
  vendors: 'ames_vendors',
  settlements: 'ames_settlements',
  expenses: 'ames_expenses',
  salesRecords: 'ames_sales',
  settings: 'ames_settings',
  tradeStatements: 'ames_trade_statements',
  users: 'ames_users',
} as const;

// ─────────────────────────────────────────────
// Generic helpers
// ─────────────────────────────────────────────
function getAll<T>(key: string): T[] {
  try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : []; } catch { return []; }
}

function setAll<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}
function getOne<T>(key: string, fallback: T): T {
  try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : fallback; } catch { return fallback; }
}
function setOne<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

// ─────────────────────────────────────────────
// 컬러 정규화 헬퍼 (string[] 하위호환)
// ─────────────────────────────────────────────
export function normalizeColors(colors: (ItemColor | string)[]): ItemColor[] {
  return colors.map(c => typeof c === 'string' ? { name: c } : c);
}

// ─────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────
export const store = {
  // Materials
  getMaterials: () => getAll<Material>(KEYS.materials),
  addMaterial: (v: Material) => { const a = getAll<Material>(KEYS.materials); a.push(v); setAll(KEYS.materials, a); sbUpsert('materials', v); },
  updateMaterial: (id: string, u: Partial<Material>) => { const a = getAll<Material>(KEYS.materials); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.materials, a); sbUpdate('materials', id, u); } },
  deleteMaterial: (id: string) => { setAll(KEYS.materials, getAll<Material>(KEYS.materials).filter(x => x.id !== id)); sbDelete('materials', id); },

  // Items
  getItems: () => getAll<Item>(KEYS.items),
  setItems: (v: Item[]) => setAll(KEYS.items, v),
  addItem: (v: Item) => { const a = getAll<Item>(KEYS.items); a.push(v); setAll(KEYS.items, a); sbUpsert('items', v); },
  updateItem: (id: string, u: Partial<Item>) => { const a = getAll<Item>(KEYS.items); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.items, a); sbUpdate('items', id, u); } },
  deleteItem: (id: string) => { setAll(KEYS.items, getAll<Item>(KEYS.items).filter(x => x.id !== id)); sbDelete('items', id); },
  addItemColor: (itemId: string, color: ItemColor | string) => {
    const a = getAll<Item>(KEYS.items);
    const i = a.findIndex(x => x.id === itemId);
    if (i >= 0) {
      const newColor: ItemColor = typeof color === 'string' ? { name: color } : color;
      const existing = normalizeColors(a[i].colors || []);
      if (!existing.find(c => c.name === newColor.name)) {
        a[i] = { ...a[i], colors: [...existing, newColor] };
        setAll(KEYS.items, a);
      }
    }
  },

  // BOMs
  getBoms: () => getAll<Bom>(KEYS.boms),
  setBoms: (v: Bom[]) => setAll(KEYS.boms, v),
  getBomByStyle: (styleId: string) => getAll<Bom>(KEYS.boms).filter(b => b.styleId === styleId),
  addBom: (v: Bom) => { const a = getAll<Bom>(KEYS.boms); a.push(v); setAll(KEYS.boms, a); sbUpsert('boms', v); },
  updateBom: (id: string, u: Partial<Bom>) => { const a = getAll<Bom>(KEYS.boms); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.boms, a); sbUpdate('boms', id, u); } },
  deleteBom: (id: string) => { setAll(KEYS.boms, getAll<Bom>(KEYS.boms).filter(x => x.id !== id)); sbDelete('boms', id); },

  /**
   * 스타일번호(styleNo) 기반 BOM 총원가 계산 (KRW 환산)
   * 총원가 = 자재비 합계(단가CNY × 소요량) + 임가공비
   * BOM이 없으면 0 반환
   */
  getBomTotalCost: (styleNo: string): number => {
    try {
      const raw = localStorage.getItem('ames_boms');
      if (!raw) return 0;
      const boms = JSON.parse(raw) as Array<{
        styleNo: string;
        lines?: Array<{ unitPriceCny?: number; unitPrice?: number; netQty: number; lossRate: number; isHqProvided?: boolean; isVendorProvided?: boolean }>;
        postProcessLines?: Array<{ netQty: number; unitPrice: number }>;
        processingFee?: number;
        snapshotCnyKrw?: number;
      }>;
      const bom = boms.find(b => b.styleNo === styleNo);
      if (!bom) return 0;
      const cnyKrw = bom.snapshotCnyKrw ?? 191;
      // 자재비 합계 (본사제공 제외, LOSS 포함 소요량 × 단가)
      const materialCny = (bom.lines || []).reduce((s, l) => {
        if (l.isHqProvided || l.isVendorProvided) return s; // 본사제공+업체제공 모두 공장단가에서 제외
        const price = l.unitPriceCny ?? (l as { unitPrice?: number }).unitPrice ?? 0;
        const qty = l.netQty * (1 + (l.lossRate ?? 0));
        return s + price * qty;
      }, 0);
      // 후가공비
      const postProcessCny = (bom.postProcessLines || []).reduce((s, l) => s + l.netQty * l.unitPrice, 0);
      // 임가공비
      const processingCny = bom.processingFee ?? 0;
      // KRW 환산 합계
      return Math.round((materialCny + postProcessCny + processingCny) * cnyKrw);
    } catch { return 0; }
  },

  // Orders
  getOrders: () => getAll<ProductionOrder>(KEYS.orders),
  setOrders: (v: ProductionOrder[]) => setAll(KEYS.orders, v),
  addOrder: (v: ProductionOrder) => { const a = getAll<ProductionOrder>(KEYS.orders); a.push(v); setAll(KEYS.orders, a); sbUpsert('production_orders', v); },
  updateOrder: (id: string, u: Partial<ProductionOrder>) => { const a = getAll<ProductionOrder>(KEYS.orders); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.orders, a); sbUpdate('production_orders', id, u); } },
  deleteOrder: (id: string) => { setAll(KEYS.orders, getAll<ProductionOrder>(KEYS.orders).filter(x => x.id !== id)); sbDelete('production_orders', id); },
  getNextRevision: (styleNo: string) => { const orders = getAll<ProductionOrder>(KEYS.orders).filter(o => o.styleNo === styleNo); return orders.length > 0 ? Math.max(...orders.map(o => o.revision)) + 1 : 1; },

  // ─── 발주용 BOM 함수 ───
  /** 스타일별 발주 이력 조회 */
  getProductionOrdersByStyle: (styleNo: string): ProductionOrder[] => {
    return getAll<ProductionOrder>(KEYS.orders)
      .filter(o => o.styleNo === styleNo)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /** 발주용 BOM 조회: 사후원가(postMaterials) 우선, 없으면 사전원가(lines) 반환 */
  getBomForOrder: (styleNo: string): { bom: Bom | null; type: 'post' | 'pre' | null } => {
    const boms = getAll<Bom>(KEYS.boms);
    // 스타일번호로 매칭되는 최신 BOM (version 내림차순)
    const bomList = boms
      .filter(b => b.styleNo === styleNo)
      .sort((a, b) => b.version - a.version);
    if (bomList.length === 0) return { bom: null, type: null };
    // 사후원가 데이터가 있는 BOM 우선
    const postBom = bomList.find(b => b.postMaterials && b.postMaterials.length > 0);
    if (postBom) return { bom: postBom, type: 'post' };
    // 없으면 사전원가
    const preBom = bomList.find(b => b.lines && b.lines.length > 0);
    if (preBom) return { bom: preBom, type: 'pre' };
    return { bom: bomList[0], type: 'pre' };
  },

  /** 자재 소요량 계산: BOM 소요량 × 발주수량, 본사제공/미제공 분리
   * 컬러별 BOM 지원:
   * - colorQtys의 각 컬러에 해당하는 colorBom이 있으면 → 해당 colorBom.lines 사용 (원자재)
   * - colorBom이 없는 컬러 or 원자재가 아닌 섹션 → 기본 BOM lines 사용
   */
  calcMaterialRequirements: (styleNo: string, qty: number, colorQtys?: ColorQty[]): {
    hqProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; color?: string }>;
    factoryProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; color?: string }>;
    processingFee: number;
    factoryUnitPriceCny: number;
    bomType: 'post' | 'pre' | null;
    manufacturingCountry?: string;
  } => {
    const { bom, type } = store.getBomForOrder(styleNo);
    if (!bom) return { hqProvided: [], factoryProvided: [], processingFee: 0, factoryUnitPriceCny: 0, bomType: null };

    // 사용할 자재 라인 결정 (사후원가 우선)
    const baseLines: BomLine[] = (type === 'post' && bom.postMaterials && bom.postMaterials.length > 0)
      ? bom.postMaterials
      : (bom.lines || []);

    const processingFee = type === 'post'
      ? (bom.postProcessingFee ?? bom.processingFee ?? 0)
      : (bom.processingFee ?? 0);

    const hqProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; color?: string }> = [];
    const factoryProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; color?: string }> = [];

    // 원자재가 아닌 섹션: 기본 BOM에서 전체 수량 적용
    const nonRawLines = baseLines.filter(l => l.category !== '원자재');
    for (const line of nonRawLines) {
      const perPcsQty = line.netQty * (1 + (line.lossRate ?? 0));
      const totalQty = Math.round(perPcsQty * qty * 100) / 100;
      const entry = {
        bomLineId: line.id,
        itemName: line.itemName,
        spec: line.spec,
        unit: line.unit,
        reqQty: totalQty,
        vendorName: line.vendorName,
        color: undefined,
      };
      if (line.isHqProvided) hqProvided.push(entry);
      else factoryProvided.push(entry);
    }

    // 원자재 섹션: colorBoms 활용
    if (colorQtys && colorQtys.length > 0 && bom.colorBoms && bom.colorBoms.length > 0) {
      // 컬러별로 처리
      for (const cq of colorQtys) {
        if (!cq.qty || cq.qty <= 0) continue;
        const colorBom = bom.colorBoms.find(cb => cb.color.trim() === cq.color.trim());
        const rawLines = colorBom ? colorBom.lines : baseLines.filter(l => l.category === '원자재');
        for (const line of rawLines) {
          const perPcsQty = line.netQty * (1 + (line.lossRate ?? 0));
          const totalQty = Math.round(perPcsQty * cq.qty * 100) / 100;
          const entry = {
            bomLineId: line.id,
            itemName: line.itemName,
            spec: line.spec,
            unit: line.unit,
            reqQty: totalQty,
            vendorName: line.vendorName,
            color: cq.color,
          };
          if (line.isHqProvided) hqProvided.push(entry);
          else factoryProvided.push(entry);
        }
      }
    } else {
      // colorBoms 없거나 colorQtys 없으면 기본 원자재 전체 수량 적용
      const rawLines = baseLines.filter(l => l.category === '원자재');
      for (const line of rawLines) {
        const perPcsQty = line.netQty * (1 + (line.lossRate ?? 0));
        const totalQty = Math.round(perPcsQty * qty * 100) / 100;
        const entry = {
          bomLineId: line.id,
          itemName: line.itemName,
          spec: line.spec,
          unit: line.unit,
          reqQty: totalQty,
          vendorName: line.vendorName,
          color: undefined,
        };
        if (line.isHqProvided) hqProvided.push(entry);
        else factoryProvided.push(entry);
      }
    }

    return {
      hqProvided,
      factoryProvided,
      processingFee,
      factoryUnitPriceCny: processingFee,
      bomType: type,
      manufacturingCountry: bom.manufacturingCountry,
    };
  },

  // Samples
  getSamples: () => getAll<Sample>(KEYS.samples),
  setSamples: (v: Sample[]) => setAll(KEYS.samples, v),
  addSample: (v: Sample) => { const a = getAll<Sample>(KEYS.samples); a.push(v); setAll(KEYS.samples, a); sbUpsert('samples', v); },
  updateSample: (id: string, u: Partial<Sample>) => { const a = getAll<Sample>(KEYS.samples); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.samples, a); sbUpdate('samples', id, u); } },
  deleteSample: (id: string) => { setAll(KEYS.samples, getAll<Sample>(KEYS.samples).filter(x => x.id !== id)); sbDelete('samples', id); },

  // Post Costs
  getPostCosts: () => getAll<PostCost>(KEYS.postCosts),
  setPostCosts: (v: PostCost[]) => setAll(KEYS.postCosts, v),
  addPostCost: (v: PostCost) => { const a = getAll<PostCost>(KEYS.postCosts); a.push(v); setAll(KEYS.postCosts, a); },
  updatePostCost: (id: string, u: Partial<PostCost>) => { const a = getAll<PostCost>(KEYS.postCosts); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.postCosts, a); } },

  // Logistics Costs
  getLogisticsCosts: () => getAll<LogisticsCost>(KEYS.logisticsCosts),
  addLogisticsCost: (v: LogisticsCost) => { const a = getAll<LogisticsCost>(KEYS.logisticsCosts); a.push(v); setAll(KEYS.logisticsCosts, a); },

  // Purchase Items
  getPurchaseItems: () => getAll<PurchaseItem>(KEYS.purchaseItems),
  setPurchaseItems: (v: PurchaseItem[]) => setAll(KEYS.purchaseItems, v),
  addPurchaseItem: (v: PurchaseItem) => { const a = getAll<PurchaseItem>(KEYS.purchaseItems); a.push(v); setAll(KEYS.purchaseItems, a); },
  updatePurchaseItem: (id: string, u: Partial<PurchaseItem>) => { const a = getAll<PurchaseItem>(KEYS.purchaseItems); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.purchaseItems, a); } },
  deletePurchaseItem: (id: string) => setAll(KEYS.purchaseItems, getAll<PurchaseItem>(KEYS.purchaseItems).filter(x => x.id !== id)),

  // Vendors
  getVendors: () => getAll<Vendor>(KEYS.vendors),
  setVendors: (v: Vendor[]) => setAll(KEYS.vendors, v),
  addVendor: (v: Vendor) => { const a = getAll<Vendor>(KEYS.vendors); a.push(v); setAll(KEYS.vendors, a); sbUpsert('vendors', v); },
  updateVendor: (id: string, u: Partial<Vendor>) => { const a = getAll<Vendor>(KEYS.vendors); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.vendors, a); sbUpdate('vendors', id, u); } },
  deleteVendor: (id: string) => { setAll(KEYS.vendors, getAll<Vendor>(KEYS.vendors).filter(x => x.id !== id)); sbDelete('vendors', id); },

  // Settlements
  getSettlements: () => getAll<Settlement>(KEYS.settlements),
  setSettlements: (v: Settlement[]) => setAll(KEYS.settlements, v),
  addSettlement: (v: Settlement) => { const a = getAll<Settlement>(KEYS.settlements); a.push(v); setAll(KEYS.settlements, a); },
  updateSettlement: (id: string, u: Partial<Settlement>) => { const a = getAll<Settlement>(KEYS.settlements); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.settlements, a); } },
  deleteSettlement: (id: string) => setAll(KEYS.settlements, getAll<Settlement>(KEYS.settlements).filter(x => x.id !== id)),

  // Expenses
  getExpenses: () => getAll<Expense>(KEYS.expenses),
  setExpenses: (v: Expense[]) => setAll(KEYS.expenses, v),
  addExpense: (v: Expense) => { const a = getAll<Expense>(KEYS.expenses); a.push(v); setAll(KEYS.expenses, a); },
  updateExpense: (id: string, u: Partial<Expense>) => { const a = getAll<Expense>(KEYS.expenses); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.expenses, a); } },
  deleteExpense: (id: string) => setAll(KEYS.expenses, getAll<Expense>(KEYS.expenses).filter(x => x.id !== id)),

  // Trade Statements
  getTradeStatements: () => getAll<TradeStatement>(KEYS.tradeStatements),
  addTradeStatement: (v: TradeStatement) => { const a = getAll<TradeStatement>(KEYS.tradeStatements); a.push(v); setAll(KEYS.tradeStatements, a); },
  updateTradeStatement: (id: string, u: Partial<TradeStatement>) => { const a = getAll<TradeStatement>(KEYS.tradeStatements); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.tradeStatements, a); } },
  deleteTradeStatement: (id: string) => setAll(KEYS.tradeStatements, getAll<TradeStatement>(KEYS.tradeStatements).filter(x => x.id !== id)),
  getNextStatementNo: (vendorCode: string) => {
    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    const prefix = `${ym}-${vendorCode}-`;
    const existing = getAll<TradeStatement>(KEYS.tradeStatements).filter(s => s.statementNo.startsWith(prefix));
    let max = 0;
    for (const s of existing) {
      const seq = parseInt(s.statementNo.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > max) max = seq;
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  },

  // Users
  getUsers: () => getAll<AppUser>(KEYS.users),
  addUser: (v: AppUser) => { const a = getAll<AppUser>(KEYS.users); a.push(v); setAll(KEYS.users, a); },
  updateUser: (id: string, u: Partial<AppUser>) => { const a = getAll<AppUser>(KEYS.users); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.users, a); } },
  deleteUser: (id: string) => setAll(KEYS.users, getAll<AppUser>(KEYS.users).filter(x => x.id !== id)),

  // Sales Records
  getSalesRecords: () => getAll<SalesRecord>(KEYS.salesRecords),
  setSalesRecords: (v: SalesRecord[]) => setAll(KEYS.salesRecords, v),
  addSalesRecord: (v: SalesRecord) => { const a = getAll<SalesRecord>(KEYS.salesRecords); a.push(v); setAll(KEYS.salesRecords, a); },
  updateSalesRecord: (id: string, u: Partial<SalesRecord>) => { const a = getAll<SalesRecord>(KEYS.salesRecords); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.salesRecords, a); } },
  deleteSalesRecord: (id: string) => setAll(KEYS.salesRecords, getAll<SalesRecord>(KEYS.salesRecords).filter(x => x.id !== id)),

  // Settings
  getSettings: (): SystemSettings => getOne<SystemSettings>(KEYS.settings, {
    currentSeason: '26SS', ddayAlertDays: 7, usdKrw: 1380, cnyKrw: 191,
    exchangeHistory: [
      { id: 'eh1', date: '2026-02-17', usdKrw: 1345, cnyKrw: 185 },
      { id: 'eh2', date: '2026-03-04', usdKrw: 1362, cnyKrw: 188 },
      { id: 'eh3', date: '2026-03-19', usdKrw: 1380, cnyKrw: 191 },
    ]
  }),
  setSettings: (v: SystemSettings) => setOne(KEYS.settings, v),

  // Utility
  isInitialized: () => getAll<Item>(KEYS.items).length > 0,
  clearAll: () => Object.values(KEYS).forEach(k => localStorage.removeItem(k)),

  // ─── 자재 발주 장바구니 ───
  getMaterialCart: (): CartItem[] => getAll<CartItem>(KEYS.materialCart),

  /**
   * BOM 소요량 기반으로 자재를 장바구니에 추가
   * BOM 소요량(netQty × (1+lossRate)) × 발주수량 = 필요량
   * 이미 같은 자재(materialName+unit)가 있으면 수량 합산, orders에 발주 추가
   */
  addToMaterialCart: (
    styleNo: string,
    styleName: string,
    bomMaterials: Array<{ itemName: string; spec?: string; unit: string; netQty: number; lossRate: number; vendorName?: string; isHqProvided: boolean }>,
    orderQty: number
  ) => {
    const cart = getAll<CartItem>(KEYS.materialCart);
    for (const mat of bomMaterials) {
      // 소요량 = netQty * (1 + lossRate) * orderQty
      const perPcsQty = mat.netQty * (1 + (mat.lossRate ?? 0));
      const totalQty = Math.round(perPcsQty * orderQty * 1000) / 1000;
      const key = mat.itemName + '||' + mat.unit;
      const idx = cart.findIndex(c => (c.materialName + '||' + c.unit) === key);
      if (idx >= 0) {
        // 기존 항목 — 수량 합산, 발주 목록 추가
        const existingOrder = cart[idx].orders.find(o => o.styleNo === styleNo);
        if (existingOrder) {
          existingOrder.qty = Math.round((existingOrder.qty + totalQty) * 1000) / 1000;
        } else {
          cart[idx].orders.push({ styleNo, styleName, qty: totalQty });
        }
        cart[idx].qty = Math.round((cart[idx].qty + totalQty) * 1000) / 1000;
      } else {
        cart.push({
          materialName: mat.itemName,
          spec: mat.spec,
          unit: mat.unit,
          qty: totalQty,
          vendorName: mat.vendorName,
          isHqProvided: mat.isHqProvided,
          orders: [{ styleNo, styleName, qty: totalQty }],
        });
      }
    }
    setAll(KEYS.materialCart, cart);
  },

  clearMaterialCart: () => setAll(KEYS.materialCart, []),

  updateCartItemQty: (materialName: string, unit: string, qty: number) => {
    const cart = getAll<CartItem>(KEYS.materialCart);
    const idx = cart.findIndex(c => c.materialName === materialName && c.unit === unit);
    if (idx >= 0) {
      cart[idx].qty = qty;
      setAll(KEYS.materialCart, cart);
    }
  },

  updateCartItemStock: (materialName: string, unit: string, stockQty: number) => {
    const cart = getAll<CartItem>(KEYS.materialCart);
    const idx = cart.findIndex(c => c.materialName === materialName && c.unit === unit);
    if (idx >= 0) {
      cart[idx].stockQty = stockQty;
      setAll(KEYS.materialCart, cart);
    }
  },

  removeCartItem: (materialName: string, unit: string) => {
    setAll(KEYS.materialCart, getAll<CartItem>(KEYS.materialCart).filter(c => !(c.materialName === materialName && c.unit === unit)));
  },

  // Auth helpers
  getCurrentUser: (): AppUser | null => {
    try { const d = localStorage.getItem('ames_current_user'); return d ? JSON.parse(d) : null; } catch { return null; }
  },
  setCurrentUser: (user: AppUser | null) => {
    if (user) localStorage.setItem('ames_current_user', JSON.stringify(user));
    else localStorage.removeItem('ames_current_user');
  },
};

// ─────────────────────────────────────────────
// 유틸리티 함수
// ─────────────────────────────────────────────
export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function formatKRW(n: number): string {
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(n);
}

export function formatNumber(n: number, decimals = 0): string {
  return new Intl.NumberFormat('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

export function calcDDay(dateStr?: string): number {
  if (!dateStr) return 999;
  const target = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function dDayColor(d: number): string {
  if (d < 0) return 'text-red-600 bg-red-50';
  if (d <= 3) return 'text-orange-600 bg-orange-50';
  if (d <= 7) return 'text-yellow-600 bg-yellow-50';
  if (d <= 14) return 'text-blue-600 bg-blue-50';
  return 'text-green-600 bg-green-50';
}

export function dDayLabel(d: number): string {
  if (d < 0) return `D+${Math.abs(d)} 지연`;
  if (d === 0) return 'D-Day';
  return `D-${d}`;
}

export function calcBomLineQty(line: BomLine): number {
  return line.netQty * (1 + line.lossRate / 100);
}

export function calcBomLineAmount(line: BomLine): number {
  return calcBomLineQty(line) * line.unitPriceCny;
}

export function calcOutstandingDays(dueDateStr: string): number {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
}

export function getSettlementStatusByDays(days: number, outstanding: number): SettlementStatus {
  if (outstanding === 0) return '완납';
  if (days <= 30) return '정상';
  if (days <= 60) return '주의';
  return '위험';
}
