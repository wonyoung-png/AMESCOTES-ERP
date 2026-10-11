import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { transform } from 'esbuild';

// JSX를 렌더링하지 않고 실제 모달의 저장 handler를 실행한다.
const source = readFileSync(new URL('./ItemMaster.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ItemMaster.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const modal = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'MultiBulkOrderModal');
const declaration = modal.body.statements.flatMap(n => ts.isVariableStatement(n) ? [...n.declarationList.declarations] : [])
  .find(n => n.name.getText(ast) === 'handleSubmit');
assert.ok(declaration, 'batch handler must exist');
const dependencies = ['submitLockRef', 'postOrderState', 'batchAttemptRef', 'factoryId', 'vendors', 'itemStates',
  'toast', 'setSubmitting', 'orderDate', 'deliveryDate', 'hqMaterialPreview', 'fetchOrders', 'nextOrderNo',
  'parseRevision', 'store', 'genId', 'bomLinesForPricing', 'upsertOrder', 'normalizeColors', 'upsertItem',
  'onSaveFail', 'queryClient', 'setPostOrderState'];
const output = await transform(`export function createHandler(deps) {
  const { ${dependencies.join(', ')} } = deps;
  return ${declaration.initializer.getText(ast)};
}`, { loader: 'ts', format: 'esm' });
const { createHandler } = await import('data:text/javascript;base64,' + Buffer.from(output.code).toString('base64'));

const modalDeclarations = modal.body.statements.flatMap(n => ts.isVariableStatement(n) ? [...n.declarationList.declarations] : []);
const inputNames = ['changeFactory', 'changeOrderDate', 'changeDeliveryDate', 'toggleItem', 'setColorQty',
  'updateColorDetail', 'saveColorDetailToMaster', 'addColorToItem', 'removeColorFromItem'];
const inputCode = ['isInputLocked', ...inputNames].map(name => {
  const node = modalDeclarations.find(n => n.name.getText(ast) === name);
  assert.ok(node, `${name} must exist`);
  return `const ${name} = ${node.initializer.getText(ast)};`;
}).join('\n');
const inputOutput = await transform(`export function createInputs(deps) {
  const { submitLockRef, batchAttemptRef, setFactoryId, setOrderDate, setDeliveryDate,
    setItemStates, store, normalizeColors, upsertItem, onSaveFail, queryClient } = deps;
  ${inputCode}
  return { isInputLocked, ${inputNames.join(', ')} };
}`, { loader: 'ts', format: 'esm' });
const { createInputs } = await import('data:text/javascript;base64,' + Buffer.from(inputOutput.code).toString('base64'));

function inputHarness(f) {
  const writes = [];
  const inputs = createInputs({ ...f.deps,
    setFactoryId: v => writes.push(['factory', v]), setOrderDate: v => writes.push(['orderDate', v]),
    setDeliveryDate: v => writes.push(['deliveryDate', v]),
    setItemStates: update => { writes.push(['item']); update(structuredClone(f.deps.itemStates)); },
    store: { ...f.deps.store, getItems: () => f.deps.itemStates.map(s => s.item) },
    upsertItem: async row => { writes.push(['master', row]); },
    queryClient: { ...f.deps.queryClient, setQueryData: () => writes.push(['cache']) },
  });
  const invokeAll = () => {
    inputs.changeFactory('changed'); inputs.changeOrderDate('2027-01-01'); inputs.changeDeliveryDate('2027-02-01');
    inputs.toggleItem('a'); inputs.setColorQty('a', 'BLACK', 999);
    inputs.updateColorDetail('a', 'BLACK', 'leatherColor', 'changed');
    inputs.saveColorDetailToMaster('a', 'BLACK', 'leatherColor', 'changed');
    inputs.addColorToItem('a', 'WHITE'); inputs.removeColorFromItem('a', 'BLACK');
  };
  return { inputs, writes, invokeAll };
}

function fixture() {
  const saved = new Map(), saves = [], carts = [], completed = [], errors = [], events = [], invalidated = [];
  let ids = 0;
  const deps = {
    submitLockRef: { current: false }, postOrderState: null, batchAttemptRef: { current: null },
    factoryId: 'factory', vendors: [{ id: 'factory', name: 'Factory' }],
    itemStates: ['a', 'b'].map(id => ({ enabled: true,
      item: { id, styleNo: 'SAME', name: id, season: '26FW', colors: [{ name: 'BLACK' }] },
      colorQtys: [{ color: 'BLACK', qty: 10 }],
    })),
    orderDate: '2026-10-11', deliveryDate: '', hqMaterialPreview: [],
    toast: { error: (...args) => errors.push(args) }, setSubmitting: v => events.push(['submitting', v]),
    fetchOrders: async () => [...saved.values()],
    nextOrderNo: (style, orders, taken) => {
      let n = 1; while (orders.some(o => o.orderNo === `${style}-R${n}`) || taken.has(`${style}-R${n}`)) n++;
      const no = `${style}-R${n}`; taken.add(no); return no;
    },
    parseRevision: no => Number(no.split('-R')[1]), genId: () => `id-${++ids}`,
    store: {
      fetchAndCacheBom: async () => {}, getBomForOrder: () => ({ bom: { id: 'bom' }, type: 'pre' }),
      calcMaterialRequirements: () => ({ factoryUnitPriceCny: 5,
        hqProvided: [{ bomLineId: 'leather', itemName: 'Leather', unit: 'SF', reqQty: 20 }] }),
      resolveFactoryUnitFromBom: () => ({ factoryUnitPriceCny: 5, factoryUnitPriceKrw: 950 }),
      getSettings: () => ({ cnyKrw: 190 }),
      addToMaterialCart: (...args) => { assert.ok(saved.has(args[4].id), 'cart requires confirmed DB save'); carts.push(args); events.push(['cart', args[4].id]); },
    },
    bomLinesForPricing: () => [], normalizeColors: colors => colors,
    upsertOrder: async row => { saves.push(structuredClone(row)); saved.set(row.id, structuredClone(row)); events.push(['save', row.id]); },
    upsertItem: async () => {}, onSaveFail: () => () => {},
    queryClient: { setQueryData: () => {}, invalidateQueries: async opts => invalidated.push(opts.queryKey) },
    setPostOrderState: state => completed.push(state),
  };
  return { deps, saved, saves, carts, completed, errors, events, invalidated, submit: () => createHandler(deps)() };
}

test('partial save failure reports actual saved orders and retry keeps IDs, quantities and cart once', async () => {
  const f = fixture();
  const save = f.deps.upsertOrder;
  let fail = true;
  f.deps.upsertOrder = async row => {
    if (row.styleId === 'b' && fail) throw new Error('DB failed');
    await save(row);
  };
  await f.submit();
  assert.equal(f.completed.length, 0);
  assert.equal(f.saved.size, 1);
  assert.equal(f.carts.length, 1);
  assert.match(f.errors[0][0], /1\/2건 저장됨/);
  assert.deepEqual(f.invalidated, [['orders']]);
  const pending = structuredClone(f.deps.batchAttemptRef.current.entries.get('b').order);
  f.deps.itemStates[1].colorQtys[0].qty = 99;
  f.deps.factoryId = 'other';
  fail = false;
  await f.submit();
  assert.equal(f.saved.size, 2);
  assert.equal(f.saves.length, 2);
  assert.equal(f.carts.length, 2);
  assert.deepEqual(f.saved.get(pending.id), pending);
  assert.equal(f.completed.length, 1);
  assert.deepEqual(f.completed[0].orders.map(o => o.qty), [10, 10]);
  assert.equal(f.deps.submitLockRef.current, false);
});

test('uncertain committed save retries same ID and number without early cart or false completion', async () => {
  const f = fixture();
  const save = f.deps.upsertOrder;
  let fail = true;
  f.deps.upsertOrder = async row => { await save(row); if (fail) { fail = false; throw new Error('response lost'); } };
  await f.submit();
  assert.equal(f.carts.length, 0);
  assert.equal(f.completed.length, 0);
  assert.equal(f.saved.size, 1);
  await f.submit();
  assert.equal(f.saved.size, 2);
  assert.equal(f.saves[0].id, f.saves[1].id);
  assert.equal(f.saves[0].orderNo, f.saves[1].orderNo);
  assert.equal(f.carts.length, 2);
  assert.equal(f.completed.length, 1);
});

test('cart failure retries cart only for already saved order', async () => {
  const f = fixture();
  const add = f.deps.store.addToMaterialCart;
  let fail = true;
  f.deps.store.addToMaterialCart = (...args) => { if (fail) { fail = false; throw new Error('cart failed'); } add(...args); };
  await f.submit();
  assert.equal(f.saves.length, 1);
  assert.equal(f.carts.length, 0);
  assert.equal(f.completed.length, 0);
  await f.submit();
  assert.equal(f.saves.length, 2);
  assert.equal(f.carts.length, 2);
  assert.equal(f.completed.length, 1);
});

test('concurrent clicks are locked and query failure releases lock with no completion', async () => {
  const f = fixture();
  let release;
  f.deps.fetchOrders = () => new Promise(resolve => { release = resolve; });
  const first = f.submit();
  await f.submit();
  assert.equal(f.saves.length, 0);
  release([]);
  await first;
  assert.equal(f.saves.length, 2);
  assert.equal(f.carts.length, 2);
  const failed = fixture();
  failed.deps.fetchOrders = async () => { throw new Error('read failed'); };
  await failed.submit();
  assert.equal(failed.completed.length, 0);
  assert.equal(failed.carts.length, 0);
  assert.equal(failed.deps.submitLockRef.current, false);
  assert.match(failed.errors[0][1].description, /read failed/);
});

test('input callbacks captured before submit freeze immediately and stay frozen after failure', async () => {
  const f = fixture();
  const input = inputHarness(f);
  let rejectRead;
  f.deps.fetchOrders = () => new Promise((resolve, reject) => { rejectRead = reject; });
  const submitting = f.submit();
  input.invokeAll();
  assert.equal(input.inputs.isInputLocked(), true);
  assert.deepEqual(input.writes, [], 'in-flight callbacks must not change inputs or persist master colors');
  rejectRead(new Error('read failed'));
  await submitting;
  assert.equal(f.deps.submitLockRef.current, false);
  input.invokeAll();
  assert.deepEqual(input.writes, [], 'failed attempt must keep original inputs locked');
  assert.equal(input.inputs.isInputLocked(), true);
  f.deps.fetchOrders = async () => [];
  await f.submit();
  assert.equal(f.completed.length, 1);
  assert.deepEqual(f.completed[0].orders.map(o => [o.qty, o.vendorId, o.orderDate]), [
    [10, 'factory', '2026-10-11'], [10, 'factory', '2026-10-11'],
  ]);
});

test('inputs still update before any batch attempt starts', () => {
  const input = inputHarness(fixture());
  assert.equal(input.inputs.isInputLocked(), false);
  input.invokeAll();
  assert.deepEqual(input.writes.map(w => w[0]), [
    'factory', 'orderDate', 'deliveryDate', 'item', 'item', 'item', 'master', 'cache', 'item', 'item',
  ]);
});

test('row-local color entry and detail controls respect immediate ref lock', async () => {
  const row = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'BulkOrderItemRow');
  const declarations = row.body.statements.flatMap(n => ts.isVariableStatement(n) ? [...n.declarationList.declarations] : []);
  const names = ['changeNewColorInput', 'handleAddColor', 'toggleDetail'];
  const body = names.map(name => `const ${name} = ${declarations.find(n => n.name.getText(ast) === name).initializer.getText(ast)};`).join('\n');
  const out = await transform(`export function createRow(deps) {
    const {isInputLocked, newColorInput, setNewColorInput, setOpenDetails, onAddColor} = deps;
    ${body} return {${names.join(', ')}};
  }`, { loader: 'ts', format: 'esm' });
  const { createRow } = await import('data:text/javascript;base64,' + Buffer.from(out.code).toString('base64'));
  const f = fixture(), input = inputHarness(f), writes = [];
  const controls = createRow({ isInputLocked: input.inputs.isInputLocked, newColorInput: 'WHITE',
    setNewColorInput: () => writes.push('color'), setOpenDetails: () => writes.push('details'), onAddColor: () => writes.push('add') });
  f.deps.submitLockRef.current = true;
  controls.changeNewColorInput('BLUE'); controls.handleAddColor(); controls.toggleDetail('BLACK');
  assert.deepEqual(writes, []);
  f.deps.submitLockRef.current = false;
  f.deps.batchAttemptRef.current = {};
  controls.changeNewColorInput('BLUE'); controls.handleAddColor(); controls.toggleDetail('BLACK');
  assert.deepEqual(writes, []);
});

test('retry form visibly disables input region and factory select and explains original-content retry', () => {
  const jsx = modal.getText(ast);
  assert.match(jsx, /<fieldset disabled=\{submitting \|\| batchAttemptRef\.current !== null\}/);
  assert.match(jsx, /<Select value=\{factoryId\} onValueChange=\{changeFactory\} disabled=\{submitting \|\| batchAttemptRef\.current !== null\}/);
  const region = jsx.slice(jsx.indexOf('<fieldset'), jsx.indexOf('</fieldset>'));
  assert.match(region, /<BulkOrderItemRow[\s\S]*isInputLocked=\{isInputLocked\}/);
  assert.match(region, /changeOrderDate\(e\.target\.value\)/);
  assert.match(region, /changeDeliveryDate\(e\.target\.value\)/);
  assert.match(jsx, /입력은 잠겨 있습니다\. 재시도는 처음 입력한 내용으로 진행됩니다\./);
  assert.match(jsx, /원래 내용으로 재시도/);
});
