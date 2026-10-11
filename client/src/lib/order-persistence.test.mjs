import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)) };
let state;
globalThis.__orderPersistence = {
  from(table) {
    const save = async row => {
      state.writes.push({ table, row });
      if (state.pending) await state.pending;
      return { error: state.fail === table ? new Error('DB failed ' + table) : null };
    };
    return { upsert: save, select: () => ({ order: async () => ({ data: state.rows, error: state.readFail ? new Error('read failed') : null }) }),
      delete: () => {
        const filters = [];
        const q = { eq: (key, value) => { filters.push([key, value]); return q; },
          select: async () => { const result = await save({ delete: true, filters });
            return { ...result, data: result.error || state.noMatch ? [] : [{ id: filters.find(([k]) => k === 'id')[1] }] }; } };
        return q;
      } };
  },
};
async function load(file, mockStore) {
  const out = await build({ entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true, write: false,
    format: 'esm', platform: 'node', logLevel: 'silent', plugins: [{ name: 'save-boundaries', setup(b) {
      b.onResolve({ filter: /^(\.\/db|sonner)$/ }, a => ({ path: a.path, namespace: 'boundary' }));
      if (mockStore) b.onResolve({ filter: /^\.\/store$/ }, a => ({ path: a.path, namespace: 'boundary' }));
      b.onLoad({ filter: /.*/, namespace: 'boundary' }, a => ({ loader: 'js', contents: a.path === './store'
        ? `export const store={getPurchaseItems:()=>JSON.parse(localStorage.getItem('ames_purchases')||'[]')};
           export const normalizeMaterialCategory=x=>x, COMMON_BRAND='COMMON';`
        : `export const db={from:table=>globalThis.__orderPersistence.from(table)}; export const toast={error(){}};` }));
    } }] });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}
const queries = await load('./dbQueries.ts', true);
const { phase1 } = await load('./phase1.ts', false);
const { store } = await load('./store.ts', false);
function reset() { memory.clear(); state = { writes: [], rows: [] }; }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('purchase cache changes only after successful DB save, with error and delay preserved', async () => {
  reset(); const item = { id: 'p', itemName: 'Leather', qty: 10, orderId: 'order-a' };
  state.fail = 'purchase_items';
  await assert.rejects(queries.upsertPurchaseItem(item), /DB failed/);
  assert.equal(memory.get('ames_purchases'), undefined);
  state.fail = undefined;
  const pending = deferred(); state.pending = pending.promise;
  const save = queries.upsertPurchaseItem(item);
  assert.equal(memory.get('ames_purchases'), undefined);
  pending.resolve(); await save;
  assert.equal(JSON.parse(memory.get('ames_purchases'))[0].orderId, 'order-a');
});

test('strict purchase lookup never mistakes stale local cache for DB success or nonempty rows', async () => {
  reset(); memory.set('ames_purchases', JSON.stringify([{ id: 'stale' }]));
  assert.deepEqual(await queries.fetchPurchaseItems({ strict: true }), []);
  state.readFail = true;
  await assert.rejects(queries.fetchPurchaseItems({ strict: true }), /read failed/);
  assert.deepEqual(JSON.parse(memory.get('ames_purchases')), [{ id: 'stale' }]);
});

test('brand draft waits for both saves and retry preserves project and batch identities', async () => {
  reset(); state.fail = 'brand_order_batches';
  await assert.rejects(phase1.createBrandBatch('LUMEN', 'Retry', undefined, undefined, 'stable-draft'), /DB failed/);
  assert.equal(phase1.getBrandBatches().length, 0);
  const first = state.writes.map(x => structuredClone(x));
  state.fail = undefined; const wait = deferred(); state.pending = wait.promise;
  const save = phase1.createBrandBatch('LUMEN', 'Retry', undefined, undefined, 'stable-draft');
  assert.equal(phase1.getBrandBatches().length, 0);
  wait.resolve(); const draft = await save;
  assert.equal(draft.id, 'stable-draft'); assert.equal(draft.projectNo, first[0].row.project_no);
  assert.equal(state.writes[2].row.id, first[0].row.id);
  assert.equal(phase1.getBrandBatches().length, 1);
  await phase1.createBrandBatch('LUMEN', 'Retry', undefined, undefined, 'stable-draft');
  assert.equal(phase1.getBrandBatches().length, 1);
});

test('failed project save prevents draft DB write and local success', async () => {
  reset(); state.fail = 'projects';
  await assert.rejects(phase1.createBrandBatch('LUMEN', 'Project fails', undefined, undefined, 'failed-project'), /DB failed/);
  assert.equal(phase1.getBrandBatches().length, 0);
  assert.equal(state.writes.length, 1);
});

test('brand line failure is not cached and stable-ID retry produces one line', async () => {
  reset(); const b = await phase1.createBrandBatch('LUMEN', 'Line retry', undefined, undefined, 'line-draft');
  const line = { styleNo: 'STYLE', qty: 3, colorQtys: [{ color: 'BLACK', qty: 3 }], productionOrigin: 'china', route: 'oem' };
  state.fail = 'brand_order_lines';
  await assert.rejects(phase1.addBrandLine(b.id, line, 'stable-line'), /DB failed/);
  assert.equal(phase1.getBrandBatch(b.id).lines.length, 0);
  state.fail = undefined;
  await phase1.addBrandLine(b.id, line, 'stable-line'); await phase1.addBrandLine(b.id, line, 'stable-line');
  assert.equal(phase1.getBrandBatch(b.id).lines.length, 1);
});

test('same style and material keep separate order provenance while same-order colors aggregate', () => {
  reset(); const material = [{ itemName: 'Leather', netQty: 10, lossRate: 0, isHqProvided: true, unit: 'SF', vendorName: 'Supplier', unitPriceCny: 5 }];
  store.addToMaterialCart('STYLE', 'Bag', material, 1, { id: 'a', orderNo: 'PO-A' });
  store.addToMaterialCart('STYLE', 'Bag', material, 1, { id: 'b', orderNo: 'PO-B' });
  store.addToMaterialCart('STYLE', 'Bag', material, 1, { id: 'a', orderNo: 'PO-A' });
  const cart = store.getMaterialCart(); assert.equal(cart.length, 1); assert.equal(cart[0].qty, 30);
  assert.deepEqual(cart[0].orders.map(o => [o.orderId, o.orderNo, o.qty]), [['a', 'PO-A', 20], ['b', 'PO-B', 10]]);
});

test('batch deletion uses one conditional cascade, leaves complete cache on failure or stale status', async () => {
  reset(); const b = await phase1.createBrandBatch('LUMEN', 'Delete', undefined, undefined, 'delete-draft');
  await phase1.addBrandLine(b.id, { styleNo: 'STYLE', qty: 1, colorQtys: [{ color: 'BLACK', qty: 1 }] }, 'delete-line');
  const before = JSON.stringify(phase1.getBrandBatch(b.id));
  state.writes = []; state.fail = 'brand_order_batches';
  await assert.rejects(phase1.deleteBrandBatch(b.id), /DB failed/);
  assert.equal(JSON.stringify(phase1.getBrandBatch(b.id)), before);
  assert.equal(state.writes.length, 1);
  assert.deepEqual(state.writes[0].row.filters, [['id', b.id], ['status', 'draft']]);
  state.fail = undefined; state.noMatch = true;
  await assert.rejects(phase1.deleteBrandBatch(b.id), /변경/);
  assert.equal(JSON.stringify(phase1.getBrandBatch(b.id)), before);
  state.noMatch = false;
  assert.deepEqual(await phase1.deleteBrandBatch(b.id), { ok: true });
  assert.equal(phase1.getBrandBatch(b.id), undefined);
});
