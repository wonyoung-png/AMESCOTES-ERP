import { genId, type Bom, type BomLine, type Material } from './store';

/** 패키지 키트 구성 행 (자재마스터 연동) */
export interface PackBomLine {
  materialId: string;
  itemCode?: string;
  itemName: string;
  spec?: string;
  unit: string;
  qty: number;
  unitPriceKrw: number;
  vendorName?: string;
}

export function isPackItem(item?: { erpCategory?: string } | null): boolean {
  return item?.erpCategory === 'PACK';
}

export function packLineTotal(line: PackBomLine): number {
  return Math.round((line.qty || 0) * (line.unitPriceKrw || 0));
}

export function packLinesTotal(lines: PackBomLine[]): number {
  return lines.reduce((s, l) => s + packLineTotal(l), 0);
}

/** 품번이 이름에 붙어 있으면 제거 (표시용) */
function stripCodeFromName(name?: string, itemCode?: string): string {
  let n = (name || '').trim();
  if (!n) return '';
  n = n.replace(/^[A-Z0-9_-]+\s*[·\-–]\s*/i, '');
  if (itemCode) {
    const re = new RegExp(`^${itemCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[·\\-–]?\\s*`, 'i');
    n = n.replace(re, '');
  }
  return n.trim() || (name || '').trim();
}

export function materialToPackLine(m: Material, qty = 1): PackBomLine {
  const price = m.unitPriceKrw ?? m.unitPriceCny ?? 0;
  return {
    materialId: m.id,
    itemCode: m.itemCode,
    itemName: stripCodeFromName(m.name, m.itemCode),
    spec: m.spec,
    unit: m.unit || 'EA',
    qty,
    unitPriceKrw: price,
    vendorName: m.orderVendorName,
  };
}

function norm(s?: string | null): string {
  return (s || '').trim().toLowerCase();
}

/** 자재마스터에서 BOM 행 매칭 (id → 품번 → memo → 이름) */
export function findMaterialForPackLine(
  line: { materialId?: string; itemCode?: string; itemName?: string; memo?: string },
  materials: Material[],
): Material | undefined {
  if (!materials.length) return undefined;

  if (line.materialId) {
    const byId = materials.find(m => m.id === line.materialId);
    if (byId) return byId;
  }

  const code = line.itemCode || (line.memo && /^LPKG-|^[A-Z0-9-]+$/i.test(String(line.memo).trim()) ? String(line.memo).trim() : '');
  if (code) {
    const byCode = materials.find(m => norm(m.itemCode) === norm(code));
    if (byCode) return byCode;
  }

  // 시드 BOM: memo에 LPKG-xxx
  const memo = String(line.memo || '').trim();
  if (memo) {
    const byMemo = materials.find(m => norm(m.itemCode) === norm(memo));
    if (byMemo) return byMemo;
  }

  const name = norm(line.itemName);
  if (name) {
    const exact = materials.find(m => norm(m.name) === name);
    if (exact) return exact;
    // "더스트백 SS" ↔ "더스트백" + size in name
    const starts = materials.filter(m => name.startsWith(norm(m.name)) || norm(m.name).startsWith(name));
    if (starts.length === 1) return starts[0];
  }

  return undefined;
}

/**
 * BOM/스냅샷 행을 자재마스터에 연결.
 * 연결되면 품번·이름·규격·단가를 마스터 기준으로 갱신(수량은 유지).
 */
export function resolvePackLinesWithMaterials(
  lines: PackBomLine[],
  materials: Material[],
  opts?: { syncPrice?: boolean },
): PackBomLine[] {
  if (!materials.length) return lines;
  const syncPrice = opts?.syncPrice !== false;
  return lines.map(line => {
    const m = findMaterialForPackLine(line, materials);
    if (!m) return line;
    return {
      ...line,
      materialId: m.id,
      itemCode: m.itemCode || line.itemCode,
      itemName: m.name || line.itemName,
      spec: m.spec || line.spec,
      unit: m.unit || line.unit || 'EA',
      unitPriceKrw: syncPrice ? (m.unitPriceKrw ?? m.unitPriceCny ?? line.unitPriceKrw) : line.unitPriceKrw,
    };
  });
}

/** BOM 저장 구조 → 패키지 구성 행 (+ 자재마스터 연결) */
export function linesFromPackBom(bom?: Bom | null, materials: Material[] = []): PackBomLine[] {
  if (!bom) return [];
  const postCb = (bom as any).postColorBoms?.[0]?.lines;
  const raw: any[] = bom.postMaterials?.length
    ? bom.postMaterials
    : postCb?.length
      ? postCb
      : bom.lines || [];

  const lines: PackBomLine[] = raw
    .filter((l: any) => l.itemName)
    .map((l: any) => {
      const matched = findMaterialForPackLine(l, materials);
      if (matched) {
        return {
          ...materialToPackLine(matched, l.netQty ?? 1),
          // 기존 BOM에 수동 수정한 단가가 있으면 우선? → 마스터 우선 (사용자가 원함)
          unitPriceKrw: matched.unitPriceKrw ?? matched.unitPriceCny ?? l.unitPriceKrw ?? l.unitPriceCny ?? 0,
        };
      }
      return {
        materialId: l.materialId || String(l.memo || l.id || ''),
        itemCode: l.itemCode || (String(l.memo || '').startsWith('LPKG-') ? l.memo : undefined),
        itemName: l.itemName,
        spec: l.spec,
        unit: l.unit || 'EA',
        qty: l.netQty ?? 1,
        unitPriceKrw: l.unitPriceKrw ?? l.unitPriceCny ?? 0,
        vendorName: l.vendorName,
      };
    });

  return lines;
}

export function packLinesToBomLines(lines: PackBomLine[]): BomLine[] {
  return lines.map(l => ({
    id: genId(),
    category: '포장재' as const,
    itemName: l.itemName,
    spec: l.spec,
    unit: l.unit || 'EA',
    unitPriceCny: l.unitPriceKrw,
    netQty: l.qty || 1,
    lossRate: 0,
    isHqProvided: true,
    vendorName: l.vendorName,
    memo: l.itemCode || l.materialId,
    materialId: l.materialId,
    itemCode: l.itemCode,
  } as BomLine));
}

/** 패키지 구성 → BOM (사전/사후원가 없음, KRW 합산) */
export function applyPackLinesToBom(bom: Bom, lines: PackBomLine[]): Bom {
  const bomLines = packLinesToBomLines(lines);
  const total = packLinesTotal(lines);
  const colorBom = {
    color: '기본',
    lines: bomLines,
    postProcessLines: [] as any[],
    processingFee: 0,
  };
  return {
    ...bom,
    erpCategory: 'PACK',
    lines: bomLines,
    postMaterials: bomLines,
    colorBoms: [colorBom],
    postColorBoms: [colorBom],
    postProcessLines: [],
    processingFee: 0,
    postProcessingFee: 0,
    currency: 'KRW',
    exchangeRateCny: 1,
    snapshotCnyKrw: 1,
    postTotalCostKrw: total,
    postSubtotalKrw: total,
    packingCostKrw: 0, // 라인 합산이 원가 — 여기에 넣으면 총원가 2배
    packagingCostKrw: 0,
    productionMarginRate: 0,
    isPackBom: true,
    isSimpleCost: true,
    simplePostCostKrw: total,
    updatedAt: new Date().toISOString(),
  } as Bom;
}

export function createEmptyPackBom(item: {
  id: string;
  styleNo: string;
  styleName: string;
  season?: string;
  designer?: string;
}): Bom {
  const base = {
    id: genId(),
    styleId: item.id,
    styleNo: item.styleNo,
    styleName: item.styleName,
    version: 1,
    season: (item.season as any) || '26SS',
    designer: item.designer || '',
    erpCategory: 'PACK',
    lines: [],
    postProcessLines: [],
    processingFee: 0,
    logisticsCostKrw: 0,
    packagingCostKrw: 0,
    packingCostKrw: 0,
    productionMarginRate: 0,
    snapshotCnyKrw: 1,
    pnl: { discountRate: 0, platformFeeRate: 0, sgaRate: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Bom;
  return applyPackLinesToBom(base, []);
}
