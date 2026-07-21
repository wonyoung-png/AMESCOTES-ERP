/**
 * 핸드백용 패키지(박스SS~박스XL-HB) + 자재마스터(포장재)
 * - 제품/택배운임 제외
 * - 공통: 품질보증서·형태봉투·라벨스티커·박스테이프·띠지
 * - 사이즈별: 더스트백·노루지·내부박스·택배박스
 * - 슈즈용은 별도 (미포함)
 */
import {
  store, genId,
  type Item, type Vendor, type Material, type Bom, type BomLine, type PackingSize,
} from './store';
import { upsertItem, upsertVendor, upsertMaterial, upsertBom } from './supabaseQueries';
import { applyPackLinesToBom, type PackBomLine } from './packBom';

export const PACK_SEED_FLAG = 'ames_hb_pack_seed_v4';

export interface PackKitLine {
  itemCode: string;
  name: string;
  qty: number;
  unitCostKrw: number;
}

export interface PackKit {
  id: string;
  packingSize: PackingSize;
  styleNo: string;
  label: string;
  lines: PackKitLine[];
  totalCostKrw: number;
  source: string;
}

function upsertById<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex(x => x.id === row.id);
  if (i >= 0) { const next = [...list]; next[i] = row; return next; }
  return [...list, row];
}

function now() { return new Date().toISOString(); }

type PackMatDef = {
  id: string;
  itemCode: string;
  name: string;
  unitCostKrw: number;
  vendorName: string;
  spec?: string;
  memo?: string;
};

/** 스프레드시트 단가 기준 — 핸드백 패키지용 자재 */
const PACK_MATERIALS: PackMatDef[] = [
  // 공통
  { id: 'hb-mat-man', itemCode: 'HB-MAN', name: '품질보증서', unitCostKrw: 80, vendorName: '에이스패키지', spec: '44*84' },
  { id: 'hb-mat-env', itemCode: 'HB-ENV', name: '형태봉투', unitCostKrw: 140, vendorName: '에이스패키지', spec: '46*92' },
  { id: 'hb-mat-label', itemCode: 'HB-LABEL', name: '라벨스티커', unitCostKrw: 94, vendorName: '레드프린팅', spec: '43*23' },
  { id: 'hb-mat-tape', itemCode: 'HB-TAPE', name: '박스테이프', unitCostKrw: 20, vendorName: '지오테이프', spec: '48mm' },
  { id: 'hb-mat-belt', itemCode: 'HB-BELT', name: '띠지', unitCostKrw: 225, vendorName: '에이스패키지', spec: '122*22.8' },
  { id: 'hb-mat-nz-st', itemCode: 'HB-NZ-ST', name: '노루지 스티커', unitCostKrw: 50, vendorName: '에이스패키지', memo: '박스SS 전용' },
  // 더스트백
  { id: 'hb-mat-dust-ss', itemCode: 'HB-DUST-SS', name: '더스트백SS', unitCostKrw: 600, vendorName: 'LUMEN패키지' },
  { id: 'hb-mat-dust-s', itemCode: 'HB-DUST-S', name: '더스트백S', unitCostKrw: 1190, vendorName: 'LUMEN패키지' },
  { id: 'hb-mat-dust-m', itemCode: 'HB-DUST-M', name: '더스트백M', unitCostKrw: 1290, vendorName: 'LUMEN패키지' },
  // 노루지 (표기: 노구지)
  { id: 'hb-mat-nz-ss', itemCode: 'HB-NZ-SS', name: '노루지SS', unitCostKrw: 23, vendorName: '에이스패키지' },
  { id: 'hb-mat-nz-s', itemCode: 'HB-NZ-S', name: '노루지S', unitCostKrw: 200, vendorName: '에이스패키지' },
  { id: 'hb-mat-nz-m', itemCode: 'HB-NZ-M', name: '노루지M', unitCostKrw: 200, vendorName: '에이스패키지' },
  { id: 'hb-mat-nz-l', itemCode: 'HB-NZ-L', name: '노루지L', unitCostKrw: 200, vendorName: '에이스패키지' },
  // 내부박스
  { id: 'hb-mat-in-ss', itemCode: 'HB-IN-SS', name: '내부박스SS', unitCostKrw: 800, vendorName: '대화박스', spec: '164*154*50' },
  { id: 'hb-mat-in-s', itemCode: 'HB-IN-S', name: '내부박스S', unitCostKrw: 1780, vendorName: '대화박스', spec: '305*290*130' },
  { id: 'hb-mat-in-m', itemCode: 'HB-IN-M', name: '내부박스M', unitCostKrw: 2584, vendorName: '대화박스', spec: '265*310*185' },
  { id: 'hb-mat-in-l', itemCode: 'HB-IN-L', name: '내부박스L', unitCostKrw: 2584, vendorName: '대화박스', spec: '379*354*144' },
  { id: 'hb-mat-in-xl', itemCode: 'HB-IN-XL', name: '내부박스XL', unitCostKrw: 2584, vendorName: '대화박스', spec: '489*389*184' },
  // 택배박스 (택배운임 제외)
  { id: 'hb-mat-out-ss', itemCode: 'HB-OUT-SS', name: '택배박스SS', unitCostKrw: 265, vendorName: '동명포장' },
  { id: 'hb-mat-out-s', itemCode: 'HB-OUT-S', name: '택배박스S', unitCostKrw: 470, vendorName: '동명포장' },
  { id: 'hb-mat-out-m', itemCode: 'HB-OUT-M', name: '택배박스M', unitCostKrw: 540, vendorName: '동명포장' },
  { id: 'hb-mat-out-l', itemCode: 'HB-OUT-L', name: '택배박스L', unitCostKrw: 800, vendorName: '동명포장' },
];

const VENDORS: Array<Partial<Vendor> & { id: string; name: string }> = [
  { id: 'pack-v-dongmyung', name: '동명포장', code: 'DMP', type: '자재거래처', country: '한국', currency: 'KRW', contactHistory: [], settlementCycle: '선입금', materialTypes: ['기타'] },
  { id: 'pack-v-daehoa', name: '대화박스', code: 'DHB', type: '자재거래처', country: '한국', currency: 'KRW', contactHistory: [], settlementCycle: '선입금', materialTypes: ['기타'] },
  { id: 'pack-v-ace', name: '에이스패키지', code: 'ACE', type: '자재거래처', country: '한국', currency: 'KRW', contactHistory: [], settlementCycle: '익월', materialTypes: ['기타'] },
  { id: 'pack-v-red', name: '레드프린팅', code: 'RED', type: '자재거래처', country: '한국', currency: 'KRW', contactHistory: [], settlementCycle: '카드', materialTypes: ['기타'] },
  { id: 'pack-v-geo', name: '지오테이프', code: 'GEO', type: '자재거래처', country: '한국', currency: 'KRW', contactHistory: [], settlementCycle: '익월', materialTypes: ['기타'] },
  { id: 'pack-v-lumen', name: 'LUMEN패키지', code: 'LMP', type: '자재거래처', country: '한국', currency: 'KRW', contactHistory: [], settlementCycle: '선입금', materialTypes: ['기타'] },
];

/** 공통 자재 (더스트백/내부박스/택배박스/노루지 제외) */
const COMMON_CODES = ['HB-MAN', 'HB-ENV', 'HB-LABEL', 'HB-TAPE', 'HB-BELT'] as const;

type HbKitDef = {
  size: PackingSize;
  styleNo: string;
  name: string;
  itemId: string;
  bomId: string;
  boxSpec: string;
  /** 사이즈별 + SS만 노루지스티커 */
  sizeCodes: string[];
};

const HB_BOX_KITS: HbKitDef[] = [
  {
    size: 'SS', styleNo: 'BOX-SS', name: '박스SS', itemId: 'hb-box-ss', bomId: 'hb-bom-ss',
    boxSpec: '164*154*50',
    sizeCodes: ['HB-DUST-SS', 'HB-NZ-SS', 'HB-NZ-ST', 'HB-IN-SS', 'HB-OUT-SS'],
  },
  {
    size: 'S', styleNo: 'BOX-S', name: '박스S', itemId: 'hb-box-s', bomId: 'hb-bom-s',
    boxSpec: '305*290*130',
    sizeCodes: ['HB-DUST-S', 'HB-NZ-S', 'HB-IN-S', 'HB-OUT-S'],
  },
  {
    size: 'M', styleNo: 'BOX-M', name: '박스M', itemId: 'hb-box-m', bomId: 'hb-bom-m',
    boxSpec: '265*310*185',
    sizeCodes: ['HB-DUST-M', 'HB-NZ-M', 'HB-IN-M', 'HB-OUT-M'],
  },
  {
    size: 'L', styleNo: 'BOX-L', name: '박스L', itemId: 'hb-box-l', bomId: 'hb-bom-l',
    boxSpec: '379*354*144',
    // L: 더스트백M 사용
    sizeCodes: ['HB-DUST-M', 'HB-NZ-L', 'HB-IN-L', 'HB-OUT-L'],
  },
  {
    size: 'XL', styleNo: 'BOX-XL-HB', name: '박스XL-HB', itemId: 'hb-box-xl-hb', bomId: 'hb-bom-xl-hb',
    boxSpec: '489*389*184',
    // XL-HB: 더스트백M + 노루지L + 내부박스XL + 택배박스L
    sizeCodes: ['HB-DUST-M', 'HB-NZ-L', 'HB-IN-XL', 'HB-OUT-L'],
  },
];

function matByCode(code: string): PackMatDef {
  const m = PACK_MATERIALS.find(x => x.itemCode === code);
  if (!m) throw new Error(`자재 코드 없음: ${code}`);
  return m;
}

function buildKitLines(sizeCodes: string[]): PackKitLine[] {
  const codes = [...COMMON_CODES, ...sizeCodes];
  return codes.map(code => {
    const m = matByCode(code);
    return { itemCode: code, name: m.name, qty: 1, unitCostKrw: m.unitCostKrw };
  });
}

function toPackBomLines(kitLines: PackKitLine[]): PackBomLine[] {
  return kitLines.map(l => {
    const m = matByCode(l.itemCode);
    return {
      materialId: m.id,
      itemCode: l.itemCode,
      itemName: l.name,
      spec: m.spec,
      unit: 'EA',
      qty: l.qty,
      unitPriceKrw: l.unitCostKrw,
      vendorName: m.vendorName,
    };
  });
}

export function getPackKits(): PackKit[] {
  try {
    return JSON.parse(localStorage.getItem('ames_pack_kits') || '[]');
  } catch { return []; }
}

export function isPackageItem(item: { styleNo?: string; erpCategory?: string }): boolean {
  const sn = item.styleNo || '';
  return (
    sn.startsWith('BOX-')
    || sn.startsWith('박스')
    || sn.startsWith('PACKAGE-')
    || (item.erpCategory === 'PACK' && (sn.startsWith('PACKAGE') || sn.startsWith('BOX')))
  );
}

export function isLegacyPackConsumable(item: { styleNo?: string; id?: string }): boolean {
  const sn = item.styleNo || '';
  if (sn.startsWith('LPKG-') || sn.startsWith('HB-')) return true;
  const id = item.id || '';
  return (
    id.startsWith('pack-out-') ||
    id.startsWith('pack-in-') ||
    id.startsWith('pack-dust-') ||
    id.startsWith('pack-nz-') ||
    id.startsWith('pack-bag-') ||
    id.startsWith('pack-tag') ||
    id.startsWith('pack-man') ||
    id.startsWith('pack-label') ||
    id.startsWith('pack-belt') ||
    id.startsWith('pack-tape') ||
    id.startsWith('pack-sv-') ||
    id.startsWith('pack-shoe-') ||
    id.startsWith('pack-st') ||
    id.startsWith('pack-ncr') ||
    id.startsWith('pack-env') ||
    id.startsWith('pack-nz-st') ||
    id.startsWith('hb-mat-')
  );
}

export function hasPackageKitItems(): boolean {
  return store.getItems().some(i =>
    (i.styleNo || '').startsWith('BOX-') || (i.styleNo || '').startsWith('PACKAGE-'),
  );
}

export async function seedLumenPackingData(): Promise<{
  ok: boolean;
  itemCount: number;
  materialCount: number;
  kits: PackKit[];
  summary: string[];
  errors: string[];
}> {
  const ts = now();
  const summary: string[] = [];
  const errors: string[] = [];

  // 1) 거래처
  let vendors = store.getVendors();
  for (const v of VENDORS) {
    const row: Vendor = {
      id: v.id, name: v.name, code: v.code || '', type: v.type || '자재거래처',
      country: v.country || '한국', currency: (v.currency as any) || 'KRW',
      contactHistory: [], settlementCycle: v.settlementCycle || '',
      materialTypes: v.materialTypes, createdAt: ts,
    };
    vendors = upsertById(vendors, row);
    try { await upsertVendor(row); } catch (e) {
      errors.push(`vendor ${v.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  store.setVendors(vendors);
  const vendorIdByName = Object.fromEntries(VENDORS.map(v => [v.name, v.id]));

  // 2) 자재 마스터
  let materials = store.getMaterials();
  for (const p of PACK_MATERIALS) {
    const mat: Material = {
      id: p.id,
      itemCode: p.itemCode,
      name: p.name,
      category: '포장재',
      spec: p.spec,
      unit: 'EA',
      unitPriceKrw: p.unitCostKrw,
      priceCurrency: 'KRW',
      vendorId: vendorIdByName[p.vendorName],
      memo: ['[HB PACK]', p.vendorName, p.memo].filter(Boolean).join(' · '),
      createdAt: ts,
    };
    materials = upsertById(materials, mat);
    try { await upsertMaterial(mat); } catch (e) {
      errors.push(`material ${p.itemCode}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  localStorage.setItem('ames_materials', JSON.stringify(materials));
  store.setMaterials(materials);
  summary.push(`포장재(자재) ${PACK_MATERIALS.length}건 · 택배운임 제외`);

  // 3) 레거시 소모품 품목 / 구 PACKAGE 키트 정리
  let items = store.getItems().filter(i =>
    !isLegacyPackConsumable(i)
    && !String(i.styleNo || '').startsWith('LPKG-')
    && !String(i.styleNo || '').startsWith('PACKAGE-'),
  );
  items = items.filter(i => !(i.erpCategory === 'PACK' && !isPackageItem(i) && !String(i.id || '').startsWith('hb-box-')));

  let boms = store.getBoms().filter(b =>
    !String(b.id || '').startsWith('pack-bom-')
    && !String(b.styleNo || '').startsWith('PACKAGE-'),
  );

  // 4) 박스SS ~ 박스XL-HB
  const kits: PackKit[] = [];
  for (const pkg of HB_BOX_KITS) {
    const kitLines = buildKitLines(pkg.sizeCodes);
    const totalCostKrw = kitLines.reduce((s, l) => s + l.qty * l.unitCostKrw, 0);
    const kit: PackKit = {
      id: `hb-kit-${pkg.size}`,
      packingSize: pkg.size,
      styleNo: pkg.styleNo,
      label: pkg.name,
      lines: kitLines,
      totalCostKrw,
      source: '핸드백 패키지 단가표 · 택배운임 제외',
    };
    kits.push(kit);

    const item: Item = {
      id: pkg.itemId,
      styleNo: pkg.styleNo,
      name: pkg.name,
      nameEn: pkg.styleNo,
      season: '26SS',
      category: '기타',
      customCategory: '패키지키트',
      erpCategory: 'PACK',
      materialType: '완제품',
      itemStatus: 'ACTIVE',
      material: `핸드백용 ${pkg.name} (${pkg.boxSpec})`,
      packingSize: pkg.size,
      deliveryPrice: totalCostKrw,
      baseCostKrw: totalCostKrw,
      hasBom: true,
      buyerId: undefined,
      colors: [{ name: '기본' }],
      designer: 'PACK-HB',
      memo: `[PACK][HB] ${pkg.boxSpec} · 택배운임 제외`,
      createdAt: ts,
    };
    items = upsertById(items, item);

    const packLines = toPackBomLines(kitLines);
    const bomBase = {
      id: pkg.bomId,
      styleId: pkg.itemId,
      styleNo: pkg.styleNo,
      styleName: item.name,
      version: 1,
      season: '26SS' as const,
      lines: [] as BomLine[],
      postProcessLines: [],
      processingFee: 0,
      logisticsCostKrw: 0,
      packagingCostKrw: 0,
      packingCostKrw: 0,
      productionMarginRate: 0,
      snapshotCnyKrw: 1,
      pnl: { discountRate: 0, platformFeeRate: 0, sgaRate: 0 },
      createdAt: ts,
      updatedAt: ts,
      erpCategory: 'PACK',
    } as Bom;
    const bom = applyPackLinesToBom(bomBase, packLines);
    boms = upsertById(boms, bom);

    try {
      await upsertItem({ ...item, erpCategory: 'ACC', memo: item.memo });
    } catch (e) {
      errors.push(`item ${pkg.styleNo}: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await upsertBom(bom);
    } catch (e) {
      errors.push(`bom ${pkg.styleNo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  store.setItems(items.map(i =>
    isPackageItem(i) ? { ...i, erpCategory: 'PACK' as const, hasBom: true } : i,
  ));
  store.setBoms(boms);

  localStorage.setItem('ames_pack_kits', JSON.stringify(kits));
  kits.forEach(k => summary.push(`${k.name}(${k.styleNo}): ₩${k.totalCostKrw.toLocaleString('ko-KR')} (${k.lines.length}자재)`));
  summary.push(`핸드백 패키지 ${HB_BOX_KITS.length}건 (박스SS~박스XL-HB)`);

  localStorage.setItem(PACK_SEED_FLAG, ts);
  return {
    ok: errors.length === 0,
    itemCount: HB_BOX_KITS.length,
    materialCount: PACK_MATERIALS.length,
    kits,
    summary,
    errors,
  };
}

/** 시드 데이터 상수 (스크립트/검수용) */
export const HB_PACK_SEED_META = {
  materials: PACK_MATERIALS,
  kits: HB_BOX_KITS,
  commonCodes: COMMON_CODES,
};
