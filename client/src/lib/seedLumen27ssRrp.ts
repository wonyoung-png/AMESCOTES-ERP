/**
 * LUMEN 27SS RRP — 바이어(LUMEN) + 품목 일괄 등록
 * 영문/국문명 괄호 = 컬러, 동일 품명 합산 · KMSRP → confirmedSalePrice · RRP 이미지
 */
import products from './data/lumen-27ss-products.json';
import imageMap from './data/lumen-27ss-images.json';
import { store, type Item, type Category, type ErpCategory, type Season, type Vendor } from './store';
import { upsertItem, upsertVendor, saveConfirmedSalePrice, fetchVendors, fetchItems } from './supabaseQueries';

export const LUMEN_27SS_SEED_FLAG = 'ames_lumen_27ss_rrp_v3';
export const LUMEN_BUYER_ID = 'vendor-lumen-buyer';

const IMAGE_BY_EN = imageMap as Record<string, string>;

export interface Lumen27Product {
  enName: string;
  koName: string;
  season: string;
  erpCategory: string;
  category: string;
  colors: Array<{ name: string; leatherColor?: string }>;
  kmsrp: number;
  memoExtra?: string;
}

export function hasLumen27ssItems(items: Array<{ id?: string; season?: string; nameEn?: string }>): boolean {
  return items.some(i =>
    i.season === '27SS'
    && (
      (i.id || '').startsWith('lumen-27ss')
      || (i.nameEn || '').toUpperCase() === 'FINE BAG'
    ),
  );
}

export function lumen27ssMissingImages(items: Array<{ season?: string; nameEn?: string; imageUrl?: string }>): boolean {
  return (products as Lumen27Product[]).some(p => {
    const url = IMAGE_BY_EN[p.enName];
    if (!url) return false;
    const it = items.find(i => (i.nameEn || '').toUpperCase() === p.enName.toUpperCase() && i.season === '27SS');
    return !it?.imageUrl;
  });
}

function typeCode(erpCategory: string, category: string): string {
  if (erpCategory === 'ACC') return 'AC';
  if (erpCategory === 'SHOES') return 'SH';
  if (category === '백팩') return 'BP';
  return 'HB';
}

function slug(enName: string): string {
  return enName.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '-').replace(/^-|-$/g, '') || 'item';
}

function nextStyleNo(
  brandCode: string,
  erpCategory: string,
  category: string,
  existing: Item[],
  seqCounter: Record<string, number>,
): string {
  const regist = new Date(2026, 6, 15);
  const yy = String(regist.getFullYear()).slice(2);
  const mm = String(regist.getMonth() + 1).padStart(2, '0');
  const tc = typeCode(erpCategory, category);
  const prefix = `${brandCode.toUpperCase()}${yy}${mm}${tc}`;
  if (seqCounter[tc] == null) {
    let max = 0;
    for (const it of existing) {
      if (!it.styleNo?.startsWith(prefix)) continue;
      const n = parseInt(it.styleNo.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
    seqCounter[tc] = max;
  }
  seqCounter[tc] += 1;
  return `${prefix}${String(seqCounter[tc]).padStart(2, '0')}`;
}

export async function ensureLumenBuyer(): Promise<{ id: string; code: string }> {
  const vendors = await fetchVendors().catch(() => store.getVendors());
  const found = vendors.find(v =>
    v.code === 'LLL'
    || String(v.name).toUpperCase() === 'LUMEN'
    || String(v.name).includes('루멘')
    || v.id === LUMEN_BUYER_ID,
  );

  if (found) {
    store.updateVendor(found.id, {
      name: 'LUMEN',
      code: found.code || 'LLL',
      companyName: found.companyName || 'LUMEN',
      type: '바이어',
    });
    try {
      await upsertVendor({
        ...found,
        name: 'LUMEN',
        code: found.code || 'LLL',
        companyName: found.companyName || 'LUMEN',
        type: '바이어',
      });
    } catch { /* local ok */ }
    return { id: found.id, code: found.code || 'LLL' };
  }

  const row: Vendor = {
    id: LUMEN_BUYER_ID,
    name: 'LUMEN',
    code: 'LLL',
    companyName: 'LUMEN',
    type: '바이어',
    country: '한국',
    currency: 'KRW',
    contactHistory: [],
    createdAt: new Date().toISOString(),
    memo: 'LUMEN 브랜드 (27SS RRP 자동등록)',
  };
  store.addVendor(row);
  try {
    await upsertVendor(row);
  } catch { /* local ok */ }
  return { id: row.id, code: 'LLL' };
}

export async function seedLumen27ssRrp(force = false): Promise<{
  buyerId: string;
  created: number;
  updated: number;
  total: number;
  errors: string[];
}> {
  const existingProbe = store.getItems() as Item[];
  if (
    !force
    && localStorage.getItem(LUMEN_27SS_SEED_FLAG)
    && hasLumen27ssItems(existingProbe)
    && !lumen27ssMissingImages(existingProbe)
  ) {
    return { buyerId: LUMEN_BUYER_ID, created: 0, updated: 0, total: 0, errors: [] };
  }
  if (!force && localStorage.getItem(LUMEN_27SS_SEED_FLAG) && !hasLumen27ssItems(existingProbe)) {
    localStorage.removeItem(LUMEN_27SS_SEED_FLAG);
  }

  const buyer = await ensureLumenBuyer();
  const existing = [...(await fetchItems().catch(() => store.getItems() as Item[]))];
  const seqCounter: Record<string, number> = {};
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  const now = new Date().toISOString();
  const list = products as Lumen27Product[];

  for (const p of list) {
    try {
      const key = p.enName.toUpperCase();
      const prev = existing.find(it =>
        (it.nameEn || '').toUpperCase() === key && it.season === '27SS',
      );

      const id = prev?.id || `lumen-27ss-${slug(p.enName)}`;
      const styleNo = prev?.styleNo || nextStyleNo(buyer.code, p.erpCategory, p.category, existing, seqCounter);

      const imageUrl = IMAGE_BY_EN[p.enName] || (prev as Item | undefined)?.imageUrl;

      const item: Record<string, unknown> = {
        id,
        styleNo,
        name: p.koName,
        nameEn: p.enName,
        season: (p.season || '27SS') as Season,
        category: p.category as Category,
        erpCategory: p.erpCategory as ErpCategory,
        materialType: '완제품',
        material: '',
        buyerId: buyer.id,
        colors: p.colors,
        imageUrl,
        confirmedSalePrice: p.kmsrp > 0 ? p.kmsrp : 0,
        hasBom: false,
        baseCostKrw: 0,
        memo: [
          'LUMEN 27SS RRP 자동등록',
          p.kmsrp ? `KMSRP ${p.kmsrp.toLocaleString()}KRW` : null,
          p.memoExtra || null,
        ].filter(Boolean).join(' · '),
        createdAt: (prev as Item | undefined)?.createdAt || now,
        updatedAt: now,
      };

      await upsertItem(item);
      if (p.kmsrp > 0) {
        try {
          await saveConfirmedSalePrice(id, p.kmsrp);
        } catch { /* ignore missing column */ }
      }

      if (!prev) {
        existing.push(item as unknown as Item);
        created++;
      } else {
        updated++;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p.enName}: ${msg}`);
    }
  }

  localStorage.setItem(LUMEN_27SS_SEED_FLAG, now);
  return { buyerId: buyer.id, created, updated, total: list.length, errors };
}

export function getLumen27ssProductCount() {
  return (products as Lumen27Product[]).length;
}
