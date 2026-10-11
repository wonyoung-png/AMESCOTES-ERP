// Execute the real page handlers with deferred persistence and a minimal hook host.
// node --test client/src/pages/BrandOrders.persistence.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const exports = ['useMemo', 'useRef', 'useState', 'Link', 'useQuery', 'useQueryClient',
  'useWorkspace', 'store', 'formatNumber', 'genId', 'phase1', 'pullBrandOrders',
  'fetchOrders', 'Button', 'Input', 'Label', 'Badge', 'Tabs', 'TabsContent', 'TabsList',
  'TabsTrigger', 'Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogFooter',
  'toast', 'Send', 'Package', 'Factory', 'Trash2', 'Undo2', 'getCurrentUser',
  'brandWorkflow', 'validDate'];
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./BrandOrders.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  jsxFactory: 'globalThis.__brandTest.element', jsxFragment: '"Fragment"',
  tsconfigRaw: { compilerOptions: { jsx: 'react' } },
  plugins: [{ name: 'page-dependencies', setup(b) {
    b.onResolve({ filter: /.*/ }, a => a.kind === 'entry-point' ? undefined : { path: a.path, namespace: 'mock' });
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ loader: 'js', contents:
      exports.map(name => `export const ${name} = globalThis.__brandTest.dependencies.${name};`).join('\n') +
      `\nexport default ${JSON.stringify(a.path.split('/').at(-1))};`,
    }));
  } }],
});
const compiled = bundle.outputFiles[0].text;
let instance = 0;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function mount() {
  const slots = [];
  let cursor = 0, nextId = 0;
  const success = [], errors = [], workflowCalls = [], creates = [], adds = [];
  const batch = { id: 'batch', projectNo: 'LM-TEST', title: 'Existing', status: 'draft',
    createdAt: '2026-10-11', workspace: 'LUMEN', lines: [
      { id: 'original', styleNo: 'ORIGINAL', qty: 1, colorQtys: [{ color: 'black', qty: 1 }] },
    ] };
  const batches = [batch];
  const phase1 = {
    getBrandBatches: () => batches, getBrandBatch: id => batches.find(b => b.id === id),
    getReorderOrderBoard: () => [], getReceiptLogs: () => [],
    createBrandBatch: (...args) => { creates.push(args); return phase1.createResult(...args); },
    createResult: async () => batch,
    addBrandLine: (...args) => { adds.push(args); return phase1.addResult(...args); },
    addResult: async () => ({}),
    deleteBrandBatch: async () => ({ ok: true }), deleteBrandLine: async () => {},
  };
  const dependencies = Object.fromEntries(exports.map(name => [name, name]));
  Object.assign(dependencies, {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo: fn => fn(), useWorkspace: () => ({ workspace: 'LUMEN' }),
    useQuery: () => ({ data: undefined }), useQueryClient: () => ({ invalidateQueries() {} }),
    store: { getOrders: () => [], getItems: () => [], getVendors: () => [{ id: 'factory', name: 'Factory', type: '공장' }] },
    phase1, genId: () => `attempt-${++nextId}`, formatNumber: String,
    toast: { success: message => success.push(message), error: message => errors.push(message), warning() {} },
    getCurrentUser: () => ({ role: '대표', name: 'Owner' }), pullBrandOrders: async () => 0,
    brandWorkflow: async (...args) => { workflowCalls.push(args); return []; },
  });
  globalThis.__brandTest = { dependencies, element: (type, props, ...children) => ({ type, props: { ...props, children } }) };
  globalThis.confirm = () => true;
  const { default: Page } = await import('data:text/javascript;base64,' + Buffer.from(compiled + `\n// instance ${++instance}`).toString('base64'));
  let tree;
  const render = () => { cursor = 0; tree = Page(); };
  const nodes = () => {
    const result = [];
    const visit = value => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') { result.push(value); visit(value.props?.children); }
    };
    visit(tree); return result;
  };
  const find = predicate => {
    const result = nodes().find(predicate);
    assert.ok(result, 'Expected page control'); return result.props;
  };
  const button = label => find(n => n.type === 'Button' && n.props.children.flat(Infinity).includes(label));
  const picker = () => find(n => n.type === 'StylePickerSheet');
  render();
  const selectBatch = (id = batch.id) => {
    const projectNo = batches.find(b => b.id === id).projectNo;
    find(n => n.type === 'button' && n.props.onClick && !n.props.title &&
      n.props.children.some(child => child?.props?.children.includes(projectNo))).onClick();
    render();
  };
  return { render, find, button, picker, selectBatch, phase1, batch, batches, creates, adds, success, errors, workflowCalls };
}
const picked = styleNo => ({ styleNo, styleName: styleNo, unitCostKrw: 0, colorQtys: [{ color: 'black', qty: 2 }] });

test('draft waits for DB, preserves title and attempt ID after rejection, and blocks duplicate clicks', async () => {
  const h = await mount();
  const title = () => h.find(n => n.type === 'Input' && n.props.placeholder?.startsWith('발주 제목'));
  title().onChange({ target: { value: 'Retry title' } }); h.render();
  const first = deferred(); h.phase1.createResult = () => first.promise;
  const submit = h.button('+ 묶음 발주').onClick;
  const pending = submit();
  await submit(); h.render();
  assert.equal(h.creates.length, 1);
  assert.equal(h.success.length, 0);
  assert.equal(title().value, 'Retry title');
  assert.equal(title().disabled, true);
  first.reject(new Error('DB unavailable')); await pending; h.render();
  assert.equal(title().value, 'Retry title');
  assert.equal(h.errors.at(-1), 'DB unavailable');
  assert.equal(title().disabled, true);
  title().onChange({ target: { value: 'Changed after failure' } }); h.render();
  assert.equal(title().value, 'Retry title');
  h.phase1.createResult = async () => h.batch;
  await h.button('+ 묶음 발주').onClick(); h.render();
  assert.equal(h.creates[0][4], h.creates[1][4]);
  assert.equal(h.creates[1][1], 'Retry title');
  assert.equal(title().value, '');
  assert.equal(title().disabled, false);
  assert.equal(h.success.length, 1);
  await h.button('+ 묶음 발주').onClick();
  assert.notEqual(h.creates[1][4], h.creates[2][4]);
});

test('pending line save blocks approval, issue, selection and picker close until completion', async () => {
  const h = await mount(); h.selectBatch();
  h.button('상품 담기').onClick(); h.render();
  const approve = h.button('대표 승인').onClick;
  const gate = deferred(); h.phase1.addResult = () => gate.promise;
  const pending = h.picker().onAdd([picked('A')], 'factory', 'oem');
  await approve(); h.render();
  assert.equal(h.workflowCalls.length, 0);
  assert.equal(h.button('대표 승인').disabled, true);
  assert.equal(h.button('발주서 발행').disabled, true);
  assert.equal(h.success.length, 0);
  h.picker().onOpenChange(false); h.render();
  assert.equal(h.picker().open, true);
  gate.resolve({}); await pending; h.render();
  assert.equal(h.picker().open, false);
  assert.equal(h.success.length, 1);
  assert.equal(h.button('대표 승인').disabled, false);
});

test('partial line failure keeps picker open and retries only unsaved lines with stable IDs', async () => {
  const h = await mount(); h.selectBatch(); h.button('상품 담기').onClick(); h.render();
  h.phase1.addResult = async (_batchId, line) => { if (line.styleNo === 'B') throw new Error('Line failure'); };
  await assert.rejects(h.picker().onAdd([picked('A'), picked('B')], 'factory', 'direct'), /Line failure/);
  h.render();
  assert.equal(h.picker().open, true);
  assert.equal(h.success.length, 0);
  assert.equal(h.errors.at(-1), 'Line failure');
  assert.equal(h.button('대표 승인').disabled, true);
  const bId = h.adds[1][2];
  h.phase1.addResult = async () => ({});
  await h.picker().onAdd([picked('A'), picked('B')], 'factory', 'direct'); h.render();
  assert.deepEqual(h.adds.map(args => args[1].styleNo), ['A', 'B', 'B']);
  assert.equal(h.adds[2][2], bId);
  assert.equal(h.picker().open, false);
  assert.equal(h.success.length, 1);
});

test('editing failed or partial saved input reuses its ID and saves changed payload', async () => {
  const h = await mount(); h.selectBatch();
  h.phase1.addResult = async (_batchId, line) => { if (line.styleNo === 'B') throw new Error('failed'); };
  await assert.rejects(h.picker().onAdd([picked('A'), picked('B')], 'factory', 'oem'));
  h.render();
  const aId = h.adds[0][2], bId = h.adds[1][2];
  h.phase1.addResult = async () => ({});
  const changed = picked('A'); changed.colorQtys[0].qty = 5;
  await h.picker().onAdd([changed, picked('B')], 'factory', 'direct');
  assert.equal(h.adds[2][2], aId);
  assert.equal(h.adds[2][1].qty, 5);
  assert.equal(h.adds[3][2], bId);
});

test('batch deletion waits and rejection keeps selected batch for retry', async () => {
  const h = await mount(); h.selectBatch();
  const gate = deferred(); h.phase1.deleteBrandBatch = () => gate.promise;
  const pending = h.button('발주 삭제').onClick(); h.render();
  assert.equal(h.success.length, 0);
  assert.equal(h.button('발주 삭제').disabled, true);
  gate.reject(new Error('delete failed')); await pending; h.render();
  assert.equal(h.errors.at(-1), 'delete failed');
  assert.equal(h.button('발주 삭제').disabled, false);
});

test('line deletion waits and blocks approval while DB is pending', async () => {
  const h = await mount(); h.selectBatch();
  const gate = deferred(); h.phase1.deleteBrandLine = () => gate.promise;
  const pending = h.find(n => n.props?.title === '이 상품 빼기').onClick(); h.render();
  assert.equal(h.button('대표 승인').disabled, true);
  gate.reject(new Error('line delete failed')); await pending; h.render();
  assert.equal(h.errors.at(-1), 'line delete failed');
  assert.equal(h.button('대표 승인').disabled, false);
});

test('a successful save on another batch cannot unlock a failed batch', async () => {
  const h = await mount();
  const second = { ...h.batch, id: 'second', projectNo: 'LM-SECOND' };
  h.batches.push(second); h.render(); h.selectBatch();
  h.phase1.addResult = async (batchId, line) => {
    if (batchId === h.batch.id && line.styleNo === 'B') throw new Error('A failed');
  };
  await assert.rejects(h.picker().onAdd([picked('A'), picked('B')], 'factory', 'oem'));
  h.render();
  h.selectBatch(second.id);
  h.phase1.addResult = async () => { throw new Error('B failed'); };
  await assert.rejects(h.picker().onAdd([picked('C')], 'factory', 'oem')); h.render();
  assert.equal(h.button('대표 승인').disabled, true);
  h.phase1.addResult = async () => ({});
  await h.picker().onAdd([picked('C')], 'factory', 'oem'); h.render();
  assert.equal(h.button('대표 승인').disabled, false);
  h.selectBatch();
  assert.equal(h.button('대표 승인').disabled, true);
  await h.button('대표 승인').onClick();
  h.batch.status = 'approved'; h.render();
  assert.equal(h.button('발주서 발행').disabled, true);
  await h.button('발주서 발행').onClick();
  assert.equal(h.workflowCalls.length, 0);
});

test('omitting failed or not-yet-started styles keeps the batch blocked until all are saved', async () => {
  const h = await mount(); h.selectBatch(); h.button('상품 담기').onClick(); h.render();
  h.phase1.addResult = async (_id, line) => { if (line.styleNo === 'B') throw new Error('failed'); };
  await assert.rejects(h.picker().onAdd([picked('A'), picked('B'), picked('C')], 'factory', 'oem'));
  h.render();
  const failedId = h.adds[1][2];
  h.phase1.addResult = async () => ({});
  await assert.rejects(h.picker().onAdd([picked('A')], 'factory', 'oem'), /B, C/); h.render();
  assert.equal(h.picker().open, true);
  assert.equal(h.success.length, 0);
  assert.equal(h.button('대표 승인').disabled, true);
  await assert.rejects(h.picker().onAdd([picked('B')], 'factory', 'oem'), /C/); h.render();
  assert.equal(h.adds.at(-1)[2], failedId);
  assert.equal(h.button('대표 승인').disabled, true);
  await h.picker().onAdd([picked('C')], 'factory', 'oem'); h.render();
  assert.deepEqual(h.adds.map(args => args[1].styleNo), ['A', 'B', 'B', 'C']);
  assert.equal(h.button('대표 승인').disabled, false);
  assert.equal(h.picker().open, false);
  assert.equal(h.success.length, 1);
});

test('deleting another failed batch only clears its own failure state', async () => {
  const h = await mount();
  const second = { ...h.batch, id: 'second', projectNo: 'LM-SECOND' };
  h.batches.push(second); h.render();
  h.phase1.addResult = async () => { throw new Error('failed'); };
  h.selectBatch(); await assert.rejects(h.picker().onAdd([picked('A')], 'factory', 'oem')); h.render();
  h.selectBatch(second.id); await assert.rejects(h.picker().onAdd([picked('B')], 'factory', 'oem')); h.render();
  await h.button('발주 삭제').onClick(); h.render();
  h.selectBatch();
  assert.equal(h.button('대표 승인').disabled, true);
  await h.button('대표 승인').onClick();
  assert.equal(h.workflowCalls.length, 0);
});
