/**
 * 발주에서 본사제공 자재를 뽑아 자재 장바구니에 담는다.
 *
 * 단건 발주(BOM 연동 모달)와 일괄 발주(발주 등록)가 각자 다른 길을 갖고 있었다.
 * 일괄 쪽은 아예 담지 않았고, 단건 쪽은 이관 전 Supabase 주소를 읽고 있었다.
 * 발주 완료 팝업은 또 다른 규칙으로 자재를 뽑아, 보여준 것과 담긴 것이 달랐다.
 * 셋을 한 곳으로 모은다 — 여기만 고치면 같이 낫는다.
 *
 * 컬러별로 따로 담는 것이 핵심이다. 컬러를 묶어 품명으로 중복 제거한 뒤
 * 총수량을 곱하면, 컬러마다 소요량이 다른 자재가 틀리게 나온다.
 */
import { store, getBomForOrderFromList, type Bom, type BomLine, type ColorQty } from './store';

/** 장바구니가 받는 모양 */
export type CartMaterial = {
  itemName: string; spec?: string; unit: string;
  netQty: number; lossRate: number;
  vendorName?: string; isHqProvided: boolean;
  imageUrl?: string; unitPriceCny?: number;
};

const toCartMaterial = (l: BomLine): CartMaterial => ({
  itemName: l.itemName ?? '',
  spec: l.spec ?? '',
  unit: l.unit ?? '',
  netQty: l.netQty ?? 0,
  lossRate: l.lossRate ?? 0,
  vendorName: l.vendorName ?? '',
  isHqProvided: true,
  imageUrl: (l as any).imageUrl,
  unitPriceCny: (l as any).unitPriceCny ?? (l as any).unitPrice ?? 0,
});

const hqOnly = (lines?: BomLine[] | null) => (lines || []).filter(l => l?.isHqProvided).map(toCartMaterial);

/**
 * 컬러가 없는 BOM에서 쓸 자재 줄 — 사후 우선, 없으면 사전.
 * BomManagement 의 "사후원가 우선, 없으면 사전원가 폴백" 규칙과 같다.
 */
function flatLines(bom: Bom): BomLine[] {
  const b = bom as any;
  if (b.postMaterials?.length) return b.postMaterials;
  if (b.postColorBoms?.[0]?.lines?.length) return b.postColorBoms[0].lines;
  if (b.colorBoms?.[0]?.lines?.length) return b.colorBoms[0].lines;
  return b.lines || [];
}

/**
 * 이 발주가 쓸 BOM 을 고른다.
 *
 * 같은 품번에 BOM 이 여러 개 남아 있는 스타일이 있다 (실측 14건).
 * 품번만 보고 고르면 남의 BOM 자재가 담길 수 있어,
 * 품목 id 가 맞는 BOM 이 있으면 그것들 안에서만 고른다 (코덱스 지적).
 *
 * 그러고도 둘 이상 남으면 어느 것이 맞는지 코드로는 알 수 없다 — `ambiguous` 로 알린다.
 */
export function pickBomForOrder(
  boms: Bom[],
  styleNo: string,
  styleId?: string,
  colorQtys?: ColorQty[],
  totalQty = 1,
): { bom: Bom | null; ambiguous: boolean } {
  const all = (boms || []).filter(b => b.styleNo === styleNo || (!!styleId && b.styleId === styleId));
  const mine = styleId ? all.filter(b => b.styleId === styleId) : [];
  const pool = mine.length > 0 ? mine : all;
  const bom = getBomForOrderFromList(pool, styleNo, styleId).bom;
  // 자재 구성이 서로 다른 중복만 문제다. 내용이 같으면 어느 것을 골라도 결과가 같다.
  //
  // 지문을 따로 계산하지 않는다. 이 발주에서 **실제로 담길 것**을 그대로 견준다 —
  // 판정과 실행이 다른 입력을 보면 어느 쪽이든 어긋난다 (코덱스가 세 번 짚은 곳이다).
  const ambiguous = pool.length > 1
    && new Set(pool.map(b => hqSignature(hqGroups(b, colorQtys, totalQty)))).size > 1;
  return { bom, ambiguous };
}

/**
 * 담길 자재 묶음을 문자열 하나로 — 같은 구성이면 같은 문자열이 나온다.
 * 자재 줄은 정렬해 담는다. 순서만 다른 것을 다르다고 하면 헛경고가 난다.
 */
function hqSignature(groups: ReturnType<typeof hqGroups>): string {
  // 장바구니에 실제로 실리는 칸을 전부 본다. 단가·사진만 달라도 담기는 결과가 달라진다 (코덱스 지적)
  const one = (m: CartMaterial) =>
    [m.itemName, m.spec, m.unit, m.netQty, m.lossRate, m.vendorName, m.unitPriceCny, m.imageUrl].join('');
  return groups
    .map(g => [g.color, g.qty, ...g.mats.map(one).sort()].join(''))
    .sort()
    .join('');
}

/**
 * 컬러별로 "이 수량에 이 자재들" 묶음을 만든다. 담는 쪽과 보여주는 쪽이 같은 것을 쓴다.
 */
export function hqGroups(
  bom: Bom | null | undefined,
  colorQtys: ColorQty[] | undefined,
  totalQty: number,
): Array<{ color: string; qty: number; mats: CartMaterial[] }> {
  if (!bom) return [];
  const colorBoms: any[] = (bom as any).postColorBoms?.length
    ? (bom as any).postColorBoms
    : ((bom as any).colorBoms || []);
  const picked = (colorQtys || []).filter(cq => (cq?.qty || 0) > 0);

  if (colorBoms.length > 0 && picked.length > 0) {
    const out: Array<{ color: string; qty: number; mats: CartMaterial[] }> = [];
    for (const cq of picked) {
      const hit = colorBoms.find((cb: any) => (cb?.color || '').trim() === (cq.color || '').trim());
      // 그 컬러의 BOM이 없으면 첫 컬러 것으로 갈음한다 — 안 담는 것보다 낫다
      const mats = hqOnly(hit?.lines || colorBoms[0]?.lines);
      if (mats.length > 0) out.push({ color: cq.color, qty: cq.qty, mats });
    }
    if (out.length > 0) return out;
  }

  const mats = hqOnly(flatLines(bom));
  if (mats.length === 0 || totalQty <= 0) return [];
  return [{ color: '', qty: totalQty, mats }];
}

/**
 * 팝업에 띄울 목록 — 컬러마다 같은 자재가 겹치니 한 번만 보여준다.
 * 품명만으로 묶으면 규격이 다른 동명 자재가 사라진다 — 장바구니와 같은 키로 묶는다 (코덱스 지적).
 */
export function hqMaterialsForDisplay(groups: ReturnType<typeof hqGroups>): CartMaterial[] {
  const seen = new Set<string>();
  const out: CartMaterial[] = [];
  for (const g of groups) {
    for (const m of g.mats) {
      const key = [m.itemName, m.spec, m.unit, m.vendorName].join('');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

/**
 * 본사제공 자재를 장바구니에 담는다. 담은 자재 줄 수를 돌려준다 (0이면 담을 게 없었다).
 * 예외를 던지지 않는다 — 장바구니는 덤이고 발주 저장이 본체다.
 */
export function addHqMaterialsToCart(
  groups: ReturnType<typeof hqGroups>,
  styleNo: string,
  styleName: string,
): number {
  try {
    let added = 0;
    for (const g of groups) {
      store.addToMaterialCart(styleNo, styleName, g.mats, g.qty);
      added += g.mats.length;
    }
    return added;
  } catch {
    return 0;
  }
}
