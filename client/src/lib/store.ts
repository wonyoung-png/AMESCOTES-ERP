// AMESCOTES ERP — Data Store v2
// 핵심 철학: "이미 만드는 파일을 올리면 자동으로 연결된다"
// localStorage + Supabase 동시 저장 (쓰기 시 둘 다, 읽기 시 localStorage 우선)

import { supabase } from './supabase';
import { filterForTable, toSnakeCase } from './tableColumns';

// 마이그레이션 전까지 Supabase에 없는 컬럼 목록 (PGRST204 에러 방지용 제외 컬럼)
// migration_add_missing_columns.sql 실행 후 이 목록에서 제거하세요
const PENDING_MIGRATION_COLUMNS: Record<string, string[]> = {
  items: ['has_bom', 'base_cost_krw', 'colors'],
  production_orders: ['order_no', 'style_name', 'style_id', 'season', 'vendor_name',
                      'delivery_date', 'factory_unit_price_cny', 'factory_unit_price_krw',
                      'factory_currency', 'bom_id', 'bom_type', 'color_qtys',
                      'hq_supply_items', 'received_qty', 'defect_qty', 'defect_note',
                      'received_date', 'revision'],
};

// ─────────────────────────────────────────────
// Supabase 쓰기 실패 알림
//
// 호출부 21곳이 전부 fire-and-forget(await 없음)이라 throw하면
// unhandled rejection만 남고 사용자는 여전히 모릅니다.
// 그래서 throw 대신 화면에 띄웁니다 — 저장 실패를 성공으로 착각하는 게 최악입니다.
// ─────────────────────────────────────────────
type SbWriteFailure = { table: string; op: string; message: string };
let onSbWriteFailure: ((f: SbWriteFailure) => void) | null = null;

/** 앱 시작 시 1회 등록 (main/App에서 toast 연결) */
export function setSbWriteFailureHandler(fn: (f: SbWriteFailure) => void): void {
  onSbWriteFailure = fn;
}

function reportSbFailure(table: string, op: string, message: string): void {
  console.error(`[store] ${table} ${op} 실패:`, message);
  try {
    onSbWriteFailure?.({ table, op, message });
  } catch (e) {
    console.error('[store] 실패 핸들러 오류:', e);
  }
}

async function sbUpsert(table: string, data: Record<string, any>): Promise<void> {
  try {
    const row = filterForTable(table, toSnakeCase(data));
    const { error } = await supabase.from(table).upsert(row);
    if (!error) return;
    if (error.code === 'PGRST204' && PENDING_MIGRATION_COLUMNS[table]) {
      // 마이그레이션 미실행 컬럼 제외 후 재시도
      const pending = PENDING_MIGRATION_COLUMNS[table];
      const fallbackRow = Object.fromEntries(Object.entries(row).filter(([k]) => !pending.includes(k)));
      const { error: err2 } = await supabase.from(table).upsert(fallbackRow);
      if (err2) reportSbFailure(table, 'upsert 재시도', err2.message);
      else console.warn(`[store] ${table}: 마이그레이션 미실행 컬럼 제외하고 저장됨`);
    } else {
      reportSbFailure(table, 'upsert', error.message);
    }
  } catch (e) {
    reportSbFailure(table, 'upsert', String(e));
  }
}

async function sbUpdate(table: string, id: string, patch: Record<string, any>): Promise<void> {
  try {
    const row = filterForTable(table, toSnakeCase(patch));
    if (Object.keys(row).length === 0) {
      // 넘어온 필드가 전부 화이트리스트 밖 — 조용히 버리면 안 된다
      reportSbFailure(table, 'update', `저장 가능한 컬럼이 없습니다 (${Object.keys(toSnakeCase(patch)).join(', ')})`);
      return;
    }
    const { error } = await supabase.from(table).update(row).eq('id', id);
    if (!error) return;
    if (error.code === 'PGRST204' && PENDING_MIGRATION_COLUMNS[table]) {
      const pending = PENDING_MIGRATION_COLUMNS[table];
      const fallbackRow = Object.fromEntries(Object.entries(row).filter(([k]) => !pending.includes(k)));
      if (Object.keys(fallbackRow).length > 0) {
        const { error: err2 } = await supabase.from(table).update(fallbackRow).eq('id', id);
        if (err2) reportSbFailure(table, 'update 재시도', err2.message);
        else console.warn(`[store] ${table}: 마이그레이션 미실행 컬럼 제외하고 저장됨`);
      } else {
        reportSbFailure(table, 'update', '마이그레이션 미실행 컬럼만 남아 저장 불가');
      }
    } else {
      reportSbFailure(table, 'update', error.message);
    }
  } catch (e) {
    reportSbFailure(table, 'update', String(e));
  }
}

async function sbDelete(table: string, id: string): Promise<void> {
  try {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) reportSbFailure(table, 'delete', error.message);
  } catch (e) {
    reportSbFailure(table, 'delete', String(e));
  }
}

export type Currency = 'KRW' | 'USD' | 'CNY';
export type Season = '25FW' | '26SS' | '26FW' | '27SS';
export type Category =
  | '숄더백' | '토트백' | '크로스백' | '클러치' | '백팩'
  | '파우치' | '키링' | '지갑'
  | '스니커즈' | '힐' | '로퍼' | '부츠' | '샌들'
  | '택배박스' | '내부박스' | '더스트백' | '쇼핑백' | '노루지' | '소모품' | '기타';
export type BomCategory = '원자재' | '지퍼' | '장식' | '보강재' | '봉사·접착제' | '포장재' | '철형' | '후가공';
export type BomSectionKey = '원자재' | '지퍼' | '장식' | '보강재' | '봉사·접착제' | '포장재' | '철형' | '후가공';
export type MaterialCategory = '원자재' | '지퍼' | '장식' | '보강재' | '봉사·접착제' | '포장재' | '철형' | '후가공';
export type VendorType = '바이어' | '자재거래처' | '공장' | '해외공장' | '물류업체' | '기타';
export type BillingType = '월별합산' | '건별즉시';
export type ItemStatus = 'TEMP' | 'ACTIVE' | 'INACTIVE';
export type ErpCategory = 'HB' | 'ACC' | 'SHOES' | 'PACK';
/** LUMEN 패킹 사이즈 등급 (BAG: SS~XL / SHOES: S~L) */
export type PackingSize = 'SS' | 'S' | 'M' | 'L' | 'XL';
export type MaterialType = '완제품' | '원재료' | '부재료';
export type SampleLocation = '내부개발실' | '중국공장';
export type SampleRound = number;  // 1, 2, 3, 4, 5차... 제한 없음
export type TradeStatementStatus = '미청구' | '청구완료' | '수금완료';
export type TaxType = '과세' | '면세';
export type OrderStatus = '발주생성' | '생산중' | '생산완료' | '입고완료';
export type SampleStage = '1차' | '2차' | '3차' | '4차' | '최종승인' | '반려';
export type SampleBillingStatus = '미청구' | '청구완료' | '수금완료';
export type SettlementStatus = '정상' | '주의' | '위험' | '완납';
export type SettlementChannel = 'W Concept' | '29CM' | '자사몰' | '해외T/T' | 'B2B직납' | '기타';
export type ExpenseType = '법인카드' | '계좌이체' | '현금';
export type ExpenseCategory = '자재구매' | '물류비' | '샘플비' | '임가공비' | '기타제조원가' | '판관비' | '기타';


// ─── 자재 마스터 ───
export interface Material {
  id: string;
  itemCode?: string;      // 품번 (M01, Z01, H01 등)
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
  orderStatus?: '발주중' | '입고완료';  // 발주 상태
  orderDate?: string;     // 발주일
  orderQty?: number;      // 발주수량
  orderVendorName?: string; // 발주 거래처명
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
  erpCategory?: ErpCategory;       // HB / ACC / SHOES / PACK
  materialType?: MaterialType;     // 완제품 / 원재료 / 부재료 (항상 완제품으로 자동 설정)
  itemStatus?: ItemStatus;         // TEMP / ACTIVE / INACTIVE
  material: string;
  designer?: string;               // 담당 디자이너
  packingSize?: PackingSize;       // LUMEN 패킹 등급 (SS/S/M/L/XL)
  boxSizeL?: number;
  boxSizeW?: number;
  boxSizeH?: number;
  packagingSizeStr?: string;       // 포장사이즈 (예: 54×14×61)
  // 판매가(salePriceKrw) 제거됨 — 납품가(deliveryPrice) 기반 마진 계산으로 전환
  salePriceKrw?: number;           // @deprecated — 하위 호환성 유지 (deliveryPrice 사용 권장)
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
  imageUrl?: string;        // 자재 이미지 (base64 또는 URL)
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
  packingItemId?: string;     // 품목마스터 PACK 연결 id
  packingItemStyleNo?: string;
  productionMarginRate?: number; // 생산마진율 (기본 16%)
  snapshotCnyKrw: number;     // 적용 환율 (CNY→KRW)
  snapshotUsdKrw?: number;    // 적용 환율 (USD→KRW)
  pnl?: BomPnlAssumptions;    // P&L 가정값
  sourceFileName?: string;    // 업로드한 엑셀 파일명 (사전원가)
  productImage?: string;      // 제품 이미지 (base64)
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
  postTotalCostKrw?: number;      // 사후원가 제품원가 (저장값)
  postSubtotalKrw?: number;       // 사후원가 소계 (생산마진 전)
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
  memo?: string;  // 컬러별 주의사항/특이사항
}

export type MilestoneStage = '발주생성' | '샘플승인' | '생산중' | '선적중' | '통관중' | '입고완료' | '샘플1차' | '생산시작' | '선적' | '통관';

export interface OrderMilestone {
  stage: MilestoneStage;
  plannedDate?: string;
  actualDate?: string;
  date?: string;
  note?: string;
  completed?: boolean;
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
  buyerId?: string;               // 바이어 ID (Supabase buyer_id 컬럼 연동)
  orderDate?: string;           // 발주일 (등록일)
  status: OrderStatus;
  milestones?: OrderMilestone[]; // 납기 마일스톤 목록
  bomId?: string;
  hqSupplyItems: HqSupplyItem[];
  attachments: OrderAttachment[];
  postCostId?: string;
  logisticsCostId?: string;
  tradeStatementId?: string;      // 연결된 거래명세표 ID
  expenseId?: string;             // 연결된 지출결의(payable) ID — 구 지출전표 ID도 호환
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
  // Phase 1 — project_no · 워크스페이스
  projectNo?: string;
  workspace?: 'OEM' | 'LUMEN' | 'AETALOOP';
  productionOrigin?: 'domestic' | 'china';
  brandBatchId?: string;
  shippedQty?: number;
  isEmployeePurchase?: boolean;
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
  /** 연결 지출결의(payable) id — 구 지출전표 id도 호환 */
  statementNo?: string;
  memo?: string;
  createdAt: string;
  projectNo?: string;
  styleNo?: string;
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
  projectNo?: string;
  workspace?: 'OEM' | 'LUMEN' | 'AETALOOP';
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
  imageUrl?: string       // BOM 자재 이미지
  unitPriceCny?: number   // BOM 단가 (CNY)
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
  projectNo?: string;
  workspace?: 'OEM' | 'LUMEN' | 'AETALOOP';
}

// ─── 지출 전표 ───
export interface ExpenseLine {
  id: string;
  description: string;   // 품목명
  qty: number;           // 수량
  unit: string;          // 단위
  unitPrice: number;     // 단가(KRW)
  amountKrw: number;     // 금액 (qty * unitPrice)
  memo?: string;
}

export interface Expense {
  id: string;
  expenseDate: string;
  expenseType: ExpenseType;
  category: ExpenseCategory;
  lines?: ExpenseLine[];   // 여러 항목 (신규)
  description: string;     // 대표 설명 (첫 번째 라인 or 수동)
  amountKrw: number;       // lines 합산 자동 계산
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
  // 생산발주 연동 필드 (입고완료 시 자동 생성)
  orderId?: string;
  orderNo?: string;
  vendorId?: string;
  vendorName?: string;
  source?: 'manual' | 'production';  // 수동 입력 vs 생산발주 자동
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
  setMaterials: (v: Material[]) => setAll(KEYS.materials, v),
  getNextItemCode: (category: MaterialCategory): string => {
    const PREFIX: Record<string, string> = {
      '원자재': 'M', '지퍼': 'Z', '장식': 'H', '보강재': 'R',
      '봉사·접착제': 'T', '포장재': 'P', '철형': 'I', '후가공': 'F',
    };
    const prefix = PREFIX[category] || 'X';
    const existing = getAll<Material>(KEYS.materials)
      .filter(m => m.category === category && m.itemCode)
      .map(m => {
        const match = m.itemCode!.match(/^[A-Z](\d+)$/);
        return match ? parseInt(match[1]) : 0;
      });
    const nextNum = existing.length > 0 ? Math.max(...existing) + 1 : 1;
    return `${prefix}${String(nextNum).padStart(2, '0')}`;
  },
  addMaterial: (v: Material) => { const a = getAll<Material>(KEYS.materials); a.push(v); setAll(KEYS.materials, a); sbUpsert('materials', v); },
  updateMaterial: (id: string, u: Partial<Material>) => { const a = getAll<Material>(KEYS.materials); const i = a.findIndex(x => x.id === id); if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.materials, a); sbUpdate('materials', id, u); } },
  deleteMaterial: (id: string) => { setAll(KEYS.materials, getAll<Material>(KEYS.materials).filter(x => x.id !== id)); sbDelete('materials', id); },

  // Items
  getItems: () => getAll<Item>(KEYS.items),
  setItems: (v: Item[]) => setAll(KEYS.items, v),
  addItem: (v: Item) => { const a = getAll<Item>(KEYS.items); a.push(v); setAll(KEYS.items, a); sbUpsert('items', v); },
  updateItem: (id: string, u: Partial<Item>) => {
    const a = getAll<Item>(KEYS.items);
    const i = a.findIndex(x => x.id === id);
    if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.items, a); }
    // Supabase에 snake_case로 명시적 변환 후 저장
    const snakeU: Record<string, unknown> = {};
    if (u.hasBom !== undefined) snakeU.has_bom = u.hasBom;
    if (u.baseCostKrw !== undefined) snakeU.base_cost_krw = u.baseCostKrw;
    if (u.colors !== undefined) snakeU.colors = u.colors;
    if (u.deliveryPrice !== undefined) snakeU.delivery_price = u.deliveryPrice;
    if (u.name !== undefined) snakeU.name = u.name;
    if (u.memo !== undefined) snakeU.memo = u.memo;
    if (u.imageUrl !== undefined) snakeU.image_url = u.imageUrl;
    if (u.season !== undefined) snakeU.season = u.season;
    if (u.designer !== undefined) snakeU.designer = u.designer;
    if (u.material !== undefined) snakeU.material = u.material;
    if (u.erpCategory !== undefined) snakeU.erp_category = u.erpCategory;
    if (u.buyerId !== undefined) snakeU.buyer_id = u.buyerId;
    if (Object.keys(snakeU).length > 0) sbUpdate('items', id, snakeU);
  },
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
   * ExtBom(BomManagement.tsx 형식) → Supabase boms 테이블에 upsert
   * colorBoms, postColorBoms, postProcessLines 등 JSONB 필드 완전 지원
   * sbUpsert는 내부에서 toSnakeCase를 또 호출하므로, 직접 supabase client 사용
   */
  saveBom: (bom: any): void => {
    // localStorage 저장 (ames_boms 키)
    const boms = getAll<any>(KEYS.boms);
    const idx = boms.findIndex((b: any) => b.id === bom.id);
    if (idx >= 0) {
      boms[idx] = bom;
    } else {
      boms.push(bom);
    }
    setAll(KEYS.boms, boms);

    // Supabase에 snake_case로 직접 변환 후 upsert
    // 실제 boms 테이블 컬럼에 맞춰 명시적 매핑
    const snakeBom: Record<string, any> = {
      id: bom.id,
      style_no: bom.styleNo,
      style_id: bom.styleId ?? null, // [FIX] items.id 참조 (BOM-아이템 연결 키)
      style_name: bom.styleName,
      season: bom.season,
      erp_category: bom.erpCategory,
      designer: bom.designer,
      line_name: bom.lineName,
      manufacturing_country: bom.manufacturingCountry,
      currency: bom.currency ?? bom.preCurrency ?? 'CNY',
      exchange_rate_cny: bom.exchangeRateCny ?? bom.snapshotCnyKrw,
      exchange_rate_usd: bom.exchangeRateUsd,
      pre_materials: bom.lines ?? [],
      pre_processing_fee: bom.processingFee ?? 0,
      post_materials: bom.postMaterials ?? [],
      post_processing_fee: bom.postProcessingFee ?? 0,
      logistics_cost_krw: bom.logisticsCostKrw ?? 0,
      packaging_cost_krw: bom.packagingCostKrw ?? 0,
      packing_cost_krw: bom.packingCostKrw ?? 0,
      production_margin_rate: bom.productionMarginRate ?? 0.16,
      customs_rate: bom.customsRate ?? 0,
      color_boms: bom.colorBoms ?? [],
      post_color_boms: bom.postColorBoms ?? [],
      post_process_lines: bom.postProcessLines ?? [],
      pnl_data: bom.pnl ? JSON.stringify(bom.pnl) : null,
      product_image: bom.productImage ?? null,
      pre_currency: bom.preCurrency ?? bom.currency ?? 'CNY',
      post_currency: bom.currency ?? 'CNY',
      pre_exchange_rate_cny: bom.preExchangeRateCny ?? bom.snapshotCnyKrw,
      post_exchange_rate_cny: bom.postExchangeRateCny ?? bom.exchangeRateCny ?? bom.snapshotCnyKrw,
      memo: bom.memo,
      updated_at: new Date().toISOString(),
    };

    // 직접 supabase client로 upsert (toSnakeCase 이중 변환 방지)
    Promise.resolve(supabase.from('boms').upsert(snakeBom))
      .then(({ error }) => {
        if (error) {
          console.warn('[store.saveBom] Supabase upsert 실패:', error.message, error.details);
        } else {
          console.log('[store.saveBom] BOM 저장 완료:', bom.styleNo, bom.id);
        }
      })
      .catch((e: unknown) => console.warn('[store.saveBom] 오류:', e));
  },

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
        colorBoms?: Array<{
          color: string;
          lines?: Array<{ unitPriceCny?: number; unitPrice?: number; netQty: number; lossRate: number; isHqProvided?: boolean; isVendorProvided?: boolean }>;
          postProcessLines?: Array<{ netQty: number; unitPrice: number }>;
          processingFee?: number;
        }>;
        postProcessLines?: Array<{ netQty: number; unitPrice: number }>;
        processingFee?: number;
        snapshotCnyKrw?: number;
      }>;
      const bom = boms.find(b => b.styleNo === styleNo);
      if (!bom) return 0;
      const cnyKrw = bom.snapshotCnyKrw ?? 191;

      // colorBoms가 있으면 첫 번째 컬러 탭 기준으로 계산
      const firstColorBom = (bom.colorBoms && bom.colorBoms.length > 0) ? bom.colorBoms[0] : null;
      const effectiveLines = firstColorBom?.lines ?? bom.lines ?? [];
      const effectivePostProcessLines = firstColorBom?.postProcessLines ?? bom.postProcessLines ?? [];
      const effectiveProcessingFee = firstColorBom?.processingFee ?? bom.processingFee ?? 0;

      // 자재비 합계 (제품원가 기준, LOSS 포함 소요량 × 단가)
      const materialCny = effectiveLines.reduce((s, l) => {
        const price = l.unitPriceCny ?? (l as { unitPrice?: number }).unitPrice ?? 0;
        const qty = l.netQty * (1 + (l.lossRate ?? 0));
        return s + price * qty;
      }, 0);
      // 후가공비
      const postProcessCny = effectivePostProcessLines.reduce((s, l) => s + l.netQty * l.unitPrice, 0);
      // 임가공비
      const processingCny = effectiveProcessingFee;
      // KRW 환산 합계
      return Math.round((materialCny + postProcessCny + processingCny) * cnyKrw);
    } catch { return 0; }
  },

  // Orders
  getOrders: () => getAll<ProductionOrder>(KEYS.orders),
  setOrders: (v: ProductionOrder[]) => setAll(KEYS.orders, v),
  addOrder: (v: ProductionOrder) => {
    const a = getAll<ProductionOrder>(KEYS.orders); a.push(v); setAll(KEYS.orders, a);
    // production_orders 테이블은 qty→quantity, factoryUnitPriceKrw→unit_price, factoryCurrency→currency 매핑 필요
    const row = {
      ...toSnakeCase(v as Record<string, any>),
      quantity: v.qty,
      unit_price: v.factoryUnitPriceKrw ?? v.factoryUnitPriceCny ?? 0,
      currency: v.factoryCurrency ?? 'KRW',
    };
    const filtered = filterForTable('production_orders', row);
    Promise.resolve(supabase.from('production_orders').upsert(filtered))
      .then(({ error }) => { if (error) console.warn('[store] production_orders upsert 실패:', error.message); })
      .catch((e: unknown) => console.warn('[store] production_orders upsert 오류:', e));
  },
  updateOrder: (id: string, u: Partial<ProductionOrder>) => {
    const a = getAll<ProductionOrder>(KEYS.orders);
    const i = a.findIndex(x => x.id === id);
    if (i >= 0) { a[i] = { ...a[i], ...u }; setAll(KEYS.orders, a); }
    // camelCase → snake_case 자동 변환 후 화이트리스트(tableColumns.ts)로 거른다.
    // 예전엔 필드를 하나씩 손으로 나열해서 defectQty/shippedQty/receivedDate/defectNote가
    // 통째로 누락됐고, 입고·출고 기록이 Supabase에 저장되지 않았다.
    const patch: Record<string, unknown> = { ...u };
    if (u.qty !== undefined) { patch.quantity = u.qty; delete patch.qty; } // qty만 컬럼명이 다름
    sbUpdate('production_orders', id, patch);
  },
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
    const items = getAll<Item>(KEYS.items);
    const item = items.find(i => i.styleNo === styleNo);
    // 스타일번호 또는 styleId로 매칭되는 최신 BOM (version 내림차순)
    const bomList = boms
      .filter(b =>
        b.styleNo === styleNo
        || (!!item && (b.styleId === item.id || b.styleId === item.styleNo || b.styleNo === item.styleNo))
      )
      .sort((a, b) => (b.version || 0) - (a.version || 0));
    if (bomList.length === 0) return { bom: null, type: null };
    // 사후원가 컬러 BOM 우선 (postColorBoms > postMaterials)
    const postColorBom = bomList.find(b => (b as any).postColorBoms && (b as any).postColorBoms.length > 0);
    if (postColorBom) return { bom: postColorBom, type: 'post' };
    const postBom = bomList.find(b => b.postMaterials && b.postMaterials.length > 0);
    if (postBom) return { bom: postBom, type: 'post' };
    // 사전원가 컬러 BOM
    const preColorBom = bomList.find(b => (b as any).colorBoms && (b as any).colorBoms.length > 0);
    if (preColorBom) return { bom: preColorBom, type: 'pre' };
    // 기본 사전원가
    const preBom = bomList.find(b => b.lines && b.lines.length > 0);
    if (preBom) return { bom: preBom, type: 'pre' };
    return { bom: bomList[0], type: 'pre' };
  },

  // Supabase에서 최신 BOM 직접 패치 (localStorage 동기화용)
  fetchAndCacheBom: async (styleNo: string): Promise<void> => {
    try {
      const SURL = 'https://linzfvhgswrnoukssqyi.supabase.co/rest/v1';
      const SKEY = 'sb_publishable_-cxAP3_Gkq4XkBfc55OymA_ozoSEEH2';
      const res = await fetch(`${SURL}/boms?style_no=eq.${encodeURIComponent(styleNo)}&select=*`, {
        headers: { 'apikey': SKEY, 'Authorization': `Bearer ${SKEY}` }
      });
      if (!res.ok) return;
      const rows = await res.json();
      if (!rows || rows.length === 0) return;
      const boms = getAll<any>(KEYS.boms);
      for (const row of rows) {
        let pnl: any;
        try {
          if (row.pnl_data) {
            pnl = typeof row.pnl_data === 'string' ? JSON.parse(row.pnl_data) : row.pnl_data;
          }
        } catch { /* ignore */ }
        let isSimpleCost = false;
        let simplePostCostKrw: number | undefined;
        let simpleCostKrw: number | undefined;
        try {
          if (row.memo && typeof row.memo === 'string' && row.memo.includes('isSimple')) {
            const m = JSON.parse(row.memo);
            if (m?.isSimple) {
              isSimpleCost = true;
              simplePostCostKrw = m.postCost ?? undefined;
              simpleCostKrw = m.preCost ?? undefined;
            }
          }
        } catch { /* ignore */ }
        const idx = boms.findIndex((b: any) => b.id === row.id || b.styleNo === row.style_no);
        const converted = {
          ...(idx >= 0 ? boms[idx] : {}),
          id: row.id,
          styleId: row.style_id ?? row.style_no,
          styleNo: row.style_no,
          styleName: row.style_name,
          postColorBoms: row.post_color_boms || [],
          colorBoms: row.color_boms || [],
          postMaterials: row.post_materials || [],
          lines: row.pre_materials || [],
          processingFee: row.processing_fee || 0,
          postProcessingFee: row.post_processing_fee || 0,
          exchangeRateCny: row.exchange_rate_cny || 191,
          preExchangeRateCny: row.pre_exchange_rate_cny || 191,
          postExchangeRateCny: row.post_exchange_rate_cny || row.exchange_rate_cny || 191,
          exchangeRateUsd: row.exchange_rate_usd || 1380,
          currency: row.currency || row.post_currency || 'CNY',
          customsRate: row.customs_rate || 0,
          productionMarginRate: row.production_margin_rate || 0.16,
          logisticsCostKrw: row.logistics_cost_krw || 0,
          packagingCostKrw: row.packaging_cost_krw || 0,
          packingCostKrw: row.packing_cost_krw || 0,
          postProcessLines: row.post_process_lines || [],
          manufacturingCountry: row.manufacturing_country,
          pnl,
          isSimpleCost,
          simplePostCostKrw,
          simpleCostKrw,
          version: 1,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
        if (idx >= 0) boms[idx] = converted;
        else boms.push(converted);
      }
      setAll(KEYS.boms, boms);
    } catch(e) { console.warn('fetchAndCacheBom 오류:', e); }
  },

  /**
   * BOM 공장단가(KRW/CNY) — BOM 화면과 동일 기준
   * 우선순위: pnl.factoryUnitCostKrw → 간단원가 → 컬러별 사후원가(수량 가중) → postMaterials
   */
  resolveFactoryUnitFromBom: (bom: Bom | null | undefined, colorQtys?: ColorQty[]): {
    factoryUnitPriceKrw: number;
    factoryUnitPriceCny: number;
    rate: number;
  } => {
    if (!bom) return { factoryUnitPriceKrw: 0, factoryUnitPriceCny: 0, rate: 191 };
    const b = bom as any;
    const postCur = b.currency || 'CNY';
    const cnyKrw = b.postExchangeRateCny || b.exchangeRateCny || b.snapshotCnyKrw || 191;
    const usdKrw = b.exchangeRateUsd || b.snapshotUsdKrw || 1380;
    const rate = postCur === 'USD' ? usdKrw : postCur === 'KRW' ? 1 : cnyKrw;

    const pnlKrw = Number(b.pnl?.factoryUnitCostKrw || 0);
    if (pnlKrw > 0) {
      return {
        factoryUnitPriceKrw: Math.round(pnlKrw),
        factoryUnitPriceCny: pnlKrw / (rate || 1),
        rate,
      };
    }
    if (b.isSimpleCost && Number(b.simplePostCostKrw) > 0) {
      const v = Math.round(Number(b.simplePostCostKrw));
      return { factoryUnitPriceKrw: v, factoryUnitPriceCny: v / (rate || 1), rate };
    }

    const calcKrwFromLines = (materials: any[], processingFee: number, postProc: any[]) => {
      const lineAmt = (price: number, net: number, loss: number) =>
        (price || 0) * (net || 0) * (1 + (loss || 0));
      const factoryMat = (materials || []).reduce((s: number, l: any) => {
        if (l.isHqProvided) return s;
        const price = l.unitPriceCny ?? l.unitPrice ?? 0;
        return s + lineAmt(price, l.netQty, l.lossRate);
      }, 0);
      const processing = processingFee || 0;
      const postP = (postProc || []).reduce((s: number, l: any) =>
        s + (l.netQty || 0) * (l.unitPrice ?? l.unitPriceCny ?? 0), 0);
      return factoryMat * rate + processing * rate + postP * rate;
    };

    const postColors: any[] = Array.isArray(b.postColorBoms) ? b.postColorBoms : [];
    if (colorQtys && colorQtys.length > 0 && postColors.length > 0) {
      let weighted = 0;
      let totalQty = 0;
      for (const cq of colorQtys) {
        if (!cq.qty || cq.qty <= 0) continue;
        const key = (cq.color || '').trim().toUpperCase();
        const match = postColors.find((cb: any) => (cb.color || '').trim().toUpperCase() === key)
          || postColors.find((cb: any) => (cb.lines || []).some((l: any) => l.itemName || (l.unitPriceCny || 0) > 0));
        if (!match) continue;
        const krw = calcKrwFromLines(
          match.lines || [],
          match.processingFee ?? b.postProcessingFee ?? 0,
          match.postProcessLines ?? b.postProcessLines ?? [],
        );
        weighted += krw * cq.qty;
        totalQty += cq.qty;
      }
      if (totalQty > 0 && weighted > 0) {
        const avg = Math.round(weighted / totalQty);
        return { factoryUnitPriceKrw: avg, factoryUnitPriceCny: avg / (rate || 1), rate };
      }
    }

    const postColorBom = postColors.find((cb: any) =>
      (cb.lines || []).some((l: any) => l.itemName || (l.unitPriceCny || 0) > 0),
    );
    const materials = postColorBom ? (postColorBom.lines || []) : (b.postMaterials || []);
    if (materials.length > 0) {
      const krw = Math.round(calcKrwFromLines(
        materials,
        postColorBom ? (postColorBom.processingFee ?? 0) : (b.postProcessingFee || 0),
        postColorBom ? (postColorBom.postProcessLines ?? []) : (b.postProcessLines || []),
      ));
      if (krw > 0) {
        return { factoryUnitPriceKrw: krw, factoryUnitPriceCny: krw / (rate || 1), rate };
      }
    }

    return { factoryUnitPriceKrw: 0, factoryUnitPriceCny: 0, rate };
  },

  /** 자재 소요량 계산: BOM 소요량 × 발주수량, 본사제공/미제공 분리
   * 컬러별 BOM 지원:
   * - colorQtys의 각 컬러에 해당하는 colorBom이 있으면 → 해당 colorBom.lines 사용 (원자재)
   * - colorBom이 없는 컬러 or 원자재가 아닌 섹션 → 기본 BOM lines 사용
   */
  calcMaterialRequirements: (styleNo: string, qty: number, colorQtys?: ColorQty[]): {
    hqProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; color?: string; imageUrl?: string; category?: string }>;
    factoryProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; color?: string; imageUrl?: string; category?: string }>;
    processingFee: number;
    factoryUnitPriceCny: number;
    bomType: 'post' | 'pre' | null;
    manufacturingCountry?: string;
  } => {
    const { bom, type } = store.getBomForOrder(styleNo);
    if (!bom) return { hqProvided: [], factoryProvided: [], processingFee: 0, factoryUnitPriceCny: 0, bomType: null };

    // 사용할 자재 라인 결정 (사후원가 컬러 우선 → 사전원가 컬러 → 기본 lines)
    const firstPostColorBom = (bom as any).postColorBoms && (bom as any).postColorBoms.length > 0
      ? (bom as any).postColorBoms[0]
      : null;
    const firstPreColorBom = (bom as any).colorBoms && (bom as any).colorBoms.length > 0
      ? (bom as any).colorBoms[0]
      : null;
    // 사후원가 컬러탭 우선 (실제 공장 원가표 기준)
    const baseLines: BomLine[] = (firstPostColorBom?.lines?.length > 0)
      ? firstPostColorBom.lines
      : (bom.postMaterials && bom.postMaterials.length > 0)
      ? bom.postMaterials
      : (firstPreColorBom?.lines?.length > 0)
      ? firstPreColorBom.lines
      : (bom.lines || []);

    // 임가공비도 사후원가 우선
    const processingFee = (firstPostColorBom?.processingFee ?? bom.postProcessingFee)
      || (firstPreColorBom?.processingFee ?? bom.processingFee) || 0;

    const hqProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; color?: string; imageUrl?: string; category?: string }> = [];
    const factoryProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; color?: string; imageUrl?: string; category?: string }> = [];

    // 원자재 섹션: postColorBoms 우선 → colorBoms fallback
    const postColorBoms = (bom as any).postColorBoms || [];
    const preColorBoms = bom.colorBoms || [];
    const hasColorData = (colorQtys && colorQtys.length > 0) && (postColorBoms.length > 0 || preColorBoms.length > 0);
    if (hasColorData) {
      // 컬러별로 처리
      for (const cq of colorQtys!) {
        if (!cq.qty || cq.qty <= 0) continue;
        // 사후원가 컬러탭 우선, 없으면 사전원가
        const postColorBom = postColorBoms.find((cb: any) => cb.color.trim() === cq.color.trim());
        const preColorBom = preColorBoms.find(cb => cb.color.trim() === cq.color.trim());
        const colorBomToUse = postColorBom || preColorBom;
        const rawLines = colorBomToUse ? colorBomToUse.lines : baseLines.filter(l => l.category === '원자재');
        // 원자재만 컬러별로 처리 (원자재 필터링 - colorBomToUse가 있으면 원자재만, 없으면 이미 필터됨)
        const filteredRawLines = colorBomToUse ? rawLines.filter((l: BomLine) => l.category === '원자재') : rawLines;
        for (const line of filteredRawLines) {
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
            imageUrl: (line as any).imageUrl,
            category: line.category as string | undefined,
          };
          if (line.isHqProvided) hqProvided.push(entry);
          else factoryProvided.push(entry);
        }
      }

      // 비원자재: 각 컬러의 BOM에서 컬러별로 계산 후 itemName+unit 기준 합산
      const nonRawMap = new Map<string, { entry: { bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; color?: string; imageUrl?: string; category?: string }; qty: number }>();
      for (const cq of colorQtys!) {
        if (!cq.qty || cq.qty <= 0) continue;
        const postCB = postColorBoms.find((cb: any) => cb.color.trim() === cq.color.trim());
        const preCB = preColorBoms.find(cb => cb.color.trim() === cq.color.trim());
        const cbToUse = postCB || preCB;
        const nonRawLines = cbToUse
          ? cbToUse.lines.filter((l: BomLine) => l.category !== '원자재')
          : baseLines.filter(l => l.category !== '원자재');
        for (const line of nonRawLines) {
          const key = line.itemName + '||' + line.unit;
          const perPcsQty = line.netQty * (1 + (line.lossRate ?? 0));
          const totalQty = Math.round(perPcsQty * cq.qty * 100) / 100;
          if (nonRawMap.has(key)) {
            nonRawMap.get(key)!.qty += totalQty;
          } else {
            nonRawMap.set(key, {
              entry: {
                bomLineId: line.id,
                itemName: line.itemName,
                spec: line.spec,
                unit: line.unit,
                reqQty: totalQty,
                vendorName: line.vendorName,
                color: undefined,
                imageUrl: (line as any).imageUrl,
                category: line.category as string | undefined,
              },
              qty: totalQty,
            });
          }
        }
      }
      for (const [, { entry, qty }] of nonRawMap.entries()) {
        const finalEntry = { ...entry, reqQty: Math.round(qty * 100) / 100 };
        const srcLine = baseLines.find(l => l.itemName === entry.itemName);
        if (srcLine?.isHqProvided) hqProvided.push(finalEntry);
        else factoryProvided.push(finalEntry);
      }
    } else {
      // colorBoms 없거나 colorQtys 없으면 기본 라인 전체 수량 적용 (원자재 + 비원자재 모두)
      for (const line of baseLines) {
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
          imageUrl: (line as any).imageUrl,
          category: line.category as string | undefined,
        };
        if (line.isHqProvided) hqProvided.push(entry);
        else factoryProvided.push(entry);
      }
    }

    // 공장단가 = BOM 화면과 동일 기준 (pnl / 컬러사후원가)
    const resolved = store.resolveFactoryUnitFromBom(bom, colorQtys);
    let factoryUnitPriceCny = resolved.factoryUnitPriceCny;
    if (!(factoryUnitPriceCny > 0)) {
      // fallback: 라인 합산 (본사제공 제외)
      const factoryMaterialCny = baseLines.reduce((s, l) => {
        if (l.isHqProvided) return s;
        const price = (l as any).unitPriceCny ?? (l as any).unitPrice ?? 0;
        const perPcsQty = l.netQty * (1 + (l.lossRate ?? 0));
        return s + price * perPcsQty;
      }, 0);
      const postProcessFee = (bom as any).postProcessLines
        ? ((bom as any).postProcessLines as Array<{ netQty: number; unitPrice: number }>).reduce((s, l) => s + l.netQty * l.unitPrice, 0)
        : 0;
      factoryUnitPriceCny = factoryMaterialCny + processingFee + postProcessFee;
    }

    return {
      hqProvided,
      factoryProvided,
      processingFee,
      factoryUnitPriceCny,
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
    bomMaterials: Array<{ itemName: string; spec?: string; unit: string; netQty: number; lossRate: number; vendorName?: string; isHqProvided: boolean; imageUrl?: string; unitPriceCny?: number }>,
    orderQty: number
  ) => {
    const cart = getAll<CartItem>(KEYS.materialCart);
    for (const mat of bomMaterials) {
      // 소요량 = netQty * (1 + lossRate) * orderQty
      const perPcsQty = mat.netQty * (1 + (mat.lossRate ?? 0));
      const totalQty = Math.round(perPcsQty * orderQty * 1000) / 1000;
      // vendorName까지 포함해서 키 생성 → 같은 자재라도 거래처 다르면 별도 항목
      const vendorKey = mat.vendorName || '';
      const key = mat.itemName + '||' + mat.unit + '||' + vendorKey;
      const idx = cart.findIndex(c => (c.materialName + '||' + c.unit + '||' + (c.vendorName || '')) === key);
      if (idx >= 0) {
        // 기존 항목 — 수량 합산, 발주 목록 추가
        const existingOrder = cart[idx].orders.find(o => o.styleNo === styleNo);
        if (existingOrder) {
          existingOrder.qty = Math.round((existingOrder.qty + totalQty) * 1000) / 1000;
        } else {
          cart[idx].orders.push({ styleNo, styleName, qty: totalQty });
        }
        cart[idx].qty = Math.round((cart[idx].qty + totalQty) * 1000) / 1000;
        if (!cart[idx].imageUrl && mat.imageUrl) cart[idx].imageUrl = mat.imageUrl;
        // 단가 업데이트 (BOM에 단가 있으면 갱신)
        if (mat.unitPriceCny !== undefined && mat.unitPriceCny > 0) {
          cart[idx].unitPriceCny = mat.unitPriceCny;
        }

      } else {
        cart.push({
          materialName: mat.itemName,
          spec: mat.spec,
          unit: mat.unit,
          qty: totalQty,
          vendorName: mat.vendorName,
          isHqProvided: mat.isHqProvided,
          imageUrl: mat.imageUrl,
          unitPriceCny: (mat as any).unitPriceCny ?? 0,
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


// ─────────────────────────────────────────────
// 외부 boms 배열을 받는 BOM 유틸 함수
// (Supabase 직접 연동으로 전환 시 useQuery 데이터를 직접 전달)
// ─────────────────────────────────────────────

export function getBomForOrderFromList(
  boms: Bom[],
  styleNo: string,
  styleId?: string
): { bom: Bom | null; type: 'post' | 'pre' | null } {
  const bomList = boms
    .filter(b =>
      b.styleNo === styleNo
      || (!!styleId && (b.styleId === styleId || b.styleId === styleNo))
      || (!!styleNo && b.styleId === styleNo)
    )
    .sort((a, b) => (b.version || 0) - (a.version || 0));
  if (bomList.length === 0) return { bom: null, type: null };
  const postColorBom = bomList.find(b => (b as any).postColorBoms && (b as any).postColorBoms.length > 0);
  if (postColorBom) return { bom: postColorBom, type: 'post' };
  const postBom = bomList.find(b => b.postMaterials && b.postMaterials.length > 0);
  if (postBom) return { bom: postBom, type: 'post' };
  const preColorBom = bomList.find(b => (b as any).colorBoms && (b as any).colorBoms.length > 0);
  if (preColorBom) return { bom: preColorBom, type: 'pre' };
  const preBom = bomList.find(b => b.lines && b.lines.length > 0);
  if (preBom) return { bom: preBom, type: 'pre' };
  return { bom: bomList[0], type: 'pre' };
}

