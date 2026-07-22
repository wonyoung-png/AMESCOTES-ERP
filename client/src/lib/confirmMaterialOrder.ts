// AMESCOTES ERP — 자재 발주 확정 정본 (Single Source of Truth)
//
// ⚠️ CLAUDE.md "절대 수정 금지" 연동 흐름의 구현체입니다.
//    거래처별 발주서 → "✅ 발주 확정" 클릭 시:
//      1. fetchMaterials() 조회 후 upsertMaterial() → Supabase materials 저장
//      2. upsertPurchaseItem() → 자재구매(PurchaseMatching) 탭에 표시
//      3. store.clearMaterialCart() → 장바구니 비우기
//      4. queryClient.invalidateQueries(['materials'])   ← 호출부 책임
//
// 예전엔 ProductionOrders와 PurchaseMatching에 사본이 하나씩 있었고 서로 달랐다:
//   - PurchaseMatching: 1단계(materials 저장)와 4단계가 통째로 없었음
//   - ProductionOrders: 장바구니 전체를 "마지막 발주 1건"의 발주번호로 태깅했음
//     (여러 발주를 담아 확정하면 A의 자재비가 B 손익에 전가됨)
// 이 파일은 양쪽의 올바른 동작을 합친 것이다.

import { store, genId, type CartItem, type ProductionOrder, type Vendor } from './store';
import { fetchMaterials, upsertMaterial, fetchPurchaseItems, upsertPurchaseItem } from './supabaseQueries';

export interface ConfirmMaterialOrderParams {
  cartItems: CartItem[];
  /** 발주번호 매칭용 — Supabase에서 조회한 발주 목록 */
  orders: ProductionOrder[];
  vendors: Vendor[];
  /** CNY→KRW 환율 */
  cnyKrw: number;
  /**
   * 장바구니 항목이 어느 발주에도 매칭되지 않을 때 사용할 발주.
   * (발주 완료 팝업에서 바로 확정하는 경로)
   */
  fallbackOrder?: ProductionOrder | null;
}

export interface ConfirmMaterialOrderResult {
  materialCount: number;   // 자재마스터에 저장된 자재 종수
  purchaseCount: number;   // 자재구매 탭에 생성된 전표 건수
  skippedNoOrder: string[]; // 발주번호를 못 찾아 건너뛴 자재명
}

/** 발주 확정 — 실패 시 throw 합니다. 호출부에서 try/catch로 감싸 toast를 띄우세요. */
export async function confirmMaterialOrder(
  params: ConfirmMaterialOrderParams,
): Promise<ConfirmMaterialOrderResult> {
  const { cartItems, orders, vendors, cnyKrw, fallbackOrder } = params;
  const today = new Date().toISOString().split('T')[0];

  // 발주필요수량이 0보다 큰 항목만 대상
  const targets = cartItems
    .map(item => ({ item, orderQty: Math.max(0, item.qty - (item.stockQty ?? 0)) }))
    .filter(t => t.orderQty > 0);

  // ── 1단계: Supabase materials 저장 ──
  const existingMaterials = await fetchMaterials();
  let materialCount = 0;
  for (const { item, orderQty } of targets) {
    const vendorName = item.vendorName || '미지정';
    const existing = existingMaterials.find(
      (m: any) => m.name === item.materialName && m.unit === item.unit,
    );
    await upsertMaterial({
      id: existing?.id || genId(),
      name: item.materialName,
      // 기존 자재의 규격·분류를 발주 확정이 덮어쓰지 않도록 보존한다.
      // (예전엔 spec: ''와 category: '원자재'를 무조건 써서 포장재가 원자재로 바뀌었다)
      spec: item.spec || (existing as any)?.spec || '',
      unit: item.unit,
      category: (existing as any)?.category || '원자재',
      orderStatus: '발주중',
      orderDate: today,
      orderQty,
      orderVendorName: vendorName,
      vendorId:
        (existing as any)?.vendorId
        || vendors.find(v => v.name === vendorName && v.type === '자재거래처')?.id,
      createdAt: (existing as any)?.createdAt || new Date().toISOString(),
    });
    materialCount++;
  }

  // ── 2단계: 자재구매 전표 생성 (발주별로 분리) ──
  const existingPurchases = await fetchPurchaseItems();
  // 이미 등록된 (발주번호 + 자재명 + 단위) 조합 — 루프 중에도 갱신해 재클릭 중복을 막는다
  const seen = new Set(
    existingPurchases.map(p => `${p.orderNo}||${p.itemName}||${p.unit}`),
  );

  let purchaseCount = 0;
  const skippedNoOrder: string[] = [];

  for (const { item, orderQty } of targets) {
    // 이 자재가 걸린 발주들을 찾는다. 장바구니는 여러 발주가 합산된 구조라
    // 반드시 발주별로 나눠 저장해야 손익이 섞이지 않는다.
    const styleNos = Array.from(new Set(item.orders.map(o => o.styleNo)));
    const matched = styleNos
      .map(styleNo => orders.find(o => o.styleNo === styleNo))
      .filter((o): o is ProductionOrder => !!o);

    const targetOrders = matched.length > 0 ? matched : (fallbackOrder ? [fallbackOrder] : []);
    if (targetOrders.length === 0) {
      // 발주번호를 모르면 저장하지 않는다.
      // 예전엔 스타일번호를 발주번호 자리에 넣어서 이후 조인이 전부 깨졌다.
      skippedNoOrder.push(item.materialName);
      continue;
    }

    // 소요수량을 발주 수량 비율대로 배분 (합계가 orderQty와 일치하도록 마지막에 잔여 배정)
    const qtyByOrder = splitQtyByOrders(orderQty, item, targetOrders);

    for (const { order, qty } of qtyByOrder) {
      if (qty <= 0) continue;
      const key = `${order.orderNo}||${item.materialName}||${item.unit}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const unitPriceCny = item.unitPriceCny ?? 0;
      await upsertPurchaseItem({
        id: genId(),
        orderId: order.id,
        orderNo: order.orderNo,
        projectNo: order.projectNo,
        styleNo: order.styleNo,
        purchaseDate: today,
        itemName: item.materialName,
        qty,
        unit: item.unit,
        unitPriceCny,
        currency: 'CNY',
        appliedRate: cnyKrw || 191,
        amountKrw: Math.round(unitPriceCny * qty * (cnyKrw || 191)),
        vendorName: item.vendorName || '미지정',
        paymentMethod: '기타',
        purchaseStatus: '미발주',
        createdAt: new Date().toISOString(),
      });
      purchaseCount++;
    }
  }

  // ── 3단계: 장바구니 비우기 (저장이 모두 끝난 뒤에만) ──
  store.clearMaterialCart();

  return { materialCount, purchaseCount, skippedNoOrder };
}

/**
 * 자재 소요수량을 발주별로 배분한다.
 * 장바구니의 item.orders에 발주별 소요량이 있으면 그 비율로, 없으면 균등 배분.
 * 반올림 오차는 마지막 발주에 몰아 합계를 보존한다.
 */
function splitQtyByOrders(
  totalQty: number,
  item: CartItem,
  targetOrders: ProductionOrder[],
): Array<{ order: ProductionOrder; qty: number }> {
  if (targetOrders.length === 1) return [{ order: targetOrders[0], qty: totalQty }];

  const weights = targetOrders.map(o => {
    const hit = item.orders.find(x => x.styleNo === o.styleNo);
    return hit?.qty ?? 0;
  });
  const weightSum = weights.reduce((s, w) => s + w, 0);

  const result: Array<{ order: ProductionOrder; qty: number }> = [];
  let assigned = 0;
  targetOrders.forEach((order, i) => {
    const isLast = i === targetOrders.length - 1;
    if (isLast) {
      result.push({ order, qty: round3(totalQty - assigned) }); // 잔여 전량 — 합계 보존
      return;
    }
    const share = weightSum > 0
      ? (totalQty * weights[i]) / weightSum
      : totalQty / targetOrders.length;
    const qty = round3(share);
    assigned += qty;
    result.push({ order, qty });
  });
  return result;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
