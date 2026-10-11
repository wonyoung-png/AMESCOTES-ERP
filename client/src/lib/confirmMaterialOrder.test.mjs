import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// 실제 helper를 번들링하고 저장 경계만 대체한다. DB/공용 store는 변경하지 않는다.
let state;
globalThis.confirmMaterialOrderTest = {
  fetchMaterials: async () => { state.reads++; return state.materials; },
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
  genId: () => `generated-${++state.ids}`,
};
const out = await build({
  entryPoints: [fileURLToPath(new URL('./confirmMaterialOrder.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'confirm-material-order-boundaries', setup(b) {
    b.onResolve({ filter: /^\.\/(store|dbQueries)$/ }, a => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ loader: 'js', contents: a.path === './store'
      ? `const t = globalThis.confirmMaterialOrderTest; export const genId = t.genId;
         export const store = { clearMaterialCart: t.clearMaterialCart };`
      : `const t = globalThis.confirmMaterialOrderTest;
         export const { fetchMaterials, upsertMaterial, fetchPurchaseItems, upsertPurchaseItem } = t;` }));
  } }],
});
const { confirmMaterialOrder } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const order = (id, styleNo = 'STYLE') => ({ id, orderNo: `PO-${id}`, styleNo, projectNo: `PROJECT-${id}` });
const ref = (id, qty, styleNo = 'STYLE') => ({ orderId: id, styleNo, styleName: 'test', qty });
const cart = (orders, overrides = {}) => ({ materialName: 'Leather', unit: 'SF', qty: 40, stockQty: 8,
  vendorName: 'Supplier', unitPriceCny: 10, isHqProvided: true, orders, ...overrides });
function reset() {
  state = { reads: 0, ids: 0, clears: 0, materials: [], materialWrites: [], purchases: [], purchaseWrites: [] };
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
  await confirm([cart([ref(undefined, 40)], { stockQty: 40 }), cart([ref('a', 40)])], [order('a'), order('b')]);
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
  const existing = { id: 'existing', orderNo: 'PO-a', itemName: 'Leather', unit: 'SF', qty: 32, vendorName: 'Supplier', purchaseStatus: '발주완료' };
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
