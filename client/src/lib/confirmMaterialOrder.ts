// AMESCOTES ERP — 자재 발주 확정 정본 (Single Source of Truth)
//
// ⚠️ CLAUDE.md "절대 수정 금지" 연동 흐름의 구현체입니다.
//    거래처별 발주서 → "✅ 발주 확정" 클릭 시:
//      1. fetchMaterials() 조회 후 upsertMaterial() → 서버 DB materials 저장
//      2. upsertPurchaseItem() → 자재구매(PurchaseMatching) 탭에 표시
//      3. store.clearMaterialCart() → 장바구니 비우기
//      4. queryClient.invalidateQueries(['materials'])   ← 호출부 책임
//
// 예전엔 ProductionOrders와 PurchaseMatching에 사본이 하나씩 있었고 서로 달랐다:
//   - PurchaseMatching: 1단계(materials 저장)와 4단계가 통째로 없었음
//   - ProductionOrders: 장바구니 전체를 "마지막 발주 1건"의 발주번호로 태깅했음
//     (여러 발주를 담아 확정하면 A의 자재비가 B 손익에 전가됨)
// 이 파일은 양쪽의 올바른 동작을 합친 것이다.

import { store, genId, type CartItem, type ProductionOrder, type Vendor, type Currency, type PurchaseItem } from './store';
import { fetchMaterials, upsertMaterial, fetchPurchaseItems, upsertPurchaseItem } from './dbQueries';
import { materialCartIdentity } from './materialCartIdentity';

export interface ConfirmMaterialOrderParams {
  cartItems: CartItem[];
  /** 발주번호 매칭용 — 서버 DB에서 조회한 발주 목록 */
  orders: ProductionOrder[];
  vendors: Vendor[];
  /** CNY→KRW 환율 */
  cnyKrw: number;
  /** USD→KRW 환율 (USD 자재에 명시 환율이 없을 때만 사용) */
  usdKrw?: number;
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
  const { cartItems, orders, vendors, cnyKrw, usdKrw, fallbackOrder } = params;
  const today = new Date().toISOString().split('T')[0];

  // 재고로 충당되는 행도 같은 가격 계약으로 합친 뒤 발주 필요수량을 계산한다.
  const sourceTargets = cartItems
    .map(item => {
      if (!Number.isFinite(item.qty) || item.qty < 0 || !Number.isFinite(item.stockQty ?? 0) || (item.stockQty ?? 0) < 0) {
        throw new Error(`${item.materialName}: 수량·재고가 올바르지 않습니다. 장바구니 수량을 확인해 주세요.`);
      }
      return { item, pricing: resolveMaterialCartPricing(item, cnyKrw, usdKrw) };
    });
  // 미지정 환율과 명시 환율이 같은 계약으로 정규화되면 수량·재고·귀속도 합친다.
  const normalized = new Map<string, typeof sourceTargets[number]>();
  for (const target of sourceTargets) {
    const item = { ...target.item, ...target.pricing, orders: [...target.item.orders] };
    const key = materialCartIdentity(item);
    const previous = normalized.get(key);
    if (previous) {
      previous.item.qty = round3(previous.item.qty + item.qty);
      previous.item.stockQty = round3((previous.item.stockQty ?? 0) + (item.stockQty ?? 0));
      previous.item.orders.push(...item.orders);
    } else {
      normalized.set(key, { ...target, item });
    }
  }
  const quantityGroups = [...normalized.values()]
    .map(target => ({ ...target, orderQty: Math.max(0, target.item.qty - (target.item.stockQty ?? 0)) }));
  const targets = quantityGroups
    .filter(target => target.orderQty > 0)
    .map(target => ({ ...target, allocations: resolveOrderWeights(target.item, orders, fallbackOrder) }));
  // 금액 오버플로도 첫 저장 전에 확인한다.
  for (const { item, orderQty, pricing } of targets) {
    if (!Number.isFinite(orderQty * pricing.unitPriceCny * pricing.appliedRate)) {
      throw new Error(`${item.materialName}: 구매 금액이 올바르지 않습니다. 수량·단가·환율을 확인해 주세요.`);
    }
  }
  // 재시도 때 설정 환율이 바뀌어도 이미 저장된 구매와 동일한 가격 계약을 사용한다.
  // 현재 장바구니의 수량·다른 항목은 공용 store가 그대로 보존한다.
  store.freezeMaterialCartPricing(sourceTargets.map(({ item, pricing }) => ({
    item, currency: pricing.currency, appliedRate: pricing.appliedRate,
  })));

  // ── 1단계: 서버 DB materials 저장 ──
  // 구매는 공급처·가격별로 나누되 자재 정본은 이름·규격·단위별 한 번만 저장한다.
  const materialGroups = new Map<string, { item: CartItem; orderQty: number; vendors: Set<string> }>();
  for (const { item, orderQty } of targets) {
    const key = JSON.stringify([item.materialName, item.spec || '', item.unit]);
    const group = materialGroups.get(key);
    if (group) { group.orderQty = round3(group.orderQty + orderQty); group.vendors.add(item.vendorName || '미지정'); }
    else materialGroups.set(key, { item, orderQty, vendors: new Set([item.vendorName || '미지정']) });
  }
  const existingMaterials = await fetchMaterials();
  const existingPurchases = await fetchPurchaseItems({ strict: true });
  // 전량 재고 충당이어도 기존 구매가 있는 계약은 필요수량 0과의 충돌을 검증한다.
  const coveredRetries = quantityGroups.filter(({ item, orderQty, pricing }) => orderQty === 0
    && existingPurchases.some(p => samePurchaseContract(p, item, pricing)))
    .map(target => ({ ...target, allocations: resolveOrderWeights(target.item, orders, fallbackOrder) }));
  const plannedPurchases = [...targets, ...coveredRetries].flatMap(({ item, orderQty, allocations, pricing }) =>
    splitQtyByOrders(orderQty, allocations)
      .map(({ order, qty }) => ({ item, order, qty, pricing })));
  // 재시도는 가격 계약과 필요수량이 모두 일치할 때만 기존 구매를 보존한다.
  const purchasesToSave = plannedPurchases.filter(({ item, order, qty, pricing }) => {
    const matches = existingPurchases.filter(p => p.orderNo === order.orderNo && samePurchaseContract(p, item, pricing));
    if (matches.length === 0) return qty > 0;
    if (matches.length !== 1 || !Number.isFinite(matches[0].qty) || round3(matches[0].qty) !== round3(qty)) {
      throw new Error(`${item.materialName}: ${order.orderNo}의 기존 구매수량과 필요수량 ${qty}이 일치하지 않거나 구매전표가 중복됩니다. 기존 구매전표와 장바구니 수량을 확인해 주세요.`);
    }
    return false;
  });
  let materialCount = 0;
  for (const { item, orderQty, vendors: supplierNames } of materialGroups.values()) {
    const vendorName = [...supplierNames].join(', ');
    const existing = existingMaterials.find(
      (m: any) => m.name === item.materialName && m.unit === item.unit
        && (!item.spec || (m.spec || '') === item.spec),
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
        || (supplierNames.size === 1 ? vendors.find(v => v.name === vendorName && v.type === '자재거래처')?.id : undefined),
      createdAt: (existing as any)?.createdAt || new Date().toISOString(),
    });
    materialCount++;
  }

  // ── 2단계: 자재구매 전표 생성 (발주별로 분리) ──
  let purchaseCount = 0;
  const skippedNoOrder: string[] = [];

  for (const { item, order, qty, pricing } of purchasesToSave) {
      const { unitPriceCny, currency, appliedRate } = pricing;

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
        spec: item.spec || '',
        unitPriceCny,
        currency,
        appliedRate,
        amountKrw: Math.round(unitPriceCny * qty * appliedRate),
        vendorName: item.vendorName || '미지정',
        paymentMethod: '기타',
        purchaseStatus: '미발주',
        createdAt: new Date().toISOString(),
      });
      purchaseCount++;
  }

  // ── 3단계: 장바구니 비우기 (저장이 모두 끝난 뒤에만) ──
  store.clearMaterialCart();

  return { materialCount, purchaseCount, skippedNoOrder };
}

type PricedCartItem = CartItem & { currency?: Currency; appliedRate?: number };

export function resolveMaterialCartPricing(item: PricedCartItem, cnyKrw: number, usdKrw?: number) {
  const currency = item.currency ?? 'CNY';
  const unitPriceCny = item.unitPriceCny ?? 0;
  if (!['CNY', 'USD', 'KRW'].includes(currency) || !Number.isFinite(unitPriceCny) || unitPriceCny < 0) {
    throw new Error(`${item.materialName}: 통화·단가가 올바르지 않습니다. BOM/원가에서 확인한 뒤 다시 담아 주세요.`);
  }
  const appliedRate = currency === 'KRW' ? 1 : item.appliedRate ?? (currency === 'USD' ? usdKrw : cnyKrw);
  if (!Number.isFinite(appliedRate) || (appliedRate ?? 0) <= 0) {
    throw new Error(`${item.materialName}: ${currency} 적용 환율이 누락되었거나 올바르지 않습니다. BOM/원가 또는 설정에서 ${currency}→KRW 환율을 확인해 주세요.`);
  }
  return { currency, unitPriceCny, appliedRate: appliedRate as number };
}

/** 화면·인쇄도 확정 시와 같은 환율을 사용하며 오류는 금액 대신 안내를 표시한다. */
export function getMaterialCartAmountKrw(item: PricedCartItem, qty: number, cnyKrw: number, usdKrw?: number): number | null {
  try {
    const pricing = resolveMaterialCartPricing(item, cnyKrw, usdKrw);
    const amount = Math.round(qty * pricing.unitPriceCny * pricing.appliedRate);
    return Number.isFinite(amount) ? amount : null;
  } catch { return null; }
}

function purchaseIdentity(orderNo: string, name: string, unit: string, vendor: string | undefined,
  spec: string | undefined, currency: Currency, price: number, rate: number | undefined): string {
  return JSON.stringify([orderNo, name, unit, vendor || '미지정', spec || '', currency, price, rate]);
}

function samePurchaseContract(
  purchase: PurchaseItem,
  item: CartItem,
  pricing: ReturnType<typeof resolveMaterialCartPricing>,
): boolean {
  const sameBase = purchase.itemName === item.materialName && purchase.unit === item.unit
    && (purchase.vendorName || '미지정') === (item.vendorName || '미지정');
  if (sameBase && pricing.currency === 'CNY' && !item.spec && !purchase.spec
    && (!purchase.currency || purchase.currency === 'CNY') && purchase.legacyPricingIdentity === true) return true;
  return purchaseIdentity('', purchase.itemName, purchase.unit, purchase.vendorName, purchase.spec,
    purchase.currency ?? 'CNY', purchase.unitPriceCny ?? 0,
    purchase.currency === 'KRW' ? 1 : purchase.appliedRate) === purchaseIdentity('', item.materialName,
      item.unit, item.vendorName, item.spec, pricing.currency, pricing.unitPriceCny, pricing.appliedRate);
}

type OrderWeight = { order: ProductionOrder; weight: number };
// 공용 CartItem 타입에 귀속 필드가 추가되기 전에도 새 provenance를 읽을 수 있다.
type CartOrderReference = CartItem['orders'][number] & { orderId?: string; orderNo?: string };

function resolveOrderWeights(
  item: CartItem,
  orders: ProductionOrder[],
  fallbackOrder?: ProductionOrder | null,
): OrderWeight[] {
  const candidates = [...orders];
  if (fallbackOrder && !candidates.some(o => o.id === fallbackOrder.id)) {
    candidates.push(fallbackOrder);
  }
  const weights = new Map<string, OrderWeight>();
  let missing = false;
  for (const ref of item.orders as CartOrderReference[]) {
    const matches = ref.orderId
      ? candidates.filter(o => o.id === ref.orderId)
      : ref.orderNo
        ? candidates.filter(o => o.orderNo === ref.orderNo)
        : candidates.filter(o => o.styleNo === ref.styleNo);
    if (matches.length > 1) {
      throw new Error(`${item.materialName}: ${ref.styleNo}의 발주가 여러 건입니다. 주문 ID를 포함하여 장바구니에 다시 담아 주세요.`);
    }
    const order = matches[0];
    if (!order) {
      if (ref.orderId || ref.orderNo) throw new Error(`${item.materialName}: 주문 ${ref.orderId || ref.orderNo}의 발주를 찾을 수 없습니다.`);
      missing = true;
      continue;
    }
    if ((ref.orderId || ref.orderNo) && (order.styleNo !== ref.styleNo || (ref.orderNo && order.orderNo !== ref.orderNo))) {
      throw new Error(`${item.materialName}: 주문 ID와 스타일번호가 일치하지 않습니다.`);
    }
    if (!Number.isFinite(ref.qty) || ref.qty < 0) {
      throw new Error(`${item.materialName}: 발주별 소요수량이 올바르지 않습니다.`);
    }
    const entry = weights.get(order.id);
    if (entry) entry.weight += ref.qty;
    else weights.set(order.id, { order, weight: ref.qty });
  }
  if (missing) {
    throw new Error(`${item.materialName}: 일부 발주의 귀속을 확인할 수 없습니다. 장바구니에 다시 담아 주세요.`);
  }
  if (item.orders.length === 0 && fallbackOrder) {
    return [{ order: fallbackOrder, weight: item.qty }];
  }
  if (weights.size === 0) throw new Error(`${item.materialName}: 발주 귀속을 확인할 수 없습니다. 장바구니에 다시 담아 주세요.`);
  return [...weights.values()];
}

/**
 * 자재 소요수량을 발주별로 배분한다.
 * 장바구니의 item.orders에 발주별 소요량이 있으면 그 비율로, 없으면 균등 배분.
 * 반올림 오차는 마지막 발주에 몰아 합계를 보존한다.
 */
function splitQtyByOrders(
  totalQty: number,
  allocations: OrderWeight[],
): Array<{ order: ProductionOrder; qty: number }> {
  if (allocations.length === 1) return [{ order: allocations[0].order, qty: totalQty }];

  const weights = allocations.map(a => a.weight);
  const weightSum = weights.reduce((s, w) => s + w, 0);

  const result: Array<{ order: ProductionOrder; qty: number }> = [];
  let assigned = 0;
  allocations.forEach(({ order }, i) => {
    const isLast = i === allocations.length - 1;
    if (isLast) {
      result.push({ order, qty: round3(totalQty - assigned) }); // 잔여 전량 — 합계 보존
      return;
    }
    const share = weightSum > 0
      ? (totalQty * weights[i]) / weightSum
      : totalQty / allocations.length;
    const qty = Math.min(round3(share), Math.max(0, round3(totalQty - assigned)));
    assigned += qty;
    result.push({ order, qty });
  });
  return result;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
