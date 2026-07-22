// AMESCOTES ERP — 품목 마스터 (대규모 개편)
import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useLocation, useSearch } from 'wouter';
import { calcPostSummary } from '@/lib/costing';
import { nextOrderNo, parseRevision } from '@/lib/orderNo';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { store, genId, formatKRW, normalizeColors, type Item, type ItemColor, type Season, type Category, type ErpCategory, type PackingSize, type ProductionOrder, type ColorQty } from '@/lib/store';
import { fetchItems, upsertItem, upsertBom, deleteItem as deleteItemSB, fetchVendors, fetchBoms, fetchBomsLight, updateItemCostData, saveConfirmedSalePrice, fetchMaterials, fetchOrders } from '@/lib/supabaseQueries';
import { PackBomEditor } from '@/components/PackBomEditor';
import {
  applyPackLinesToBom, createEmptyPackBom, linesFromPackBom, packLinesTotal, type PackBomLine,
} from '@/lib/packBom';
import { seedLumenPackingData, hasPackageKitItems, isLegacyPackConsumable } from '@/lib/seedLumenPacking';
import { seedLumen27ssRrp, hasLumen27ssItems, getLumen27ssProductCount } from '@/lib/seedLumen27ssRrp';
import { parseExcelBomSheet } from '@/lib/bomExcelParser';
import { resizeImage } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { HoverZoomImage } from '@/components/HoverZoomImage';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Pencil, Trash2, Package, Wand2, AlertCircle, X, Palette, BarChart2, Link, ShoppingCart, Printer, Download, Upload, FileSpreadsheet, CheckCircle2, XCircle, Columns3, Factory, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

// ─── 공장 원가표 일괄 업로드 타입 ───
interface BatchCostItem {
  item: Item;
  bom: any | null;
  parsedData?: { materials: any[]; processingFee: number; exchangeRateCny: number; postProcessLines: any[] };
  fileName?: string;
  status: 'pending' | 'ready' | 'saving' | 'done' | 'error';
  errorMsg?: string;
}

// HB 전용 세부 카테고리
const HB_CATEGORIES: Category[] = ['숄더백', '토트백', '크로스백', '클러치', '백팩', '기타'];
// ACC 전용 세부 카테고리
const ACC_CATEGORIES: Category[] = ['파우치', '키링', '지갑', '기타'];
// SHOES 전용 세부 카테고리
const SHOES_CATEGORIES: Category[] = ['스니커즈', '힐', '로퍼', '부츠', '샌들', '기타'];
// PACK 전용 세부 카테고리 (LUMEN·AETALOOP 패키지 키트 — 소모품은 자재마스터)
const PACK_CATEGORIES: Category[] = ['기타', '택배박스', '내부박스', '더스트백', '쇼핑백', '노루지', '소모품'];
const PACKING_SIZES: PackingSize[] = ['SS', 'S', 'M', 'L', 'XL'];

const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS'];

// 카테고리 → 제품유형코드 매핑
const CATEGORY_CODE_MAP: Partial<Record<Category, string>> = {
  '숄더백': 'HB', '토트백': 'HB', '크로스백': 'HB', '클러치': 'HB', '백팩': 'BP',
  '파우치': 'SL', '키링': 'SL', '지갑': 'SL',
  '스니커즈': 'SH', '힐': 'SH', '로퍼': 'SH', '부츠': 'SH', '샌들': 'SH',
  '택배박스': 'PK', '내부박스': 'PK', '더스트백': 'PK', '쇼핑백': 'PK', '노루지': 'PK', '소모품': 'PK',
  '기타': 'ETC',
};

const ERP_CAT_COLOR: Record<ErpCategory, string> = {
  'HB':   'bg-blue-50 text-blue-700 border-blue-200',
  'ACC':  'bg-purple-50 text-purple-700 border-purple-200',
  'SHOES':'bg-green-50 text-green-700 border-green-200',
  'PACK':'bg-amber-50 text-amber-700 border-amber-200',
};

function generateStyleNo(
  brandCode: string,
  registDate: Date,
  category: Category,
  existingItems: Item[],
  currentItemId?: string,
  erpCategory?: ErpCategory
): string {
  const yy = String(registDate.getFullYear()).slice(2);
  const mm = String(registDate.getMonth() + 1).padStart(2, '0');
  // erpCategory별 타입코드 강제 적용
  let typeCode = CATEGORY_CODE_MAP[category] || 'HB';
  if (erpCategory === 'ACC') typeCode = 'AC';
  else if (erpCategory === 'SHOES') typeCode = 'SH';
  else if (erpCategory === 'PACK') typeCode = 'PK';
  else if (erpCategory === 'HB') typeCode = CATEGORY_CODE_MAP[category] || 'HB';
  const prefix = `${brandCode.toUpperCase()}${yy}${mm}${typeCode}`;
  const existing = existingItems.filter(it => it.styleNo.startsWith(prefix) && it.id !== currentItemId);
  let maxSeq = 0;
  for (const it of existing) {
    const seq = parseInt(it.styleNo.slice(prefix.length), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(2, '0')}`;
}

const emptyItem: Partial<Item> = {
  styleNo: '', name: '', nameEn: '', season: '26SS', category: '숄더백',
  erpCategory: 'HB', materialType: '완제품',
  material: '', deliveryPrice: 0,
  colors: [], memo: '',
};

/**
 * 단가 조회용 BOM 라인 전체 목록.
 * 소요량 계산이 아니라 "이 자재의 단가가 얼마였나"만 보므로 전 컬러를 훑어도 된다.
 * (소요량은 반드시 컬러별로 계산해야 한다 — CLAUDE.md)
 */
function bomLinesForPricing(bom: any): Array<{ id?: string; itemName?: string; unitPriceCny?: number; unitPrice?: number }> {
  return [
    ...((bom?.postColorBoms || []).flatMap((cb: any) => cb.lines || [])),
    ...(bom?.postMaterials || []),
    ...((bom?.colorBoms || []).flatMap((cb: any) => cb.lines || [])),
    ...(bom?.lines || []),
  ];
}

// ─── 사후원가 계산 → lib/costing.ts 정본 위임 ───
// 예전엔 여기에 calcPostSummary 복붙본이 있었고, 업체제공 자재를 공장단가에서
// 빼지 않는 등 다른 사본들과 갈라져 있었다. 이제 계산식은 costing.ts에만 있다.
// (반환 형태는 기존 호출부 호환을 위해 그대로 유지)
type BomCostResult = {
  productCost: number; totalCostKrw: number; factoryUnitCostKrw: number;
  logisticsKrw: number; packagingKrw: number; processingKrw: number;
  processingBase: number; processingCur: string; packingKrw: number; marginRate: number;
};

function calcBomCostsFromMaterials(
  bom: any,
  materials: any[],
  processingFee: number,
  postProcLines: any[],
): BomCostResult {
  const postCur = bom.currency || 'CNY';
  if (!materials.some((l: any) => l.itemName || l.unitPriceCny > 0)) {
    return {
      productCost: 0, totalCostKrw: 0, factoryUnitCostKrw: 0, logisticsKrw: 0,
      packagingKrw: 0, processingKrw: 0, processingBase: 0, processingCur: postCur,
      packingKrw: 0, marginRate: 0,
    };
  }
  const ps = calcPostSummary(bom, store.getSettings().usdKrw || 1380, {
    lines: materials,
    processingFee,
    postProcessLines: postProcLines,
  });
  return {
    productCost: Math.round(ps.productCostKrw),
    totalCostKrw: Math.round(ps.finalCostKrw),
    factoryUnitCostKrw: Math.round(ps.factoryUnitCostKrw),
    logisticsKrw: Math.round(bom.logisticsCostKrw || 0),
    packagingKrw: Math.round(bom.packagingCostKrw || 0),
    processingKrw: Math.round(ps.processingKrw),
    processingBase: ps.processingCny,
    processingCur: postCur,
    packingKrw: Math.round(bom.packingCostKrw || 0),
    marginRate: ps.marginRate,
  };
}

function calcBomCosts(bom: any): { productCost: number; totalCostKrw: number; factoryUnitCostKrw: number; logisticsKrw: number; packagingKrw: number; processingKrw: number; processingBase: number; processingCur: string; packingKrw: number; marginRate: number } {
  const ZERO_EXTRA = { logisticsKrw: 0, packagingKrw: 0, processingKrw: 0, processingBase: 0, processingCur: bom.currency || 'CNY', packingKrw: 0, marginRate: 0 };
  if (bom.isSimpleCost && bom.simplePostCostKrw && bom.simplePostCostKrw > 0) {
    const v = Math.round(bom.simplePostCostKrw);
    return { productCost: v, totalCostKrw: v, factoryUnitCostKrw: v, ...ZERO_EXTRA, packingKrw: v };
  }
  const postColorBom = (bom.postColorBoms || []).find((cb: any) =>
    (cb.lines || []).some((l: any) => l.itemName || l.unitPriceCny > 0)
  );
  const materials: any[] = postColorBom
    ? (postColorBom.lines || [])
    : (bom.postMaterials || []);
  if (materials.length === 0) return { productCost: 0, totalCostKrw: 0, factoryUnitCostKrw: 0, ...ZERO_EXTRA };
  const processingCny = postColorBom
    ? (postColorBom.processingFee ?? 0)
    : (bom.postProcessingFee || 0);
  const postProcLines: any[] = postColorBom
    ? (postColorBom.postProcessLines ?? [])
    : (bom.postProcessLines || []);
  return calcBomCostsFromMaterials(bom, materials, processingCny, postProcLines);
}

// 패킹재(PACK) 품목의 단가 산출 — BomManagement.resolvePackItemCostKrw 동일 로직
function resolvePackItemCostKrw(item: any): number {
  const n = Number(
    item?.baseCostKrw
    ?? item?.postCostKrw
    ?? item?.deliveryPrice
    ?? item?.targetSalePrice
    ?? 0,
  );
  return Math.round(n) || 0;
}

type ColorCostRow = {
  color: string;
  productCost: number;
  totalCostKrw: number;
  displayCost: number; // 자사=productCost, OEM=totalCostKrw
  factoryUnitCostKrw: number;
};

/** 품목 컬러 + BOM 컬러 탭 합집합 (표시용, 품목 순서 우선) */
function mergeDisplayColors(item: Item, mergedBom: any, colorCosts: ColorCostRow[]): string[] {
  const fromItem = normalizeColors(item.colors || []).map(c => c.name).filter(Boolean);
  const fromBom = [
    ...((mergedBom?.postColorBoms || []) as any[]).map((t: any) => t.color),
    ...((mergedBom?.colorBoms || []) as any[]).map((t: any) => t.color),
  ].filter((c: string) => c && c !== '기본');
  const fromCosts = colorCosts.map(c => c.color).filter(c => c && !['기본', '전체'].includes(c));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of [...fromItem, ...fromBom, ...fromCosts]) {
    const key = String(n).trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(n).trim());
  }
  return out;
}

/** 품목 hasBom 플래그가 끊겨도 실제 BOM/원가가 있으면 작성 완료로 본다 */
function hasEffectiveBom(
  item: { hasBom?: boolean },
  rd?: { bom?: any; bomCost?: number; colorCosts?: ColorCostRow[] } | null,
): boolean {
  if (item.hasBom) return true;
  if (!rd) return false;
  if (rd.bom) return true;
  if ((rd.bomCost ?? 0) > 0) return true;
  if ((rd.colorCosts || []).some(c => c.displayCost > 0)) return true;
  return false;
}

/** 발주/표시용 — 품목 colors + BOM 컬러를 ItemColor[]로 합침 */
function resolveItemColorsWithBom(item: Item, bom?: any | null): ItemColor[] {
  const fromItem = normalizeColors(item.colors || []);
  const byKey = new Map(fromItem.map(c => [c.name.trim().toUpperCase(), c]));
  const bomNames = [
    ...((bom?.postColorBoms || []) as any[]).map((t: any) => t.color),
    ...((bom?.colorBoms || []) as any[]).map((t: any) => t.color),
  ].filter((c: string) => c && String(c).trim() && c !== '기본');

  const ordered: ItemColor[] = [...fromItem];
  for (const raw of bomNames) {
    const name = String(raw).trim();
    const key = name.toUpperCase();
    if (byKey.has(key)) continue;
    const next = { name };
    byKey.set(key, next);
    ordered.push(next);
  }
  return ordered;
}

function findBomForItem(item: Item): any | null {
  const boms = store.getBoms() as any[];
  return boms.find(b =>
    (item.id && b.styleId === item.id)
    || (item.styleNo && b.styleNo === item.styleNo)
    || (item.styleNo && b.styleNo === item.styleNo.trim())
  ) || null;
}

/** 사후원가 컬러 탭별 원가 (탭 없으면 단일 '기본' 행) */
function calcBomCostsByColor(bom: any, isSelfBrand: boolean): ColorCostRow[] {
  if (!bom) return [];
  if (bom.isSimpleCost && bom.simplePostCostKrw && bom.simplePostCostKrw > 0) {
    const v = Math.round(bom.simplePostCostKrw);
    return [{ color: '전체', productCost: v, totalCostKrw: v, displayCost: v, factoryUnitCostKrw: v }];
  }
  const tabs: any[] = Array.isArray(bom.postColorBoms) ? bom.postColorBoms : [];
  const withData = tabs.filter((cb: any) =>
    (cb.lines || []).some((l: any) => l.itemName || l.unitPriceCny > 0)
  );
  if (withData.length > 0) {
    return withData.map((cb: any) => {
      const r = calcBomCostsFromMaterials(
        bom,
        cb.lines || [],
        cb.processingFee ?? 0,
        cb.postProcessLines ?? [],
      );
      const displayCost = isSelfBrand ? r.productCost : r.totalCostKrw;
      return {
        color: cb.color || '기본',
        productCost: r.productCost,
        totalCostKrw: r.totalCostKrw,
        displayCost,
        factoryUnitCostKrw: r.factoryUnitCostKrw,
      };
    });
  }
  // 구형: postMaterials 단일
  const r = calcBomCosts(bom);
  const displayCost = isSelfBrand ? r.productCost : r.totalCostKrw;
  if (displayCost <= 0 && r.factoryUnitCostKrw <= 0) return [];
  return [{
    color: '기본',
    productCost: r.productCost,
    totalCostKrw: r.totalCostKrw,
    displayCost,
    factoryUnitCostKrw: r.factoryUnitCostKrw,
  }];
}
// 하위 호환용 단순 래퍼 (syncPostCost에서 사용)
function calcBomPostCostKrw(bom: any): number {
  return calcBomCosts(bom).totalCostKrw;
}

// ─── 컬럼 너비 리사이즈 기본값 ───
const ITEM_DEFAULT_COL_WIDTHS: Record<string, number> = {
  image: 60, styleNo: 130, season: 80, buyer: 120, name: 180,
  category: 90, color: 160, delivery: 100, bomCost: 140, factoryCost: 120, processing: 100, logistics: 90, packaging: 100, packing: 130, prodMargin: 90, salePrice: 110, multiple: 80, margin: 90,
  orderCount: 80, cumQty: 90, noOrder: 90, createdAt: 100, bom: 70, action: 70,
};

/** 열 설정 — 공장단가/KMSRP/실현배수/마진율은 기본 숨김 */
const ITEM_COLUMN_DEFS: { key: string; label: string; defaultVisible: boolean }[] = [
  { key: 'image', label: '이미지', defaultVisible: true },
  { key: 'styleNo', label: '스타일번호', defaultVisible: true },
  { key: 'season', label: '시즌', defaultVisible: true },
  { key: 'buyer', label: '바이어', defaultVisible: true },
  { key: 'name', label: '품명', defaultVisible: true },
  { key: 'category', label: '카테고리', defaultVisible: true },
  { key: 'color', label: '컬러', defaultVisible: true },
  { key: 'delivery', label: '납품가(KRW)', defaultVisible: true },
  { key: 'bomCost', label: '총원가액', defaultVisible: true },
  { key: 'factoryCost', label: '공장단가', defaultVisible: false },
  { key: 'processing', label: '임가공비', defaultVisible: false },
  { key: 'logistics', label: '물류비', defaultVisible: false },
  { key: 'packaging', label: '포장/검사비', defaultVisible: false },
  { key: 'packing', label: '패킹재', defaultVisible: false },
  { key: 'prodMargin', label: '생산마진', defaultVisible: false },
  { key: 'salePrice', label: 'KMSRP', defaultVisible: true },
  { key: 'multiple', label: '실현배수', defaultVisible: false },
  { key: 'margin', label: '마진율', defaultVisible: false },
  { key: 'orderCount', label: '발주차수', defaultVisible: true },
  { key: 'cumQty', label: '누적생산량', defaultVisible: false },
  { key: 'noOrder', label: '미발주기간', defaultVisible: true },
  { key: 'createdAt', label: '등록일', defaultVisible: true },
  { key: 'bom', label: 'BOM', defaultVisible: true },
];

type ItemOrderRound = {
  orderId: string;
  orderNo: string;
  revision: number;
  qty: number;
  orderDate: string;
  status: string;
  colorQtys: { color: string; qty: number }[];
};

type ItemOrderStat = {
  orderCount: number;
  maxRevision: number;
  cumQty: number;
  lastOrderDate: string | null;
  byColor: Record<string, number>;
  rounds: ItemOrderRound[];
};

const EMPTY_ORDER_STAT: ItemOrderStat = {
  orderCount: 0, maxRevision: 0, cumQty: 0, lastOrderDate: null, byColor: {}, rounds: [],
};

const ITEM_COL_VISIBLE_KEY = 'ames_item_col_visible_v1';
const ITEM_COL_ORDER_KEY = 'ames_item_col_order_v1';

function loadItemColVisible(): Record<string, boolean> {
  const defaults = Object.fromEntries(ITEM_COLUMN_DEFS.map(c => [c.key, c.defaultVisible]));
  try {
    const saved = localStorage.getItem(ITEM_COL_VISIBLE_KEY);
    if (saved) return { ...defaults, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return defaults;
}

// 열 순서 — 저장값에 신규 컬럼 보정(끝에 추가) + 없어진 키 제거
function loadItemColOrder(): string[] {
  const defs = ITEM_COLUMN_DEFS.map(c => c.key);
  try {
    const saved = localStorage.getItem(ITEM_COL_ORDER_KEY);
    if (saved) {
      const arr: string[] = JSON.parse(saved).filter((k: string) => defs.includes(k));
      for (const k of defs) if (!arr.includes(k)) arr.push(k); // 신규 컬럼은 뒤에
      return arr;
    }
  } catch { /* ignore */ }
  return defs;
}

// 순서·표시여부에 따라 노드 배열을 정렬/필터 — 각 노드는 key(컬럼키)를 가져야 함
function orderNodes(order: string[], nodes: any[]): any[] {
  const idx = (k: string) => { const i = order.indexOf(k); return i < 0 ? 999 : i; };
  return nodes
    .filter(Boolean)
    .slice()
    .sort((a, b) => idx(String(a.key)) - idx(String(b.key)));
}

export default function ItemMaster() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { isBrand } = useWorkspace();
  // URL 파라미터 (샘플 관리에서 품목등록 버튼 클릭 시 전달됨)
  const searchString = useSearch();
  const { data: itemsRaw = [] } = useQuery({ queryKey: ['items'], queryFn: fetchItems });
  // 레거시 LPKG 소모품 품목은 숨김 (자재마스터로 이전)
  const items = useMemo(
    () => (itemsRaw as Item[]).filter(i => !isLegacyPackConsumable(i) && !(i.styleNo || '').startsWith('LPKG-')),
    [itemsRaw],
  );
  const setItems = (_v: Item[]) => {}; // no-op
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const { data: materials = [] } = useQuery({ queryKey: ['materials'], queryFn: fetchMaterials });
  const [packLines, setPackLines] = useState<PackBomLine[]>([]);
  const [search, setSearch] = usePersistedState('items.search', '');
  const [filterSeason, setFilterSeason] = usePersistedState('items.filterSeason', '전체');
  const [filterCategory, setFilterCategory] = usePersistedState('items.filterCategory', '전체');
  const [filterErpCategory, setFilterErpCategory] = usePersistedState('items.filterErpCategory', '전체');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<Partial<Item>>({ ...emptyItem });
  const [isEdit, setIsEdit] = useState(false);
  // 변경사항 추적
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [manualStyleNo, setManualStyleNo] = useState(false);
  const [registDate, setRegistDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [previewStyleNo, setPreviewStyleNo] = useState('');
  const [colorInput, setColorInput] = useState('');
  const [colorDetailOpen, setColorDetailOpen] = useState<number | null>(null); // 열린 컬러 세부정보 인덱스
  const [filterBuyer, setFilterBuyer] = usePersistedState('items.filterBuyer', '전체');
  const [filterNoBom, setFilterNoBom] = usePersistedState('items.filterNoBom', false);
  const [filterStyleNo, setFilterStyleNo] = usePersistedState('items.filterStyleNo', '');
  const [filterName, setFilterName] = usePersistedState('items.filterName', '');
  const [sortField, setSortField] = useState<'styleNo' | 'name' | 'season' | 'createdAt' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showSeasonStats, setShowSeasonStats] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [seasonStatsTarget, setSeasonStatsTarget] = useState('전체');
  const [customCategory, setCustomCategory] = useState(''); // 세부 카테고리 직접 입력
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: () => import('@/lib/supabaseQueries').then(m => m.fetchOrders()) }); // 미발주·발주차수·누적생산
  const [listTab, setListTab] = useState<'items' | 'production'>('items');
  const [prodExpanded, setProdExpanded] = useState<Set<string>>(new Set());
  const [prodOrderedOnly, setProdOrderedOnly] = useState(true);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const excelUploadRef = useRef<HTMLInputElement>(null);
  // 공장 원가표 일괄 업로드
  const [showBatchCostUpload, setShowBatchCostUpload] = useState(false);
  const [batchCostItems, setBatchCostItems] = useState<BatchCostItem[]>([]);
  const [batchCostActiveId, setBatchCostActiveId] = useState<string | null>(null);
  const batchCostFileRef = useRef<HTMLInputElement>(null);

  // ─── 컬럼 너비 리사이즈 ───
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('ames_item_col_widths');
      if (saved) return { ...ITEM_DEFAULT_COL_WIDTHS, ...JSON.parse(saved) };
    } catch {}
    return { ...ITEM_DEFAULT_COL_WIDTHS };
  });
  const [colVisible, setColVisible] = useState<Record<string, boolean>>(loadItemColVisible);
  const [colOrder, setColOrder] = useState<string[]>(loadItemColOrder);
  const [colSettingsOpen, setColSettingsOpen] = useState(false);
  const showCol = useCallback((key: string) => colVisible[key] !== false, [colVisible]);
  // 열 순서 이동 (dir: -1 위로, +1 아래로)
  const moveCol = (key: string, dir: number) => {
    setColOrder(prev => {
      const arr = prev.slice();
      const i = arr.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      localStorage.setItem(ITEM_COL_ORDER_KEY, JSON.stringify(arr));
      return arr;
    });
  };
  const visibleDataColCount = useMemo(
    () => ITEM_COLUMN_DEFS.filter(c => showCol(c.key)).length,
    [showCol],
  );
  const toggleColVisible = (key: string) => {
    setColVisible(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(ITEM_COL_VISIBLE_KEY, JSON.stringify(next));
      return next;
    });
  };
  const resetColVisible = () => {
    const defaults = Object.fromEntries(ITEM_COLUMN_DEFS.map(c => [c.key, c.defaultVisible]));
    setColVisible(defaults);
    localStorage.setItem(ITEM_COL_VISIBLE_KEY, JSON.stringify(defaults));
    const defOrder = ITEM_COLUMN_DEFS.map(c => c.key);
    setColOrder(defOrder);
    localStorage.setItem(ITEM_COL_ORDER_KEY, JSON.stringify(defOrder));
    toast.success('열 설정을 기본값으로 복원했습니다');
  };
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  const startResize = useCallback((e: React.MouseEvent, col: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidthsRef.current[col];
    const onMove = (ev: MouseEvent) => {
      setColWidths(prev => ({ ...prev, [col]: Math.max(40, startW + ev.clientX - startX) }));
    };
    const onUp = () => {
      setColWidths(prev => {
        localStorage.setItem('ames_item_col_widths', JSON.stringify(prev));
        return prev;
      });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // ─── 엑셀 일괄 등록 상태 ───
  const [excelPreviewOpen, setExcelPreviewOpen] = useState(false);
  const [excelPreviewItems, setExcelPreviewItems] = useState<Array<{
    styleNo: string; name: string; nameEn: string; season: string;
    category: string; erpCategory: string; colors: string[];
    salePriceKrw: number | null; material: string; memo: string;
    buyerId?: string; buyerName?: string;
    isDuplicate: boolean;
  }>>([]);

  // 양식 다운로드
  const downloadTemplate = () => {
    // 거래처 목록 주석용 (code 또는 name)
    const vendorList = (vendors as any[]).map(v => v.code || v.name).filter(Boolean).join(', ');
    const ws = XLSX.utils.aoa_to_sheet([
      ['스타일번호*', '품목명*', '거래처(브랜드코드)', '품목명(영문)', '시즌', '카테고리', 'ERP카테고리', '컬러코드1', '컬러코드2', '컬러코드3', '판매가', '소재', '메모'],
      ['LLL6S82', 'SOFIA WEAVING BAG', 'LLL', 'SOFIA WEAVING BAG', '26SS', '숄더백', 'HB', 'OB', 'SB', '', 398000, '소프트레더', ''],
    ]);
    // 거래처 컬럼에 주석 추가 (등록된 거래처 목록 안내)
    if (vendorList) {
      if (!ws['C1'].c) ws['C1'].c = [];
      ws['C1'].c.hidden = false;
      ws['C1'].c.push({ a: 'ERP', t: `등록된 거래처 코드/이름: ${vendorList}` });
    }
    ws['!cols'] = [
      { wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 30 }, { wch: 8 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '품목등록양식');
    XLSX.writeFile(wb, '품목등록양식.xlsx');
    toast.success('양식 다운로드 완료');
  };

  // 엑셀 파싱 (표준 양식 + atlm.kr 형식)
  const parseExcelFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

        if (rows.length < 2) { toast.error('데이터가 없습니다'); return; }

        // 헤더로 형식 감지
        const header = rows[0].map((h: any) => String(h || '').trim());
        const isStandardFormat = header[0]?.includes('스타일번호');
        const isAtlmFormat = header.length >= 15 && (header[2]?.includes('상품코드') || header[14]?.includes('제조사') || !isStandardFormat);
        // 신양식: 헤더 col2에 '거래처' 포함 여부로 구분
        const hasVendorCol = isStandardFormat && header[2]?.includes('거래처');

        const grouped: Record<string, typeof excelPreviewItems[0]> = {};
        const existingStyleNos = new Set((items as Item[]).map(i => i.styleNo));

        // 거래처 매칭 헬퍼: code 또는 name으로 검색
        const matchVendor = (input: string) => {
          const s = input.trim();
          if (!s) return undefined;
          return (vendors as any[]).find(v =>
            v.code === s || v.name === s ||
            v.code?.toLowerCase() === s.toLowerCase() ||
            v.name?.toLowerCase() === s.toLowerCase()
          );
        };

        const dataRows = rows.slice(1).filter(r => r && r.length >= 2);

        for (const row of dataRows) {
          if (isAtlmFormat && !isStandardFormat) {
            // atlm.kr 형식: Col4=상품명, Col14=판매가, Col15=스타일번호+컬러
            const name = String(row[3] || '').trim();
            const price = row[13];
            const fullStyle = String(row[14] || '').trim();
            if (!name || !fullStyle) continue;

            const colorMatch = fullStyle.match(/([A-Z]{2,4})$/);
            const colorCode = colorMatch ? colorMatch[1] : '';
            const styleNo = colorCode ? fullStyle.slice(0, -colorCode.length) : fullStyle;
            if (!styleNo) continue;

            if (!grouped[styleNo]) {
              grouped[styleNo] = {
                styleNo, name, nameEn: '', season: '26SS', category: '숄더백',
                erpCategory: 'HB', colors: [], salePriceKrw: price ? Number(price) : null,
                material: '', memo: '', isDuplicate: existingStyleNos.has(styleNo),
              };
            }
            if (colorCode && !grouped[styleNo].colors.includes(colorCode)) {
              grouped[styleNo].colors.push(colorCode);
            }
          } else if (hasVendorCol) {
            // 신양식: col2=거래처(브랜드코드), 이후 컬럼 +1 shift
            const styleNo = String(row[0] || '').trim();
            const name = String(row[1] || '').trim();
            if (!styleNo || !name) continue;

            const vendorInput = String(row[2] || '').trim();
            const matched = matchVendor(vendorInput);

            const colors: string[] = [];
            [row[7], row[8], row[9]].forEach(c => { if (c) colors.push(String(c).trim()); });

            grouped[styleNo] = {
              styleNo,
              name,
              buyerId: matched?.id,
              buyerName: matched ? (matched.name || matched.code) : (vendorInput || undefined),
              nameEn: String(row[3] || '').trim(),
              season: String(row[4] || '26SS').trim(),
              category: String(row[5] || '숄더백').trim(),
              erpCategory: String(row[6] || 'HB').trim(),
              colors,
              salePriceKrw: row[10] ? Number(row[10]) : null,
              material: String(row[11] || '').trim(),
              memo: String(row[12] || '').trim(),
              isDuplicate: existingStyleNos.has(styleNo),
            };
          } else {
            // 구양식: 거래처 컬럼 없음
            const styleNo = String(row[0] || '').trim();
            const name = String(row[1] || '').trim();
            if (!styleNo || !name) continue;

            const colors: string[] = [];
            [row[6], row[7], row[8]].forEach(c => { if (c) colors.push(String(c).trim()); });

            grouped[styleNo] = {
              styleNo,
              name,
              nameEn: String(row[2] || '').trim(),
              season: String(row[3] || '26SS').trim(),
              category: String(row[4] || '숄더백').trim(),
              erpCategory: String(row[5] || 'HB').trim(),
              colors,
              salePriceKrw: row[9] ? Number(row[9]) : null,
              material: String(row[10] || '').trim(),
              memo: String(row[11] || '').trim(),
              isDuplicate: existingStyleNos.has(styleNo),
            };
          }
        }

        const result = Object.values(grouped);
        if (result.length === 0) { toast.error('파싱된 데이터가 없습니다'); return; }
        setExcelPreviewItems(result);
        setExcelPreviewOpen(true);
      } catch (err) {
        toast.error('엑셀 파싱 실패: ' + String(err));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 엑셀 일괄 등록 실행
  const handleExcelBulkRegister = async () => {
    const toRegister = excelPreviewItems.filter(p => !p.isDuplicate);
    if (toRegister.length === 0) { toast.error('등록할 신규 품목이 없습니다'); return; }

    let success = 0;
    let fail = 0;
    const cnyKrwRate = store.getSettings().cnyKrw || 191;
    for (const p of toRegister) {
      try {
        const itemId = genId();
        const itemData: Item = {
          id: itemId,
          styleNo: p.styleNo,
          name: p.name,
          nameEn: p.nameEn || undefined,
          season: (p.season as Season) || '26SS',
          category: (p.category as Category) || '숄더백',
          erpCategory: (p.erpCategory as ErpCategory) || 'HB',
          materialType: '완제품',
          itemStatus: 'ACTIVE',
          material: p.material || '',
          deliveryPrice: 0,
          buyerId: p.buyerId || undefined,
          colors: p.colors.map(c => ({ name: c })),
          hasBom: p.colors.length > 0,
          createdAt: new Date().toISOString(),
          memo: p.memo || '',
        };
        await upsertItem(itemData);

        // 확정판매가 저장 (confirmed_sale_price 전용 함수 사용 — delivery_price/post_cost_krw 건드리지 않음)
        if (p.salePriceKrw && p.salePriceKrw > 0) {
          await saveConfirmedSalePrice(itemId, p.salePriceKrw);
        }

        // 컬러가 있으면 사후원가 BOM 자동 생성 (원가항목 빈칸, 확정판매가 입력)
        if (p.colors.length > 0) {
          const buyer = (vendors as any[]).find(v => v.id === p.buyerId);
          const isSelfBrand = !buyer || buyer.name?.includes('아뜰리에드루멘');
          const bomData = {
            id: genId(),
            styleNo: p.styleNo,
            styleId: itemId,
            styleName: p.name,
            season: itemData.season,
            erpCategory: itemData.erpCategory,
            lineName: '',
            manufacturingCountry: '중국',
            currency: 'CNY',
            snapshotCnyKrw: cnyKrwRate,
            exchangeRateCny: cnyKrwRate,
            lines: [],
            processingFee: 0,
            postMaterials: [],
            postProcessingFee: 0,
            postProcessLines: [],
            colorBoms: [],
            postColorBoms: p.colors.map(c => ({
              color: c,
              lines: [],
              postProcessLines: [],
              processingFee: 0,
            })),
            productionMarginRate: isSelfBrand ? 0 : 0.16,
            customsRate: 0,
            logisticsCostKrw: 0,
            packagingCostKrw: 0,
            packingCostKrw: 0,
            pnl: {
              discountRate: 0.05,
              platformFeeRate: 0.30,
              sgaRate: 0.10,
              ...(p.salePriceKrw && p.salePriceKrw > 0 ? { confirmedSalePrice: p.salePriceKrw } : {}),
            },
          };
          await upsertBom(bomData);
        }

        success++;
      } catch {
        fail++;
      }
    }
    setExcelPreviewOpen(false);
    setExcelPreviewItems([]);
    refresh();
    toast.success(`일괄 등록 완료: ${success}개 등록, ${excelPreviewItems.filter(p => p.isDuplicate).length}개 중복 스킵${fail > 0 ? `, ${fail}개 실패` : ''}`);
    if (excelUploadRef.current) excelUploadRef.current.value = '';
  };

  const handleItemImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await resizeImage(file);
      setEditItem(prev => ({ ...prev, imageUrl: base64 }));
    } catch {
      toast.error('이미지 업로드 실패');
    }
    if (imageFileRef.current) imageFileRef.current.value = '';
  };

  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['items'] }); queryClient.invalidateQueries({ queryKey: ['boms'] }); };
  // product_image 제외한 경량 쿼리로 목록 조회 속도 개선
  const { data: boms = [] } = useQuery({ queryKey: ['boms'], queryFn: fetchBomsLight });

  // ─── 선택 품목 엑셀 다운로드 ───
  const downloadSelectedItemsExcel = () => {
    const selectedItems = (items as Item[]).filter(i => selectedIds.has(i.id));
    if (selectedItems.length === 0) return;

    const HEADERS = ['스타일번호', '품명', '바이어', '시즌', '카테고리', '세부카테고리', '납품가', '총원가액', 'KMSRP', '실현배수', '마진율(%)'];

    const getRow = (item: Item) => {
      const itemBom = (boms as any[]).find(b => b.styleId === item.id) ||
                      (boms as any[]).find(b => b.styleNo === item.styleNo) ||
                      (boms as any[]).find(b => b.styleNo?.trim() === item.styleNo?.trim());
      const delivery = itemBom?.postDeliveryPrice || item.deliveryPrice || item.targetSalePrice || 0;
      const { productCost: pcCalc, totalCostKrw: tcCalc } = itemBom ? calcBomCosts(itemBom) : { productCost: 0, totalCostKrw: 0 };
      const postCostDb: number = (item as any).postCostKrw || 0;
      const buyer = (vendors as any[]).find(v => v.id === (item as any).buyerId);
      const isSelfBrand = !buyer || buyer.name?.includes('아뜰리에드루멘');
      const bomCost = (isSelfBrand ? pcCalc : tcCalc) > 0 ? (isSelfBrand ? pcCalc : tcCalc) : postCostDb;
      const confirmedSalePrice = itemBom?.pnl?.confirmedSalePrice || (item as any).confirmedSalePrice || 0;
      const actualMultiple = bomCost > 0 && confirmedSalePrice > 0 ? parseFloat((confirmedSalePrice / bomCost).toFixed(2)) : '';
      const { rate: mRate } = calcMargin(delivery, bomCost);
      return [
        item.styleNo,
        item.name,
        buyer?.code || buyer?.name || '',
        item.season || '',
        item.erpCategory || '',
        item.category || '',
        delivery || '',
        bomCost || '',
        confirmedSalePrice || '',
        actualMultiple,
        mRate != null ? parseFloat(mRate.toFixed(1)) : '',
      ];
    };

    const wb = XLSX.utils.book_new();

    // 전체 시트
    const makeSheet = (rows: Item[]) => {
      const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows.map(getRow)]);
      const colWidths = [14, 30, 12, 8, 8, 10, 12, 12, 12, 10, 10];
      ws['!cols'] = colWidths.map(w => ({ wch: w }));
      return ws;
    };

    XLSX.utils.book_append_sheet(wb, makeSheet(selectedItems), '전체');

    const catMap: { key: string; label: string }[] = [
      { key: 'HB', label: 'HB' },
      { key: 'ACC', label: 'ACC' },
      { key: 'SHOES', label: 'SHOES' },
      { key: 'PACK', label: 'PACK' },
    ];
    for (const { key, label } of catMap) {
      const rows = selectedItems.filter(i => i.erpCategory === key);
      if (rows.length > 0) XLSX.utils.book_append_sheet(wb, makeSheet(rows), label);
    }

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    XLSX.writeFile(wb, `품목목록_${date}.xlsx`);
  };

  // ─── 공장 원가표 일괄 업로드 ───
  const openBatchCostUpload = () => {
    const selectedItems = (items as Item[]).filter(i => selectedIds.has(i.id));
    const batch: BatchCostItem[] = selectedItems.map(item => ({
      item,
      bom: (boms as any[]).find(b => b.styleId === item.id || b.styleNo === item.styleNo) ?? null,
      status: 'pending',
    }));
    setBatchCostItems(batch);
    setShowBatchCostUpload(true);
  };

  const handleBatchCostFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !batchCostActiveId) return;
    const itemId = batchCostActiveId;
    setBatchCostActiveId(null);
    if (batchCostFileRef.current) batchCostFileRef.current.value = '';
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null });
      const existingBom = (boms as any[]).find(b => b.styleId === itemId || b.styleNo === (items as Item[]).find(i => i.id === itemId)?.styleNo);
      const fallback = existingBom?.exchangeRateCny ?? 191;
      const { materials, parsedProcessingFee, parsedRate, postProcessLines } = parseExcelBomSheet(raw, fallback);
      setBatchCostItems(prev => prev.map(bi =>
        bi.item.id === itemId
          ? { ...bi, status: 'ready', fileName: file.name, parsedData: { materials, processingFee: parsedProcessingFee, exchangeRateCny: parsedRate, postProcessLines } }
          : bi
      ));
    } catch {
      setBatchCostItems(prev => prev.map(bi =>
        bi.item.id === itemId ? { ...bi, status: 'error', errorMsg: '파싱 실패' } : bi
      ));
    }
  };

  const applyBatchCostUpload = async () => {
    const readyItems = batchCostItems.filter(bi => bi.parsedData && bi.status === 'ready');
    for (const bi of readyItems) {
      setBatchCostItems(prev => prev.map(b => b.item.id === bi.item.id ? { ...b, status: 'saving' } : b));
      try {
        const { materials, processingFee, exchangeRateCny, postProcessLines } = bi.parsedData!;
        let updatedBom: any;
        if (bi.bom) {
          const existing = bi.bom.postColorBoms || [];
          let tabs;
          if (existing.length === 0) {
            tabs = [{ color: '기본', lines: materials.map(l => ({ ...l, id: genId() })), postProcessLines: postProcessLines.map(l => ({ ...l, id: genId() })), processingFee: processingFee || 0 }];
          } else {
            // 전체 컬러 탭에 동일한 자재 데이터 적용 (컬러별 가격 동일)
            tabs = existing.map((cb: any) => ({
              ...cb,
              lines: materials.length > 0 ? materials.map(l => ({ ...l, id: genId() })) : cb.lines,
              postProcessLines: postProcessLines.length > 0 ? postProcessLines.map(l => ({ ...l, id: genId() })) : cb.postProcessLines,
              processingFee: processingFee || cb.processingFee,
            }));
          }
          // postMaterials / postProcessingFee / postProcessLines 도 갱신:
          // BomManagement PostCostSummary는 postColorBoms 탭이 아닌 이 필드들을 읽음
          const newPostMaterials = materials.length > 0 ? materials.map(l => ({ ...l, id: genId() })) : (bi.bom.postMaterials || []);
          const newPostProcLines = postProcessLines.length > 0 ? postProcessLines.map(l => ({ ...l, id: genId() })) : (bi.bom.postProcessLines || []);
          const newProcessingFee = processingFee || bi.bom.postProcessingFee || 0;
          updatedBom = {
            ...bi.bom,
            postColorBoms: tabs,
            postMaterials: newPostMaterials,
            postProcessingFee: newProcessingFee,
            postProcessLines: newPostProcLines,
            exchangeRateCny: exchangeRateCny || bi.bom.exchangeRateCny,
            // 패킹자재·포장/검사비: 엑셀 업로드로 변경 안됨 — 기존 BOM 값 유지
            packagingCostKrw: bi.bom.packagingCostKrw ?? 0,
            packingCostKrw: bi.bom.packingCostKrw ?? 0,
          };
        } else {
          updatedBom = {
            id: genId(), styleNo: bi.item.styleNo, styleId: bi.item.id, styleName: bi.item.name,
            colorBoms: [],
            postColorBoms: [{ color: '기본', lines: materials.map(l => ({ ...l, id: genId() })), postProcessLines: postProcessLines.map(l => ({ ...l, id: genId() })), processingFee: processingFee || 0 }],
            postMaterials: materials.map(l => ({ ...l, id: genId() })),
            postProcessingFee: processingFee || 0,
            postProcessLines: postProcessLines.map(l => ({ ...l, id: genId() })),
            exchangeRateCny: exchangeRateCny || 191,
            productionMarginRate: 0.16, logisticsCostKrw: 0, packagingCostKrw: 0, packingCostKrw: 0, customsRate: 0,
            pnl: { discountRate: 0.05, platformFeeRate: 0.30, sgaRate: 0.10 },
          };
        }
        const { totalCostKrw, factoryUnitCostKrw: factKrw } = calcBomCosts(updatedBom);
        (updatedBom as any).postSubtotalKrw = totalCostKrw;
        (updatedBom as any).postTotalCostKrw = totalCostKrw;
        if (factKrw > 0) updatedBom.pnl = { ...(updatedBom.pnl || {}), factoryUnitCostKrw: factKrw };
        await upsertBom(updatedBom);
        if (totalCostKrw > 0) await updateItemCostData(bi.item.id, totalCostKrw); // confirmedSalePrice 전달 안함 → 수정 안됨
        setBatchCostItems(prev => prev.map(b => b.item.id === bi.item.id ? { ...b, status: 'done' } : b));
      } catch (err) {
        setBatchCostItems(prev => prev.map(b => b.item.id === bi.item.id ? { ...b, status: 'error', errorMsg: (err as Error)?.message || String(err) } : b));
      }
    }
    queryClient.invalidateQueries({ queryKey: ['boms'] });
    queryClient.invalidateQueries({ queryKey: ['items'] });
    toast.success('공장 원가표 일괄 적용 완료');
  };

  // ─── BOM→items 원가 일괄 동기화 ───
  const [isSyncing, setIsSyncing] = useState(false);
  const syncPostCost = async () => {
    setIsSyncing(true);
    let bomSynced = 0, bomFailed = 0;

    // Step 1: localStorage BOM → Supabase 동기화
    // postMaterials 또는 비용 필드가 있는 BOM은 무조건 upsert (타임스탬프 비교 제거)
    const localBoms = store.getBoms() as any[];
    for (const lb of localBoms) {
      if (!lb.id) continue;
      const hasData = (lb.postMaterials?.length > 0) ||
                      (lb.logisticsCostKrw > 0) ||
                      (lb.packagingCostKrw > 0) ||
                      (lb.packingCostKrw > 0);
      if (!hasData) continue;
      try {
        await upsertBom(lb);
        bomSynced++;
      } catch (e) {
        bomFailed++;
        console.warn('[원가동기화] BOM upsert 실패:', lb.styleNo, (e as any)?.message);
      }
    }

    // Step 2: 최신 BOM fetch (항상 새로 fetch하여 캐시 무효화)
    const freshBoms = await fetchBomsLight();
    // 중복 styleNo 중 updatedAt 최신 BOM 우선 선택
    const latestBomMap = new Map<string, any>();
    for (const b of freshBoms) {
      const key = b.styleId || b.styleNo;
      const ex = latestBomMap.get(key);
      if (!ex || (b.updatedAt || '') >= (ex.updatedAt || '')) latestBomMap.set(key, b);
    }

    // Step 3: items 원가 업데이트
    let saved = 0, noMatch = 0, zeroCost = 0;
    for (const bom of latestBomMap.values()) {
      const cost = calcBomPostCostKrw(bom);
      if (cost <= 0) { zeroCost++; continue; }
      const matchedItem =
        (items as any[]).find((i: any) => i.id === bom.styleId) ||
        (items as any[]).find((i: any) => i.styleNo === bom.styleNo) ||
        (items as any[]).find((i: any) => i.styleNo?.trim() === bom.styleNo?.trim());
      if (!matchedItem) { noMatch++; continue; }
      const salePx = bom?.pnl?.confirmedSalePrice || 0;
      await updateItemCostData(matchedItem.id, cost, salePx);
      saved++;
    }

    queryClient.invalidateQueries({ queryKey: ['boms'] });
    if (saved > 0) queryClient.invalidateQueries({ queryKey: ['items'] });
    setIsSyncing(false);
    const failMsg = bomFailed > 0 ? ` | BOM실패: ${bomFailed}개` : '';
    toast.success(
      `동기화 완료 — BOM저장: ${bomSynced}개 | 원가업데이트: ${saved}개 | 미매칭: ${noMatch}개${failMsg}`,
      { duration: 8000 }
    );
  };

  // 현재 선택된 erpCategory에 따른 세부 카테고리 옵션
  const subCategories =
    editItem.erpCategory === 'ACC' ? ACC_CATEGORIES :
    editItem.erpCategory === 'SHOES' ? SHOES_CATEGORIES :
    editItem.erpCategory === 'PACK' ? PACK_CATEGORIES :
    HB_CATEGORIES;

  /**
   * BOM 원가 기반 마진 계산
   * deliveryPrice = 납품가 (바이어에게 납품하는 금액)
   * bomCost = BOM에서 자동 조회한 총원가 (자재비 + 임가공비, KRW)
   * 마진금액 = 납품가 - BOM원가
   * 마진율 = 마진금액 / 납품가 × 100
   */
  const calcMargin = (deliveryPrice: number, bomCost: number) => {
    if (!deliveryPrice || deliveryPrice <= 0) return { rate: null, amount: null };
    const amount = deliveryPrice - bomCost;
    const rate = (amount / deliveryPrice) * 100;
    return { rate, amount };
  };

  /**
   * 마진율 색상 클래스 반환
   * 30% 이상: 초록, 15~30%: 노란색, 15% 미만: 빨간색
   */
  const marginColorClass = (rate: number): string => {
    if (rate >= 30) return 'text-green-600';
    if (rate >= 15) return 'text-amber-600';
    return 'text-red-500';
  };

  const activeFilterCount = [
    filterStyleNo !== '',
    filterName !== '',
    filterSeason !== '전체',
    filterCategory !== '전체',
    filterErpCategory !== '전체',
    filterBuyer !== '전체',
    filterNoBom,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setSearch('');
    setFilterStyleNo('');
    setFilterName('');
    setFilterSeason('전체');
    setFilterCategory('전체');
    setFilterErpCategory('전체');
    setFilterBuyer('전체');
    setFilterNoBom(false);
  };

  const handleSort = (field: 'styleNo' | 'name' | 'season' | 'createdAt') => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: string }) => (
    <span className={`ml-1 text-[10px] ${sortField === field ? 'text-amber-500' : 'text-stone-300'}`}>
      {sortField === field ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
    </span>
  );

  const filtered = useMemo(() => {
    let result = items.filter(item => {
      const buyerName = vendors.find(v => v.id === item.buyerId)?.name || '';
      const matchSearch = !search ||
        item.styleNo.toLowerCase().includes(search.toLowerCase()) ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        buyerName.toLowerCase().includes(search.toLowerCase());
      const matchStyleNo = !filterStyleNo || item.styleNo.toLowerCase().includes(filterStyleNo.toLowerCase());
      const matchName = !filterName ||
        item.name.toLowerCase().includes(filterName.toLowerCase()) ||
        (item.nameEn || '').toLowerCase().includes(filterName.toLowerCase());
      const matchSeason = filterSeason === '전체'
        || item.season === filterSeason
        || item.erpCategory === 'PACK'; // 패키지 키트는 시즌 공통
      const matchCat = filterCategory === '전체' || item.category === filterCategory;
      const matchErpCat = filterErpCategory === '전체' || item.erpCategory === filterErpCategory;
      const matchBuyer = filterBuyer === '전체' || item.buyerId === filterBuyer;
      const matchNoBom = !filterNoBom || !item.hasBom;
      return matchSearch && matchStyleNo && matchName && matchSeason && matchCat && matchErpCat && matchBuyer && matchNoBom;
    });

    if (sortField) {
      result = [...result].sort((a, b) => {
        let aVal = '', bVal = '';
        if (sortField === 'styleNo') { aVal = a.styleNo; bVal = b.styleNo; }
        else if (sortField === 'name') { aVal = a.name; bVal = b.name; }
        else if (sortField === 'season') { aVal = a.season || ''; bVal = b.season || ''; }
        else if (sortField === 'createdAt') { aVal = a.createdAt || ''; bVal = b.createdAt || ''; }
        const cmp = aVal.localeCompare(bVal, 'ko');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [items, search, filterStyleNo, filterName, filterSeason, filterCategory, filterErpCategory, filterBuyer, filterNoBom, sortField, sortDir, vendors]);

  // 바이어 지정 시 탭 카운트도 해당 바이어 품목만 반영
  const tabItems = useMemo(() => {
    if (filterBuyer === '전체') return items as Item[];
    return (items as Item[]).filter(i => i.buyerId === filterBuyer);
  }, [items, filterBuyer]);

  const tabCounts = useMemo(() => ({
    HB: tabItems.filter(i => i.erpCategory === 'HB').length,
    ACC: tabItems.filter(i => i.erpCategory === 'ACC').length,
    SHOES: tabItems.filter(i => i.erpCategory === 'SHOES').length,
    PACK: tabItems.filter(i => i.erpCategory === 'PACK').length,
    전체: tabItems.length,
  }), [tabItems]);

  // ─── O(1) 조회용 Map 캐시 (boms/vendors 변경 시에만 재생성) ───
  // 동일 styleNo BOM이 여러 개 있을 경우 updatedAt 최신 BOM 우선 선택
  const bomMap = useMemo(() => {
    const m = new Map<string, any>();
    const setIfNewer = (key: string, b: any) => {
      const existing = m.get(key);
      if (!existing || (b.updatedAt || b.updated_at || '') >= (existing.updatedAt || existing.updated_at || '')) {
        m.set(key, b);
      }
    };
    for (const b of boms as any[]) {
      if (b.styleId) setIfNewer(b.styleId, b);
      if (b.styleNo) setIfNewer(b.styleNo, b);
      if (b.styleNo?.trim()) setIfNewer(b.styleNo.trim(), b);
    }
    return m;
  }, [boms]);

  const vendorMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const v of vendors as any[]) m.set(v.id, v);
    return m;
  }, [vendors]);

  // 패킹재 선택용 PACK 품목 목록 (BomManagement.packItems 동일 필터)
  const packItems = useMemo(
    () => (items as Item[]).filter(i =>
      (i as any).erpCategory === 'PACK'
      || (i.styleNo || '').startsWith('BOX-')
      || (i.styleNo || '').startsWith('PACKAGE-')
      || String((i as any).memo || '').includes('[PACK]'),
    ).sort((a, b) => (a.styleNo || '').localeCompare(b.styleNo || '', 'ko')),
    [items],
  );
  const packItemMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of packItems) m.set(p.id, p);
    return m;
  }, [packItems]);

  // ─── 행별 원가 계산 사전 처리 — 렌더링 중 반복 연산 제거 ───
  const rowDataMap = useMemo(() => {
    const m = new Map<string, {
      bom: any; delivery: number; bomCost: number;
      confirmedSalePrice: number; actualMultiple: number;
      marginRate: number | null; marginAmount: number | null;
      factoryUnitCostKrw: number;
      logisticsKrw: number; packagingKrw: number;
      processingKrw: number; processingBase: number; processingCur: string;
      packingKrw: number; prodMarginRate: number;
      colorCosts: ColorCostRow[];
      displayColors: string[];
    }>();

    // localStorage bom 맵 — Supabase에 비용 필드가 없을 때 보완용
    const localBoms = store.getBoms() as any[];
    const localBomMap = new Map<string, any>();
    for (const b of localBoms) {
      if (b.styleId) localBomMap.set(b.styleId, b);
      if (b.styleNo) localBomMap.set(b.styleNo, b);
      if (b.styleNo?.trim()) localBomMap.set(b.styleNo.trim(), b);
    }
    for (const item of items as Item[]) {
      const bom = bomMap.get(item.id) ?? bomMap.get(item.styleNo) ?? bomMap.get(item.styleNo?.trim());
      const localBom = localBomMap.get(item.id) ?? localBomMap.get(item.styleNo) ?? localBomMap.get(item.styleNo?.trim());
      // Supabase bom이 없으면 localBom 기본, 있으면 Supabase 우선 + 빈 필드는 localStorage 보완
      const baseBom = bom || localBom;
      const mergedBom = baseBom ? {
        ...(localBom || {}),
        ...(bom || {}),
        logisticsCostKrw: bom?.logisticsCostKrw || localBom?.logisticsCostKrw || 0,
        packagingCostKrw: bom?.packagingCostKrw || localBom?.packagingCostKrw || 0,
        packingCostKrw: bom?.packingCostKrw || localBom?.packingCostKrw || 0,
        postMaterials: (bom?.postMaterials?.length > 0) ? bom.postMaterials : (localBom?.postMaterials || []),
        postProcessingFee: bom?.postProcessingFee || localBom?.postProcessingFee || 0,
        postProcessLines: (bom?.postProcessLines?.length > 0) ? bom.postProcessLines : (localBom?.postProcessLines || []),
        postColorBoms: (bom?.postColorBoms?.length > 0) ? bom.postColorBoms : (localBom?.postColorBoms || []),
        colorBoms: (bom?.colorBoms?.length > 0) ? bom.colorBoms : (localBom?.colorBoms || []),
        customsRate: bom?.customsRate || localBom?.customsRate || 0,
        exchangeRateCny: bom?.exchangeRateCny || localBom?.exchangeRateCny || localBom?.snapshotCnyKrw || 191,
        productionMarginRate: bom?.productionMarginRate ?? localBom?.productionMarginRate ?? 0,
        postDeliveryPrice: bom?.postDeliveryPrice || localBom?.postDeliveryPrice || 0,
        postTotalCostKrw: bom?.postTotalCostKrw || localBom?.postTotalCostKrw || 0,
        currency: bom?.currency || localBom?.currency || 'CNY',
        pnl: bom?.pnl || localBom?.pnl || { discountRate: 0.05, platformFeeRate: 0.30, sgaRate: 0.10 },
        erpCategory: bom?.erpCategory || localBom?.erpCategory || '',
        styleNo: bom?.styleNo || localBom?.styleNo || item.styleNo,
        isPackBom: !!(bom?.isPackBom || localBom?.isPackBom),
        isSimpleCost: !!(bom?.isSimpleCost || localBom?.isSimpleCost),
        simplePostCostKrw: bom?.simplePostCostKrw || localBom?.simplePostCostKrw || 0,
      } : null;
      const delivery = mergedBom?.postDeliveryPrice || item.deliveryPrice || (item as any).targetSalePrice || 0;
      const { productCost: pcCalc, totalCostKrw: tcCalc, factoryUnitCostKrw: factCalc, logisticsKrw, packagingKrw, processingKrw, processingBase, processingCur, packingKrw, marginRate: prodMarginRate } = mergedBom ? calcBomCosts(mergedBom) : { productCost: 0, totalCostKrw: 0, factoryUnitCostKrw: 0, logisticsKrw: 0, packagingKrw: 0, processingKrw: 0, processingBase: 0, processingCur: 'CNY', packingKrw: 0, marginRate: 0 };
      const postCostDb: number = (item as any).postCostKrw || mergedBom?.postTotalCostKrw || 0;
      const buyer = vendorMap.get((item as any).buyerId);
      const isSelf = !buyer || buyer.name?.includes('아뜰리에드루멘');
      const colorCosts = calcBomCostsByColor(mergedBom, isSelf);
      const displayColors = mergeDisplayColors(item, mergedBom, colorCosts);
      const bomCostLive = isSelf ? pcCalc : tcCalc;
      const maxColorCost = colorCosts.reduce((mx, c) => Math.max(mx, c.displayCost), 0);
      const bomCost = maxColorCost > 0 ? maxColorCost : (bomCostLive > 0 ? bomCostLive : postCostDb);
      const confirmedSalePrice: number = mergedBom?.pnl?.confirmedSalePrice || (item as any).confirmedSalePrice || 0;
      const actualMultiple = bomCost > 0 && confirmedSalePrice > 0 ? confirmedSalePrice / bomCost : 0;
      const marginAmount = delivery > 0 ? delivery - bomCost : null;
      const marginRate = delivery > 0 && marginAmount != null ? (marginAmount / delivery) * 100 : null;
      const factCalcDb: number = mergedBom?.pnl?.factoryUnitCostKrw ?? 0;
      const maxFactory = colorCosts.reduce((mx, c) => Math.max(mx, c.factoryUnitCostKrw), 0);
      m.set(item.id, {
        bom: mergedBom,
        delivery,
        bomCost,
        confirmedSalePrice,
        actualMultiple,
        marginRate,
        marginAmount,
        factoryUnitCostKrw: maxFactory > 0 ? maxFactory : (factCalc > 0 ? factCalc : factCalcDb),
        logisticsKrw, packagingKrw, processingKrw, processingBase, processingCur, packingKrw, prodMarginRate,
        colorCosts,
        displayColors,
      });
    }
    return m;
  }, [items, boms, vendors, bomMap, vendorMap]);

  // ─── 원가 컬럼 일괄 인라인 편집 (물류비·포장검사비·패킹재·생산마진·임가공비) ───
  // 편집값을 품목ID별로 모아두었다가 "저장"에서 각 BOM에 반영 + 원가 재계산.
  type CostField = 'logistics' | 'packaging' | 'prodMarginPct' | 'processing';
  const [costEdits, setCostEdits] = useState<Record<string, Partial<Record<CostField, number>>>>({});
  // 패킹재는 금액이 아니라 PACK 품목 '선택' — 품목ID를 저장('' = 연결해제)
  const [packEdits, setPackEdits] = useState<Record<string, string>>({});
  // KMSRP(확정판매가)는 품목에 저장 — 품목ID별 편집값
  const [msrpEdits, setMsrpEdits] = useState<Record<string, number>>({});
  const [savingCosts, setSavingCosts] = useState(false);
  const dirtyCostIds = useMemo(
    () => new Set([...Object.keys(costEdits), ...Object.keys(packEdits), ...Object.keys(msrpEdits)]),
    [costEdits, packEdits, msrpEdits],
  );

  const setMsrpEdit = (itemId: string, raw: string, original: number) => {
    setMsrpEdits(prev => {
      const cleaned = raw.replace(/[,\s]/g, '');
      const next = { ...prev };
      if (cleaned === '' || Number.isNaN(Number(cleaned))) {
        // 빈 값: 원래 0이면 편집취소, 아니면 0으로 명시 변경
        if (!original) delete next[itemId]; else next[itemId] = 0;
      } else if (Number(cleaned) === original) {
        delete next[itemId];
      } else {
        next[itemId] = Number(cleaned);
      }
      return next;
    });
  };

  const setCostEdit = (itemId: string, field: CostField, raw: string) => {
    setCostEdits(prev => {
      const cleaned = raw.replace(/[,\s]/g, '');
      const row: Partial<Record<CostField, number>> = { ...(prev[itemId] || {}) };
      if (cleaned === '' || Number.isNaN(Number(cleaned))) {
        delete row[field];
      } else {
        row[field] = Number(cleaned);
      }
      const next = { ...prev };
      if (Object.keys(row).length === 0) delete next[itemId]; else next[itemId] = row;
      return next;
    });
  };

  const setPackEdit = (itemId: string, packItemId: string, originalId: string) => {
    setPackEdits(prev => {
      const next = { ...prev };
      // 원래 값과 같으면 편집 취소 처리
      if (packItemId === (originalId || '')) delete next[itemId];
      else next[itemId] = packItemId;
      return next;
    });
  };

  const saveCostEdits = async () => {
    const ids = Array.from(dirtyCostIds);
    if (ids.length === 0) return;
    setSavingCosts(true);
    let ok = 0, fail = 0;
    for (const itemId of ids) {
      try {
        const rd = rowDataMap.get(itemId);
        const item = (items as Item[]).find(i => i.id === itemId);
        if (!item) { fail++; continue; }
        // KMSRP(확정판매가) — 품목에 저장 (BOM 불필요)
        if (itemId in msrpEdits) {
          await saveConfirmedSalePrice(item.id, msrpEdits[itemId]);
        }
        const hasCostEdit = (itemId in costEdits) || (itemId in packEdits);
        if (hasCostEdit) {
        if (!rd?.bom) { fail++; continue; }
        const edit = costEdits[itemId] || {};
        const bom: any = { ...rd.bom };
        if (edit.logistics != null) bom.logisticsCostKrw = Math.round(edit.logistics);
        if (edit.packaging != null) bom.packagingCostKrw = Math.round(edit.packaging);
        // 패킹재: PACK 품목 선택 반영 (선택 시 단가 자동 산출, 해제 시 0)
        if (itemId in packEdits) {
          const packId = packEdits[itemId];
          if (!packId) {
            bom.packingItemId = undefined;
            bom.packingItemStyleNo = undefined;
            bom.packingCostKrw = 0;
          } else {
            const pack = packItemMap.get(packId);
            if (pack) {
              bom.packingItemId = pack.id;
              bom.packingItemStyleNo = pack.styleNo;
              bom.packingCostKrw = resolvePackItemCostKrw(pack);
            }
          }
        }
        if (edit.prodMarginPct != null) bom.productionMarginRate = edit.prodMarginPct / 100;
        if (edit.processing != null) {
          // 임가공비는 화면상 KRW지만 BOM엔 CNY(기준통화)로 저장 → 환율로 되돌림
          const postCur = bom.currency || 'CNY';
          const cnyKrw = bom.exchangeRateCny || bom.snapshotCnyKrw || 191;
          const usdKrw = bom.exchangeRateUsd || 1380;
          const rate = postCur === 'USD' ? usdKrw : postCur === 'KRW' ? 1 : cnyKrw;
          const newCny = rate > 0 ? edit.processing / rate : edit.processing;
          // 계산 함수가 읽는 위치와 동일하게: 데이터 있는 첫 postColorBom + postProcessingFee 모두 갱신
          const pcb = (bom.postColorBoms || []).find((cb: any) =>
            (cb.lines || []).some((l: any) => l.itemName || l.unitPriceCny > 0));
          if (pcb) {
            bom.postColorBoms = bom.postColorBoms.map((cb: any) =>
              cb === pcb ? { ...cb, processingFee: newCny } : cb);
          }
          bom.postProcessingFee = newCny;
        }
        // 원가 재계산 후 요약 필드 갱신 (기존 저장 패턴과 동일)
        const { totalCostKrw, factoryUnitCostKrw: factKrw } = calcBomCosts(bom);
        bom.postSubtotalKrw = totalCostKrw;
        bom.postTotalCostKrw = totalCostKrw;
        if (factKrw > 0) bom.pnl = { ...(bom.pnl || {}), factoryUnitCostKrw: factKrw };
        await upsertBom(bom);
        if (totalCostKrw > 0) await updateItemCostData(item.id, totalCostKrw);
        }
        ok++;
      } catch (e) {
        fail++;
        console.warn('[원가일괄수정] 실패:', itemId, (e as any)?.message);
      }
    }
    setSavingCosts(false);
    setCostEdits({});
    setPackEdits({});
    setMsrpEdits({});
    queryClient.invalidateQueries({ queryKey: ['boms'] });
    queryClient.invalidateQueries({ queryKey: ['items'] });
    if (fail === 0) toast.success(`원가 일괄수정 저장 완료 (${ok}건)`);
    else toast.error(`원가 저장: ${ok}건 완료, ${fail}건 실패`);
  };

  // hasBom 플래그 누락 보정 — BOM/원가는 있는데 items.has_bom=false 인 경우
  useEffect(() => {
    const stale = (items as Item[]).filter(item => {
      if (item.hasBom) return false;
      return hasEffectiveBom(item, rowDataMap.get(item.id));
    });
    if (stale.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const item of stale) {
        if (cancelled) return;
        try {
          // 부분 객체 upsert는 다른 컬럼을 비울 수 있어 전체 품목 + hasBom만 갱신
          await upsertItem({ ...item, hasBom: true });
        } catch { /* ignore */ }
      }
      if (!cancelled) {
        queryClient.invalidateQueries({ queryKey: ['items'] });
      }
    })();
    return () => { cancelled = true; };
  }, [items, rowDataMap, queryClient]);

  // 자동생성 미리보기
  useEffect(() => {
    if (manualStyleNo) return;
    const vendor = vendors.find(v => v.id === selectedVendorId);
    if (!vendor?.code || !editItem.category) { setPreviewStyleNo(''); return; }
    const date = registDate ? new Date(registDate) : new Date();
    const generated = generateStyleNo(vendor.code, date, editItem.category as Category, items as Item[], isEdit ? editItem.id : undefined, editItem.erpCategory);
    setPreviewStyleNo(generated);
    setEditItem(prev => ({ ...prev, styleNo: generated }));
  }, [selectedVendorId, registDate, editItem.category, editItem.erpCategory, manualStyleNo, isEdit, editItem.id, vendors, items]);

  const openAdd = (prefill?: { styleNo?: string; buyerId?: string; season?: string; styleName?: string; imageUrl?: string }) => {
    // 샘플에서 넘어온 prefill 확인
    const storedPrefill = localStorage.getItem('ames_prefill_item');
    const pf = prefill || (storedPrefill ? JSON.parse(storedPrefill) : null);
    if (storedPrefill) localStorage.removeItem('ames_prefill_item');

    setEditItem({
      ...emptyItem,
      colors: [],
      styleNo: pf?.styleNo || '',
      name: pf?.styleName || '',
      buyerId: pf?.buyerId || '',
      season: (pf?.season as Season) || '26SS',
      imageUrl: pf?.imageUrl || undefined,
    });
    setIsEdit(false);
    setManualStyleNo(pf?.styleNo ? true : false);
    setRegistDate(new Date().toISOString().split('T')[0]);
    setSelectedVendorId(pf?.buyerId || '');
    setPreviewStyleNo(pf?.styleNo || '');
    setColorInput('');
    setCustomCategory('');
    setPackLines([]);
    setIsDirty(false);
    setModalOpen(true);
  };

  // 진입 시 prefill 체크 (localStorage 또는 URL 파라미터)
  useEffect(() => {
    // 1) URL 파라미터 우선 체크 (샘플관리 → 품목등록 버튼 클릭 시)
    const urlParams = new URLSearchParams(searchString);
    const urlSampleId = urlParams.get('sampleId');
    const urlStyleNo = urlParams.get('styleNo');
    const urlStyleName = urlParams.get('styleName');
    const urlBuyerId = urlParams.get('buyerId');
    const urlSeason = urlParams.get('season');

    if (urlStyleName || urlBuyerId || urlSampleId) {
      const pf: {
        styleNo: string;
        styleName: string;
        buyerId: string;
        season: string;
        sampleId?: string;
        imageUrl?: string;
      } = {
        styleNo: urlStyleNo || '',
        styleName: urlStyleName || '',
        buyerId: urlBuyerId || '',
        season: urlSeason || '26SS',
        sampleId: urlSampleId || undefined,
      };
      const storedPrefill = localStorage.getItem('ames_prefill_item');
      if (storedPrefill) {
        try {
          const stored = JSON.parse(storedPrefill);
          if (stored.imageUrl) pf.imageUrl = stored.imageUrl;
          localStorage.removeItem('ames_prefill_item');
        } catch { /* 무시 */ }
      }
      if (pf.sampleId) sessionStorage.setItem('ames_link_sampleId', pf.sampleId);
      openAdd(pf);
      navigate('/items', { replace: true });
      return;
    }
    // 2) localStorage prefill 체크 (기존 방식 호환)
    const storedPrefill = localStorage.getItem('ames_prefill_item');
    if (storedPrefill) {
      try {
        const pf = JSON.parse(storedPrefill);
        if (pf.sampleId) sessionStorage.setItem('ames_link_sampleId', pf.sampleId);
        openAdd(pf);
      } catch {
        localStorage.removeItem('ames_prefill_item');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (item: Item) => {
    setEditItem({ ...item, colors: normalizeColors(item.colors || []) });
    if (item.erpCategory === 'PACK') {
      const bom = (boms as any[]).find(b => b.styleId === item.id || b.styleNo === item.styleNo);
      setPackLines(linesFromPackBom(bom, materials));
    } else {
      setPackLines([]);
    }
    setIsEdit(true); setManualStyleNo(true);
    setRegistDate(item.createdAt.split('T')[0]);
    setSelectedVendorId(''); setPreviewStyleNo(item.styleNo); setColorInput('');
    setCustomCategory(item.customCategory || '');
    setColorDetailOpen(null);
    setIsDirty(false);
    setModalOpen(true);
  };

  const handleModalClose = useCallback((requestClose: boolean) => {
    if (!requestClose) return;
    if (isDirty) {
      setShowUnsavedDialog(true);
    } else {
      setModalOpen(false);
    }
  }, [isDirty]);

  const handleSave = () => {
    if (!editItem.styleNo || !editItem.name) { toast.error('스타일번호와 품명을 입력하세요'); return; }
    if (!isEdit) {
      const dup = (items as Item[]).find(it => it.styleNo === editItem.styleNo);
      if (dup) { toast.error(`스타일번호 '${editItem.styleNo}'는 이미 등록되어 있습니다`); return; }
    }

    // 바이어 연결: selectedVendorId(자동생성 거래처)가 있으면 적용
    const buyerId = selectedVendorId || editItem.buyerId;

    // 납품가: deliveryPrice 우선, 없으면 targetSalePrice 사용 (0도 유효한 값이므로 ?? 사용)
    const deliveryVal = editItem.deliveryPrice ?? editItem.targetSalePrice ?? 0;

    const isPack = editItem.erpCategory === 'PACK';
    const packTotal = isPack ? packLinesTotal(packLines) : 0;

    // BOM 원가 조회 후 마진 자동 계산
    const bomCostForSave = isPack
      ? packTotal
      : (editItem.styleNo ? store.getBomTotalCost(editItem.styleNo) : 0);
    let marginAmountVal: number | undefined;
    let marginRateVal: number | undefined;
    if (deliveryVal > 0) {
      marginAmountVal = deliveryVal - bomCostForSave;
      marginRateVal = (marginAmountVal / deliveryVal) * 100;
    }

    const itemData = isEdit && editItem.id
      ? {
          ...editItem,
          buyerId,
          colors: normalizeColors(editItem.colors || []),
          deliveryPrice: deliveryVal,
          targetSalePrice: deliveryVal,
          marginAmount: marginAmountVal,
          marginRate: marginRateVal,
          materialType: '완제품' as const,
          customCategory: customCategory || undefined,
          ...(isPack ? {
            baseCostKrw: packTotal,
            hasBom: packLines.length > 0,
            deliveryPrice: deliveryVal || packTotal,
            targetSalePrice: deliveryVal || packTotal,
          } : {}),
        } as Item
      : {
          ...editItem,
          buyerId,
          deliveryPrice: deliveryVal,
          targetSalePrice: deliveryVal,
          marginAmount: marginAmountVal,
          marginRate: marginRateVal,
          id: genId(),
          hasBom: isPack ? packLines.length > 0 : false,
          createdAt: new Date().toISOString(),
          materialType: '완제품' as const,
          itemStatus: 'ACTIVE' as const,
          customCategory: customCategory || undefined,
          ...(isPack ? { baseCostKrw: packTotal } : {}),
        } as Item;

    upsertItem(itemData)
      .then(async () => {
        if (isPack) {
          const existingBom = (boms as any[]).find(b => b.styleId === itemData.id || b.styleNo === itemData.styleNo);
          const bomBase = existingBom || createEmptyPackBom({
            id: itemData.id,
            styleNo: itemData.styleNo!,
            styleName: itemData.name!,
            season: itemData.season,
            designer: itemData.designer,
          });
          const bomToSave = applyPackLinesToBom(bomBase, packLines);
          await upsertBom(bomToSave);
          queryClient.invalidateQueries({ queryKey: ['boms'] });
        }
        if (!isEdit) {
          // 샘플-품목 연결
          const linkedSampleId = sessionStorage.getItem('ames_link_sampleId');
          if (linkedSampleId) {
            try {
              const { upsertSample } = await import('@/lib/supabaseQueries');
              const samples = (await import('@/lib/supabaseQueries').then(m => m.fetchSamples()));
              const linkedSample = samples.find((s: any) => s.id === linkedSampleId);
              if (linkedSample) {
                await upsertSample({ ...linkedSample, styleId: itemData.id, styleNo: itemData.styleNo });
                toast.success(`품목 등록 완료 — 샘플 "${linkedSample.styleName}"에 연결되었습니다`);
              } else {
                toast.success('품목이 등록되었습니다');
              }
            } catch { toast.success('품목이 등록되었습니다'); }
            sessionStorage.removeItem('ames_link_sampleId');
          } else {
            toast.success('품목이 등록되었습니다');
          }
        } else {
          toast.success('품목이 수정되었습니다');
        }
        setIsDirty(false);
        setModalOpen(false);
        refresh();
      })
      .catch((e: Error) => toast.error(`저장 실패: ${e.message}`));
  };

  const handleDelete = (id: string) => {
    if (confirm('정말 삭제하시겠습니까?')) {
      deleteItemSB(id)
        .then(() => { toast.success('삭제되었습니다'); refresh(); })
        .catch((e: Error) => toast.error(`삭제 실패: ${e.message}`));
    }
  };

  // 체크박스 다중 선택 관련
  const displayItems = showSelectedOnly ? filtered.filter(i => selectedIds.has(i.id)) : filtered;
  // 렌더 상한 — 802행 × 20열을 한 번에 그리면 브라우저가 멈춘다. 필터가 바뀌면 다시 100부터.
  const [renderLimit, setRenderLimit] = useState(100);
  useEffect(() => { setRenderLimit(100); }, [search, filterSeason, filterCategory, filterErpCategory, filterBuyer, filterNoBom, filterStyleNo, filterName, showSelectedOnly]);
  const visibleItems = displayItems.slice(0, renderLimit);
  const isAllSelected = filtered.length > 0 && filtered.every(item => selectedIds.has(item.id));
  const isIndeterminate = filtered.some(item => selectedIds.has(item.id)) && !isAllSelected;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(item => item.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (confirm(`${selectedIds.size}개 항목을 삭제하시겠습니까?`)) {
      const count = selectedIds.size;
      Promise.all([...selectedIds].map(id => deleteItemSB(id)))
        .then(() => { setSelectedIds(new Set()); toast.success(`${count}개 항목이 삭제되었습니다`); refresh(); })
        .catch((e: Error) => toast.error(`삭제 실패: ${e.message}`));
    }
  };

  // 일괄 발주 모달 상태
  const [bulkOrderModalOpen, setBulkOrderModalOpen] = useState(false);

  const handleBulkOrder = () => {
    if (selectedIds.size === 0) return;
    setBulkOrderModalOpen(true);
  };

  const addColor = () => {
    const c = colorInput.trim();
    if (!c) return;
    const existing = normalizeColors(editItem.colors || []);
    if (existing.find(x => x.name === c)) { toast.error('이미 추가된 컬러입니다'); return; }
    setEditItem(prev => ({ ...prev, colors: [...normalizeColors(prev.colors || []), { name: c }] }));
    setColorInput('');
  };

  const removeColor = (idx: number) => {
    const colorName = normalizeColors(editItem.colors || [])[idx]?.name;
    if (!confirm(`"${colorName || '이 컬러'}"를 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) return;
    setEditItem(prev => {
      const normalized = normalizeColors(prev.colors || []);
      return { ...prev, colors: normalized.filter((_, i) => i !== idx) };
    });
    setColorDetailOpen(null);
  };

  const updateColorDetail = (idx: number, field: keyof Omit<ItemColor, 'name'>, value: string) => {
    setEditItem(prev => {
      const normalized = normalizeColors(prev.colors || []);
      normalized[idx] = { ...normalized[idx], [field]: value };
      return { ...prev, colors: normalized };
    });
  };

  // 시즌별 스타일 현황
  const seasonStats = useMemo(() => {
    const seasons = seasonStatsTarget === '전체' ? SEASONS : [seasonStatsTarget as Season];
    return seasons.map(season => {
      const seasonItems = items.filter(i => i.season === season);
      return {
        season,
        total: seasonItems.length,
        hb: seasonItems.filter(i => i.erpCategory === 'HB').length,
        acc: seasonItems.filter(i => i.erpCategory === 'ACC').length,
        shoes: seasonItems.filter(i => i.erpCategory === 'SHOES').length,
        pack: seasonItems.filter(i => i.erpCategory === 'PACK').length,
        hasBom: seasonItems.filter(i => i.hasBom).length,
        noBom: seasonItems.filter(i => !i.hasBom).length,
      };
    });
  }, [items, seasonStatsTarget]);

  // 바이어 거래처만
  const buyerVendors = vendors.filter(v => v.type === '바이어');
  const brandVendors = vendors.filter(v => v.code);

  // 미발주기간·발주차수·누적생산량 (styleId + styleNo 매칭)
  const mergedOrders = useMemo(() => {
    const map = new Map<string, ProductionOrder>();
    [...orders, ...store.getOrders()].forEach(o => map.set(o.id, o as ProductionOrder));
    return [...map.values()];
  }, [orders]);

  const itemOrderStats = useMemo(() => {
    const byKey = new Map<string, ProductionOrder[]>();
    const push = (key: string, o: ProductionOrder) => {
      if (!key) return;
      const list = byKey.get(key) || [];
      list.push(o);
      byKey.set(key, list);
    };
    mergedOrders.forEach(o => {
      push(o.styleId || '', o);
      push(o.styleNo || '', o);
    });

    const result = new Map<string, ItemOrderStat>();
    items.forEach(item => {
      const seen = new Set<string>();
      const list: ProductionOrder[] = [];
      for (const key of [item.id, item.styleNo]) {
        for (const o of byKey.get(key) || []) {
          if (seen.has(o.id)) continue;
          seen.add(o.id);
          list.push(o);
        }
      }
      if (list.length === 0) {
        result.set(item.id, EMPTY_ORDER_STAT);
        return;
      }
      const byColor: Record<string, number> = {};
      let cumQty = 0;
      let maxRevision = 0;
      let lastOrderDate: string | null = null;
      const rounds: ItemOrderRound[] = list
        .map(o => {
          const qty = o.qty || 0;
          cumQty += qty;
          maxRevision = Math.max(maxRevision, o.revision || 1);
          const d = (o.orderDate || o.createdAt || '').slice(0, 10);
          if (d && (!lastOrderDate || d > lastOrderDate)) lastOrderDate = d;
          const cqs = (o.colorQtys || []).length
            ? o.colorQtys!
            : [{ color: '(미지정)', qty }];
          cqs.forEach(cq => {
            const c = (cq.color || '').trim() || '(미지정)';
            byColor[c] = (byColor[c] || 0) + (cq.qty || 0);
          });
          return {
            orderId: o.id,
            orderNo: o.orderNo,
            revision: o.revision || 1,
            qty,
            orderDate: d,
            status: o.status || '',
            colorQtys: cqs.map(cq => ({ color: cq.color || '(미지정)', qty: cq.qty || 0 })),
          };
        })
        .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.revision - b.revision);
      result.set(item.id, {
        orderCount: list.length,
        maxRevision,
        cumQty,
        lastOrderDate,
        byColor,
        rounds,
      });
    });
    return result;
  }, [items, mergedOrders]);

  const monthsSinceLastOrder = (item: Item): number | null => {
    const stat = itemOrderStats.get(item.id);
    if (!stat?.lastOrderDate) return null;
    const diffMs = Date.now() - new Date(stat.lastOrderDate).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30));
  };

  const toggleProdExpand = (id: string) => {
    setProdExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const prodSummary = useMemo(() => {
    let styles = 0;
    let ordersN = 0;
    let qty = 0;
    displayItems.forEach(item => {
      const s = itemOrderStats.get(item.id) || EMPTY_ORDER_STAT;
      if (s.orderCount > 0) {
        styles += 1;
        ordersN += s.orderCount;
        qty += s.cumQty;
      }
    });
    return { styles, ordersN, qty };
  }, [displayItems, itemOrderStats]);

  /** 누적생산량 탭: 발주 있는 품목 우선 */
  const prodDisplayItems = useMemo(() => {
    const base = prodOrderedOnly
      ? displayItems.filter(i => (itemOrderStats.get(i.id)?.orderCount || 0) > 0)
      : displayItems;
    return [...base].sort((a, b) => {
      const sa = itemOrderStats.get(a.id) || EMPTY_ORDER_STAT;
      const sb = itemOrderStats.get(b.id) || EMPTY_ORDER_STAT;
      if (sb.orderCount !== sa.orderCount) return sb.orderCount - sa.orderCount;
      if (sb.cumQty !== sa.cumQty) return sb.cumQty - sa.cumQty;
      return (a.styleNo || '').localeCompare(b.styleNo || '');
    });
  }, [displayItems, itemOrderStats, prodOrderedOnly]);

  const [isPackLoading, setIsPackLoading] = useState(false);
  const packAutoTried = useRef(false);
  const lumen27AutoTried = useRef(false);
  const [isLumen27Loading, setIsLumen27Loading] = useState(false);

  const loadLumenPacking = async (silent = false) => {
    setIsPackLoading(true);
    try {
      const result = await seedLumenPackingData();
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      await queryClient.invalidateQueries({ queryKey: ['materials'] });
      if (isBrand) setFilterErpCategory('PACK');
      setFilterSeason('전체');
      if (!silent) {
        toast.success(`박스 패키지 ${result.itemCount}건 · 포장재 ${result.materialCount}건 (핸드백)`);
        result.kits.slice(0, 3).forEach(k =>
          toast.message(`${k.styleNo}: ₩${k.totalCostKrw.toLocaleString('ko-KR')}`),
        );
      } else {
        toast.success(`박스 패키지 ${result.itemCount}건 자동 등록`);
      }
    } catch (e) {
      if (!silent) toast.error('패키지 생성 실패');
      console.error(e);
    } finally {
      setIsPackLoading(false);
    }
  };

  const runLumen27Seed = async (silent = false) => {
    setIsLumen27Loading(true);
    try {
      const r = await seedLumen27ssRrp(true);
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      await queryClient.invalidateQueries({ queryKey: ['vendors'] });
      setFilterSeason('27SS');
      if (!silent) {
        if (r.errors.length) {
          toast.warning(`LUMEN 27SS: ${r.created + r.updated}건 (오류 ${r.errors.length})`);
        } else {
          toast.success(`LUMEN 27SS 등록 · ${r.created + r.updated}/${r.total}건 (바이어 LUMEN · KMSRP)`);
        }
      } else if (r.created + r.updated > 0) {
        toast.success(`LUMEN 27SS RRP ${r.created + r.updated}품목 자동 등록 · 시즌 27SS`);
      }
    } catch (e) {
      if (!silent) toast.error('LUMEN 27SS 등록 실패');
      console.error(e);
    } finally {
      setIsLumen27Loading(false);
    }
  };

  // 27SS LUMEN RRP 없으면 자동 등록
  useEffect(() => {
    if (lumen27AutoTried.current) return;
    if (hasLumen27ssItems(itemsRaw as Item[])) return;
    lumen27AutoTried.current = true;
    void runLumen27Seed(true);
  }, [itemsRaw]);

  // LUMEN/AETALOOP — PACKAGE 키트 없으면 자동 시드 (브랜드 워크스페이스만)
  useEffect(() => {
    if (!isBrand) return;
    if (packAutoTried.current) return;
    if (hasPackageKitItems()) return;
    packAutoTried.current = true;
    void loadLumenPacking(true);
  }, [items, isBrand]);

  return (
    <div className="p-6 space-y-5">
      {/* 원가 일괄수정 저장 바 — 변경된 품목이 있을 때만 노출 */}
      {dirtyCostIds.size > 0 && (
        <div className="fixed bottom-6 right-8 z-50 flex items-center gap-3 bg-white border border-stone-300 shadow-xl rounded-lg px-4 py-3">
          <span className="text-sm text-stone-700">{dirtyCostIds.size}개 품목 원가 변경됨</span>
          <button onClick={() => { setCostEdits({}); setPackEdits({}); }} disabled={savingCosts}
            className="text-xs text-stone-500 hover:text-stone-800 px-2 py-1 disabled:opacity-40">취소</button>
          <button onClick={saveCostEdits} disabled={savingCosts}
            className="text-sm font-medium bg-[#20E39B] text-black rounded px-3 py-1.5 hover:brightness-95 disabled:opacity-50">
            {savingCosts ? '저장 중…' : '저장'}
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">품목 마스터</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            스타일별 품목 · HB / ACC / SHOES / PACK
            {isBrand ? ' (박스SS~XL-HB · 핸드백)' : ' (패킹재)'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => runLumen27Seed(false)}
            disabled={isLumen27Loading}
            className="gap-2 border-rose-300 text-rose-800 hover:bg-rose-50"
          >
            <Upload size={16} />
            {isLumen27Loading ? '등록 중...' : `LUMEN 27SS 등록 (${getLumen27ssProductCount()})`}
          </Button>
          <Button
            variant="outline"
            onClick={loadLumenPacking}
            disabled={isPackLoading}
            className="gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"
          >
            <Package size={16} />
            {isPackLoading ? '불러오는 중...' : '핸드백 패키지 등록'}
          </Button>
          <Button variant="outline" onClick={() => setColSettingsOpen(true)} className="gap-2 border-stone-300 text-stone-600 hover:bg-stone-50">
            <Columns3 size={16} />열 설정
          </Button>
          <Button variant="outline" onClick={() => setShowSeasonStats(true)} className="gap-2 border-stone-300 text-stone-600 hover:bg-stone-50">
            <BarChart2 size={16} />시즌별 현황
          </Button>
          <Button variant="outline" onClick={downloadTemplate} className="gap-2 border-stone-300 text-stone-600 hover:bg-stone-50">
            <Download size={16} />양식 다운로드
          </Button>
          <Button variant="outline" onClick={() => excelUploadRef.current?.click()} className="gap-2 border-stone-300 text-stone-600 hover:bg-stone-50">
            <Upload size={16} />엑셀 일괄 등록
          </Button>
          <input
            ref={excelUploadRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) parseExcelFile(f); }}
          />
          <Button
            variant="outline"
            onClick={syncPostCost}
            disabled={isSyncing}
            className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            {isSyncing ? '동기화 중...' : '원가 동기화'}
          </Button>
          <Button onClick={() => openAdd()} className="bg-[#C9A96E] hover:bg-[#B8985D] text-white gap-2">
            <Plus size={16} />품목 등록
          </Button>
        </div>
      </div>

      {/* 품목 수 통계 — 클릭 시 카테고리 필터 (바이어 지정 시 해당 바이어만 집계) */}
      <div className="grid grid-cols-5 gap-3">
        {([
          { key: 'HB', label: 'HB (핸드백)', count: tabCounts.HB, active: 'bg-blue-100 border-blue-400 ring-2 ring-blue-300', idle: 'bg-blue-50 border-blue-200 hover:border-blue-400', num: 'text-blue-700', sub: 'text-blue-600' },
          { key: 'ACC', label: 'ACC (소품)', count: tabCounts.ACC, active: 'bg-purple-100 border-purple-400 ring-2 ring-purple-300', idle: 'bg-purple-50 border-purple-200 hover:border-purple-400', num: 'text-purple-700', sub: 'text-purple-600' },
          { key: 'SHOES', label: 'SHOES (슈즈)', count: tabCounts.SHOES, active: 'bg-green-100 border-green-400 ring-2 ring-green-300', idle: 'bg-green-50 border-green-200 hover:border-green-400', num: 'text-green-700', sub: 'text-green-600' },
          { key: 'PACK' as const, label: 'PACK (패키지)', count: tabCounts.PACK, active: 'bg-amber-100 border-amber-400 ring-2 ring-amber-300', idle: 'bg-amber-50 border-amber-200 hover:border-amber-400', num: 'text-amber-700', sub: 'text-amber-600' },
          { key: '전체', label: '전체', count: tabCounts.전체, active: 'bg-stone-100 border-stone-400 ring-2 ring-stone-300', idle: 'bg-white border-stone-200 hover:border-stone-400', num: 'text-stone-800', sub: 'text-stone-500' },
        ] as const).map(tab => {
          const selected = filterErpCategory === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setFilterErpCategory(tab.key);
                // PACK 탭: 시즌 필터 때문에 목록이 비지 않도록
                if (tab.key === 'PACK') setFilterSeason('전체');
              }}
              className={`rounded-xl border p-3 text-center transition-all cursor-pointer ${selected ? tab.active : tab.idle}`}
            >
              <p className={`text-xl font-bold ${tab.num}`}>{tab.count}</p>
              <p className={`text-xs mt-0.5 ${tab.sub}`}>{tab.label}</p>
            </button>
          );
        })}
      </div>
      {filterBuyer !== '전체' && (
        <p className="text-xs text-stone-500 -mt-2">
          바이어 필터 적용 중 — 탭·목록에 해당 바이어 품목만 표시됩니다
        </p>
      )}

      {/* 품목목록 / 누적생산량 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setListTab('items')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              listTab === 'items' ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-50'
            }`}
          >
            품목목록
          </button>
          <button
            type="button"
            onClick={() => setListTab('production')}
            className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition-colors ${
              listTab === 'production' ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-50'
            }`}
          >
            <Factory size={14} />
            누적생산량
          </button>
        </div>
        {listTab === 'production' && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
            <span>
              누적발주 {prodSummary.ordersN.toLocaleString()}회 · 스타일 {prodSummary.styles}종 · 누적 {prodSummary.qty.toLocaleString()}pcs
            </span>
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-[#C9A96E]"
                checked={prodOrderedOnly}
                onChange={e => setProdOrderedOnly(e.target.checked)}
              />
              발주 있는 품목만
            </label>
          </div>
        )}
      </div>

      {/* 필터 */}
      <Card className="border-stone-200">
        <CardContent className="p-3 space-y-2">
          {/* 1행: 텍스트 검색 + 바이어 + 입희화 */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[150px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input placeholder="스타일번호 검색" value={filterStyleNo} onChange={e => setFilterStyleNo(e.target.value)} className="pl-8 h-9 text-sm" />
            </div>
            <div className="relative flex-1 min-w-[150px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input placeholder="품명 검색 (한/영)" value={filterName} onChange={e => setFilterName(e.target.value)} className="pl-8 h-9 text-sm" />
            </div>
            <Select value={filterBuyer} onValueChange={setFilterBuyer}>
              <SelectTrigger className="w-36 h-9"><SelectValue placeholder="바이어" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체 바이어</SelectItem>
                {buyerVendors.map(v => <SelectItem key={v.id} value={v.id}>{v.code || v.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              onClick={resetFilters}
              className="h-9 px-3 rounded-lg border border-stone-200 text-xs font-medium text-stone-500 hover:bg-stone-50 flex items-center gap-1.5 whitespace-nowrap"
            >
              <X size={13} />필터 초기화
              {activeFilterCount > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center bg-amber-500 text-white text-[10px] font-bold rounded-full w-4 h-4">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
          {/* 2행: 드롭다운 필터 */}
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={filterErpCategory} onValueChange={setFilterErpCategory}>
              <SelectTrigger className="w-32 h-9"><SelectValue placeholder="카테고리" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체 카테고리</SelectItem>
                <SelectItem value="HB">HB (핸드백)</SelectItem>
                <SelectItem value="ACC">ACC (소품)</SelectItem>
                <SelectItem value="SHOES">SHOES (슈즈)</SelectItem>
                <SelectItem value="PACK">PACK (패키지)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterSeason} onValueChange={setFilterSeason}>
              <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체 시즌</SelectItem>
                {SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">세부 카테고리</SelectItem>
                {[...HB_CATEGORIES, ...ACC_CATEGORIES, ...SHOES_CATEGORIES, ...PACK_CATEGORIES].filter((c, i, a) => a.indexOf(c) === i).map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              onClick={() => setFilterNoBom(v => !v)}
              className={`h-9 px-3 rounded-lg border text-xs font-medium transition-colors ${filterNoBom ? 'bg-red-50 border-red-300 text-red-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}
            >
              BOM 미작성 {filterNoBom && `(${items.filter(i => !i.hasBom).length}건)`}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* 다중 선택 액션 바 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-800 text-white rounded-xl">
          <span className="text-sm font-medium">{selectedIds.size}개 선택됨</span>
          <button
            onClick={handleBulkOrder}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            📦 선택 발주
          </button>
          <button
            onClick={openBatchCostUpload}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors"
          >
            🏭 공장 원가표 업로드
          </button>
          <button
            onClick={downloadSelectedItemsExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Download size={13} />엑셀 다운로드
          </button>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            🗑️ 선택 삭제
          </button>
          <button
            onClick={() => setShowSelectedOnly(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showSelectedOnly ? 'bg-blue-500 hover:bg-blue-600' : 'bg-stone-600 hover:bg-stone-500'} text-white`}
          >
            {showSelectedOnly ? '👁 선택만 보기 ON' : '👁 선택만 보기'}
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setShowSelectedOnly(false); }}
            className="flex items-center gap-1 px-3 py-1.5 bg-stone-600 hover:bg-stone-500 text-white rounded-lg text-xs font-medium transition-colors"
          >
            ✕ 선택 해제
          </button>
        </div>
      )}

      {/* 테이블 */}
      {listTab === 'items' ? (
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm table-fixed w-full" style={{ minWidth: 40 + 70 + ITEM_COLUMN_DEFS.filter(c => showCol(c.key)).reduce((s, c) => s + (colWidths[c.key] || 80), 0) }}>
            <colgroup>
              <col style={{ width: 40 }} />
              {orderNodes(colOrder, colOrder.map(k =>
                showCol(k) ? <col key={k} style={{ width: colWidths[k] || 80 }} /> : null
              ))}
              <col style={{ width: colWidths.action }} />
            </colgroup>
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50">
                <th className="px-4 py-3" style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-stone-300 accent-[#C9A96E] cursor-pointer"
                  />
                </th>
                {orderNodes(colOrder, [
                  showCol('image') && (
                  <th key="image" className="text-left px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    이미지
                    <div onMouseDown={(e) => startResize(e, 'image')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('styleNo') && (
                  <th key="styleNo" className="text-left px-4 py-3 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700 select-none relative overflow-hidden whitespace-nowrap" onClick={() => handleSort('styleNo')}>
                    스타일번호<SortIcon field="styleNo" />
                    <div onMouseDown={(e) => startResize(e, 'styleNo')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('season') && (
                  <th key="season" className="text-left px-4 py-3 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700 select-none relative overflow-hidden whitespace-nowrap" onClick={() => handleSort('season')}>
                    시즌<SortIcon field="season" />
                    <div onMouseDown={(e) => startResize(e, 'season')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('buyer') && (
                  <th key="buyer" className="text-left px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    바이어
                    <div onMouseDown={(e) => startResize(e, 'buyer')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('name') && (
                  <th key="name" className="text-left px-4 py-3 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700 select-none relative overflow-hidden whitespace-nowrap" onClick={() => handleSort('name')}>
                    품명<SortIcon field="name" />
                    <div onMouseDown={(e) => startResize(e, 'name')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('category') && (
                  <th key="category" className="text-left px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    카테고리
                    <div onMouseDown={(e) => startResize(e, 'category')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('color') && (
                  <th key="color" className="text-left px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    컬러
                    <div onMouseDown={(e) => startResize(e, 'color')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('delivery') && (
                  <th key="delivery" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    납품가(KRW)
                    <div onMouseDown={(e) => startResize(e, 'delivery')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('bomCost') && (
                  <th key="bomCost" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    총원가액
                    <div onMouseDown={(e) => startResize(e, 'bomCost')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('factoryCost') && (
                  <th key="factoryCost" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    공장단가
                    <div onMouseDown={(e) => startResize(e, 'factoryCost')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('processing') && (
                  <th key="processing" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    임가공비
                    <div onMouseDown={(e) => startResize(e, 'processing')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('logistics') && (
                  <th key="logistics" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    물류비
                    <div onMouseDown={(e) => startResize(e, 'logistics')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('packaging') && (
                  <th key="packaging" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    포장/검사비
                    <div onMouseDown={(e) => startResize(e, 'packaging')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('packing') && (
                  <th key="packing" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    패킹재
                    <div onMouseDown={(e) => startResize(e, 'packing')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('prodMargin') && (
                  <th key="prodMargin" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    생산마진
                    <div onMouseDown={(e) => startResize(e, 'prodMargin')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('salePrice') && (
                  <th key="salePrice" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    KMSRP
                    <div onMouseDown={(e) => startResize(e, 'salePrice')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('multiple') && (
                  <th key="multiple" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    실현배수
                    <div onMouseDown={(e) => startResize(e, 'multiple')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('margin') && (
                  <th key="margin" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    마진율
                    <div onMouseDown={(e) => startResize(e, 'margin')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('orderCount') && (
                  <th key="orderCount" className="text-center px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    발주차수
                    <div onMouseDown={(e) => startResize(e, 'orderCount')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('cumQty') && (
                  <th key="cumQty" className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    누적생산량
                    <div onMouseDown={(e) => startResize(e, 'cumQty')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('noOrder') && (
                  <th key="noOrder" className="text-center px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    미발주기간
                    <div onMouseDown={(e) => startResize(e, 'noOrder')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('createdAt') && (
                  <th key="createdAt" className="text-center px-4 py-3 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700 select-none relative overflow-hidden whitespace-nowrap" onClick={() => handleSort('createdAt')}>
                    등록일<SortIcon field="createdAt" />
                    <div onMouseDown={(e) => startResize(e, 'createdAt')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                  showCol('bom') && (
                  <th key="bom" className="text-center px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden whitespace-nowrap">
                    BOM
                    <div onMouseDown={(e) => startResize(e, 'bom')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                  </th>
                  ),
                ])}
                <th className="text-center px-4 py-3 text-xs font-medium text-stone-500 whitespace-nowrap">작업</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map(item => {
                const rd = rowDataMap.get(item.id) ?? { bom: null, delivery: 0, bomCost: 0, confirmedSalePrice: 0, actualMultiple: 0, marginRate: null, marginAmount: null, factoryUnitCostKrw: 0, logisticsKrw: 0, packagingKrw: 0, processingKrw: 0, processingBase: 0, processingCur: 'CNY', packingKrw: 0, prodMarginRate: 0, colorCosts: [] as ColorCostRow[], displayColors: [] as string[] };
                const { bom: itemBom, delivery, bomCost, confirmedSalePrice, actualMultiple, marginRate, marginAmount, factoryUnitCostKrw, logisticsKrw, packagingKrw, processingKrw, processingCur, packingKrw, prodMarginRate, colorCosts, displayColors } = rd;
                const costByColor = new Map(colorCosts.map(c => [c.color.trim().toUpperCase(), c]));
                const colorRows = (displayColors.length > 0
                  ? displayColors
                  : (colorCosts.length > 0 ? colorCosts.map(c => c.color) : [])
                ).map(name => {
                  const cc = costByColor.get(name.trim().toUpperCase());
                  return {
                    name,
                    displayCost: cc?.displayCost ?? 0,
                    factoryUnitCostKrw: cc?.factoryUnitCostKrw ?? 0,
                  };
                });
                const showColorCostRows = colorRows.length > 1
                  || (colorRows.length === 1 && !['기본', '전체'].includes(colorRows[0].name));
                // 컬러별 원가 없고 단일/전체 BOM 원가만 있을 때 — 행별 — 대신 합산 표시
                const aggregateOnlyCost = showColorCostRows
                  && colorRows.every(r => r.displayCost <= 0)
                  && bomCost > 0;
                const aggregateOnlyFactory = showColorCostRows
                  && colorRows.every(r => r.factoryUnitCostKrw <= 0)
                  && factoryUnitCostKrw > 0;
                const COLOR_CHIP_MAX = 3;
                const visibleColorRows = colorRows.slice(0, COLOR_CHIP_MAX);
                const extraColorCount = Math.max(0, colorRows.length - COLOR_CHIP_MAX);
                const months = monthsSinceLastOrder(item);
                const isChecked = selectedIds.has(item.id);
                return (
                  <tr key={item.id} className={`border-b border-stone-50 hover:bg-stone-50/50 ${isChecked ? 'bg-amber-50/60' : ''}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4 rounded border-stone-300 accent-[#C9A96E] cursor-pointer"
                      />
                    </td>
                    {orderNodes(colOrder, [
                    showCol('image') && (
                      <td key="image" className="px-3 py-2.5">
                        {item.imageUrl ? (
                          <HoverZoomImage
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-10 h-10 rounded-lg border border-stone-200 overflow-hidden cursor-zoom-in"
                            imgClassName="w-10 h-10 object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center">
                            <Package size={16} className="text-stone-300" />
                          </div>
                        )}
                      </td>
                    ),
                    showCol('styleNo') && (
                      <td key="styleNo" className="px-4 py-3 font-mono text-xs font-medium text-stone-700 whitespace-nowrap">{item.styleNo}</td>
                    ),
                    showCol('season') && (
                      <td key="season" className="px-4 py-3">
                        {item.season ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-medium whitespace-nowrap">{item.season}</span>
                        ) : <span className="text-stone-300 text-xs">-</span>}
                      </td>
                    ),
                    showCol('buyer') && (
                      <td key="buyer" className="px-4 py-3">
                        {item.buyerId ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
                            {vendorMap.get(item.buyerId)?.code || vendorMap.get(item.buyerId)?.name || '-'}
                          </span>
                        ) : <span className="text-stone-300 text-xs">-</span>}
                      </td>
                    ),
                    showCol('name') && (
                      <td key="name" className="px-4 py-3 overflow-hidden">
                        <p className="font-medium text-stone-800 truncate" title={item.name}>{item.name}</p>
                        {item.nameEn && <p className="text-xs text-stone-400 truncate" title={item.nameEn}>{item.nameEn}</p>}
                      </td>
                    ),
                    showCol('category') && (
                      <td key="category" className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {item.erpCategory && (
                            <span className={`text-xs px-1.5 py-0.5 rounded border w-fit ${ERP_CAT_COLOR[item.erpCategory]}`}>
                              {item.erpCategory}
                            </span>
                          )}
                          <span className="text-xs text-stone-400 whitespace-nowrap">
                            {item.customCategory || item.category}
                          </span>
                        </div>
                      </td>
                    ),
                    showCol('color') && (
                      <td key="color" className="px-4 py-3">
                        {colorRows.length > 0 ? (
                          <div className="flex flex-col gap-0.5 items-start">
                            {visibleColorRows.map(row => (
                              <button
                                key={row.name}
                                type="button"
                                onClick={() => navigate(`/bom?styleNo=${encodeURIComponent(item.id)}&color=${encodeURIComponent(row.name)}`)}
                                className="h-6 text-xs px-1.5 bg-stone-100 text-stone-600 rounded hover:bg-amber-100 hover:text-amber-700 hover:border hover:border-amber-300 border border-transparent transition-colors whitespace-nowrap leading-none"
                                title={`${row.name} 컬러 BOM으로 이동`}
                              >
                                {row.name}
                              </button>
                            ))}
                            {extraColorCount > 0 && (
                              <span
                                className="h-6 text-xs px-1.5 text-stone-400 inline-flex items-center"
                                title={colorRows.slice(COLOR_CHIP_MAX).map(r => r.name).join(', ')}
                              >
                                +{extraColorCount}
                              </span>
                            )}
                          </div>
                        ) : <span className="text-stone-300 text-xs">—</span>}
                      </td>
                    ),
                    showCol('delivery') && (
                      <td key="delivery" className="px-4 py-3 text-right whitespace-nowrap">
                        {delivery > 0 ? (
                          <p className="font-mono text-xs text-stone-700">{formatKRW(delivery)}</p>
                        ) : <span className="text-stone-300 text-xs">—</span>}
                      </td>
                    ),
                    showCol('bomCost') && (
                      <td key="bomCost" className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                        {showColorCostRows && !aggregateOnlyCost ? (
                          <div className="flex flex-col gap-0.5 items-end">
                            {visibleColorRows.map(row => (
                              <button
                                key={row.name}
                                type="button"
                                title={`${row.name} 원가 · BOM 이동`}
                                onClick={() => navigate(`/bom?styleNo=${encodeURIComponent(item.id)}&color=${encodeURIComponent(row.name)}`)}
                                className="h-6 px-1 hover:bg-amber-50 rounded transition-colors inline-flex items-center"
                              >
                                <span className="text-amber-700 font-semibold leading-none">
                                  {row.displayCost > 0 ? formatKRW(row.displayCost) : '—'}
                                </span>
                              </button>
                            ))}
                            {extraColorCount > 0 && (
                              <span className="h-6 px-1 inline-flex items-center text-stone-300">+{extraColorCount}</span>
                            )}
                          </div>
                        ) : bomCost > 0 ? (
                          <span className="text-amber-700 font-semibold">{formatKRW(bomCost)}</span>
                        ) : itemBom ? (
                          <span className="text-stone-300 text-xs">원가미입력</span>
                        ) : (
                          <span className="text-stone-300 text-xs">미등록</span>
                        )}
                      </td>
                    ),
                    showCol('factoryCost') && (
                      <td key="factoryCost" className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                        {showColorCostRows && !aggregateOnlyFactory ? (
                          <div className="flex flex-col gap-0.5 items-end">
                            {visibleColorRows.map(row => (
                              <div key={row.name} className="h-6 px-1 inline-flex items-center">
                                <span className="text-blue-700 leading-none">
                                  {row.factoryUnitCostKrw > 0 ? formatKRW(row.factoryUnitCostKrw) : '—'}
                                </span>
                              </div>
                            ))}
                            {extraColorCount > 0 && (
                              <span className="h-6 px-1 inline-flex items-center text-stone-300">+{extraColorCount}</span>
                            )}
                          </div>
                        ) : factoryUnitCostKrw > 0 ? (
                          <span className="text-blue-700">{formatKRW(factoryUnitCostKrw)}</span>
                        ) : (
                          <span className="text-stone-300 text-xs">—</span>
                        )}
                      </td>
                    ),
                    showCol('processing') && (
                      <td key="processing" className="px-2 py-1 text-right whitespace-nowrap">
                        {itemBom ? (() => {
                          const cur = processingCur || 'CNY';
                          const rate = cur === 'USD' ? (itemBom.exchangeRateUsd || 1380) : cur === 'KRW' ? 1 : (itemBom.exchangeRateCny || itemBom.snapshotCnyKrw || 191);
                          const curKrw = costEdits[item.id]?.processing ?? processingKrw ?? 0;
                          const base = rate > 0 ? curKrw / rate : 0;
                          const sym = cur === 'USD' ? '$' : cur === 'CNY' ? '¥' : '₩';
                          return (
                            <div className="flex flex-col items-end leading-tight">
                              <input inputMode="numeric" value={costEdits[item.id]?.processing ?? (processingKrw || '')}
                                onChange={e => setCostEdit(item.id, 'processing', e.target.value)}
                                className={`w-20 text-right font-mono text-xs rounded px-1 py-0.5 bg-transparent outline-none border ${costEdits[item.id]?.processing != null ? 'border-[#20E39B] bg-[#20E39B]/5' : 'border-transparent hover:border-stone-300 focus:border-[#20E39B]'}`} />
                              <span className="text-[10px] text-stone-400 font-mono pr-1">{base > 0 ? `${sym}${cur === 'USD' ? base.toFixed(1) : Math.round(base).toLocaleString()}` : ''}</span>
                            </div>
                          );
                        })() : <span className="text-stone-300 font-mono text-xs">—</span>}
                      </td>
                    ),
                    showCol('logistics') && (
                      <td key="logistics" className="px-2 py-1 text-right whitespace-nowrap">
                        {itemBom ? (
                          <input inputMode="numeric" value={costEdits[item.id]?.logistics ?? (logisticsKrw || '')}
                            onChange={e => setCostEdit(item.id, 'logistics', e.target.value)}
                            className={`w-20 text-right font-mono text-xs rounded px-1 py-0.5 bg-transparent outline-none border ${costEdits[item.id]?.logistics != null ? 'border-[#20E39B] bg-[#20E39B]/5' : 'border-transparent hover:border-stone-300 focus:border-[#20E39B]'}`} />
                        ) : <span className="text-stone-300 font-mono text-xs">—</span>}
                      </td>
                    ),
                    showCol('packaging') && (
                      <td key="packaging" className="px-2 py-1 text-right whitespace-nowrap">
                        {itemBom ? (
                          <input inputMode="numeric" value={costEdits[item.id]?.packaging ?? (packagingKrw || '')}
                            onChange={e => setCostEdit(item.id, 'packaging', e.target.value)}
                            className={`w-24 text-right font-mono text-xs rounded px-1 py-0.5 bg-transparent outline-none border ${costEdits[item.id]?.packaging != null ? 'border-[#20E39B] bg-[#20E39B]/5' : 'border-transparent hover:border-stone-300 focus:border-[#20E39B]'}`} />
                        ) : <span className="text-stone-300 font-mono text-xs">—</span>}
                      </td>
                    ),
                    showCol('packing') && (
                      <td key="packing" className="px-2 py-1 text-right whitespace-nowrap">
                        {itemBom ? (() => {
                          const origId = itemBom.packingItemId || '';
                          const sel = packEdits[item.id] ?? origId;
                          const dirty = item.id in packEdits;
                          const selItem = sel ? packItemMap.get(sel) : null;
                          const cost = selItem ? resolvePackItemCostKrw(selItem) : (sel ? packingKrw : 0);
                          return (
                            <div className="flex flex-col items-end leading-tight">
                              <select value={sel} onChange={e => setPackEdit(item.id, e.target.value, origId)}
                                className={`w-28 text-xs rounded px-1 py-0.5 outline-none border bg-white ${dirty ? 'border-[#20E39B] bg-[#20E39B]/5' : 'border-transparent hover:border-stone-300 focus:border-[#20E39B]'}`}>
                                <option value="">— 없음 —</option>
                                {sel && !selItem && <option value={sel}>{itemBom.packingItemStyleNo || sel}</option>}
                                {packItems.map(p => <option key={p.id} value={p.id}>{p.styleNo}</option>)}
                              </select>
                              <span className="text-[10px] text-stone-400 font-mono pr-1">{cost > 0 ? formatKRW(cost) : ''}</span>
                            </div>
                          );
                        })() : <span className="text-stone-300 font-mono text-xs">—</span>}
                      </td>
                    ),
                    showCol('prodMargin') && (
                      <td key="prodMargin" className="px-2 py-1 text-right whitespace-nowrap">
                        {itemBom ? (
                          <span className="inline-flex items-center gap-0.5">
                            <input inputMode="numeric" value={costEdits[item.id]?.prodMarginPct ?? (prodMarginRate ? Math.round(prodMarginRate * 100) : '')}
                              onChange={e => setCostEdit(item.id, 'prodMarginPct', e.target.value)}
                              className={`w-12 text-right font-mono text-xs rounded px-1 py-0.5 bg-transparent outline-none border ${costEdits[item.id]?.prodMarginPct != null ? 'border-[#20E39B] bg-[#20E39B]/5' : 'border-transparent hover:border-stone-300 focus:border-[#20E39B]'}`} />
                            <span className="text-stone-400 text-xs">%</span>
                          </span>
                        ) : <span className="text-stone-300 font-mono text-xs">—</span>}
                      </td>
                    ),
                    showCol('salePrice') && (
                      <td key="salePrice" className="px-2 py-1 text-right whitespace-nowrap">
                        <input inputMode="numeric"
                          value={msrpEdits[item.id] ?? (confirmedSalePrice || '')}
                          onChange={e => setMsrpEdit(item.id, e.target.value, confirmedSalePrice)}
                          className={`w-24 text-right font-mono text-xs rounded px-1 py-0.5 bg-transparent outline-none border ${item.id in msrpEdits ? 'border-[#20E39B] bg-[#20E39B]/5' : 'border-transparent hover:border-stone-300 focus:border-[#20E39B]'}`} />
                      </td>
                    ),
                    showCol('multiple') && (
                      <td key="multiple" className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                        {actualMultiple > 0 ? (
                          <span className={`font-semibold ${actualMultiple >= 3.5 ? 'text-green-600' : actualMultiple >= 3.0 ? 'text-amber-600' : 'text-red-500'}`}>
                            {actualMultiple.toFixed(2)}x
                          </span>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                    ),
                    showCol('margin') && (
                      <td key="margin" className="px-4 py-3 text-right whitespace-nowrap">
                        {marginRate !== null ? (
                          <div>
                            <p className={`text-xs font-medium ${marginColorClass(marginRate)}`}>
                              {marginRate.toFixed(1)}%
                            </p>
                            {marginAmount !== null && (
                              <p className="text-[10px] text-stone-400">{formatKRW(marginAmount)}</p>
                            )}
                          </div>
                        ) : <span className="text-stone-300 text-xs">—</span>}
                      </td>
                    ),
                    showCol('orderCount') && (() => {
                      const st = itemOrderStats.get(item.id) || EMPTY_ORDER_STAT;
                      return (
                        <td key="orderCount" className="px-4 py-3 text-center whitespace-nowrap">
                          {st.orderCount > 0 ? (
                            <button
                              type="button"
                              className="inline-flex items-center"
                              title="발주 누적 횟수 (1차·2차·…N차) · 클릭 시 상세"
                              onClick={() => setListTab('production')}
                            >
                              <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                {st.orderCount}차
                              </span>
                            </button>
                          ) : (
                            <span className="text-xs text-stone-300">—</span>
                          )}
                        </td>
                      );
                    })(),
                    showCol('cumQty') && (() => {
                      const st = itemOrderStats.get(item.id) || EMPTY_ORDER_STAT;
                      return (
                        <td key="cumQty" className="px-4 py-3 text-right whitespace-nowrap">
                          {st.cumQty > 0 ? (
                            <span className="text-xs font-mono font-medium text-stone-700">
                              {st.cumQty.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-xs text-stone-300">—</span>
                          )}
                        </td>
                      );
                    })(),
                    showCol('noOrder') && (
                      <td key="noOrder" className="px-4 py-3 text-center whitespace-nowrap">
                        {months === null ? (
                          <span className="text-xs text-stone-400 font-medium">미발주</span>
                        ) : (
                          <span className={`text-xs font-medium ${months >= 12 ? 'text-red-500' : months >= 6 ? 'text-amber-600' : 'text-stone-500'}`}>
                            {months}개월
                          </span>
                        )}
                      </td>
                    ),
                    showCol('createdAt') && (
                      <td key="createdAt" className="px-4 py-3 text-center whitespace-nowrap">
                        <span className="text-xs text-stone-500">{item.createdAt ? item.createdAt.split('T')[0] : '-'}</span>
                      </td>
                    ),
                    showCol('bom') && (
                      <td key="bom" className="px-4 py-3 text-center">
                        {(() => {
                          const bomOk = hasEffectiveBom(item, { bom: itemBom, bomCost, colorCosts });
                          return (
                        <button
                          onClick={() => {
                            localStorage.setItem('ames_prefill_bom', item.id);
                            navigate('/bom');
                          }}
                          className={`text-xs px-2 py-0.5 rounded border transition-colors font-medium whitespace-nowrap ${
                            bomOk
                              ? 'text-green-700 border-green-300 bg-green-50 hover:bg-green-100'
                              : 'text-red-600 border-red-300 bg-red-50 hover:bg-red-100'
                          }`}
                        >
                          {bomOk ? 'BOM ✓' : 'BOM ⚠'}
                        </button>
                          );
                        })()}
                      </td>
                    ),
                    ])}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 rounded hover:bg-stone-100 text-stone-500">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={2 + visibleDataColCount} className="text-center py-12 text-stone-400">
                  <Package size={32} className="mx-auto mb-2 opacity-30" />
                  등록된 품목이 없습니다
                </td></tr>
              )}
            </tbody>
          </table>
          {displayItems.length > renderLimit && (
            <div className="px-4 py-3 border-t border-stone-100 flex items-center justify-center gap-3">
              <span className="text-xs text-stone-500">{renderLimit}/{displayItems.length}개 표시 중</span>
              <button type="button" onClick={() => setRenderLimit(n => n + 200)}
                className="text-sm px-3 py-1.5 rounded border border-stone-300 hover:bg-stone-50">더 보기</button>
              <button type="button" onClick={() => setRenderLimit(displayItems.length)}
                className="text-xs text-stone-500 hover:text-stone-800">전체 표시</button>
            </div>
          )}
        </div>
      </div>
      ) : (
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 flex flex-wrap items-center gap-2">
          <Factory size={16} className="text-amber-700" />
          <span className="text-sm font-semibold text-stone-800">스타일별 누적생산량</span>
          <span className="text-xs text-stone-400">발주차수 = 누적 발주 횟수 (5번 발주면 5차) · 컬러별 수량 · 행 클릭 시 발주 상세</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead>
              <tr className="border-b border-stone-100 bg-white text-xs text-stone-500">
                <th className="w-8 px-2 py-2" />
                <th className="text-left px-3 py-2">스타일번호</th>
                <th className="text-left px-3 py-2">품명</th>
                <th className="text-left px-3 py-2">시즌</th>
                <th className="text-left px-3 py-2">바이어</th>
                <th className="text-center px-3 py-2 whitespace-nowrap">발주차수</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">누적생산량</th>
                <th className="text-left px-3 py-2 min-w-[280px]">컬러별 생산수량</th>
                <th className="text-center px-3 py-2">최종발주</th>
              </tr>
            </thead>
            <tbody>
              {prodDisplayItems.map(item => {
                const st = itemOrderStats.get(item.id) || EMPTY_ORDER_STAT;
                const open = prodExpanded.has(item.id);
                const colorEntries = Object.entries(st.byColor).sort((a, b) => b[1] - a[1]);
                const totalForBar = st.cumQty || colorEntries.reduce((s, [, q]) => s + q, 0) || 1;
                return (
                  <Fragment key={item.id}>
                    <tr
                      className={`border-t border-stone-100 hover:bg-amber-50/40 cursor-pointer align-top ${st.orderCount === 0 ? 'opacity-50' : ''}`}
                      onClick={() => st.orderCount > 0 && toggleProdExpand(item.id)}
                    >
                      <td className="px-2 py-3 text-stone-400">
                        {st.orderCount > 0 ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-amber-800 whitespace-nowrap">{item.styleNo}</td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-stone-800 truncate max-w-[200px]" title={item.name}>{item.name}</p>
                        {item.nameEn && <p className="text-[10px] text-stone-400 truncate max-w-[200px]">{item.nameEn}</p>}
                      </td>
                      <td className="px-3 py-3 text-xs text-stone-600">{item.season || '—'}</td>
                      <td className="px-3 py-3 text-xs">
                        {item.buyerId
                          ? (vendorMap.get(item.buyerId)?.code || vendorMap.get(item.buyerId)?.name || '—')
                          : '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {st.orderCount > 0 ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-base font-bold tabular-nums text-amber-900">
                            {st.orderCount}차
                          </span>
                        ) : (
                          <span className="text-xs text-stone-300">미발주</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {st.cumQty > 0 ? (
                          <div className="inline-flex flex-col items-end">
                            <span className="text-base font-bold tabular-nums text-stone-900 leading-none">{st.cumQty.toLocaleString()}</span>
                            <span className="text-[10px] text-stone-400 mt-0.5">pcs</span>
                          </div>
                        ) : <span className="text-xs text-stone-300">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {colorEntries.length > 0 ? (
                          <div className="space-y-1.5 min-w-[260px]">
                            {colorEntries.map(([c, q]) => {
                              const pct = Math.round((q / totalForBar) * 100);
                              return (
                                <div key={c} className="grid grid-cols-[minmax(72px,1fr)_64px_minmax(80px,1.2fr)] gap-2 items-center">
                                  <span className="text-xs font-medium text-stone-700 truncate" title={c}>{c}</span>
                                  <span className="text-xs font-mono font-semibold text-stone-900 text-right tabular-nums">{q.toLocaleString()}</span>
                                  <div className="flex items-center gap-1.5">
                                    <div className="flex-1 h-2 rounded-full bg-stone-100 overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-amber-500/80"
                                        style={{ width: `${Math.max(pct, q > 0 ? 4 : 0)}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-stone-400 w-7 text-right tabular-nums">{pct}%</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : <span className="text-xs text-stone-300">—</span>}
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-stone-500 whitespace-nowrap">
                        {st.lastOrderDate || '—'}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-amber-50/30 border-t border-amber-100/80">
                        <td colSpan={9} className="px-4 py-3">
                          <p className="text-[11px] font-semibold text-stone-500 mb-2">발주 상세 (누적 {st.orderCount}차)</p>
                          <div className="rounded-lg border border-stone-200 overflow-hidden bg-white">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-stone-50 text-stone-500">
                                  <th className="text-left px-3 py-2">차수</th>
                                  <th className="text-left px-3 py-2">발주번호</th>
                                  <th className="text-left px-3 py-2">발주일</th>
                                  <th className="text-left px-3 py-2">상태</th>
                                  <th className="text-right px-3 py-2">수량</th>
                                  <th className="text-left px-3 py-2">컬러별</th>
                                </tr>
                              </thead>
                              <tbody>
                                {st.rounds.map((r, idx) => (
                                  <tr key={`${item.id}-${r.orderId}`} className="border-t border-stone-100">
                                    <td className="px-3 py-2 font-semibold text-stone-800">{idx + 1}차</td>
                                    <td className="px-3 py-2 font-mono text-amber-800">{r.orderNo}</td>
                                    <td className="px-3 py-2 text-stone-600">{r.orderDate || '—'}</td>
                                    <td className="px-3 py-2 text-stone-500">{r.status || '—'}</td>
                                    <td className="px-3 py-2 text-right font-mono font-semibold">{r.qty.toLocaleString()}</td>
                                    <td className="px-3 py-2">
                                      <div className="flex flex-wrap gap-1.5">
                                        {(r.colorQtys || []).map(cq => (
                                          <span
                                            key={`${r.orderId}-${cq.color}`}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-stone-200 bg-stone-50"
                                          >
                                            <span className="text-stone-600">{cq.color}</span>
                                            <span className="font-mono font-semibold text-stone-900">{cq.qty.toLocaleString()}</span>
                                          </span>
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {prodDisplayItems.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-stone-400">
                    {prodOrderedOnly ? '발주 이력이 있는 품목이 없습니다 · 「발주 있는 품목만」 해제해 보세요' : '필터에 해당하는 품목이 없습니다'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* 열 설정 */}
      <Dialog open={colSettingsOpen} onOpenChange={setColSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Columns3 size={18} />열 설정
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-stone-500 -mt-1">체크로 표시/숨김, ▲▼로 열 순서를 바꿉니다. 설정은 이 브라우저에 저장됩니다.</p>
          <div className="space-y-0.5 max-h-[50vh] overflow-y-auto py-1">
            {colOrder.map((key, i) => {
              const col = ITEM_COLUMN_DEFS.find(c => c.key === key);
              if (!col) return null;
              return (
                <div key={key} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-stone-50">
                  <div className="flex items-center gap-0.5 min-w-0">
                    <button type="button" disabled={i === 0} onClick={() => moveCol(key, -1)}
                      className="p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-20 disabled:cursor-default" title="위로">
                      <ChevronUp size={14} />
                    </button>
                    <button type="button" disabled={i === colOrder.length - 1} onClick={() => moveCol(key, 1)}
                      className="p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-20 disabled:cursor-default" title="아래로">
                      <ChevronDown size={14} />
                    </button>
                    <span className="text-sm text-stone-700 truncate">
                      {col.label}
                      {!col.defaultVisible && <span className="ml-1.5 text-[10px] text-stone-400">기본숨김</span>}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    className="accent-[#C9A96E] w-4 h-4 cursor-pointer shrink-0"
                    checked={showCol(key)}
                    onChange={() => toggleColVisible(key)}
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={resetColVisible}>기본값 복원</Button>
            <Button type="button" size="sm" onClick={() => setColSettingsOpen(false)}>완료</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 시즌별 스타일 현황 모달 */}
      <Dialog open={showSeasonStats} onOpenChange={setShowSeasonStats}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart2 size={18} />시즌별 스타일 현황
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-stone-500">시즌 선택:</Label>
              <Select value={seasonStatsTarget} onValueChange={setSeasonStatsTarget}>
                <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="전체">전체</SelectItem>
                  {SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">시즌</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-stone-500">전체</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-blue-600">HB</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-purple-600">ACC</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-green-600">SHOES</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-blue-600">BOM완료</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-red-500">BOM미작성</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonStats.map(row => (
                    <tr key={row.season} className="border-b border-stone-50 hover:bg-stone-50">
                      <td className="px-4 py-2.5 font-semibold text-stone-700">{row.season}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-stone-800">{row.total}</td>
                      <td className="px-3 py-2.5 text-center text-blue-700">{row.hb}</td>
                      <td className="px-3 py-2.5 text-center text-purple-700">{row.acc}</td>
                      <td className="px-3 py-2.5 text-center text-green-700">{row.shoes}</td>
                      <td className="px-3 py-2.5 text-center text-blue-600">{row.hasBom}</td>
                      <td className="px-3 py-2.5 text-center">
                        {row.noBom > 0 ? (
                          <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                            <AlertCircle size={12} />{row.noBom}
                          </span>
                        ) : <span className="text-stone-300">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSeasonStats(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 변경사항 확인 다이얼로그 */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onSaveAndClose={() => { setShowUnsavedDialog(false); handleSave(); }}
        onDiscardAndClose={() => { setShowUnsavedDialog(false); setIsDirty(false); setModalOpen(false); }}
        onCancel={() => setShowUnsavedDialog(false)}
      />

      {/* 등록/수정 모달 */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) handleModalClose(true); }}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? '품목 수정' : '품목 등록'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* 스타일번호 자동생성 */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Wand2 size={15} className="text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800">스타일번호 자동생성</span>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={manualStyleNo} onChange={e => {
                    setManualStyleNo(e.target.checked);
                    if (!e.target.checked) setEditItem(prev => ({ ...prev, styleNo: previewStyleNo }));
                  }} className="w-3.5 h-3.5 accent-amber-600" />
                  <span className="text-xs text-amber-700">직접 입력</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-amber-700">거래처 (브랜드코드 보유)</Label>
                  <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
                    <SelectTrigger className="h-8 text-sm bg-white"><SelectValue placeholder="거래처 선택" /></SelectTrigger>
                    <SelectContent>
                      {brandVendors.length === 0
                        ? <div className="px-3 py-2 text-xs text-stone-400">브랜드코드 등록된 거래처 없음</div>
                        : brandVendors.map(v => (
                          <SelectItem key={v.id} value={v.id}>
                            <span className="font-mono font-bold text-amber-700 mr-2">[{v.code}]</span>{v.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-amber-700">등록일 (YYMM 기준)</Label>
                  <Input type="date" value={registDate} onChange={e => setRegistDate(e.target.value)} className="h-8 text-sm bg-white" />
                </div>
              </div>
              {!manualStyleNo ? (
                <div className="flex items-center gap-2 p-2.5 bg-white border border-amber-200 rounded-lg">
                  {previewStyleNo ? (
                    <>
                      <span className="text-xs text-amber-600">예상 품번:</span>
                      <span className="font-mono font-bold text-amber-800 text-base tracking-widest">{previewStyleNo}</span>
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-amber-500">
                      <AlertCircle size={13} />거래처와 카테고리를 선택하면 자동으로 생성됩니다
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs text-amber-700">스타일번호 (직접 입력)</Label>
                  <Input
                    value={editItem.styleNo || ''}
                    onChange={e => setEditItem({ ...editItem, styleNo: e.target.value.toUpperCase() })}
                    placeholder="AT2603HB01"
                    className="font-mono uppercase bg-white"
                  />
                </div>
              )}
            </div>

            {/* 기본 정보 */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-stone-600">기본 정보</p>

              {/* 카테고리 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>카테고리</Label>
                  <Select
                    value={editItem.erpCategory || 'HB'}
                    onValueChange={v => {
                      const newErpCat = v as ErpCategory;
                      // erpCategory 변경 시 세부 카테고리 기본값 변경
                      const defaultCategory =
                        newErpCat === 'ACC' ? '파우치' :
                        newErpCat === 'SHOES' ? '스니커즈' :
                        newErpCat === 'PACK' ? '기타' : '숄더백';
                      setEditItem({
                        ...editItem,
                        erpCategory: newErpCat,
                        category: defaultCategory,
                        customCategory: newErpCat === 'PACK' ? '패키지키트' : undefined,
                        materialType: newErpCat === 'PACK' ? '완제품' : (editItem.materialType || '완제품'),
                      });
                      setCustomCategory(newErpCat === 'PACK' ? '패키지키트' : '');
                      if (newErpCat === 'PACK') setPackLines([]);
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HB">HB (핸드백)</SelectItem>
                      <SelectItem value="ACC">ACC (소품)</SelectItem>
                      <SelectItem value="SHOES">SHOES (슈즈)</SelectItem>
                      <SelectItem value="PACK">PACK (패키지)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>세부 카테고리</Label>
                  <Select
                    value={editItem.category || (editItem.erpCategory === 'ACC' ? '파우치' : editItem.erpCategory === 'SHOES' ? '스니커즈' : editItem.erpCategory === 'PACK' ? '기타' : '숄더백')}
                    onValueChange={v => {
                      setEditItem({ ...editItem, category: v as Category });
                      if (v !== '기타') setCustomCategory('');
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {subCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      <SelectItem value="비고(직접입력)">비고(직접입력)</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* 기타 또는 비고(직접입력) 선택 시 직접 입력 */}
                  {(editItem.category === '기타' || (editItem.category as string) === '비고(직접입력)') && (
                    <Input
                      value={customCategory}
                      onChange={e => setCustomCategory(e.target.value)}
                      placeholder="직접 입력 (예: 카드케이스, 파우치)"
                      className="mt-1.5 text-sm"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>품명 (국문) *</Label>
                  <Input value={editItem.name || ''} onChange={e => setEditItem({ ...editItem, name: e.target.value })} placeholder="파니에 쁘띠 백" />
                </div>
                <div className="space-y-1.5">
                  <Label>품명 (영문)</Label>
                  <Input value={editItem.nameEn || ''} onChange={e => setEditItem({ ...editItem, nameEn: e.target.value })} placeholder="PANIER PETIT BAG" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>시즌</Label>
                  <Select value={editItem.season || '26SS'} onValueChange={v => setEditItem({ ...editItem, season: v as Season })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>패킹사이즈</Label>
                  <Select
                    value={editItem.packingSize || '_none'}
                    onValueChange={v => setEditItem({ ...editItem, packingSize: v === '_none' ? undefined : v as PackingSize })}
                  >
                    <SelectTrigger><SelectValue placeholder="사이즈 선택" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">없음</SelectItem>
                      {PACKING_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {editItem.erpCategory === 'PACK' ? (
                  <div className="space-y-1.5 col-span-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
                    PACK는 자재마스터(포장재)에서 구성품을 선택하면 <b>전체원가가 자동 합산</b>됩니다. 사전/사후원가 없음.
                  </div>
                ) : null}
                {editItem.erpCategory === 'PACK' ? (
                  <div className="space-y-1.5 col-span-2">
                    <Label>패키지 구성 (자재마스터)</Label>
                    <PackBomEditor
                      lines={packLines}
                      materials={materials}
                      onChange={lines => {
                        setPackLines(lines);
                        const total = packLinesTotal(lines);
                        setEditItem(prev => ({
                          ...prev,
                          baseCostKrw: total,
                          deliveryPrice: prev.deliveryPrice || total,
                        }));
                        setIsDirty(true);
                      }}
                      compact
                    />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label>소재 / 스펙</Label>
                  <Input value={editItem.material || ''} onChange={e => setEditItem({ ...editItem, material: e.target.value })} placeholder={editItem.erpCategory === 'PACK' ? 'BAG 표준키트 L' : '소가죽'} />
                </div>
              </div>
            </div>

            {/* 가격 정보 */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-stone-600">가격 정보</p>

              {/* BOM 원가 표시 영역 */}
              {(() => {
                const styleNo = editItem.styleNo || '';
                const hasBom = isEdit ? items.find(i => i.id === editItem.id)?.hasBom : false;
                const rd = isEdit && editItem.id ? rowDataMap.get(editItem.id) : undefined;
                const colorCosts = rd?.colorCosts || [];
                const bomCostVal = colorCosts.length > 0
                  ? Math.max(...colorCosts.map(c => c.displayCost))
                  : (hasBom && styleNo ? store.getBomTotalCost(styleNo) : 0);
                const showByColor = colorCosts.length > 0 && (colorCosts.length > 1 || !['기본', '전체'].includes(colorCosts[0].color));
                return (
                  <div className={`p-3 rounded-lg border ${hasBom && bomCostVal > 0 ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-200'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-stone-600">BOM 원가:</span>
                        {showByColor ? (
                          <div className="mt-1.5 space-y-1">
                            {colorCosts.map(cc => (
                              <div key={cc.color} className="flex items-center justify-between gap-3 text-xs">
                                <span className="text-stone-500 truncate">{cc.color}</span>
                                <span className="font-bold text-amber-700 font-mono">{cc.displayCost > 0 ? formatKRW(cc.displayCost) : '—'}</span>
                              </div>
                            ))}
                          </div>
                        ) : hasBom && bomCostVal > 0 ? (
                          <span className="ml-2 text-sm font-bold text-amber-700">{formatKRW(bomCostVal)}</span>
                        ) : (
                          <span className="ml-2 text-xs text-stone-400">
                            {hasBom ? '원가 계산중' : 'BOM 미등록'}
                          </span>
                        )}
                      </div>
                      {!hasBom && styleNo && (
                        <button
                          type="button"
                          onClick={() => {
                            setModalOpen(false);
                            localStorage.setItem('ames_prefill_bom', editItem.id || styleNo);
                            navigate('/bom');
                          }}
                          className="flex items-center gap-1 text-xs text-[#C9A96E] hover:text-amber-700 font-medium shrink-0"
                        >
                          <Link size={12} />BOM 등록하러 가기
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-1.5">
                <Label>납품가(KRW)</Label>
                <Input
                  type="number"
                  value={editItem.deliveryPrice ?? editItem.targetSalePrice ?? ''}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setEditItem(prev => ({ ...prev, deliveryPrice: val, targetSalePrice: val }));
                  }}
                  placeholder="바이어 납품가 입력 (예: 85000)"
                />
                <p className="text-[10px] text-stone-400">※ BOM이 등록된 경우 납품가 입력 시 마진이 자동 계산됩니다</p>
              </div>

              {/* 마진 자동 계산 표시 (BOM 원가 연동) */}
              {(() => {
                const styleNo = editItem.styleNo || '';
                const hasBom = isEdit ? items.find(i => i.id === editItem.id)?.hasBom : false;
                const bomCostVal = hasBom && styleNo ? store.getBomTotalCost(styleNo) : 0;
                const deliveryVal = editItem.deliveryPrice ?? editItem.targetSalePrice ?? 0;
                const { rate, amount } = calcMargin(deliveryVal, bomCostVal);
                if (rate === null) return null;
                const bgClass = rate >= 30 ? 'bg-green-50 border-green-200' : rate >= 15 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
                return (
                  <div className={`p-3 rounded-lg border ${bgClass}`}>
                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-xs text-stone-500">마진금액</p>
                        <p className={`text-sm font-bold ${marginColorClass(rate)}`}>
                          {formatKRW(amount || 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-stone-500">마진율</p>
                        <p className={`text-xl font-bold ${marginColorClass(rate)}`}>
                          {rate.toFixed(1)}%
                        </p>
                      </div>
                      <div className="ml-auto text-right">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${rate >= 30 ? 'bg-green-100 text-green-700' : rate >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {rate >= 30 ? '✅ 양호' : rate >= 15 ? '🟡 주의' : '🔴 위험'}
                        </span>
                        <p className="text-[10px] text-stone-400 mt-1">마진율 = (납품가 - BOM원가) / 납품가 × 100</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 컬러 목록 */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Palette size={14} />컬러 목록</Label>
              <div className="flex gap-2">
                <Input
                  value={colorInput}
                  onChange={e => setColorInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addColor(); } }}
                  placeholder="블랙, 베이지, 카멜..."
                  className="h-9"
                />
                <Button type="button" variant="outline" size="sm" onClick={addColor} className="h-9 px-3">추가</Button>
              </div>
              {normalizeColors(editItem.colors || []).length > 0 && (
                <div className="space-y-2 p-2 bg-stone-50 rounded-lg border border-stone-100">
                  {normalizeColors(editItem.colors || []).map((c, idx) => (
                    <div key={idx} className="bg-white border border-stone-200 rounded-lg overflow-hidden">
                      {/* 컬러 헤더 */}
                      <div className="flex items-center justify-between px-3 py-2">
                        <button
                          type="button"
                          className="flex items-center gap-2 text-sm font-medium text-stone-700 hover:text-stone-900 flex-1 text-left"
                          onClick={() => setColorDetailOpen(colorDetailOpen === idx ? null : idx)}
                        >
                          <span className="w-2 h-2 rounded-full bg-stone-400 inline-block" />
                          {c.name}
                          <span className="text-xs text-stone-400 font-normal">
                            {[c.leatherColor, c.decorColor, c.threadColor, c.girimaeColor].filter(Boolean).length > 0
                              ? `— ${[
                                  c.leatherColor ? `가죽: ${c.leatherColor}` : null,
                                  c.decorColor ? `장식: ${c.decorColor}` : null,
                                  c.threadColor ? `실: ${c.threadColor}` : null,
                                  c.girimaeColor ? `기리매: ${c.girimaeColor}` : null,
                                ].filter(Boolean).join(', ')}`
                              : '— 세부정보 없음'}
                          </span>
                          <span className="text-xs text-stone-300 ml-auto">{colorDetailOpen === idx ? '▲' : '▼'}</span>
                        </button>
                        {/* BOM 바로가기 버튼 */}
                        {editItem.styleNo && (
                          <button
                            type="button"
                            onClick={() => {
                              setModalOpen(false);
                              navigate(`/bom?styleNo=${encodeURIComponent(editItem.styleNo || '')}&color=${encodeURIComponent(c.name)}`);
                            }}
                            className="text-xs px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium ml-1 shrink-0"
                            title={`${c.name} 컬러 BOM으로 이동`}
                          >
                            BOM
                          </button>
                        )}
                        <button type="button" onClick={() => removeColor(idx)} className="text-stone-400 hover:text-red-500 ml-1">
                          <X size={14} />
                        </button>
                      </div>
                      {/* 세부 정보 */}
                      {colorDetailOpen === idx && (
                        <div className="px-3 pb-3 grid grid-cols-2 gap-2 border-t border-stone-100 pt-2">
                          <div className="space-y-1">
                            <Label className="text-xs text-stone-500">가죽/원단 컬러</Label>
                            <Input
                              value={c.leatherColor || ''}
                              onChange={e => updateColorDetail(idx, 'leatherColor', e.target.value)}
                              placeholder="블랙"
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-stone-500">장식 컬러</Label>
                            <Input
                              value={c.decorColor || ''}
                              onChange={e => updateColorDetail(idx, 'decorColor', e.target.value)}
                              placeholder="골드"
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-stone-500">실 컬러</Label>
                            <Input
                              value={c.threadColor || ''}
                              onChange={e => updateColorDetail(idx, 'threadColor', e.target.value)}
                              placeholder="블랙"
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-stone-500">기리매 컬러</Label>
                            <Input
                              value={c.girimaeColor || ''}
                              onChange={e => updateColorDetail(idx, 'girimaeColor', e.target.value)}
                              placeholder="블랙"
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>담당 디자이너</Label>
                <Input value={editItem.designer || ''} onChange={e => setEditItem({ ...editItem, designer: e.target.value })} placeholder="디자이너 이름" />
              </div>
              <div className="space-y-1.5">
                <Label>메모</Label>
                <Input value={editItem.memo || ''} onChange={e => setEditItem({ ...editItem, memo: e.target.value })} placeholder="비고" />
              </div>
            </div>

            {/* 대표 이미지 업로드 */}
            <div className="space-y-2">
              <Label>대표 이미지</Label>
              <div className="flex items-center gap-3">
                <div
                  className="w-20 h-20 rounded-xl border-2 border-dashed border-stone-200 flex items-center justify-center cursor-pointer hover:border-amber-400 transition-colors overflow-hidden"
                  onClick={() => imageFileRef.current?.click()}
                >
                  {editItem.imageUrl ? (
                    <HoverZoomImage
                      src={editItem.imageUrl}
                      alt="미리보기"
                      className="w-full h-full"
                      imgClassName="w-full h-full object-cover"
                    />
                  ) : (
                    <Package size={28} className="text-stone-300" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => imageFileRef.current?.click()} className="text-xs">
                    이미지 선택
                  </Button>
                  {editItem.imageUrl && (
                    <Button type="button" variant="ghost" size="sm" className="text-xs text-red-500" onClick={() => setEditItem(prev => ({ ...prev, imageUrl: undefined }))}>
                      삭제
                    </Button>
                  )}
                  <p className="text-xs text-stone-400">최대 800px, JPEG 자동 변환</p>
                </div>
              </div>
              <input ref={imageFileRef} type="file" accept="image/*" className="hidden" onChange={handleItemImageUpload} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>취소</Button>
            <Button onClick={handleSave} className="bg-[#C9A96E] hover:bg-[#B8985D] text-white">{isEdit ? '수정' : '등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 일괄 발주 모달 */}
      {bulkOrderModalOpen && (
        <MultiBulkOrderModal
          open={bulkOrderModalOpen}
          onClose={() => setBulkOrderModalOpen(false)}
          selectedItems={items.filter(i => selectedIds.has(i.id)).map(i => {
            const rd = rowDataMap.get(i.id);
            const names = (rd?.displayColors && rd.displayColors.length > 0)
              ? rd.displayColors
              : resolveItemColorsWithBom(i, rd?.bom || findBomForItem(i)).map(c => c.name);
            const existing = normalizeColors(i.colors || []);
            const colors: ItemColor[] = names.map(name =>
              existing.find(c => c.name.trim().toUpperCase() === name.trim().toUpperCase())
              || { name },
            );
            return { ...i, colors };
          })}
          onComplete={(opts) => {
            setBulkOrderModalOpen(false);
            setSelectedIds(new Set());
            if (opts?.goToCart) {
              try { localStorage.setItem('ames_open_material_cart', '1'); } catch { /* ignore */ }
              navigate('/purchase?cart=1');
            } else {
              navigate('/orders');
            }
          }}
        />
      )}

      {/* 엑셀 일괄 등록 미리보기 모달 */}
      <Dialog open={excelPreviewOpen} onOpenChange={setExcelPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet size={18} className="text-green-600" />
              엑셀 일괄 등록 미리보기
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-4 px-1 py-2 bg-stone-50 rounded-lg text-sm">
            <span className="flex items-center gap-1.5 text-green-700">
              <CheckCircle2 size={14} />
              신규 {excelPreviewItems.filter(p => !p.isDuplicate).length}개
            </span>
            <span className="flex items-center gap-1.5 text-amber-600">
              <XCircle size={14} />
              중복 스킵 {excelPreviewItems.filter(p => p.isDuplicate).length}개
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-stone-100">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">상태</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">스타일번호</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">품목명</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">거래처</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">시즌</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">카테</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">컬러</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">판매가</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {excelPreviewItems.map((p, idx) => (
                  <tr key={idx} className={p.isDuplicate ? 'bg-amber-50 opacity-60' : 'bg-white'}>
                    <td className="px-2 py-1.5">
                      {p.isDuplicate
                        ? <span className="text-amber-600 font-medium">중복</span>
                        : <span className="text-green-600 font-medium">신규</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{p.styleNo}</td>
                    <td className="px-2 py-1.5 max-w-[200px] truncate">{p.name}</td>
                    <td className="px-2 py-1.5">
                      {p.buyerName
                        ? <span className={p.buyerId ? 'text-green-700 font-medium' : 'text-amber-600'}>{p.buyerName}{!p.buyerId && ' ⚠️미매칭'}</span>
                        : <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-2 py-1.5">{p.season}</td>
                    <td className="px-2 py-1.5">{p.erpCategory}</td>
                    <td className="px-2 py-1.5">{p.colors.join(', ')}</td>
                    <td className="px-2 py-1.5">{p.salePriceKrw ? p.salePriceKrw.toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter className="pt-3 border-t border-stone-100">
            <Button variant="outline" onClick={() => { setExcelPreviewOpen(false); if (excelUploadRef.current) excelUploadRef.current.value = ''; }}>
              취소
            </Button>
            <Button
              onClick={handleExcelBulkRegister}
              disabled={excelPreviewItems.filter(p => !p.isDuplicate).length === 0}
              className="bg-[#C9A96E] hover:bg-[#B8985D] text-white"
            >
              <FileSpreadsheet size={14} className="mr-1.5" />
              {excelPreviewItems.filter(p => !p.isDuplicate).length}개 일괄 등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 공장 원가표 일괄 업로드 hidden input */}
      <input
        ref={batchCostFileRef}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        onChange={handleBatchCostFileChange}
      />

      {/* 공장 원가표 일괄 업로드 모달 */}
      <Dialog open={showBatchCostUpload} onOpenChange={open => { if (!open) setShowBatchCostUpload(false); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-stone-800">🏭 공장 원가표 일괄 업로드</DialogTitle>
            <p className="text-xs text-stone-500 mt-0.5">각 스타일별로 공장 원가표 엑셀을 업로드하세요. KMSRP(확정판매가)는 변경되지 않습니다.</p>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-stone-100 text-stone-600">
                  <th className="px-3 py-2 text-left font-medium">스타일번호</th>
                  <th className="px-3 py-2 text-left font-medium">품명</th>
                  <th className="px-3 py-2 text-left font-medium">적용 탭</th>
                  <th className="px-3 py-2 text-left font-medium">파일 / 상태</th>
                  <th className="px-3 py-2 text-center font-medium">업로드</th>
                </tr>
              </thead>
              <tbody>
                {batchCostItems.map(bi => {
                  const tabCount = bi.bom?.postColorBoms?.length ?? 0;
                  const tabLabel = bi.bom
                    ? (tabCount > 0 ? `전체 ${tabCount}개 탭 덮어쓰기` : '새 탭 생성')
                    : 'BOM 없음 (자동 생성)';
                  const statusEl = (() => {
                    if (bi.status === 'pending') return <span className="text-stone-400">대기중</span>;
                    if (bi.status === 'ready') return <span className="text-blue-600 font-medium">✓ {bi.parsedData!.materials.length}개 자재 · 환율 {bi.parsedData!.exchangeRateCny}</span>;
                    if (bi.status === 'saving') return <span className="text-amber-500 animate-pulse">저장중…</span>;
                    if (bi.status === 'done') return <span className="text-green-600 font-medium">✅ 적용 완료</span>;
                    if (bi.status === 'error') return <span className="text-red-500">⚠ {bi.errorMsg}</span>;
                  })();
                  return (
                    <tr key={bi.item.id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-3 py-2 font-mono font-medium text-stone-700">{bi.item.styleNo}</td>
                      <td className="px-3 py-2 text-stone-600 max-w-[180px] truncate">{bi.item.name}</td>
                      <td className="px-3 py-2 text-stone-500">{tabLabel}</td>
                      <td className="px-3 py-2">{bi.fileName ? <span className="text-stone-500 truncate max-w-[140px] block">{bi.fileName}</span> : null}<div className="mt-0.5">{statusEl}</div></td>
                      <td className="px-3 py-2 text-center">
                        {bi.status !== 'done' && bi.status !== 'saving' && (
                          <button
                            onClick={() => { setBatchCostActiveId(bi.item.id); setTimeout(() => batchCostFileRef.current?.click(), 0); }}
                            className="px-2.5 py-1 bg-stone-700 hover:bg-stone-800 text-white rounded text-xs font-medium"
                          >
                            파일 선택
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DialogFooter className="mt-3 pt-3 border-t border-stone-100 flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowBatchCostUpload(false)} className="border-stone-300 text-stone-600">
              닫기
            </Button>
            <Button
              size="sm"
              onClick={applyBatchCostUpload}
              disabled={batchCostItems.filter(bi => bi.status === 'ready').length === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Upload size={13} className="mr-1.5" />
              {batchCostItems.filter(bi => bi.status === 'ready').length}개 적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 일괄 발주 모달 컴포넌트 ───────────────────────────────────────────────

interface BulkColorQty {
  color: string;
  qty: number;
  leatherColor?: string;
  decorColor?: string;
  threadColor?: string;
  girimaeColor?: string;
}

interface BulkOrderItemState {
  item: Item;
  enabled: boolean;
  // 컬러별 수량 + 세부 정보
  colorQtys: BulkColorQty[];
}

interface PostOrderState {
  orders: ProductionOrder[];
  hqMaterialSummary: Array<{ materialName: string; spec?: string; unit: string; totalQty: number; vendorName?: string; styleNos: string[] }>;
}

function MultiBulkOrderModal({
  open,
  onClose,
  selectedItems,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  selectedItems: Item[];
  onComplete: (opts?: { goToCart?: boolean }) => void;
}) {
  const queryClient = useQueryClient();
  const vendors = store.getVendors();
  const factories = vendors.filter(v => v.type === '공장' || v.type === '해외공장');

  const [factoryId, setFactoryId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [itemStates, setItemStates] = useState<BulkOrderItemState[]>(() =>
    selectedItems.map(item => {
      const colors = normalizeColors(item.colors || []).length > 0
        ? normalizeColors(item.colors || [])
        : resolveItemColorsWithBom(item, findBomForItem(item));
      return {
        item: { ...item, colors },
        enabled: true,
        colorQtys: colors.map(c => ({
          color: c.name,
          qty: 0,
          leatherColor: c.leatherColor,
          decorColor: c.decorColor,
          threadColor: c.threadColor,
          girimaeColor: c.girimaeColor,
        })),
      };
    })
  );

  // BOM/표시에만 있던 컬러를 품목 마스터에 동기화
  useEffect(() => {
    if (!open) return;
    let changed = false;
    for (const s of itemStates) {
      const master = store.getItems().find(i => i.id === s.item.id);
      if (!master) continue;
      const existing = normalizeColors(master.colors || []);
      const merged = normalizeColors(s.item.colors || []);
      if (merged.length === 0) continue;
      const existKeys = new Set(existing.map(c => c.name.toUpperCase()));
      if (merged.every(c => existKeys.has(c.name.toUpperCase())) && merged.length === existing.length) continue;
      upsertItem({ id: master.id, colors: merged } as any).catch(() => {});
      changed = true;
    }
    if (changed) queryClient.invalidateQueries({ queryKey: ['items'] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [postOrderState, setPostOrderState] = useState<PostOrderState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleItem = (itemId: string) => {
    setItemStates(prev => prev.map(s =>
      s.item.id === itemId ? { ...s, enabled: !s.enabled } : s
    ));
  };

  const setColorQty = (itemId: string, colorName: string, qty: number) => {
    setItemStates(prev => prev.map(s => {
      if (s.item.id !== itemId) return s;
      return {
        ...s,
        colorQtys: s.colorQtys.map(cq => cq.color === colorName ? { ...cq, qty } : cq),
      };
    }));
  };

  const updateColorDetail = (itemId: string, colorName: string, field: keyof Omit<BulkColorQty, 'color' | 'qty'>, value: string) => {
    setItemStates(prev => prev.map(s => {
      if (s.item.id !== itemId) return s;
      return {
        ...s,
        colorQtys: s.colorQtys.map(cq => cq.color === colorName ? { ...cq, [field]: value } : cq),
      };
    }));
  };

  // 컬러 상세정보 변경 후 포커스 아웃 시 품목 마스터에 즉각 저장
  const saveColorDetailToMaster = (itemId: string, colorName: string, field: keyof Omit<BulkColorQty, 'color' | 'qty'>, value: string) => {
    const currentItem = store.getItems().find(i => i.id === itemId);
    if (!currentItem) return;
    const currentColors = normalizeColors(currentItem.colors || []);
    const existingIdx = currentColors.findIndex(c => c.name === colorName);
    let updatedColors: ItemColor[];
    if (existingIdx >= 0) {
      updatedColors = currentColors.map(c =>
        c.name === colorName ? { ...c, [field]: value } : c
      );
    } else {
      updatedColors = [...currentColors, { name: colorName, [field]: value }];
    }
    upsertItem({ id: itemId, colors: updatedColors } as any).catch(() => {});
    queryClient.setQueryData(['items'], (old: any[] = []) =>
      old.map((it: any) => it.id === itemId ? { ...it, colors: updatedColors } : it)
    );
  };

  const addColorToItem = (itemId: string, colorName: string) => {
    const trimmed = colorName.trim();
    if (!trimmed) return;
    // 품목 마스터에서 기존 컬러 정보 로드
    const masterItem = items.find((i: any) => i.id === itemId);
    const masterColors = normalizeColors(masterItem?.colors || []);
    const existingMasterColor = masterColors.find(c => c.name === trimmed);
    setItemStates(prev => prev.map(s => {
      if (s.item.id !== itemId) return s;
      if (s.colorQtys.find(cq => cq.color === trimmed)) return s;
      return {
        ...s,
        colorQtys: [...s.colorQtys, {
          color: trimmed,
          qty: 0,
          leatherColor: existingMasterColor?.leatherColor || '',
          decorColor: existingMasterColor?.decorColor || '',
          threadColor: existingMasterColor?.threadColor || '',
          girimaeColor: existingMasterColor?.girimaeColor || '',
        }],
      };
    }));
  };

  const removeColorFromItem = (itemId: string, colorName: string) => {
    setItemStates(prev => prev.map(s => {
      if (s.item.id !== itemId) return s;
      return { ...s, colorQtys: s.colorQtys.filter(cq => cq.color !== colorName) };
    }));
  };

  // 본사제공 자재 합산 미리보기
  const hqMaterialPreview = useMemo(() => {
    const summary: Record<string, { materialName: string; spec?: string; unit: string; totalQty: number; vendorName?: string; styleNos: string[] }> = {};
    for (const state of itemStates) {
      if (!state.enabled) continue;
      const totalQty = state.colorQtys.reduce((sum, cq) => sum + cq.qty, 0);
      if (totalQty <= 0) continue;
      const { bom } = store.getBomForOrder(state.item.styleNo);
      if (!bom) continue;
      const lines = bom.postMaterials?.length ? bom.postMaterials : (bom.lines || []);
      for (const line of lines) {
        if (!line.isHqProvided) continue;
        const perPcs = line.netQty * (1 + (line.lossRate ?? 0));
        const reqQty = Math.round(perPcs * totalQty * 1000) / 1000;
        const key = line.itemName + '||' + line.unit;
        if (summary[key]) {
          summary[key].totalQty = Math.round((summary[key].totalQty + reqQty) * 1000) / 1000;
          if (!summary[key].styleNos.includes(state.item.styleNo)) {
            summary[key].styleNos.push(state.item.styleNo);
          }
        } else {
          summary[key] = {
            materialName: line.itemName,
            spec: line.spec,
            unit: line.unit,
            totalQty: reqQty,
            vendorName: line.vendorId ? vendors.find(v => v.id === line.vendorId)?.name : undefined,
            styleNos: [state.item.styleNo],
          };
        }
      }
    }
    return Object.values(summary);
  }, [itemStates]);

  const handleSubmit = async () => {
    if (!factoryId) { toast.error('공장을 선택해주세요'); return; }
    const factory = vendors.find(v => v.id === factoryId);
    if (!factory) return;

    const enabledStates = itemStates.filter(s => s.enabled);
    if (enabledStates.length === 0) { toast.error('발주할 품목을 하나 이상 선택해주세요'); return; }

    const hasQty = enabledStates.some(s => s.colorQtys.reduce((sum, cq) => sum + cq.qty, 0) > 0);
    if (!hasQty) { toast.error('수량을 입력해주세요'); return; }

    setSubmitting(true);
    try {
      const createdOrders: ProductionOrder[] = [];
      // 채번은 Supabase 발주 목록 기준 (localStorage의 store.getNextRevision을 쓰면
      // 캐시가 빈 새 PC에서 이미 존재하는 발주번호와 충돌한다 — CLAUDE.md 레드라인)
      const allOrders = await fetchOrders();
      const issuedOrderNos = new Set<string>(); // 이번 일괄발주 안에서의 충돌도 방지

      for (const state of enabledStates) {
        const totalQty = state.colorQtys.reduce((sum, cq) => sum + cq.qty, 0);
        if (totalQty <= 0) continue;

        const orderNo = nextOrderNo(state.item.styleNo, allOrders as any[], issuedOrderNos);
        const revision = parseRevision(orderNo);
        const colorQtysForOrder: ColorQty[] = state.colorQtys.filter(cq => cq.qty > 0).map(cq => ({ color: cq.color, qty: cq.qty }));

        await store.fetchAndCacheBom(state.item.styleNo);
        const { bom, type: bomType } = store.getBomForOrder(state.item.styleNo);
        const calc = store.calcMaterialRequirements(state.item.styleNo, totalQty, colorQtysForOrder);
        const resolved = store.resolveFactoryUnitFromBom(bom, colorQtysForOrder);
        const factoryUnitPriceCny = resolved.factoryUnitPriceCny || calc.factoryUnitPriceCny || 0;
        const factoryUnitPriceKrw = resolved.factoryUnitPriceKrw > 0
          ? resolved.factoryUnitPriceKrw
          : (factoryUnitPriceCny > 0
            ? Math.round(factoryUnitPriceCny * (resolved.rate || store.getSettings().cnyKrw || 191))
            : 0);

        const hqSupplyItems: ProductionOrder['hqSupplyItems'] = calc.hqProvided.map(h => ({
          bomLineId: h.bomLineId,
          itemName: h.itemName,
          spec: h.spec,
          unit: h.unit,
          requiredQty: h.reqQty,
          purchaseStatus: '미구매' as const,
        }));

        // 본사제공 자재 장바구니
        // calc.hqProvided[].reqQty는 store.calcMaterialRequirements가 이미
        // 컬러별 수량을 반영해 계산한 "총 소요량"이다. 여기서 다시 계산하면 안 된다.
        // (예전엔 postColorBoms를 전 컬러 flatMap해서 아무 컬러의 netQty/lossRate를
        //  집어와 총수량에 곱했다 — 컬러별 소요량이 다르면 자재가 부족해진다.
        //  CLAUDE.md가 금지한 패턴)
        // addToMaterialCart가 netQty × (1+lossRate) × orderQty로 다시 곱하므로,
        // reqQty를 그대로 재현하도록 netQty = reqQty/총수량, lossRate = 0으로 넘긴다.
        if (calc.hqProvided.length > 0 && bom) {
          const priceByLine = new Map<string, number>();
          for (const l of bomLinesForPricing(bom)) {
            const price = (l as any).unitPriceCny ?? (l as any).unitPrice;
            if (price === undefined) continue;
            if (l.id) priceByLine.set(`id:${l.id}`, price);
            if (l.itemName) priceByLine.set(`name:${l.itemName}`, price);
          }
          const cartMats = calc.hqProvided.map(h => ({
            itemName: h.itemName,
            spec: h.spec,
            unit: h.unit,
            netQty: totalQty > 0 ? h.reqQty / totalQty : 0,
            lossRate: 0, // reqQty에 로스가 이미 반영돼 있음 — 다시 곱하면 이중 적용
            vendorName: h.vendorName,
            isHqProvided: true as const,
            imageUrl: h.imageUrl,
            unitPriceCny: priceByLine.get(`id:${h.bomLineId}`) ?? priceByLine.get(`name:${h.itemName}`),
          }));
          store.addToMaterialCart(state.item.styleNo, state.item.name, cartMats, totalQty);
        }

        // 손익·전표 연결 키 = 발주번호 (orderNo). project_no 미발급
        const newOrder: ProductionOrder = {
          id: genId(),
          orderNo,
          workspace: 'OEM',
          styleId: state.item.id,
          styleNo: state.item.styleNo,
          styleName: state.item.name,
          season: state.item.season as Season,
          revision,
          isReorder: revision > 1,
          qty: totalQty,
          colorQtys: colorQtysForOrder,
          vendorId: factoryId,
          vendorName: factory.name,
          orderDate,
          deliveryDate: deliveryDate || undefined,
          status: '발주생성',
          bomId: bom?.id,
          bomType: bomType || undefined,
          factoryUnitPriceCny: factoryUnitPriceCny || undefined,
          factoryUnitPriceKrw: factoryUnitPriceKrw || undefined,
          factoryCurrency: 'CNY',
          hqSupplyItems,
          attachments: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        store.addOrder(newOrder);
        createdOrders.push(newOrder);

        // 새 컬러 및 세부 정보를 품목 마스터에 반영
        const existingColors = normalizeColors(state.item.colors || []);
        const existingColorNames = existingColors.map(c => c.name);
        for (const cq of state.colorQtys) {
          const itemColor: ItemColor = {
            name: cq.color,
            leatherColor: cq.leatherColor,
            decorColor: cq.decorColor,
            threadColor: cq.threadColor,
            girimaeColor: cq.girimaeColor,
          };
          if (!existingColorNames.includes(cq.color)) {
            // 새 컬러: 품목 마스터에 추가 (낙관적 업데이트)
            const newColors = [...existingColors, itemColor];
            upsertItem({ id: state.item.id, colors: newColors } as any).catch(() => {});
            queryClient.setQueryData(['items'], (old: any[] = []) =>
              old.map((it: any) => it.id === state.item.id ? { ...it, colors: newColors } : it)
            );
          } else {
            // 기존 컬러: 세부 정보가 변경된 경우 업데이트
            const existingColor = existingColors.find(c => c.name === cq.color);
            const hasDetailChange = existingColor && (
              (cq.leatherColor !== undefined && cq.leatherColor !== existingColor.leatherColor) ||
              (cq.decorColor !== undefined && cq.decorColor !== existingColor.decorColor) ||
              (cq.threadColor !== undefined && cq.threadColor !== existingColor.threadColor) ||
              (cq.girimaeColor !== undefined && cq.girimaeColor !== existingColor.girimaeColor)
            );
            if (hasDetailChange) {
              const updatedColors = existingColors.map(c =>
                c.name === cq.color ? { ...c, ...itemColor } : c
              );
              upsertItem({ id: state.item.id, colors: updatedColors } as any).catch(() => {});
              queryClient.setQueryData(['items'], (old: any[] = []) =>
                old.map((it: any) => it.id === state.item.id ? { ...it, colors: updatedColors } : it)
              );
            }
          }
        }
      }

      setPostOrderState({
        orders: createdOrders,
        hqMaterialSummary: hqMaterialPreview,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // 완료 팝업이 보이는 상태
  if (postOrderState) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              ✅ 발주 등록 완료
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
              <p className="text-sm font-medium text-green-800 mb-2">
                {postOrderState.orders.length}건 발주가 등록되었습니다
              </p>
              <ul className="space-y-1">
                {postOrderState.orders.map(o => (
                  <li key={o.id} className="text-xs text-green-700 flex items-center gap-2">
                    <span className="font-mono font-semibold">{o.orderNo}</span>
                    <span className="text-green-600">{o.styleName}</span>
                    <span className="ml-auto font-medium">{o.qty.toLocaleString()}개</span>
                  </li>
                ))}
              </ul>
            </div>
            {postOrderState.hqMaterialSummary.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
                  <ShoppingCart size={13} />본사제공 자재 장바구니 담김
                </p>
                <ul className="space-y-1">
                  {postOrderState.hqMaterialSummary.map((m, idx) => (
                    <li key={idx} className="text-xs text-amber-700 flex items-center gap-2">
                      <span className="font-medium">{m.materialName}</span>
                      {m.spec && <span className="text-amber-500">{m.spec}</span>}
                      <span className="ml-auto font-mono">{m.totalQty.toLocaleString()} {m.unit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2 sm:flex-row flex-col">
            <Button
              variant="outline"
              className="flex items-center gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => onComplete({ goToCart: true })}
            >
              <ShoppingCart size={14} />자재 장바구니 확인
            </Button>
            <Button
              className="bg-[#C9A96E] hover:bg-[#B8985D] text-white flex items-center gap-1.5"
              onClick={() => onComplete()}
            >
              <Printer size={14} />발주 목록으로 이동
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package size={18} className="text-amber-600" />
            일괄 발주 등록
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* 공장 / 날짜 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>공장 선택 *</Label>
              <Select value={factoryId} onValueChange={setFactoryId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="공장 선택" />
                </SelectTrigger>
                <SelectContent>
                  {factories.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-stone-400">등록된 공장 없음</div>
                  ) : (
                    factories.map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>발주일</Label>
              <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label>납기일</Label>
              <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* 품목별 설정 */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-stone-700">품목별 컬러 · 수량 설정</Label>
            <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
              {itemStates.map(state => (
                <BulkOrderItemRow
                  key={state.item.id}
                  state={state}
                  onToggle={() => toggleItem(state.item.id)}
                  onSetColorQty={(color, qty) => setColorQty(state.item.id, color, qty)}
                  onUpdateColorDetail={(color, field, value) => updateColorDetail(state.item.id, color, field, value)}
                  onSaveColorDetail={(color, field, value) => saveColorDetailToMaster(state.item.id, color, field, value)}
                  onAddColor={(color) => addColorToItem(state.item.id, color)}
                  onRemoveColor={(color) => removeColorFromItem(state.item.id, color)}
                />
              ))}
            </div>
          </div>

          {/* 본사제공 자재 합산 */}
          {hqMaterialPreview.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-stone-700 flex items-center gap-1.5">
                <ShoppingCart size={14} className="text-amber-600" />
                본사제공 자재 통합 발주 (자동 합산)
              </Label>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5">
                {hqMaterialPreview.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className="text-amber-700 font-medium">{m.materialName}</span>
                    {m.spec && <span className="text-amber-500 text-xs">{m.spec}</span>}
                    <span className="text-xs text-stone-400 ml-1">({m.styleNos.join(' + ')})</span>
                    <span className="ml-auto font-mono font-semibold text-amber-800">
                      {m.totalQty.toLocaleString()} {m.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>취소</Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            {submitting ? '등록 중...' : '발주 등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 개별 품목 행 컴포넌트
function BulkOrderItemRow({
  state,
  onToggle,
  onSetColorQty,
  onUpdateColorDetail,
  onSaveColorDetail,
  onAddColor,
  onRemoveColor,
}: {
  state: BulkOrderItemState;
  onToggle: () => void;
  onSetColorQty: (color: string, qty: number) => void;
  onUpdateColorDetail: (color: string, field: keyof Omit<BulkColorQty, 'color' | 'qty'>, value: string) => void;
  onSaveColorDetail: (color: string, field: keyof Omit<BulkColorQty, 'color' | 'qty'>, value: string) => void;
  onAddColor: (color: string) => void;
  onRemoveColor: (color: string) => void;
}) {
  const [newColorInput, setNewColorInput] = useState('');
  const [openDetails, setOpenDetails] = useState<Set<string>>(new Set());

  const totalQty = state.colorQtys.reduce((sum, cq) => sum + cq.qty, 0);

  const toggleDetail = (colorName: string) => {
    setOpenDetails(prev => {
      const next = new Set(prev);
      if (next.has(colorName)) next.delete(colorName);
      else next.add(colorName);
      return next;
    });
  };

  const handleAddColor = () => {
    const trimmed = newColorInput.trim();
    if (!trimmed) return;
    onAddColor(trimmed);
    setNewColorInput('');
    // 새로 추가된 컬러의 세부 정보 토글 자동 펼침
    setOpenDetails(prev => new Set(prev).add(trimmed));
  };

  return (
    <div className={`p-3 transition-colors ${state.enabled ? 'bg-white' : 'bg-stone-50 opacity-60'}`}>
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-2.5">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={onToggle}
          className="w-4 h-4 rounded border-stone-300 accent-amber-500 cursor-pointer"
        />
        {state.item.imageUrl ? (
          <HoverZoomImage
            src={state.item.imageUrl}
            alt={state.item.name}
            className="w-8 h-8 rounded-lg border border-stone-200 overflow-hidden cursor-zoom-in"
            imgClassName="w-8 h-8 object-cover"
            previewSize={280}
          />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center">
            <Package size={12} className="text-stone-300" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-800 truncate">{state.item.name}</p>
          <p className="text-xs font-mono text-stone-500">{state.item.styleNo}</p>
        </div>
        {totalQty > 0 && (
          <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            합계 {totalQty.toLocaleString()}개
          </span>
        )}
      </div>

      {/* 컬러별 수량 */}
      {state.enabled && (
        <div className="pl-7 space-y-2">
          <div className="grid grid-cols-1 gap-2">
            {state.colorQtys.map(cq => {
              const isOpen = openDetails.has(cq.color);
              return (
                <div key={cq.color} className="border border-stone-100 rounded-lg overflow-hidden">
                  {/* 컬러 메인 행 */}
                  <div className="flex items-center gap-2 px-2 py-1.5 bg-stone-50">
                    <span className="text-xs px-2 py-1 bg-white text-stone-700 rounded border border-stone-200 font-medium w-24 truncate">{cq.color}</span>
                    <Input
                      type="number"
                      min={0}
                      value={cq.qty || ''}
                      onChange={e => onSetColorQty(cq.color, Number(e.target.value))}
                      placeholder="수량"
                      className="h-7 text-xs w-20"
                    />
                    <span className="text-xs text-stone-400">개</span>
                    <button
                      type="button"
                      onClick={() => onRemoveColor(cq.color)}
                      className="text-stone-300 hover:text-red-400 transition-colors"
                    >
                      <X size={12} />
                    </button>
                    {/* 세부 정보 토글 버튼 */}
                    <button
                      type="button"
                      onClick={() => toggleDetail(cq.color)}
                      title="세부 컬러 정보 입력"
                      className={`ml-auto flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded transition-colors ${
                        isOpen
                          ? 'bg-amber-100 text-amber-700 border border-amber-200'
                          : 'text-stone-400 hover:text-amber-600 hover:bg-amber-50 border border-transparent'
                      }`}
                    >
                      {isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                  {/* 세부 정보 패널 */}
                  {isOpen && (
                    <div className="px-2 py-2 bg-white border-t border-stone-100">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-stone-400 w-16 shrink-0">가죽/원단</span>
                          <Input
                            value={cq.leatherColor || ''}
                            onChange={e => { onUpdateColorDetail(cq.color, 'leatherColor', e.target.value); onSaveColorDetail(cq.color, 'leatherColor', e.target.value); }}
                            placeholder="가죽/원단 컬러"
                            className="h-6 text-xs flex-1"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-stone-400 w-10 shrink-0">장식</span>
                          <Input
                            value={cq.decorColor || ''}
                            onChange={e => { onUpdateColorDetail(cq.color, 'decorColor', e.target.value); onSaveColorDetail(cq.color, 'decorColor', e.target.value); }}
                            placeholder="장식 컬러"
                            className="h-6 text-xs flex-1"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-stone-400 w-16 shrink-0">실</span>
                          <Input
                            value={cq.threadColor || ''}
                            onChange={e => { onUpdateColorDetail(cq.color, 'threadColor', e.target.value); onSaveColorDetail(cq.color, 'threadColor', e.target.value); }}
                            placeholder="실 컬러"
                            className="h-6 text-xs flex-1"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-stone-400 w-10 shrink-0">기리매</span>
                          <Input
                            value={cq.girimaeColor || ''}
                            onChange={e => { onUpdateColorDetail(cq.color, 'girimaeColor', e.target.value); onSaveColorDetail(cq.color, 'girimaeColor', e.target.value); }}
                            placeholder="기리매 컬러"
                            className="h-6 text-xs flex-1"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* 컬러 추가 */}
          <div className="flex items-center gap-1.5">
            <Input
              value={newColorInput}
              onChange={e => setNewColorInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddColor();
                }
              }}
              placeholder="컬러 추가 (Enter)"
              className="h-7 text-xs flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleAddColor}
            >
              +
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
