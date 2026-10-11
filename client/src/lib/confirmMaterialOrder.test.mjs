import assert from 'node:assert/strict';
import test from 'node:test';
import { build, transformSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// 실제 helper를 번들링하고 저장 경계만 대체한다. DB/공용 store는 변경하지 않는다.
let state;
// 부모가 제공한 실제 freeze 구현을 메모리 저장 경계에서 실행한다.
const identityModule = { exports: {} };
new Function('module', 'exports', transformSync(
  readFileSync(new URL('./materialCartIdentity.ts', import.meta.url), 'utf8'),
  { loader: 'ts', format: 'cjs' }).code)(identityModule, identityModule.exports);
const { materialCartIdentity } = identityModule.exports;
const storeSource = readFileSync(new URL('./store.ts', import.meta.url), 'utf8');
const freezeStart = storeSource.indexOf('  freezeMaterialCartPricing:');
const freezeEnd = storeSource.indexOf('  // Auth helpers', freezeStart);
assert.ok(freezeStart >= 0 && freezeEnd > freezeStart);
const freezeCode = transformSync(`const methods = { ${storeSource.slice(freezeStart, freezeEnd)} };`, { loader: 'ts' }).code;
const browserCartMethods = new Function('getAll', 'setAll', 'KEYS', 'materialCartIdentity', freezeCode + ';return methods;')(
  () => structuredClone(state.browserCart), (_, value) => { state.browserCart = value; },
  { materialCart: 'cart' }, materialCartIdentity);
const freezePricing = browserCartMethods.freezeMaterialCartPricing;
globalThis.confirmMaterialOrderTest = {
  fetchMaterials: async () => { state.reads++; state.events.push('read-materials'); return state.materials; },
  upsertMaterial: async row => { state.materialWrites.push(row); },
  fetchPurchaseItems: async options => {
    assert.deepEqual(options, { strict: true });
    if (state.readError) throw new Error('purchase read failed');
    return state.purchases;
  },
  upsertPurchaseItem: async row => {
    if (state.failOrder === row.orderId) throw new Error('purchase save failed');
    state.purchases.push(row);
    state.purchaseWrites.push(row);
  },
  clearMaterialCart: () => { state.clears++; },
  freezeMaterialCartPricing: updates => {
    state.freezes++; state.events.push('freeze');
    freezePricing(updates);
  },
  genId: () => `generated-${++state.ids}`,
};
const out = await build({
  entryPoints: [fileURLToPath(new URL('./confirmMaterialOrder.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'confirm-material-order-boundaries', setup(b) {
    b.onResolve({ filter: /^\.\/(store|dbQueries)$/ }, a => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ loader: 'js', contents: a.path === './store'
      ? `const t = globalThis.confirmMaterialOrderTest; export const genId = t.genId;
         export const store = { clearMaterialCart: t.clearMaterialCart, freezeMaterialCartPricing: t.freezeMaterialCartPricing };`
      : `const t = globalThis.confirmMaterialOrderTest;
         export const { fetchMaterials, upsertMaterial, fetchPurchaseItems, upsertPurchaseItem } = t;` }));
  } }],
});
const { confirmMaterialOrder, resolveMaterialCartPricing, getMaterialCartAmountKrw } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const order = (id, styleNo = 'STYLE') => ({ id, orderNo: `PO-${id}`, styleNo, projectNo: `PROJECT-${id}` });
const ref = (id, qty, styleNo = 'STYLE') => ({ orderId: id, styleNo, styleName: 'test', qty });
const cart = (orders, overrides = {}) => ({ materialName: 'Leather', unit: 'SF', qty: 40, stockQty: 8,
  vendorName: 'Supplier', unitPriceCny: 10, isHqProvided: true, orders, ...overrides });
function reset() {
  state = { reads: 0, ids: 0, clears: 0, freezes: 0, events: [], browserCart: [], materials: [], materialWrites: [], purchases: [], purchaseWrites: [] };
}
const confirm = (cartItems, orders, extras = {}) => confirmMaterialOrder({ cartItems, orders, vendors: [], cnyKrw: 190, ...extras });

test('same style: order ID weights aggregate repeated color contributions and subtract stock', async () => {
  reset();
  const result = await confirm([cart([ref('a', 5), ref('b', 30), ref('a', 5)])], [order('b'), order('a')]);
  assert.equal(result.purchaseCount, 2);
  assert.deepEqual(state.purchases.map(p => [p.orderId, p.qty, p.orderNo, p.projectNo, p.amountKrw]), [
    ['a', 8, 'PO-a', 'PROJECT-a', 15200], ['b', 24, 'PO-b', 'PROJECT-b', 45600],
  ]);
  assert.equal(state.materialWrites[0].orderQty, 32);
  assert.equal(state.clears, 1);
});

test('ambiguous legacy rejects whole batch before any IO, even with fallback', async () => {
  reset();
  await assert.rejects(confirm([
    cart([ref('c', 40, 'UNIQUE')]), cart([ref(undefined, 40)]),
  ], [order('c', 'UNIQUE'), order('a'), order('b')], { fallbackOrder: order('a') }), /주문 ID/);
  assert.equal(state.reads, 0);
  assert.deepEqual(state.materialWrites, []);
  assert.deepEqual(state.purchaseWrites, []);
  assert.equal(state.clears, 0);
});

test('unique legacy style preserves material metadata, procurement fields and totals', async () => {
  reset();
  state.materials = [{ id: 'material-existing', name: 'Leather', unit: 'SF', spec: 'original', category: '포장재', createdAt: 'original-date' }];
  const result = await confirm([cart([ref(undefined, 10), ref(undefined, 30)])], [order('a')]);
  assert.deepEqual(result, { materialCount: 1, purchaseCount: 1, skippedNoOrder: [] });
  assert.equal(state.materialWrites[0].id, 'material-existing');
  assert.equal(state.materialWrites[0].spec, 'original');
  assert.equal(state.materialWrites[0].category, '포장재');
  assert.equal(state.purchases[0].qty, 32);
  assert.equal(state.purchases[0].purchaseStatus, '미발주');
  assert.equal(state.purchases[0].vendorName, 'Supplier');
  assert.equal(state.clears, 1);
});

test('retry after partial purchase save keeps existing purchase and creates only missing order', async () => {
  reset();
  const items = [cart([ref('a', 10), ref('b', 30)])];
  state.failOrder = 'b';
  await assert.rejects(confirm(items, [order('a'), order('b')]), /purchase save failed/);
  assert.equal(state.clears, 0);
  const first = { ...state.purchases[0] };
  state.failOrder = undefined;
  const result = await confirm(items, [order('a'), order('b')]);
  assert.equal(result.purchaseCount, 1);
  assert.equal(state.purchases.length, 2);
  assert.deepEqual(state.purchases[0], first);
  assert.deepEqual(state.purchases.map(p => [p.orderId, p.qty]), [['a', 8], ['b', 24]]);
  assert.equal(state.clears, 1);
  assert.equal((await confirm(items, [order('a'), order('b')])).purchaseCount, 0);
  assert.equal(state.purchases.length, 2);
});

test('unknown ID, mismatched style and partly unresolved legacy fail before writes', async () => {
  for (const refs of [[ref('missing', 40)], [ref('a', 40, 'WRONG')], [ref(undefined, 10), ref(undefined, 30, 'MISSING')]]) {
    reset();
    await assert.rejects(confirm([cart(refs)], [order('a')], { fallbackOrder: order('a') }));
    assert.equal(state.reads, 0);
    assert.equal(state.clears, 0);
  }
});

test('strict purchase read failure preserves cart and writes no purchases', async () => {
  reset();
  state.readError = true;
  await assert.rejects(confirm([cart([ref('a', 40)])], [order('a')]), /purchase read failed/);
  assert.deepEqual(state.purchaseWrites, []);
  assert.equal(state.clears, 0);
});

test('completion fallback resolves order absent from listing; empty provenance retains fallback path', async () => {
  for (const refs of [[ref('a', 40)], [ref(undefined, 40)], []]) {
    reset();
    await confirm([cart(refs)], [], { fallbackOrder: order('a') });
    assert.equal(state.purchases[0].orderId, 'a');
    assert.equal(state.purchases[0].qty, 32);
  }
});

test('stock-covered ambiguous legacy needs no purchase and does not block valid orders', async () => {
  reset();
  await confirm([cart([ref(undefined, 40)], { stockQty: 40, materialName: 'Stock-covered material' }), cart([ref('a', 40)])], [order('a'), order('b')]);
  assert.equal(state.purchases.length, 1);
  assert.equal(state.purchases[0].orderId, 'a');
});

test('order number provenance resolves same-style orders and conflicting number rejects', async () => {
  reset();
  await confirm([cart([
    { ...ref(undefined, 10), orderNo: 'PO-a' },
    { ...ref('b', 30), orderNo: 'PO-b' },
  ])], [order('a'), order('b')]);
  assert.deepEqual(state.purchases.map(p => [p.orderId, p.qty]), [['a', 8], ['b', 24]]);
  reset();
  await assert.rejects(confirm([cart([{ ...ref('a', 40), orderNo: 'PO-b' }])], [order('a'), order('b')]), /일치하지/);
  assert.equal(state.reads, 0);
});

test('existing legacy purchase is preserved on retry', async () => {
  reset();
  const existing = { id: 'existing', orderNo: 'PO-a', itemName: 'Leather', unit: 'SF', qty: 32, vendorName: 'Supplier', purchaseStatus: '발주완료', currency: 'CNY', unitPriceCny: 0, appliedRate: 191, legacyPricingIdentity: true };
  state.purchases.push(existing);
  const result = await confirm([cart([ref('a', 40)])], [order('a')]);
  assert.equal(result.purchaseCount, 0);
  assert.deepEqual(state.purchases, [existing]);
  assert.equal(state.clears, 1);
});

test('rounding small splits preserves quantity and never generates negative allocation', async () => {
  reset();
  const orders = ['a', 'b', 'c', 'd'].map(id => order(id));
  await confirm([cart(orders.map(o => ref(o.id, 1)), { qty: 0.002, stockQty: 0 })], orders);
  assert.equal(state.purchases.reduce((sum, p) => sum + p.qty, 0), 0.002);
  assert.ok(state.purchases.every(p => p.qty > 0));
});

test('completely missing legacy provenance or empty no-fallback cart cannot be cleared', async () => {
  for (const refs of [[ref(undefined, 40, 'MISSING')], []]) {
    reset();
    await assert.rejects(confirm([cart(refs)], [order('a')]), /귀속/);
    assert.equal(state.reads, 0); assert.equal(state.clears, 0);
  }
});

test('same order and material purchased from different suppliers creates both and retries neither', async () => {
  reset();
  const items = [cart([ref('a', 40)], { vendorName: 'A' }), cart([ref('a', 40)], { vendorName: 'B' })];
  const result = await confirm(items, [order('a')]);
  assert.equal(result.purchaseCount, 2); assert.equal(result.materialCount, 1);
  assert.equal(state.materialWrites.length, 1); assert.equal(state.materialWrites[0].orderQty, 64);
  assert.equal(state.materialWrites[0].orderVendorName, 'A, B');
  assert.deepEqual(state.purchases.map(p => [p.vendorName, p.qty]), [['A', 32], ['B', 32]]);
  assert.equal((await confirm(items, [order('a')])).purchaseCount, 0);
  assert.equal(state.purchases.length, 2);
});

test('USD uses explicit or USD settings rate; KRW always uses one; legacy remains CNY', async () => {
  for (const [extra, settings, currency, rate] of [
    [{ currency: 'USD', appliedRate: 1450 }, { usdKrw: 1400 }, 'USD', 1450],
    [{ currency: 'USD' }, { usdKrw: 1400 }, 'USD', 1400],
    [{ currency: 'KRW', appliedRate: 190 }, {}, 'KRW', 1],
    [{}, {}, 'CNY', 190],
    [{ currency: 'CNY', appliedRate: 200 }, {}, 'CNY', 200],
  ]) {
    reset();
    await confirm([cart([ref('a', 40)], extra)], [order('a')], settings);
    assert.deepEqual(state.purchases.map(p => [p.currency, p.appliedRate, p.amountKrw]), [[currency, rate, 320 * rate]]);
  }
});

test('missing or invalid USD rate never falls back to CNY and whole batch fails before IO', async () => {
  for (const [extra, settings] of [
    [{ currency: 'USD' }, {}], [{ currency: 'USD' }, { usdKrw: 0 }],
    [{ currency: 'USD', appliedRate: 0 }, { usdKrw: 1400 }],
    [{ currency: 'USD', appliedRate: -1 }, { usdKrw: 1400 }],
    [{ currency: 'USD', appliedRate: NaN }, { usdKrw: 1400 }],
    [{ currency: 'USD', appliedRate: Infinity }, { usdKrw: 1400 }],
    [{ currency: 'CNY', appliedRate: 0 }, {}],
    [{ currency: 'CNY' }, { cnyKrw: -1 }],
  ]) {
    reset();
    await assert.rejects(confirm([cart([ref('a', 40)]), cart([ref('a', 40)], extra)], [order('a')], settings), /환율/);
    assert.equal(state.reads, 0); assert.equal(state.clears, 0);
    assert.deepEqual(state.materialWrites, []); assert.deepEqual(state.purchaseWrites, []);
  }
});

test('invalid prices and currencies reject before any write and zero price stays valid', async () => {
  for (const extra of [{ unitPriceCny: -1 }, { unitPriceCny: NaN }, { unitPriceCny: Infinity }, { currency: 'EUR' }]) {
    reset();
    await assert.rejects(confirm([cart([ref('a', 40)]), cart([ref('a', 40)], extra)], [order('a')]), /통화·단가/);
    assert.equal(state.reads, 0); assert.equal(state.clears, 0);
    assert.deepEqual(state.materialWrites, []); assert.deepEqual(state.purchaseWrites, []);
  }
  reset();
  await confirm([cart([ref('a', 40)], { unitPriceCny: 0 })], [order('a')]);
  assert.equal(state.purchases[0].amountKrw, 0);
});

test('retry separates spec, currency, price and rate but retains identical purchases', async () => {
  reset();
  const items = [
    { spec: 'thin', currency: 'USD', appliedRate: 1400 },
    { spec: 'thick', currency: 'USD', appliedRate: 1400 },
    { spec: 'thin', currency: 'CNY', appliedRate: 1400 },
    { spec: 'thin', currency: 'USD', appliedRate: 1400, unitPriceCny: 11 },
    { spec: 'thin', currency: 'USD', appliedRate: 1500 },
  ].map(extra => cart([ref('a', 40)], extra));
  assert.equal((await confirm(items, [order('a')])).purchaseCount, 5);
  assert.deepEqual(state.purchases.map(p => p.spec), ['thin', 'thick', 'thin', 'thin', 'thin']);
  const saved = structuredClone(state.purchases);
  assert.equal((await confirm(items, [order('a')])).purchaseCount, 0);
  assert.deepEqual(state.purchases, saved);
  assert.equal(state.materialWrites[0].spec, 'thin');
  assert.equal(state.materialWrites[1].spec, 'thick');
});

test('legacy missing pricing identity cannot swallow USD or specified material', async () => {
  reset();
  state.purchases.push({ id: 'old', orderNo: 'PO-a', itemName: 'Leather', unit: 'SF', vendorName: 'Supplier', currency: 'CNY', unitPriceCny: 0, appliedRate: 191, legacyPricingIdentity: true });
  const result = await confirm([
    cart([ref('a', 40)], { currency: 'USD', appliedRate: 1400 }),
    cart([ref('a', 40)], { spec: 'thin' }),
  ], [order('a')]);
  assert.equal(result.purchaseCount, 2);
  assert.equal(state.purchases.length, 3);
});

test('screen and print conversions match purchase calculations and flag invalid USD pricing', () => {
  const usd = cart([], { currency: 'USD', appliedRate: 1450 });
  assert.deepEqual(resolveMaterialCartPricing(usd, 190, 1400), { currency: 'USD', unitPriceCny: 10, appliedRate: 1450 });
  assert.equal(getMaterialCartAmountKrw(usd, 32, 190, 1400), 464000);
  assert.equal(getMaterialCartAmountKrw(cart([], { currency: 'USD' }), 32, 190), null);
  assert.equal(getMaterialCartAmountKrw(cart([], { currency: 'KRW' }), 32, 190), 320);
  assert.equal(getMaterialCartAmountKrw(cart([]), 32, 190), 60800);
});

test('numeric overflow fails before master writes', async () => {
  reset();
  await assert.rejects(confirm([cart([ref('a', 40)], { unitPriceCny: Number.MAX_VALUE })], [order('a')]), /구매 금액/);
  assert.equal(state.reads, 0); assert.equal(state.clears, 0);
});

const productionSource = readFileSync(new URL('../pages/ProductionOrders.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const purchaseSource = readFileSync(new URL('../pages/PurchaseMatching.tsx', import.meta.url), 'utf8');

test('USD partial-save retry retains frozen browser-cart rate despite settings changes', async () => {
  reset();
  state.browserCart = [cart([ref('a', 10), ref('b', 30)], { currency: 'USD' })];
  state.failOrder = 'b';
  await assert.rejects(confirm(structuredClone(state.browserCart), [order('a'), order('b')], { usdKrw: 1400 }), /purchase save failed/);
  assert.deepEqual(state.events.slice(0, 2), ['freeze', 'read-materials']);
  assert.equal(state.browserCart[0].appliedRate, 1400);
  assert.equal(state.clears, 0);
  const first = structuredClone(state.purchases[0]);
  state.failOrder = undefined;
  const result = await confirm(structuredClone(state.browserCart), [order('a'), order('b')], { usdKrw: 1500 });
  assert.equal(result.purchaseCount, 1); assert.equal(state.purchases.length, 2);
  assert.deepEqual(state.purchases[0], first);
  assert.deepEqual(state.purchases.map(p => [p.orderId, p.appliedRate]), [['a', 1400], ['b', 1400]]);
  for (const source of [productionSource, purchaseSource]) {
    assert.match(source, /console\.error\('발주 확정 오류:', e\);\s*refreshCart\(\);/);
  }
});

test('freeze preserves newer quantities and unrelated browser-cart entries, validation precedes freezing', async () => {
  reset();
  const snapshot = cart([ref('a', 40)], { currency: 'USD' });
  const unrelated = cart([ref('b', 20)], { materialName: 'Zipper', qty: 20 });
  state.browserCart = [{ ...snapshot, qty: 50, stockQty: 9 }, unrelated];
  state.failOrder = 'a';
  await assert.rejects(confirm([snapshot], [order('a')], { usdKrw: 1400 }), /purchase save failed/);
  assert.equal(state.browserCart[0].qty, 50); assert.equal(state.browserCart[0].stockQty, 9);
  assert.equal(state.browserCart[0].appliedRate, 1400);
  assert.deepEqual(state.browserCart[1], unrelated);
  reset();
  state.browserCart = [snapshot];
  const before = structuredClone(state.browserCart);
  await assert.rejects(confirm([snapshot, cart([ref('a', 40)], { unitPriceCny: -1 })], [order('a')], { usdKrw: 1400 }));
  assert.equal(state.freezes, 0); assert.equal(state.reads, 0);
  assert.deepEqual(state.browserCart, before);
});

test('implicit and explicit equal USD rates create one purchase for the full normalized quantity', async () => {
  reset();
  const rows = [
    cart([ref('a', 10)], { qty: 10, stockQty: 0, currency: 'USD' }),
    cart([ref('a', 20)], { qty: 20, stockQty: 0, currency: 'USD', appliedRate: 1400 }),
  ];
  state.browserCart = structuredClone(rows);
  assert.notEqual(materialCartIdentity(rows[0]), materialCartIdentity(rows[1]));
  const result = await confirm(structuredClone(rows), [order('a')], { usdKrw: 1400 });
  assert.equal(result.purchaseCount, 1);
  assert.deepEqual(state.purchases.map(p => [p.qty, p.appliedRate, p.amountKrw]), [[30, 1400, 420000]]);
  assert.equal(state.materialWrites[0].orderQty, 30);
  assert.equal(state.clears, 1);
});

test('actual freeze merges full quantities, stock and provenance; failed normalized cart remains editable', async () => {
  reset();
  const rows = [
    cart([ref('a', 10)], { qty: 10, stockQty: 1, currency: 'USD' }),
    cart([ref('a', 20)], { qty: 20, stockQty: 2, currency: 'USD', appliedRate: 1400 }),
  ];
  const unrelated = cart([ref('b', 5)], { materialName: 'Zipper', qty: 5, stockQty: 5, currency: 'USD', appliedRate: 1450 });
  state.browserCart = structuredClone([...rows, unrelated]);
  state.failOrder = 'a';
  await assert.rejects(confirm(structuredClone(state.browserCart), [order('a'), order('b')], { usdKrw: 1400 }), /purchase save failed/);
  assert.equal(state.clears, 0);
  assert.equal(state.browserCart.length, 2);
  const merged = state.browserCart[0];
  assert.equal(merged.qty, 30); assert.equal(merged.stockQty, 3); assert.equal(merged.appliedRate, 1400);
  assert.deepEqual(merged.orders, [...rows[0].orders, ...rows[1].orders]);
  assert.deepEqual(state.browserCart[1], unrelated);
  browserCartMethods.updateCartItemStock(merged.materialName, merged.unit, 3, merged);
  browserCartMethods.updateCartItemQty(merged.materialName, merged.unit, 30, merged);
  const beforeDelete = structuredClone(state.browserCart);
  browserCartMethods.removeCartItem(merged.materialName, merged.unit, merged);
  assert.deepEqual(state.browserCart, [unrelated]);
  state.browserCart = beforeDelete;
  state.failOrder = undefined;
  await confirm(structuredClone(state.browserCart), [order('a'), order('b')], { usdKrw: 1500 });
  assert.deepEqual(state.purchases.map(p => [p.orderId, p.qty, p.appliedRate]), [['a', 27, 1400]]);
});

test('stock-covered same-contract row participates before initial IO and keeps retry allocation identical', async () => {
  reset();
  const rows = [
    cart([ref('a', 10)], { qty: 10, stockQty: 0, currency: 'USD' }),
    cart([ref('b', 20)], { qty: 20, stockQty: 20, currency: 'USD', appliedRate: 1400 }),
  ];
  state.browserCart = structuredClone(rows);
  state.failOrder = 'b';
  await assert.rejects(confirm(structuredClone(state.browserCart), [order('a'), order('b')], { usdKrw: 1400 }), /purchase save failed/);
  assert.deepEqual(state.purchases.map(p => [p.orderId, p.qty]), [['a', 3.333]]);
  assert.equal(state.browserCart.length, 1);
  assert.equal(state.browserCart[0].qty, 30); assert.equal(state.browserCart[0].stockQty, 20);
  assert.deepEqual(state.browserCart[0].orders, rows.flatMap(r => r.orders));
  const first = structuredClone(state.purchases[0]);
  state.failOrder = undefined;
  assert.equal((await confirm(structuredClone(state.browserCart), [order('a'), order('b')], { usdKrw: 1500 })).purchaseCount, 1);
  assert.deepEqual(state.purchases[0], first);
  assert.deepEqual(state.purchases.map(p => [p.orderId, p.qty, p.appliedRate]), [['a', 3.333, 1400], ['b', 6.667, 1400]]);
});

test('existing purchases with a conflicting quantity or duplicate identity cannot be skipped or duplicated', async () => {
  for (const saved of [[{ qty: 10 }], [{ qty: 31 }], [{ qty: 15 }, { qty: 15 }]]) {
    reset();
    state.purchases = saved.map((extra, index) => ({ id: `existing-${index}`, orderNo: 'PO-a', itemName: 'Leather',
      unit: 'SF', vendorName: 'Supplier', currency: 'USD', unitPriceCny: 10, appliedRate: 1400, ...extra }));
    const before = structuredClone(state.purchases);
    state.browserCart = [cart([ref('a', 10)], { qty: 10, stockQty: 0, currency: 'USD' }),
      cart([ref('a', 20)], { qty: 20, stockQty: 0, currency: 'USD', appliedRate: 1400 })];
    await assert.rejects(confirm(structuredClone(state.browserCart), [order('a')], { usdKrw: 1400 }), /기존 구매수량.*필요수량 30/);
    assert.deepEqual(state.purchaseWrites, []); assert.deepEqual(state.materialWrites, []);
    assert.deepEqual(state.purchases, before); assert.equal(state.clears, 0);
    assert.equal(state.browserCart[0].qty, 30);
  }
});

test('every expected purchase quantity is checked before writing any missing order', async () => {
  reset();
  state.purchases = [{ id: 'saved-b', orderNo: 'PO-b', itemName: 'Leather', unit: 'SF', vendorName: 'Supplier',
    currency: 'USD', unitPriceCny: 10, appliedRate: 1400, qty: 10 }];
  const value = cart([ref('a', 10), ref('b', 20)], { qty: 30, stockQty: 0, currency: 'USD', appliedRate: 1400 });
  await assert.rejects(confirm([value], [order('a'), order('b')]), /기존 구매수량.*필요수량 20/);
  assert.deepEqual(state.purchaseWrites, []); assert.deepEqual(state.materialWrites, []);
  assert.equal(state.clears, 0);
});

test('retry after stock covers all demand still rejects previously purchased positive quantities', async () => {
  reset();
  state.browserCart = [cart([ref('a', 10), ref('b', 20)], { qty: 30, stockQty: 0, currency: 'USD' })];
  state.failOrder = 'b';
  await assert.rejects(confirm(structuredClone(state.browserCart), [order('a'), order('b')], { usdKrw: 1400 }), /purchase save failed/);
  assert.deepEqual(state.purchases.map(p => [p.orderId, p.qty]), [['a', 10]]);
  const frozen = state.browserCart[0];
  browserCartMethods.updateCartItemStock(frozen.materialName, frozen.unit, 30, frozen);
  const before = structuredClone(state.browserCart);
  const saved = structuredClone(state.purchases);
  state.failOrder = undefined;
  state.materialWrites = []; state.purchaseWrites = [];
  await assert.rejects(confirm(structuredClone(state.browserCart), [order('a'), order('b')], { usdKrw: 1500 }), /기존 구매수량.*필요수량 0/);
  assert.deepEqual(state.purchases, saved); assert.deepEqual(state.browserCart, before);
  assert.deepEqual(state.materialWrites, []); assert.deepEqual(state.purchaseWrites, []);
  assert.equal(state.clears, 0);
});

test('zero rounded order allocation is checked against an existing positive purchase', async () => {
  reset();
  state.purchases = [{ id: 'saved-b', orderNo: 'PO-b', itemName: 'Leather', unit: 'SF', vendorName: 'Supplier',
    currency: 'USD', unitPriceCny: 10, appliedRate: 1400, qty: 1 }];
  const value = cart([ref('a', 10000), ref('b', 1)], { qty: 0.001, stockQty: 0, currency: 'USD', appliedRate: 1400 });
  await assert.rejects(confirm([value], [order('a'), order('b')]), /기존 구매수량.*필요수량 0/);
  assert.deepEqual(state.purchaseWrites, []); assert.equal(state.clears, 0);
});

test('explicit zero price is not a legacy wildcard, even with the same mapped 0/191 defaults', async () => {
  reset();
  state.purchases.push({ id: 'zero', orderNo: 'PO-a', itemName: 'Leather', unit: 'SF', vendorName: 'Supplier',
    currency: 'CNY', unitPriceCny: 0, appliedRate: 191, legacyPricingIdentity: false, qty: 32 });
  assert.equal((await confirm([cart([ref('a', 40)])], [order('a')])).purchaseCount, 1);
  assert.equal(state.purchases.length, 2);
  reset();
  state.purchases.push({ id: 'zero', orderNo: 'PO-a', itemName: 'Leather', unit: 'SF', vendorName: 'Supplier',
    currency: 'CNY', unitPriceCny: 0, appliedRate: 191, legacyPricingIdentity: false, qty: 32 });
  assert.equal((await confirm([cart([ref('a', 40)], { unitPriceCny: 0, appliedRate: 191 })], [order('a')])).purchaseCount, 0);
});

test('automatic master stock is one shared pool across currency/price-split cart rows', async () => {
  const start = productionSource.indexOf('  const fillStockFromMaster = async');
  const end = productionSource.indexOf('  /** 실제 공장 전달', start);
  assert.ok(start >= 0 && end > start);
  const code = transformSync(productionSource.slice(start, end), { loader: 'ts' }).code;
  async function fill(rows, materials) {
    const calls = [];
    const run = new Function('fetchMaterials', 'store', 'refreshCart', 'toast', code + ';return fillStockFromMaster;')(
      async () => materials, { getMaterialCart: () => rows,
        updateCartItemStock: (name, unit, qty, item) => { calls.push([name, unit, qty, item]); item.stockQty = qty; } },
      () => {}, { success: () => {}, error: message => assert.fail(message) });
    await run(); return calls;
  }
  const rows = [
    cart([], { qty: 10, stockQty: 8, currency: 'CNY' }),
    cart([], { qty: 10, stockQty: 8, currency: 'USD', unitPriceCny: 12 }),
  ];
  const calls = await fill(rows, [{ name: 'Leather', unit: 'SF', stockQty: 5, factoryStockQty: 3 }]);
  assert.deepEqual(calls.map(c => c[2]), [8, 0]);
  assert.equal(rows.reduce((sum, item) => sum + Math.max(0, item.qty - item.stockQty), 0), 12);
  assert.equal(calls[0][3], rows[0]); assert.equal(calls[1][3], rows[1]);
  const separate = [cart([], { qty: 3 }), cart([], { qty: 10, unitPriceCny: 12 }), cart([], { qty: 10, spec: 'thick' })];
  const second = await fill(separate, [
    { name: 'Leather', unit: 'SF', stockQty: 8 }, { name: 'Leather', spec: 'thick', unit: 'SF', stockQty: 4 },
  ]);
  assert.deepEqual(second.map(c => c[2]), [3, 5, 4]);
});

test('all page stock/delete handlers target the complete cart identity, including automatic stock fill', () => {
  let count = 0;
  for (const source of [productionSource, purchaseSource]) {
    for (const hit of source.matchAll(/store\.(updateCartItemStock|updateCartItemQty|removeCartItem)\(([^;]+)\);/g)) {
      const args = hit[2].split(',').map(s => s.trim());
      assert.equal(args.length, hit[1] === 'removeCartItem' ? 3 : 4);
      assert.equal(args.at(-1), 'item');
      count++;
    }
    assert.ok(source.includes('key={materialCartIdentity(item)}'));
    assert.match(source, /usdKrw: (settings|store\.getSettings\(\))\.usdKrw/);
  }
  assert.equal(count, 7);
});

test('saved single order still opens completion with actionable material error and no cart mutation', () => {
  const start = productionSource.indexOf('    let bomMaterials:');
  const end = productionSource.indexOf('    setPostOrderModal(true);', start) + '    setPostOrderModal(true);'.length;
  assert.ok(start >= 0 && end > start);
  const snippet = transformSync(productionSource.slice(start, end), { loader: 'ts' }).code;
  const notices = []; let info, opened, writes = 0;
  const run = new Function('boms', 'form', 'order', 'totalQty', 'pickBomForOrder', 'hqGroups',
    'hqMaterialsForDisplay', 'addHqMaterialsToCart', 'toast', 'refreshCart', 'setPostOrderInfo', 'setPostOrderModal', snippet);
  const saved = order('a');
  run([], {}, saved, 40, () => ({ bom: {}, ambiguous: false }),
    () => { throw new Error('BLUE 컬러 BOM 등록 후 다시 담아 주세요'); }, () => [], () => { writes++; },
    { warning: (...args) => notices.push(args), error: () => assert.fail('saved order must not be reported as failed') },
    () => {}, value => { info = value; }, value => { opened = value; });
  assert.equal(writes, 0); assert.equal(opened, true); assert.equal(info.order, saved);
  assert.match(info.materialError, /BLUE.*등록/);
  assert.match(notices[0][0], /발주 저장 완료/);
  assert.match(notices[0][1].description, /BLUE/);
});

test('bulk saved orders count as successful when subsequent material validation fails', async () => {
  const start = productionSource.indexOf('      try {\n        await upsertOrder(order);');
  const end = productionSource.indexOf('    }\n    if (ok > 0)', start);
  assert.ok(start >= 0 && end > start);
  const snippet = transformSync(`async function run() {
    const known = [], created = [], hqAmbiguous = []; let ok = 0, hqAdded = 0;
    for (let n = 0; n < 1; n++) { ${productionSource.slice(start, end)} }
    return { ok, created, hqAdded };
  }`, { loader: 'ts' }).code;
  const notices = []; let saves = 0;
  const run = new Function('upsertOrder', 'order', 'item', 'boms', 'pickBomForOrder', 'hqGroups',
    'addHqMaterialsToCart', 'toast', snippet + '; return run;')(
    async () => { saves++; }, order('a'), { styleNo: 'STYLE', id: 'item', name: 'style' }, [],
    () => { throw new Error('BLUE 컬러 BOM 등록 후 다시 담아 주세요'); }, () => [],
    () => assert.fail('invalid material must never reach the cart'),
    { warning: (...args) => notices.push(args), error: () => assert.fail('saved order must not be reported as failed') });
  const result = await run();
  assert.equal(saves, 1); assert.equal(result.ok, 1); assert.equal(result.created.length, 1);
  assert.equal(result.hqAdded, 0); assert.match(notices[0][0], /발주 저장 완료/);
});
