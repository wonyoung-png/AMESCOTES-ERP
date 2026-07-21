// Phase 1 제조 ERP — project_no, 입고·출고, 미지급, 브랜드 발주·R3
import { supabase } from './supabase';
import type { ColorQty } from './store';

export type Workspace = 'OEM' | 'LUMEN' | 'AETALOOP';
export type ProductionOrigin = 'domestic' | 'china';
export type ReceiptLogType = 'inbound' | 'outbound_oem' | 'outbound_3pl';
export type ReceiptDestination = 'korea' | 'china';
export type BrandBatchStatus = 'draft' | 'in_approval' | 'approved' | 'split' | 'done';
export type PayableStatus = 'pending' | 'partial' | 'paid';
export type PayablePayeeType = 'factory_direct' | 'china_corp';
export type DefectStatus = 'pending' | 'applied';

/** 오더관리 파생 상태 */
export type OrderProdAxis = 'ordered' | 'in_progress' | 'produced';
export type OrderReceiptAxis = 'none' | 'advance' | 'partial' | 'complete';
export type OrderPaymentAxis = 'none' | 'resolution' | 'paid';
export type OrderDisplayStatus =
  | '결제완료'
  | '지출결의'
  | '입고완료'
  | '부분입고'
  | '선입고'
  | '생산완료'
  | '진행중'
  | '발주';

export const CHINA_CORP_VENDOR_CODE = 'AMES-CN';
export const CHINA_CORP_VENDOR_NAME = '아메스코테스 중국법인';

export interface Project {
  id: string;
  projectNo: string;
  workspace: Workspace;
  title: string;
  status: 'active' | 'closed';
  createdAt: string;
}

export interface ReceiptLog {
  id: string;
  orderId: string;
  orderNo: string;
  projectNo?: string;
  logType: ReceiptLogType;
  qty: number;
  defectQty: number;
  defectNote?: string;
  receivedDate: string;
  memo?: string;
  /** 한국입고 / 중국입고 */
  destination?: ReceiptDestination;
  /** 중국입고 시 컬러 */
  color?: string;
  /** 생산완료 전 선입고 */
  isAdvance?: boolean;
  createdAt: string;
}

export interface DefectCarryover {
  id: string;
  styleNo: string;
  orderNo: string;
  projectNo?: string;
  vendorId?: string;
  vendorName: string;
  amountKrw: number;
  reason: string;
  defectDate: string;
  status: DefectStatus;
  appliedStatementId?: string;
  createdAt: string;
}

export interface Payable {
  id: string;
  vendorId?: string;
  vendorName: string;
  projectNo?: string;
  sourceType: 'purchase' | 'expense' | 'processing' | 'manual' | 'order_receipt';
  sourceId?: string;
  amountKrw: number;
  paidAmountKrw: number;
  dueDate: string;
  status: PayableStatus;
  memo?: string;
  payeeType?: PayablePayeeType;
  orderId?: string;
  orderNo?: string;
  styleNo?: string;
  color?: string;
  receiptLogIds?: string[];
  createdAt: string;
}

/** 중국창고 입출고 (한국 3PL/이지어드민과 분리) */
export type ChinaStockMoveType = 'inbound' | 'outbound' | 'adjust';

export interface ChinaStockMove {
  id: string;
  workspace: 'LUMEN' | 'AETALOOP';
  styleNo: string;
  styleName?: string;
  color: string;
  /** 입고·조정(+)/출고 모두 양수 수량, 부호는 moveType */
  qty: number;
  moveType: ChinaStockMoveType;
  moveDate: string;
  orderId?: string;
  orderNo?: string;
  receiptLogId?: string;
  memo?: string;
  createdAt: string;
}

export interface ChinaStockBalance {
  workspace: 'LUMEN' | 'AETALOOP';
  styleNo: string;
  styleName: string;
  color: string;
  onHand: number;
  inboundQty: number;
  outboundQty: number;
}

export interface ReorderColorBreakdown {
  color: string;
  qty: number;
  advanceQty: number;
  receivedQty: number;
  remaining: number;
}

export interface ReorderOrderRow {
  orderId: string;
  orderNo: string;
  styleNo: string;
  styleName: string;
  revision: number;
  orderDate: string;
  qty: number;
  advanceQty: number;
  receivedQty: number;
  remaining: number;
  erpCategory?: string;
  colorQtys?: ColorQty[];
  /** 품목·컬러별 잔량 분해 */
  colorLines: ReorderColorBreakdown[];
  vendorId?: string;
  vendorName?: string;
  workspace?: Workspace;
  projectNo?: string;
  factoryUnitPriceKrw?: number;
  orderStatus: string;
  productionStatus: OrderProdAxis;
  receiptStatus: OrderReceiptAxis;
  paymentStatus: OrderPaymentAxis;
  displayStatus: OrderDisplayStatus;
  /** 진행중 필터: 잔량 > 0 */
  isComplete: boolean;
}

export interface ReorderOrderBoardGroup {
  styleNo: string;
  styleName: string;
  erpCategory?: string;
  rows: ReorderOrderRow[];
}

export interface BrandOrderLine {
  id: string;
  batchId: string;
  styleNo: string;
  styleName: string;
  colorQtys: ColorQty[];
  factoryId?: string;
  factoryName?: string;
  productionOrigin: ProductionOrigin;
  isEmployeePurchase: boolean;
  qty: number;
  memo?: string;
}

export interface ApprovalLog {
  id: string;
  batchId: string;
  step: number;
  action: 'approve' | 'reject' | 'comment' | 'submit';
  actorId?: string;
  actorName: string;
  comment?: string;
  createdAt: string;
}

export interface BrandOrderBatch {
  id: string;
  workspace: 'LUMEN' | 'AETALOOP';
  projectNo: string;
  title: string;
  weekLabel?: string;
  status: BrandBatchStatus;
  approvalStep: number;
  expectedDely?: string;
  delyRequestedTo?: string;
  createdBy?: string;
  lines: BrandOrderLine[];
  createdAt: string;
  updatedAt: string;
}

export const R3_STEPS = [
  { step: 1, label: 'MD 작성', role: 'md' },
  { step: 2, label: '생산 납기', role: 'production' },
  { step: 3, label: 'MD 재확인', role: 'md' },
  { step: 4, label: 'MD팀장', role: 'md_lead' },
  { step: 5, label: '디자인팀장', role: 'design_lead' },
  { step: 6, label: '대표', role: 'ceo' },
] as const;

const KEYS = {
  projects: 'ames_projects',
  receiptLogs: 'ames_receipt_logs',
  defectCarryovers: 'ames_defect_carryovers',
  payables: 'ames_payables',
  brandBatches: 'ames_brand_order_batches',
  brandLines: 'ames_brand_order_lines',
  approvalLogs: 'ames_approval_logs',
  campaigns: 'ames_campaigns',
  chinaStockMoves: 'ames_china_stock_moves',
} as const;

export type CampaignStatus = 'draft' | 'onboarded' | 'active' | 'closed';
export type CampaignTaskStatus = 'todo' | 'in_progress' | 'review' | 'done';

export const CAMPAIGN_TEAMS = ['MD', '마케팅', '비주얼', '디자인', '물류', '쇼룸'] as const;
export type CampaignTeam = typeof CAMPAIGN_TEAMS[number];

export interface CampaignTaskMessage {
  id: string;
  authorName: string;
  authorId?: string;
  text: string;
  /** @멘션된 사람 이름 */
  mentions: string[];
  /** 멘션 대상에게 체크 요청 여부 */
  askCheck: boolean;
  createdAt: string;
}

export interface CampaignTaskCheck {
  id: string;
  messageId: string;
  /** 체크해야 할 사람 */
  targetName: string;
  targetUserId?: string;
  checked: boolean;
  checkedAt?: string;
  checkedBy?: string;
}

export interface CampaignTask {
  id: string;
  team: string;
  label: string;
  detail?: string;
  done: boolean;
  status: CampaignTaskStatus;
  /** 예상완료일 */
  dueDate?: string;
  /** 담당자 */
  assignee?: string;
  messages?: CampaignTaskMessage[];
  checks?: CampaignTaskCheck[];
}

export interface Campaign {
  id: string;
  workspace: 'LUMEN' | 'AETALOOP';
  title: string;
  channel: string;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  discountRate?: number;
  pushSkus?: string[];
  owner?: string;
  tasks: CampaignTask[];
  createdAt: string;
  updatedAt: string;
}

export const CAMPAIGN_CHANNELS = ['자사몰', '센텀', '29CM', 'W컨셉', '쇼룸', '해외'] as const;

/** 예전 자동생성 템플릿 업무명 — 로드 시 제거 (직접 입력 업무만 유지) */
const LEGACY_AUTO_TASK_LABELS = new Set([
  '푸시 상품 확정',
  '할인율·조건',
  '선발주 수량 (품목·공장)',
  '채널 재고 배분',
  '가격·프로모션 최종 확인',
  '카카오채널 메시지·발송',
  '인스타 스토리',
  '인스타 피드',
  '메타 광고 (예산·소재)',
  '기획전 랜딩 URL',
  '메인 배너 (채널별)',
  '서브 배너·썸네일',
  '상세페이지 업데이트',
  'SNS 이미지',
  '신규 컬러·디테일 확인',
  '샘플 확인·승인',
  '패키징·택',
  '3PL 입고 확인',
  '채널별 출고·배분',
  'W/29CM 납품 일정',
  '매장 세팅·POS 할인',
]);

function normalizeTask(t: Partial<CampaignTask> & { team: string; label: string }): CampaignTask {
  const done = !!t.done;
  return {
    id: t.id || uid(),
    team: t.team,
    label: t.label,
    detail: t.detail || '',
    done,
    status: t.status || (done ? 'done' : 'todo'),
    dueDate: t.dueDate,
    assignee: t.assignee || '',
    messages: Array.isArray(t.messages) ? t.messages : [],
    checks: Array.isArray(t.checks) ? t.checks : [],
  };
}

function isLegacyAutoTask(t: { team: string; label: string }): boolean {
  return LEGACY_AUTO_TASK_LABELS.has(t.label.trim());
}

/** 직접 추가한 업무만 유지 (자동 템플릿 업무 제거). startDate는 호환용으로 유지 */
export function buildCampaignProjectTasks(_startDate: string, existing?: CampaignTask[]): CampaignTask[] {
  return (existing || [])
    .filter(t => t.label?.trim() && !isLegacyAutoTask(t))
    .map(t => normalizeTask(t));
}

function migrateCampaignTasks(c: Campaign): Campaign {
  const tasks = buildCampaignProjectTasks(c.startDate, c.tasks);
  return { ...c, tasks };
}

function seedCampaignsIfEmpty() {
  const existing = getAll<Campaign>(KEYS.campaigns);
  if (existing.length > 0) return;
  const samples: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'tasks'>[] = [
    { workspace: 'LUMEN', title: '센텀 오픈100일 · 시즌오프', channel: '센텀', startDate: '2026-07-10', endDate: '2026-07-20', status: 'active', discountRate: 20, pushSkus: ['LLL6F92SB'], owner: 'MD' },
    { workspace: 'LUMEN', title: '여름 시즌오프', channel: '자사몰', startDate: '2026-07-06', endDate: '2026-07-12', status: 'active', discountRate: 15 },
    { workspace: 'LUMEN', title: 'Lumen with SUMMER', channel: '자사몰', startDate: '2026-07-01', endDate: '2026-07-13', status: 'active', discountRate: 10 },
    { workspace: 'LUMEN', title: 'W ONLY · 72H 특가', channel: 'W컨셉', startDate: '2026-07-06', endDate: '2026-07-12', status: 'onboarded' },
    { workspace: 'LUMEN', title: '가을 대형 (안)', channel: '자사몰', startDate: '2026-09-01', endDate: '2026-09-14', status: 'draft' },
  ];
  const now = new Date().toISOString();
  setAll(KEYS.campaigns, samples.map(s => ({
    ...s,
    id: uid(),
    tasks: [] as CampaignTask[],
    createdAt: now,
    updatedAt: now,
  })));
}

function getAll<T>(key: string): T[] {
  try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : []; } catch { return []; }
}
function setAll<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }

export function generateProjectNo(workspace: Workspace, vendorCode?: string): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const projects = getAll<Project>(KEYS.projects);
  if (workspace === 'OEM') {
    const code = (vendorCode || 'NW').toUpperCase().slice(0, 4);
    const year = d.getFullYear();
    const prefix = `${code}${year}-`;
    const nums = projects
      .filter(p => p.projectNo.startsWith(prefix))
      .map(p => parseInt(p.projectNo.slice(prefix.length), 10))
      .filter(n => !isNaN(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
  }
  const prefix = workspace === 'LUMEN' ? `LUM-${yy}${mm}${dd}-` : `AET-${yy}${mm}${dd}-`;
  const nums = projects
    .filter(p => p.projectNo.startsWith(prefix))
    .map(p => parseInt(p.projectNo.slice(prefix.length), 10))
    .filter(n => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(2, '0')}`;
}

export function ensureProject(projectNo: string, workspace: Workspace, title?: string): Project {
  const all = getAll<Project>(KEYS.projects);
  const existing = all.find(p => p.projectNo === projectNo);
  if (existing) return existing;
  const p: Project = {
    id: uid(),
    projectNo,
    workspace,
    title: title || projectNo,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  all.push(p);
  setAll(KEYS.projects, all);
  syncProjectToSupabase(p).catch(() => {});
  return p;
}

async function syncProjectToSupabase(p: Project) {
  await supabase.from('projects').upsert({
    id: p.id,
    project_no: p.projectNo,
    workspace: p.workspace,
    title: p.title,
    status: p.status,
    created_at: p.createdAt,
    updated_at: new Date().toISOString(),
  });
}

function mapProductionAxis(status: string): OrderProdAxis {
  if (status === '생산완료' || status === '입고완료') return 'produced';
  if (status === '생산중' || status === '진행중' || status === '진행') return 'in_progress';
  return 'ordered';
}

function deriveDisplayStatus(
  production: OrderProdAxis,
  receipt: OrderReceiptAxis,
  payment: OrderPaymentAxis,
): OrderDisplayStatus {
  if (payment === 'paid') return '결제완료';
  if (payment === 'resolution') return '지출결의';
  if (receipt === 'complete') return '입고완료';
  if (receipt === 'advance') return '선입고';
  if (receipt === 'partial') return '부분입고';
  if (production === 'produced') return '생산완료';
  if (production === 'in_progress') return '진행중';
  return '발주';
}

export type BoardOrderInput = {
  id: string;
  orderNo: string;
  styleNo: string;
  styleName: string;
  revision?: number;
  isReorder?: boolean;
  brandBatchId?: string;
  orderDate?: string;
  createdAt?: string;
  qty: number;
  status: string;
  colorQtys?: ColorQty[];
  vendorId?: string;
  vendorName?: string;
  workspace?: Workspace;
  projectNo?: string;
  factoryUnitPriceKrw?: number;
};

export function buildOrderReceiptSummary(orderId: string, orderQty: number) {
  const logs = getAll<ReceiptLog>(KEYS.receiptLogs).filter(r => r.orderId === orderId);
  const inbound = logs.filter(l => l.logType === 'inbound');
  const outbound = logs.filter(l => l.logType === 'outbound_oem' || l.logType === 'outbound_3pl');
  const receivedQty = inbound.reduce((s, l) => s + l.qty, 0);
  const defectQty = inbound.reduce((s, l) => s + l.defectQty, 0);
  const shippedQty = outbound.reduce((s, l) => s + l.qty, 0);
  const advanceQty = inbound.filter(l => l.isAdvance).reduce((s, l) => s + l.qty, 0);
  const byDestination: Record<ReceiptDestination, number> = { korea: 0, china: 0 };
  const byColor: Record<string, number> = {};
  const advanceByColor: Record<string, number> = {};
  inbound.forEach(l => {
    if (l.destination) byDestination[l.destination] += l.qty;
    const c = (l.color || '').trim() || '(미배정)';
    byColor[c] = (byColor[c] || 0) + l.qty;
    if (l.isAdvance) advanceByColor[c] = (advanceByColor[c] || 0) + l.qty;
  });
  return {
    receivedQty,
    defectQty,
    shippedQty,
    remaining: Math.max(0, orderQty - receivedQty),
    advanceQty,
    byDestination,
    byColor,
    advanceByColor,
    logs,
  };
}

function paymentAxisForOrder(orderId: string): OrderPaymentAxis {
  const pays = getAll<Payable>(KEYS.payables).filter(p => p.orderId === orderId);
  if (pays.length === 0) return 'none';
  if (pays.every(p => p.status === 'paid')) return 'paid';
  return 'resolution';
}

export const phase1 = {
  getProjects: () => getAll<Project>(KEYS.projects),
  getProjectByNo: (no: string) => getAll<Project>(KEYS.projects).find(p => p.projectNo === no),

  getReceiptLogs: () => getAll<ReceiptLog>(KEYS.receiptLogs),
  getReceiptLogsByOrder: (orderId: string) =>
    getAll<ReceiptLog>(KEYS.receiptLogs).filter(r => r.orderId === orderId),
  addReceiptLog: (v: Omit<ReceiptLog, 'id' | 'createdAt'>) => {
    const log: ReceiptLog = { ...v, id: uid(), createdAt: new Date().toISOString() };
    const a = getAll<ReceiptLog>(KEYS.receiptLogs);
    a.push(log);
    setAll(KEYS.receiptLogs, a);
    syncReceiptLog(log).catch(() => {});
    return log;
  },

  getDefectCarryovers: () => getAll<DefectCarryover>(KEYS.defectCarryovers),
  addDefectCarryover: (v: Omit<DefectCarryover, 'id' | 'createdAt' | 'status'>) => {
    const row: DefectCarryover = { ...v, id: uid(), status: 'pending', createdAt: new Date().toISOString() };
    const a = getAll<DefectCarryover>(KEYS.defectCarryovers);
    a.push(row);
    setAll(KEYS.defectCarryovers, a);
    syncDefect(row).catch(() => {});
    return row;
  },
  applyDefectCarryover: (id: string, statementId: string) => {
    const a = getAll<DefectCarryover>(KEYS.defectCarryovers);
    const i = a.findIndex(x => x.id === id);
    if (i >= 0) {
      a[i] = { ...a[i], status: 'applied', appliedStatementId: statementId };
      setAll(KEYS.defectCarryovers, a);
    }
  },

  getPayables: () => getAll<Payable>(KEYS.payables),
  addPayable: (v: Omit<Payable, 'id' | 'createdAt' | 'paidAmountKrw' | 'status'>) => {
    const row: Payable = {
      ...v,
      id: uid(),
      paidAmountKrw: 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    const a = getAll<Payable>(KEYS.payables);
    a.push(row);
    setAll(KEYS.payables, a);
    syncPayable(row).catch(() => {});
    return row;
  },
  recordPayablePayment: (id: string, amount: number) => {
    const a = getAll<Payable>(KEYS.payables);
    const i = a.findIndex(x => x.id === id);
    if (i < 0) return;
    const paid = (a[i].paidAmountKrw || 0) + amount;
    const status: PayableStatus =
      paid >= a[i].amountKrw ? 'paid' : paid > 0 ? 'partial' : 'pending';
    a[i] = { ...a[i], paidAmountKrw: paid, status };
    setAll(KEYS.payables, a);
    syncPayable(a[i]).catch(() => {});
  },

  /** 자재구매 → 지출결의 (Expense 대신 Payable). 동일 purchaseItem 중복 방지 */
  createPayableFromPurchase: (item: {
    id: string;
    orderId?: string;
    orderNo?: string;
    itemName?: string;
    amountKrw: number;
    vendorId?: string;
    vendorName?: string;
    purchaseDate?: string;
    projectNo?: string;
    styleNo?: string;
  }): Payable | null => {
    if (item.amountKrw <= 0) return null;
    const existing = getAll<Payable>(KEYS.payables).find(p =>
      p.sourceType === 'purchase' && p.sourceId === item.id,
    );
    if (existing) return existing;
    return phase1.addPayable({
      vendorId: item.vendorId,
      vendorName: item.vendorName || '자재거래처',
      projectNo: item.projectNo,
      sourceType: 'purchase',
      sourceId: item.id,
      amountKrw: Math.round(item.amountKrw),
      dueDate: (item.purchaseDate || new Date().toISOString()).slice(0, 10),
      memo: `자재구매 · ${item.orderNo || ''}${item.itemName ? ` · ${item.itemName}` : ''}`.trim(),
      orderId: item.orderId,
      orderNo: item.orderNo,
      styleNo: item.styleNo,
    });
  },

  /** OEM 등 생산발주 공장비 → 지출결의 */
  createPayableFromProcessingOrder: (order: {
    id: string;
    orderNo?: string;
    styleNo?: string;
    styleName?: string;
    qty?: number;
    factoryUnitPriceKrw?: number;
    vendorId?: string;
    vendorName?: string;
    projectNo?: string;
    receivedDate?: string;
  }, amountKrw?: number): Payable | null => {
    const amt = amountKrw ?? Math.round((order.factoryUnitPriceKrw || 0) * (order.qty || 0));
    if (amt <= 0) return null;
    const existing = getAll<Payable>(KEYS.payables).find(p =>
      p.sourceType === 'processing' && (p.sourceId === order.id || p.orderId === order.id),
    );
    if (existing) return existing;
    return phase1.addPayable({
      vendorId: order.vendorId,
      vendorName: order.vendorName || '공장',
      projectNo: order.projectNo,
      sourceType: 'processing',
      sourceId: order.id,
      amountKrw: amt,
      dueDate: (order.receivedDate || new Date().toISOString()).slice(0, 10),
      memo: `임가공 · ${order.orderNo || ''} · ${order.styleName || order.styleNo || ''}`.trim(),
      payeeType: 'factory_direct',
      orderId: order.id,
      orderNo: order.orderNo,
      styleNo: order.styleNo,
    });
  },

  getBrandBatches: (workspace?: 'LUMEN' | 'AETALOOP') => {
    const batches = getAll<BrandOrderBatch>(KEYS.brandBatches);
    const lines = getAll<BrandOrderLine>(KEYS.brandLines);
    return batches
      .filter(b => !workspace || b.workspace === workspace)
      .map(b => ({ ...b, lines: lines.filter(l => l.batchId === b.id) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  getBrandBatch: (id: string) => phase1.getBrandBatches().find(b => b.id === id),

  createBrandBatch: (workspace: 'LUMEN' | 'AETALOOP', title: string, weekLabel?: string, createdBy?: string) => {
    const projectNo = generateProjectNo(workspace);
    ensureProject(projectNo, workspace, title);
    const batch: BrandOrderBatch = {
      id: uid(),
      workspace,
      projectNo,
      title,
      weekLabel,
      status: 'draft',
      approvalStep: 1,
      lines: [],
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const a = getAll<BrandOrderBatch>(KEYS.brandBatches);
    a.push(batch);
    setAll(KEYS.brandBatches, a);
    syncBrandBatch(batch).catch(() => {});
    return batch;
  },

  updateBrandBatch: (id: string, u: Partial<BrandOrderBatch>) => {
    const a = getAll<BrandOrderBatch>(KEYS.brandBatches);
    const i = a.findIndex(x => x.id === id);
    if (i < 0) return;
    a[i] = { ...a[i], ...u, updatedAt: new Date().toISOString() };
    setAll(KEYS.brandBatches, a);
    syncBrandBatch(a[i]).catch(() => {});
  },

  addBrandLine: (batchId: string, line: Omit<BrandOrderLine, 'id' | 'batchId'>) => {
    const row: BrandOrderLine = { ...line, id: uid(), batchId };
    const a = getAll<BrandOrderLine>(KEYS.brandLines);
    a.push(row);
    setAll(KEYS.brandLines, a);
    syncBrandLine(row).catch(() => {});
    return row;
  },
  deleteBrandLine: (id: string) => {
    setAll(KEYS.brandLines, getAll<BrandOrderLine>(KEYS.brandLines).filter(l => l.id !== id));
  },

  submitBrandBatch: (batchId: string, actorName: string) => {
    phase1.addApprovalLog(batchId, 1, 'submit', actorName, '발주 제출');
    phase1.updateBrandBatch(batchId, { status: 'in_approval', approvalStep: 2 });
  },

  approveBrandStep: (batchId: string, step: number, actorName: string, comment?: string) => {
    phase1.addApprovalLog(batchId, step, 'approve', actorName, comment);
    const batch = getAll<BrandOrderBatch>(KEYS.brandBatches).find(b => b.id === batchId);
    if (!batch) return;
    if (step >= 6) {
      phase1.updateBrandBatch(batchId, { status: 'approved', approvalStep: 6 });
    } else {
      phase1.updateBrandBatch(batchId, { approvalStep: step + 1 });
    }
  },

  rejectBrandStep: (batchId: string, step: number, actorName: string, comment: string) => {
    phase1.addApprovalLog(batchId, step, 'reject', actorName, comment);
    phase1.updateBrandBatch(batchId, { status: 'draft', approvalStep: step });
  },

  addApprovalLog: (batchId: string, step: number, action: ApprovalLog['action'], actorName: string, comment?: string) => {
    const log: ApprovalLog = {
      id: uid(),
      batchId,
      step,
      action,
      actorName,
      comment,
      createdAt: new Date().toISOString(),
    };
    const a = getAll<ApprovalLog>(KEYS.approvalLogs);
    a.push(log);
    setAll(KEYS.approvalLogs, a);
    syncApprovalLog(log).catch(() => {});
    return log;
  },

  getApprovalLogs: (batchId: string) =>
    getAll<ApprovalLog>(KEYS.approvalLogs).filter(l => l.batchId === batchId),

  /** 승인 완료 배치 → 생산발주 자동 생성 */
  splitBrandBatchToOrders: (
    batchId: string,
    createOrder: (order: Record<string, unknown>) => void,
    vendors: { id: string; name: string }[],
  ) => {
    const batch = phase1.getBrandBatch(batchId);
    if (!batch || batch.status !== 'approved') return [];
    const created: string[] = [];
    for (const line of batch.lines) {
      const qty = line.qty || line.colorQtys.reduce((s, c) => s + c.qty, 0);
      const factory = vendors.find(v => v.id === line.factoryId);
      const orderNo = `${line.styleNo}-R1`;
      createOrder({
        id: uid(),
        orderNo,
        styleId: line.styleNo,
        styleNo: line.styleNo,
        styleName: line.styleName,
        qty,
        colorQtys: line.colorQtys,
        vendorId: line.factoryId || '',
        vendorName: factory?.name || line.factoryName || '',
        projectNo: batch.projectNo,
        workspace: batch.workspace,
        productionOrigin: line.productionOrigin,
        isEmployeePurchase: line.isEmployeePurchase,
        brandBatchId: batch.id,
        status: '발주생성',
        hqSupplyItems: [],
        attachments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      created.push(orderNo);
    }
    phase1.updateBrandBatch(batchId, { status: 'split' });
    return created;
  },

  getOrderReceiptSummary: (orderId: string, orderQty: number) =>
    buildOrderReceiptSummary(orderId, orderQty),

  /** 리오더·오더관리: 스타일별 차수 보드 */
  getReorderOrderBoard: (
    orders: BoardOrderInput[],
    workspace?: 'LUMEN' | 'AETALOOP',
    items?: { styleNo: string; name?: string; erpCategory?: string }[],
  ): ReorderOrderBoardGroup[] => {
    const itemMap = new Map((items || []).map(i => [i.styleNo, i]));
    const filtered = orders.filter(o => {
      if (workspace && o.workspace && o.workspace !== workspace) return false;
      // 브랜드 워크스페이스: 리오더·브랜드 분할·LUMEN/AETALOOP
      if (workspace) {
        return !!(o.isReorder || o.brandBatchId || o.workspace === workspace);
      }
      return true;
    });
    const byStyle = new Map<string, BoardOrderInput[]>();
    filtered.forEach(o => {
      const list = byStyle.get(o.styleNo) || [];
      list.push(o);
      byStyle.set(o.styleNo, list);
    });
    const groups: ReorderOrderBoardGroup[] = [];
    byStyle.forEach((list, styleNo) => {
      const item = itemMap.get(styleNo);
      const rows: ReorderOrderRow[] = list
        .map(o => {
          const sum = buildOrderReceiptSummary(o.id, o.qty);
          const productionStatus = mapProductionAxis(o.status);
          let receiptStatus: OrderReceiptAxis = 'none';
          if (sum.receivedQty <= 0) receiptStatus = 'none';
          else if (sum.remaining <= 0) receiptStatus = 'complete';
          else if (sum.advanceQty > 0 && sum.receivedQty === sum.advanceQty) receiptStatus = 'advance';
          else receiptStatus = 'partial';
          const paymentStatus = paymentAxisForOrder(o.id);
          const displayStatus = deriveDisplayStatus(productionStatus, receiptStatus, paymentStatus);

          const orderedColors = (o.colorQtys && o.colorQtys.length > 0)
            ? o.colorQtys.map(c => ({ color: c.color.trim() || '(미지정)', qty: c.qty }))
            : [{ color: '(미지정)', qty: o.qty }];
          const colorSet = new Set(orderedColors.map(c => c.color));
          Object.keys(sum.byColor).forEach(c => colorSet.add(c));
          const qtyByOrdered = new Map(orderedColors.map(c => [c.color, c.qty]));
          const colorLines: ReorderColorBreakdown[] = [...colorSet].map(color => {
            const qty = qtyByOrdered.get(color) || 0;
            const received = sum.byColor[color] || 0;
            const advance = sum.advanceByColor[color] || 0;
            return {
              color,
              qty,
              receivedQty: received,
              advanceQty: advance,
              remaining: Math.max(0, qty - received),
            };
          }).sort((a, b) => a.color.localeCompare(b.color));

          return {
            orderId: o.id,
            orderNo: o.orderNo,
            styleNo: o.styleNo,
            styleName: o.styleName || item?.name || o.styleNo,
            revision: o.revision || 1,
            orderDate: (o.orderDate || o.createdAt || '').slice(0, 10),
            qty: o.qty,
            advanceQty: sum.advanceQty,
            receivedQty: sum.receivedQty,
            remaining: sum.remaining,
            erpCategory: item?.erpCategory,
            colorQtys: o.colorQtys,
            colorLines,
            vendorId: o.vendorId,
            vendorName: o.vendorName,
            workspace: o.workspace,
            projectNo: o.projectNo,
            factoryUnitPriceKrw: o.factoryUnitPriceKrw,
            orderStatus: o.status,
            productionStatus,
            receiptStatus,
            paymentStatus,
            displayStatus,
            isComplete: sum.remaining <= 0,
          };
        })
        .sort((a, b) => a.revision - b.revision || a.orderDate.localeCompare(b.orderDate));
      groups.push({
        styleNo,
        styleName: rows[0]?.styleName || item?.name || styleNo,
        erpCategory: item?.erpCategory,
        rows,
      });
    });
    return groups.sort((a, b) => a.styleNo.localeCompare(b.styleNo));
  },

  /** 중국법인 거래처 조회 (UI에서 store vendors와 함께 사용) */
  getChinaCorpPayeeHint: () => ({
    code: CHINA_CORP_VENDOR_CODE,
    name: CHINA_CORP_VENDOR_NAME,
  }),

  /** 입고 로그 → 지출결의(payable) 초안. 동일 receiptLogId 중복 방지 */
  createPayableFromReceipt: (
    log: ReceiptLog,
    opts: {
      unitPriceKrw: number;
      factoryVendorId?: string;
      factoryVendorName?: string;
      chinaCorpVendorId?: string;
      chinaCorpVendorName?: string;
    },
  ): Payable | null => {
    const existing = getAll<Payable>(KEYS.payables).find(p =>
      (p.receiptLogIds || []).includes(log.id) || p.sourceId === log.id,
    );
    if (existing) return existing;
    if (log.logType !== 'inbound' || log.qty <= 0) return null;
    const dest = log.destination || 'korea';
    const payeeType: PayablePayeeType = dest === 'china' ? 'china_corp' : 'factory_direct';
    const vendorId = payeeType === 'china_corp'
      ? (opts.chinaCorpVendorId || '')
      : (opts.factoryVendorId || '');
    const vendorName = payeeType === 'china_corp'
      ? (opts.chinaCorpVendorName || CHINA_CORP_VENDOR_NAME)
      : (opts.factoryVendorName || '공장');
    const amountKrw = Math.round((opts.unitPriceKrw || 0) * log.qty);
    return phase1.addPayable({
      vendorId: vendorId || undefined,
      vendorName,
      projectNo: log.projectNo,
      sourceType: 'order_receipt',
      sourceId: log.id,
      amountKrw,
      dueDate: new Date().toISOString().slice(0, 10),
      memo: `${dest === 'china' ? '중국입고' : '한국입고'} · ${log.orderNo}${log.color ? ` · ${log.color}` : ''} · ${log.qty}pcs${log.isAdvance ? ' (선입)' : ''}`,
      payeeType,
      orderId: log.orderId,
      orderNo: log.orderNo,
      styleNo: undefined,
      color: log.color,
      receiptLogIds: [log.id],
    });
  },

  /** 오더에 미결의 입고건 일괄 지출결의 */
  createPayablesForOrderReceipts: (
    orderId: string,
    opts: {
      unitPriceKrw: number;
      factoryVendorId?: string;
      factoryVendorName?: string;
      chinaCorpVendorId?: string;
      chinaCorpVendorName?: string;
    },
  ) => {
    const logs = phase1.getReceiptLogsByOrder(orderId).filter(l => l.logType === 'inbound');
    return logs
      .map(log => phase1.createPayableFromReceipt(log, opts))
      .filter((p): p is Payable => !!p);
  },

  getChinaStockMoves: (workspace?: 'LUMEN' | 'AETALOOP') => {
    const all = getAll<ChinaStockMove>(KEYS.chinaStockMoves)
      .sort((a, b) => b.moveDate.localeCompare(a.moveDate) || b.createdAt.localeCompare(a.createdAt));
    return workspace ? all.filter(m => m.workspace === workspace) : all;
  },

  getChinaStockBalances: (workspace?: 'LUMEN' | 'AETALOOP'): ChinaStockBalance[] => {
    const moves = phase1.getChinaStockMoves(workspace);
    const map = new Map<string, ChinaStockBalance>();
    moves.forEach(m => {
      const key = `${m.workspace}::${m.styleNo}::${m.color}`;
      const row = map.get(key) || {
        workspace: m.workspace,
        styleNo: m.styleNo,
        styleName: m.styleName || m.styleNo,
        color: m.color,
        onHand: 0,
        inboundQty: 0,
        outboundQty: 0,
      };
      if (m.styleName) row.styleName = m.styleName;
      if (m.moveType === 'inbound') {
        row.onHand += m.qty;
        row.inboundQty += m.qty;
      } else if (m.moveType === 'outbound') {
        row.onHand -= m.qty;
        row.outboundQty += m.qty;
      } else {
        // adjust: qty can be signed via memo convention — store signed in qty for adjust
        row.onHand += m.qty;
        if (m.qty >= 0) row.inboundQty += m.qty;
        else row.outboundQty += Math.abs(m.qty);
      }
      map.set(key, row);
    });
    return [...map.values()]
      .filter(r => r.onHand !== 0 || r.inboundQty > 0 || r.outboundQty > 0)
      .sort((a, b) => a.styleNo.localeCompare(b.styleNo) || a.color.localeCompare(b.color));
  },

  addChinaStockMove: (input: Omit<ChinaStockMove, 'id' | 'createdAt'>) => {
    const color = (input.color || '').trim();
    if (!input.styleNo.trim() || !color) return null;
    if (!input.qty || input.qty === 0) return null;
    if (input.moveType === 'outbound' && input.qty < 0) return null;
    const move: ChinaStockMove = {
      ...input,
      styleNo: input.styleNo.trim(),
      color,
      qty: input.moveType === 'adjust' ? input.qty : Math.abs(input.qty),
      id: uid(),
      createdAt: new Date().toISOString(),
    };
    if (move.moveType === 'outbound') {
      const bal = phase1.getChinaStockBalances(move.workspace)
        .find(b => b.styleNo === move.styleNo && b.color === move.color);
      if ((bal?.onHand || 0) < move.qty) return null;
    }
    const a = getAll<ChinaStockMove>(KEYS.chinaStockMoves);
    a.push(move);
    setAll(KEYS.chinaStockMoves, a);
    return move;
  },

  /** 중국입고 receipt → 중국창고 장부 (동일 receiptLogId 중복 방지) */
  postChinaInboundFromReceipt: (
    log: ReceiptLog,
    opts: {
      workspace: 'LUMEN' | 'AETALOOP';
      styleNo: string;
      styleName?: string;
      color: string;
    },
  ): ChinaStockMove | null => {
    if (log.logType !== 'inbound' || log.destination !== 'china') return null;
    const color = (opts.color || log.color || '').trim();
    if (!color || log.qty <= 0) return null;
    const existing = getAll<ChinaStockMove>(KEYS.chinaStockMoves)
      .find(m => m.receiptLogId === log.id);
    if (existing) return existing;
    return phase1.addChinaStockMove({
      workspace: opts.workspace,
      styleNo: opts.styleNo,
      styleName: opts.styleName,
      color,
      qty: log.qty,
      moveType: 'inbound',
      moveDate: log.receivedDate,
      orderId: log.orderId,
      orderNo: log.orderNo,
      receiptLogId: log.id,
      memo: log.memo || `중국입고${log.isAdvance ? ' (선입)' : ''}`,
    });
  },

  getCampaigns: (workspace?: 'LUMEN' | 'AETALOOP') => {
    seedCampaignsIfEmpty();
    let all = getAll<Campaign>(KEYS.campaigns).map(migrateCampaignTasks);
    const migrated = all.some((c, i) => c !== getAll<Campaign>(KEYS.campaigns)[i]);
    if (migrated) setAll(KEYS.campaigns, all);
    return workspace ? all.filter(c => c.workspace === workspace) : all;
  },

  getCampaign: (id: string) => {
    const c = phase1.getCampaigns().find(x => x.id === id);
    return c ? migrateCampaignTasks(c) : undefined;
  },

  addCampaign: (v: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'tasks'> & { tasks?: CampaignTask[] }) => {
    const status = v.status ?? 'draft';
    const tasks = buildCampaignProjectTasks(v.startDate, v.tasks || []);
    const row: Campaign = migrateCampaignTasks({
      ...v,
      status,
      tasks,
      id: uid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const a = getAll<Campaign>(KEYS.campaigns);
    a.push(row);
    setAll(KEYS.campaigns, a);
    return row;
  },

  onboardCampaign: (id: string) => {
    const c = phase1.getCampaign(id);
    if (!c) return;
    phase1.updateCampaign(id, {
      status: c.status === 'draft' ? 'onboarded' : c.status,
      // 자동 템플릿 생성 없음 — 직접 추가한 업무만 유지
      tasks: buildCampaignProjectTasks(c.startDate, c.tasks),
    });
  },

  updateCampaign: (id: string, u: Partial<Campaign>) => {
    const a = getAll<Campaign>(KEYS.campaigns);
    const i = a.findIndex(x => x.id === id);
    if (i < 0) return;
    const next = { ...a[i], ...u, updatedAt: new Date().toISOString() };
    if (u.tasks) {
      next.tasks = buildCampaignProjectTasks(next.startDate, u.tasks);
    }
    a[i] = migrateCampaignTasks(next);
    setAll(KEYS.campaigns, a);
  },

  updateCampaignTask: (campaignId: string, taskId: string, patch: Partial<CampaignTask>) => {
    const a = getAll<Campaign>(KEYS.campaigns);
    const i = a.findIndex(x => x.id === campaignId);
    if (i < 0) return;
    const tasks = a[i].tasks.map(t => {
      if (t.id !== taskId) return t;
      const done = patch.done ?? t.done;
      return normalizeTask({
        ...t,
        ...patch,
        done,
        status: patch.status ?? (done ? 'done' : t.status === 'done' ? 'todo' : t.status),
      });
    });
    a[i] = { ...a[i], tasks, updatedAt: new Date().toISOString() };
    setAll(KEYS.campaigns, a);
  },

  addCampaignTask: (
    campaignId: string,
    input: { team: string; label: string; assignee?: string; dueDate?: string; detail?: string },
  ) => {
    const a = getAll<Campaign>(KEYS.campaigns);
    const i = a.findIndex(x => x.id === campaignId);
    if (i < 0) return;
    const label = input.label.trim();
    if (!label) return;
    const task = normalizeTask({
      team: input.team,
      label,
      assignee: input.assignee?.trim() || '',
      dueDate: input.dueDate || undefined,
      detail: input.detail || '',
      done: false,
      status: 'todo',
    });
    a[i] = {
      ...a[i],
      tasks: [...a[i].tasks, task],
      updatedAt: new Date().toISOString(),
    };
    setAll(KEYS.campaigns, a);
  },

  deleteCampaignTask: (campaignId: string, taskId: string) => {
    const a = getAll<Campaign>(KEYS.campaigns);
    const i = a.findIndex(x => x.id === campaignId);
    if (i < 0) return;
    a[i] = {
      ...a[i],
      tasks: a[i].tasks.filter(t => t.id !== taskId),
      updatedAt: new Date().toISOString(),
    };
    setAll(KEYS.campaigns, a);
  },

  addCampaignTaskMessage: (
    campaignId: string,
    taskId: string,
    input: {
      authorName: string;
      authorId?: string;
      text: string;
      mentions: string[];
      askCheck: boolean;
    },
  ) => {
    const a = getAll<Campaign>(KEYS.campaigns);
    const i = a.findIndex(x => x.id === campaignId);
    if (i < 0) return;
    const text = input.text.trim();
    if (!text) return;
    const msgId = uid();
    const now = new Date().toISOString();
    const message: CampaignTaskMessage = {
      id: msgId,
      authorName: input.authorName,
      authorId: input.authorId,
      text,
      mentions: input.mentions,
      askCheck: input.askCheck && input.mentions.length > 0,
      createdAt: now,
    };
    const newChecks: CampaignTaskCheck[] = message.askCheck
      ? input.mentions.map(name => ({
          id: uid(),
          messageId: msgId,
          targetName: name,
          checked: false,
        }))
      : [];
    a[i] = {
      ...a[i],
      tasks: a[i].tasks.map(t => {
        if (t.id !== taskId) return t;
        return normalizeTask({
          ...t,
          messages: [...(t.messages || []), message],
          checks: [...(t.checks || []), ...newChecks],
        });
      }),
      updatedAt: now,
    };
    setAll(KEYS.campaigns, a);
  },

  toggleCampaignTaskCheck: (
    campaignId: string,
    taskId: string,
    checkId: string,
    checkerName: string,
  ) => {
    const a = getAll<Campaign>(KEYS.campaigns);
    const i = a.findIndex(x => x.id === campaignId);
    if (i < 0) return;
    const now = new Date().toISOString();
    a[i] = {
      ...a[i],
      tasks: a[i].tasks.map(t => {
        if (t.id !== taskId) return t;
        return normalizeTask({
          ...t,
          checks: (t.checks || []).map(c => {
            if (c.id !== checkId) return c;
            const checked = !c.checked;
            return {
              ...c,
              checked,
              checkedAt: checked ? now : undefined,
              checkedBy: checked ? checkerName : undefined,
            };
          }),
        });
      }),
      updatedAt: now,
    };
    setAll(KEYS.campaigns, a);
  },

  toggleCampaignTask: (campaignId: string, taskId: string) => {
    const c = phase1.getCampaign(campaignId);
    if (!c) return;
    const t = c.tasks.find(x => x.id === taskId);
    if (!t) return;
    phase1.updateCampaignTask(campaignId, taskId, { done: !t.done });
  },

  getCampaignProgress: (c: Campaign) => {
    if (!c.tasks.length) return 0;
    return Math.round((c.tasks.filter(t => t.done).length / c.tasks.length) * 100);
  },

  getCampaignTeamProgress: (c: Campaign, team: string) => {
    const teamTasks = c.tasks.filter(t => t.team === team);
    if (!teamTasks.length) return 0;
    return Math.round((teamTasks.filter(t => t.done).length / teamTasks.length) * 100);
  },

  getCampaignTasksByTeam: (c: Campaign, team: string) => c.tasks.filter(t => t.team === team),

  getProjectPL: (key: string) => {
    type OrderRow = {
      id?: string; orderNo?: string; styleNo?: string; styleName?: string;
      projectNo?: string; qty?: number; factoryUnitPriceKrw?: number; receivedQty?: number;
      colorQtys?: Array<{ color: string; qty: number }>;
    };
    type PurchaseRow = {
      id?: string; orderId?: string; orderNo?: string; projectNo?: string; styleNo?: string;
      amountKrw?: number; statementNo?: string;
    };
    type StatementRow = {
      projectNo?: string; orderNo?: string; orderId?: string;
      lines?: Array<{ qty: number; unitPrice: number; taxRate?: number }>;
    };
    const orders = JSON.parse(localStorage.getItem('ames_orders') || '[]') as OrderRow[];
    const statements = JSON.parse(localStorage.getItem('ames_trade_statements') || '[]') as StatementRow[];
    const purchases = JSON.parse(localStorage.getItem('ames_purchases') || '[]') as PurchaseRow[];
    // 손익 키 = 발주번호(우선). 브랜드 배치용 legacy project_no도 허용
    const projOrders = orders.filter(o =>
      o.orderNo === key || o.projectNo === key,
    );
    const orderIds = new Set(projOrders.map(o => o.id).filter(Boolean) as string[]);
    const orderNos = new Set(projOrders.map(o => o.orderNo).filter(Boolean) as string[]);
    const projectNos = new Set(
      [key, ...projOrders.map(o => o.projectNo).filter(Boolean) as string[]],
    );
    const projStatements = statements.filter(s =>
      (!!s.orderNo && orderNos.has(s.orderNo))
      || (!!s.orderId && orderIds.has(s.orderId))
      || (!!s.projectNo && projectNos.has(s.projectNo)),
    );
    const projPurchases = purchases.filter(p =>
      (!!p.orderId && orderIds.has(p.orderId))
      || (!!p.orderNo && orderNos.has(p.orderNo))
      || (!!p.projectNo && projectNos.has(p.projectNo)),
    );
    const payables = getAll<Payable>(KEYS.payables).filter(p =>
      (!!p.orderId && orderIds.has(p.orderId))
      || (!!p.orderNo && orderNos.has(p.orderNo))
      || (!!p.projectNo && projectNos.has(p.projectNo)),
    );
    const purchasePays = payables.filter(p => p.sourceType === 'purchase');
    const factoryPays = payables.filter(p =>
      p.sourceType === 'processing' || p.sourceType === 'order_receipt',
    );

    const bomCost = projOrders.reduce((s, o) => s + (o.factoryUnitPriceKrw || 0) * (o.qty || 0), 0);
    const estimatedFactory = projOrders.reduce(
      (s, o) => s + (o.factoryUnitPriceKrw || 0) * (o.receivedQty || o.qty || 0), 0,
    );
    const payableFactory = factoryPays.reduce((s, p) => s + (p.amountKrw || 0), 0);
    const actualCost = payableFactory > 0 ? payableFactory : estimatedFactory;
    const revenue = projStatements.reduce((s, st) =>
      s + (st.lines || []).reduce((ls, l) => ls + l.qty * l.unitPrice * (1 + (l.taxRate ?? 0)), 0), 0);
    const purchaseFromItems = projPurchases.reduce((s, p) => s + (p.amountKrw || 0), 0);
    const purchaseFromPays = purchasePays.reduce((s, p) => s + (p.amountKrw || 0), 0);
    // 자재: 구매이력 우선, 없으면 지출결의
    const purchaseCost = purchaseFromItems > 0 ? purchaseFromItems : purchaseFromPays;

    const byStyleColor = projOrders.flatMap(o => {
      const colors = (o.colorQtys && o.colorQtys.length > 0)
        ? o.colorQtys.filter(c => (c.qty || 0) > 0)
        : [{ color: '(전체)', qty: o.qty || 0 }];
      const totalColorQty = colors.reduce((s, c) => s + (c.qty || 0), 0) || 1;
      const orderMatItems = projPurchases.filter(p =>
        (p.orderId && p.orderId === o.id) || (p.orderNo && p.orderNo === o.orderNo),
      );
      const orderMatPays = purchasePays.filter(p =>
        (p.orderId && p.orderId === o.id) || (p.orderNo && p.orderNo === o.orderNo),
      );
      const matBase = orderMatItems.reduce((s, p) => s + (p.amountKrw || 0), 0)
        || orderMatPays.reduce((s, p) => s + (p.amountKrw || 0), 0);
      const orderFactPays = factoryPays.filter(p =>
        (p.orderId && p.orderId === o.id) || (p.orderNo && p.orderNo === o.orderNo),
      );
      const factBase = orderFactPays.length
        ? orderFactPays.reduce((s, p) => s + (p.amountKrw || 0), 0)
        : (o.factoryUnitPriceKrw || 0) * (o.receivedQty || o.qty || 0);

      return colors.map(cq => {
        const w = (cq.qty || 0) / totalColorQty;
        const colorFact = orderFactPays.filter(p => p.color && p.color === cq.color);
        const factoryCost = colorFact.length
          ? colorFact.reduce((s, p) => s + (p.amountKrw || 0), 0)
          : Math.round(factBase * w);
        const materialCost = Math.round(matBase * w);
        const totalCost = materialCost + factoryCost;
        return {
          orderNo: o.orderNo || '',
          styleNo: o.styleNo || '',
          styleName: o.styleName || '',
          color: cq.color,
          qty: cq.qty || 0,
          materialCost,
          factoryCost,
          totalCost,
        };
      });
    });

    const profit = revenue - actualCost - purchaseCost;
    return {
      bomCost,
      actualCost,
      revenue,
      purchaseCost,
      payableFactory,
      payablePurchase: purchaseFromPays,
      profit,
      orderCount: projOrders.length,
      byStyleColor,
    };
  },
};

async function syncReceiptLog(log: ReceiptLog) {
  await supabase.from('receipt_logs').upsert({
    id: log.id,
    order_id: log.orderId,
    order_no: log.orderNo,
    project_no: log.projectNo,
    log_type: log.logType,
    qty: log.qty,
    defect_qty: log.defectQty,
    defect_note: log.defectNote,
    received_date: log.receivedDate,
    memo: log.memo,
    destination: log.destination,
    color: log.color,
    is_advance: log.isAdvance,
    created_at: log.createdAt,
  });
}

async function syncDefect(d: DefectCarryover) {
  await supabase.from('defect_carryovers').upsert({
    id: d.id,
    style_no: d.styleNo,
    order_no: d.orderNo,
    project_no: d.projectNo,
    vendor_id: d.vendorId,
    vendor_name: d.vendorName,
    amount_krw: d.amountKrw,
    reason: d.reason,
    defect_date: d.defectDate,
    status: d.status,
    applied_statement_id: d.appliedStatementId,
    created_at: d.createdAt,
  });
}

async function syncPayable(p: Payable) {
  await supabase.from('payables').upsert({
    id: p.id,
    vendor_id: p.vendorId,
    vendor_name: p.vendorName,
    project_no: p.projectNo,
    source_type: p.sourceType,
    source_id: p.sourceId,
    amount_krw: p.amountKrw,
    paid_amount_krw: p.paidAmountKrw,
    due_date: p.dueDate,
    status: p.status,
    memo: p.memo,
    payee_type: p.payeeType,
    order_id: p.orderId,
    receipt_log_ids: p.receiptLogIds,
    created_at: p.createdAt,
    updated_at: new Date().toISOString(),
  });
}

async function syncBrandBatch(b: BrandOrderBatch) {
  await supabase.from('brand_order_batches').upsert({
    id: b.id,
    workspace: b.workspace,
    project_no: b.projectNo,
    title: b.title,
    week_label: b.weekLabel,
    status: b.status,
    approval_step: b.approvalStep,
    expected_dely: b.expectedDely,
    dely_requested_to: b.delyRequestedTo,
    created_by: b.createdBy,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  });
}

async function syncBrandLine(l: BrandOrderLine) {
  await supabase.from('brand_order_lines').upsert({
    id: l.id,
    batch_id: l.batchId,
    style_no: l.styleNo,
    style_name: l.styleName,
    color_qtys: l.colorQtys,
    factory_id: l.factoryId,
    factory_name: l.factoryName,
    production_origin: l.productionOrigin,
    is_employee_purchase: l.isEmployeePurchase,
    qty: l.qty,
    memo: l.memo,
  });
}

async function syncApprovalLog(l: ApprovalLog) {
  await supabase.from('approval_logs').upsert({
    id: l.id,
    batch_id: l.batchId,
    step: l.step,
    action: l.action,
    actor_id: l.actorId,
    actor_name: l.actorName,
    comment: l.comment,
    created_at: l.createdAt,
  });
}

/** localStorage → Supabase 일괄 동기화 (정산 테이블) */
export async function migrateLocalToSupabase() {
  const tradeStatements = JSON.parse(localStorage.getItem('ames_trade_statements') || '[]');
  const settlements = JSON.parse(localStorage.getItem('ames_settlements') || '[]');
  const purchases = JSON.parse(localStorage.getItem('ames_purchases') || '[]');
  for (const s of tradeStatements) {
    await supabase.from('trade_statements').upsert({
      id: s.id,
      statement_no: s.statementNo,
      vendor_id: s.vendorId,
      vendor_name: s.vendorName,
      vendor_code: s.vendorCode,
      project_no: s.projectNo,
      workspace: s.workspace,
      issue_date: s.issueDate,
      lines: s.lines,
      status: s.status,
      tax_invoice: s.taxInvoice,
      memo: s.memo,
      created_at: s.createdAt,
    });
  }
  for (const s of settlements) {
    await supabase.from('settlements').upsert({
      id: s.id,
      buyer_id: s.buyerId,
      buyer_name: s.buyerName,
      project_no: s.projectNo,
      workspace: s.workspace,
      channel: s.channel,
      invoice_no: s.invoiceNo,
      invoice_date: s.invoiceDate,
      due_date: s.dueDate,
      billed_amount_krw: s.billedAmountKrw,
      collected_amount_krw: s.collectedAmountKrw,
      collected_date: s.collectedDate,
      status: s.status,
      memo: s.memo,
      created_at: s.createdAt,
    });
  }
  for (const p of purchases) {
    await supabase.from('purchase_items').upsert({
      id: p.id,
      order_id: p.orderId,
      order_no: p.orderNo,
      project_no: p.projectNo,
      purchase_date: p.purchaseDate,
      item_name: p.itemName,
      qty: p.qty,
      unit: p.unit,
      unit_price_cny: p.unitPriceCny,
      currency: p.currency,
      applied_rate: p.appliedRate,
      amount_krw: p.amountKrw,
      vendor_id: p.vendorId,
      vendor_name: p.vendorName,
      payment_method: p.paymentMethod,
      purchase_status: p.purchaseStatus,
      statement_no: p.statementNo,
      memo: p.memo,
      created_at: p.createdAt,
    });
  }
}

/** Supabase → localStorage 복원 */
export async function syncPhase1FromSupabase() {
  const tables: Array<{ table: string; key: string; map: (r: Record<string, unknown>) => unknown }> = [
    {
      table: 'projects',
      key: KEYS.projects,
      map: r => ({
        id: r.id,
        projectNo: r.project_no,
        workspace: r.workspace,
        title: r.title,
        status: r.status,
        createdAt: r.created_at,
      }),
    },
    {
      table: 'receipt_logs',
      key: KEYS.receiptLogs,
      map: r => ({
        id: r.id,
        orderId: r.order_id,
        orderNo: r.order_no,
        projectNo: r.project_no,
        logType: r.log_type,
        qty: r.qty,
        defectQty: r.defect_qty,
        defectNote: r.defect_note,
        receivedDate: r.received_date,
        memo: r.memo,
        createdAt: r.created_at,
      }),
    },
    {
      table: 'defect_carryovers',
      key: KEYS.defectCarryovers,
      map: r => ({
        id: r.id,
        styleNo: r.style_no,
        orderNo: r.order_no,
        projectNo: r.project_no,
        vendorId: r.vendor_id,
        vendorName: r.vendor_name,
        amountKrw: r.amount_krw,
        reason: r.reason,
        defectDate: r.defect_date,
        status: r.status,
        appliedStatementId: r.applied_statement_id,
        createdAt: r.created_at,
      }),
    },
    {
      table: 'payables',
      key: KEYS.payables,
      map: r => ({
        id: r.id,
        vendorId: r.vendor_id,
        vendorName: r.vendor_name,
        projectNo: r.project_no,
        sourceType: r.source_type,
        sourceId: r.source_id,
        amountKrw: r.amount_krw,
        paidAmountKrw: r.paid_amount_krw,
        dueDate: r.due_date,
        status: r.status,
        memo: r.memo,
        createdAt: r.created_at,
      }),
    },
  ];
  for (const { table, key, map } of tables) {
    const { data, error } = await supabase.from(table).select('*');
    if (!error && data?.length) {
      localStorage.setItem(key, JSON.stringify(data.map(map)));
    }
  }
  const { data: batches } = await supabase.from('brand_order_batches').select('*');
  if (batches?.length) {
    localStorage.setItem(KEYS.brandBatches, JSON.stringify(batches.map(r => ({
      id: r.id,
      workspace: r.workspace,
      projectNo: r.project_no,
      title: r.title,
      weekLabel: r.week_label,
      status: r.status,
      approvalStep: r.approval_step,
      expectedDely: r.expected_dely,
      delyRequestedTo: r.dely_requested_to,
      createdBy: r.created_by,
      lines: [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))));
  }
  const { data: lines } = await supabase.from('brand_order_lines').select('*');
  if (lines?.length) {
    localStorage.setItem(KEYS.brandLines, JSON.stringify(lines.map(r => ({
      id: r.id,
      batchId: r.batch_id,
      styleNo: r.style_no,
      styleName: r.style_name,
      colorQtys: r.color_qtys || [],
      factoryId: r.factory_id,
      factoryName: r.factory_name,
      productionOrigin: r.production_origin || 'china',
      isEmployeePurchase: r.is_employee_purchase,
      qty: r.qty,
      memo: r.memo,
    }))));
  }
}
