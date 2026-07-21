/**
 * 컬러 없는 TEMP / LUMEN / HB 품목에 테스트용 컬러를 채우고
 * 관련 생산발주·브랜드라인·입고로그 color도 맞춰 재적용한다.
 */
import { store, normalizeColors, type Item, type ItemColor, type ProductionOrder } from './store';
import { upsertItem, upsertOrder } from './supabaseQueries';
import { phase1, type BrandOrderLine, type ChinaStockMove } from './phase1';

export const ITEM_COLOR_FILL_FLAG = 'ames_item_color_fill_v2';

const PLACEHOLDER_COLORS = new Set([
  '', '기본', '(미지정)', '(미배정)', '미지정', '미배정', 'default', 'DEFAULT',
]);

const SUFFIX_COLOR: Record<string, ItemColor> = {
  SB: { name: '샌드베이지', leatherColor: 'SB' },
  BLK: { name: '블랙', leatherColor: 'BLK' },
  BK: { name: '블랙', leatherColor: 'BK' },
  OB: { name: '올리브', leatherColor: 'OB' },
  BRN: { name: '브라운', leatherColor: 'BRN' },
  CML: { name: '카멜', leatherColor: 'CML' },
  IV: { name: '아이보리', leatherColor: 'IV' },
  WH: { name: '화이트', leatherColor: 'WH' },
  RD: { name: '레드', leatherColor: 'RD' },
  NV: { name: '네이비', leatherColor: 'NV' },
  TB: { name: '토프', leatherColor: 'TB' },
  CR: { name: '크림', leatherColor: 'CR' },
};

const DEFAULT_COLORS: ItemColor[] = [
  { name: '블랙', leatherColor: 'BLK' },
  { name: '브라운', leatherColor: 'BRN' },
  { name: '아이보리', leatherColor: 'IV' },
];

/** 스타일별 고정 테스트 컬러 */
const STYLE_COLOR_PRESETS: Record<string, ItemColor[]> = {
  LLL1F050B: [
    { name: '블랙', leatherColor: 'BLK' },
    { name: '브라운', leatherColor: 'BRN' },
    { name: '아이보리', leatherColor: 'IV' },
  ],
  LLL5F700B: [
    { name: '블랙', leatherColor: 'BLK' },
    { name: '카멜', leatherColor: 'CML' },
    { name: '올리브', leatherColor: 'OB' },
  ],
  LLL5F780B: [
    { name: '블랙', leatherColor: 'BLK' },
    { name: '브라운', leatherColor: 'BRN' },
    { name: '카멜', leatherColor: 'CML' },
  ],
  LLL5F785B: [
    { name: '블랙', leatherColor: 'BLK' },
    { name: '아이보리', leatherColor: 'IV' },
    { name: '올리브', leatherColor: 'OB' },
  ],
  LLL5F78SB: [
    { name: '샌드베이지', leatherColor: 'SB' },
    { name: '블랙', leatherColor: 'BLK' },
  ],
  LLL5S57TB: [
    { name: '토프', leatherColor: 'TB' },
    { name: '블랙', leatherColor: 'BLK' },
    { name: '크림', leatherColor: 'CR' },
  ],
  LLL6F92SB: [
    { name: '샌드베이지', leatherColor: 'SB' },
    { name: '블랙', leatherColor: 'BLK' },
    { name: '브라운', leatherColor: 'BRN' },
  ],
  'OEM-26SS-001': [
    { name: '블랙', leatherColor: 'BLK' },
    { name: '브라운', leatherColor: 'BRN' },
  ],
  'OEM-26SS-MINI': [
    { name: '카멜', leatherColor: 'CML' },
    { name: '블랙', leatherColor: 'BLK' },
  ],
};

function isPlaceholderColor(name: string | undefined | null): boolean {
  return PLACEHOLDER_COLORS.has((name || '').trim());
}

function shouldFillTarget(item: Item): boolean {
  if (item.erpCategory === 'PACK' || (item.styleNo || '').startsWith('LPKG-')) return false;
  const sn = item.styleNo || '';
  return (
    item.itemStatus === 'TEMP' ||
    sn.startsWith('TEMP') ||
    sn.startsWith('LLL') ||
    sn.startsWith('LUM') ||
    item.erpCategory === 'HB' ||
    !!STYLE_COLOR_PRESETS[sn]
  );
}

function shouldFill(item: Item, forceOverwrite: boolean): boolean {
  if (!shouldFillTarget(item)) return false;
  const colors = normalizeColors(item.colors || []);
  if (forceOverwrite) return true;
  if (colors.length > 0) {
    if (STYLE_COLOR_PRESETS[item.styleNo] && colors.length < STYLE_COLOR_PRESETS[item.styleNo].length) return true;
    return false;
  }
  return true;
}

function pickColors(item: Item): ItemColor[] {
  if (STYLE_COLOR_PRESETS[item.styleNo]) return STYLE_COLOR_PRESETS[item.styleNo];
  const sn = item.styleNo || '';
  const m = sn.match(/([A-Z]{2,4})$/);
  if (m && SUFFIX_COLOR[m[1]]) {
    const primary = SUFFIX_COLOR[m[1]];
    return [
      primary,
      ...DEFAULT_COLORS.filter(c => c.leatherColor !== primary.leatherColor).slice(0, 2),
    ];
  }
  if (item.itemStatus === 'TEMP' || sn.startsWith('TEMP')) {
    return [
      { name: '블랙', leatherColor: 'BLK' },
      { name: '브라운', leatherColor: 'BRN' },
      { name: '샌드베이지', leatherColor: 'SB' },
    ];
  }
  return DEFAULT_COLORS;
}

function splitQty(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  let rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

function hasMeaningfulColorQtys(o: { colorQtys?: { color: string; qty: number }[] }): boolean {
  const cq = o.colorQtys || [];
  if (!cq.length) return false;
  return cq.some(c => !isPlaceholderColor(c.color));
}

function needsOrderRewrite(
  o: ProductionOrder,
  colors: ItemColor[],
  forceOverwrite: boolean,
): boolean {
  if (!colors.length) return false;
  if (forceOverwrite) return true;
  if (!hasMeaningfulColorQtys(o)) return true;
  const cq = o.colorQtys || [];
  if (cq.length < colors.length) return true;
  if (cq.some(c => isPlaceholderColor(c.color))) return true;
  return false;
}

function buildColorQtys(total: number, colors: ItemColor[]): { color: string; qty: number }[] {
  const parts = splitQty(total || 0, colors.length);
  return colors.map((c, i) => ({ color: c.name, qty: parts[i] || 0 }));
}

function remapPlaceholderLogs(orderId: string, colors: ItemColor[]): number {
  if (!colors.length) return 0;
  const all = phase1.getReceiptLogs();
  let changed = 0;
  const next = all.flatMap(log => {
    if (log.orderId !== orderId) return [log];
    if (!isPlaceholderColor(log.color)) return [log];
    if (log.qty <= 0) {
      changed += 1;
      return [{ ...log, color: colors[0].name }];
    }
    const parts = splitQty(log.qty, colors.length);
    changed += 1;
    return colors.map((c, i) => ({
      ...log,
      id: i === 0 ? log.id : `${log.id}-c${i}`,
      color: c.name,
      qty: parts[i] || 0,
    })).filter(l => l.qty > 0);
  });
  if (changed > 0) {
    localStorage.setItem('ames_receipt_logs', JSON.stringify(next));
  }
  return changed;
}

function remapChinaMoves(styleNo: string, colors: ItemColor[]): number {
  if (!colors.length) return 0;
  const key = 'ames_china_stock_moves';
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const all = JSON.parse(raw) as ChinaStockMove[];
    let changed = 0;
    const next = all.flatMap(m => {
      if (m.styleNo !== styleNo) return [m];
      if (!isPlaceholderColor(m.color)) return [m];
      const parts = splitQty(m.qty || 0, colors.length);
      changed += 1;
      return colors.map((c, i) => ({
        ...m,
        id: i === 0 ? m.id : `${m.id}-c${i}`,
        color: c.name,
        qty: parts[i] || 0,
      })).filter(x => x.qty > 0);
    });
    if (changed > 0) localStorage.setItem(key, JSON.stringify(next));
    return changed;
  } catch {
    return 0;
  }
}

function rewriteBrandLines(itemMap: Map<string, ItemColor[]>, forceOverwrite: boolean): number {
  const key = 'ames_brand_order_lines';
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const lines = JSON.parse(raw) as BrandOrderLine[];
    let n = 0;
    const next = lines.map(l => {
      const colors = itemMap.get(l.styleNo) || [];
      if (!colors.length) return l;
      if (!forceOverwrite && hasMeaningfulColorQtys(l) && !(l.colorQtys || []).some(c => isPlaceholderColor(c.color))) {
        return l;
      }
      n += 1;
      return { ...l, colorQtys: buildColorQtys(l.qty || 0, colors) };
    });
    if (n > 0) localStorage.setItem(key, JSON.stringify(next));
    return n;
  } catch {
    return 0;
  }
}

export function ordersNeedColorFix(): boolean {
  const items = store.getItems();
  const orders = store.getOrders();
  return orders.some(o => {
    const item = items.find(i => i.styleNo === o.styleNo);
    if (!item || !shouldFillTarget(item)) return false;
    const colors = normalizeColors(item.colors || []);
    if (!colors.length) return true;
    return needsOrderRewrite(o, colors, false);
  });
}

export function fillMissingItemColorsForTest(force = false): {
  itemsUpdated: number;
  ordersUpdated: number;
  receiptsRemapped: number;
  brandLinesUpdated: number;
  chinaMovesRemapped: number;
  skipped: boolean;
} {
  if (!force && localStorage.getItem(ITEM_COLOR_FILL_FLAG) && !ordersNeedColorFix()) {
    return {
      itemsUpdated: 0,
      ordersUpdated: 0,
      receiptsRemapped: 0,
      brandLinesUpdated: 0,
      chinaMovesRemapped: 0,
      skipped: true,
    };
  }

  const forceOverwrite = force;
  let items = store.getItems();
  const touched: Item[] = [];
  const colorByStyle = new Map<string, ItemColor[]>();

  items = items.map(item => {
    if (!shouldFill(item, forceOverwrite)) {
      const existing = normalizeColors(item.colors || []);
      if (existing.length && shouldFillTarget(item)) colorByStyle.set(item.styleNo, existing);
      return item;
    }
    const nextColors = pickColors(item);
    colorByStyle.set(item.styleNo, nextColors);
    const prev = normalizeColors(item.colors || []);
    const same =
      !forceOverwrite &&
      prev.length === nextColors.length &&
      prev.every((c, i) => c.name === nextColors[i].name);
    if (same) return item;
    const updated = { ...item, colors: nextColors };
    touched.push(updated);
    return updated;
  });
  store.setItems(items);

  let orders = store.getOrders();
  const touchedOrders: ProductionOrder[] = [];
  let receiptsRemapped = 0;
  let chinaMovesRemapped = 0;

  orders = orders.map(o => {
    const colors = colorByStyle.get(o.styleNo) || normalizeColors(
      items.find(i => i.styleNo === o.styleNo)?.colors || [],
    );
    if (!colors.length) return o;
    if (!needsOrderRewrite(o, colors, forceOverwrite)) return o;
    const colorQtys = buildColorQtys(o.qty || 0, colors);
    const updated = { ...o, colorQtys };
    touchedOrders.push(updated);
    receiptsRemapped += remapPlaceholderLogs(o.id, colors);
    chinaMovesRemapped += remapChinaMoves(o.styleNo, colors);
    return updated;
  });
  store.setOrders(orders);

  const brandLinesUpdated = rewriteBrandLines(colorByStyle, forceOverwrite);

  localStorage.setItem(ITEM_COLOR_FILL_FLAG, new Date().toISOString());
  localStorage.removeItem('ames_item_color_fill_v1');

  touched.forEach(i => { upsertItem(i).catch(() => {}); });
  touchedOrders.forEach(o => { upsertOrder(o).catch(() => {}); });

  return {
    itemsUpdated: touched.length,
    ordersUpdated: touchedOrders.length,
    receiptsRemapped,
    brandLinesUpdated,
    chinaMovesRemapped,
    skipped: false,
  };
}

/** 화면에서 한 번에 컬러 테스트 데이터 강제 재적용 */
export function applyColorTestData() {
  localStorage.removeItem(ITEM_COLOR_FILL_FLAG);
  localStorage.removeItem('ames_item_color_fill_v1');
  return fillMissingItemColorsForTest(true);
}
