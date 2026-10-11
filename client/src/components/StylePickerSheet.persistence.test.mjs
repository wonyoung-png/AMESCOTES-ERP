// node --test client/src/components/StylePickerSheet.persistence.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const names = ['useMemo', 'useRef', 'useState', 'store', 'normalizeColors', 'calcPostSummary',
  'Sheet', 'SheetContent', 'SheetHeader', 'SheetTitle', 'Input', 'Button', 'Search', 'ImageOff'];
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./StylePickerSheet.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  jsxFactory: 'globalThis.__pickerTest.element', tsconfigRaw: { compilerOptions: { jsx: 'react' } },
  plugins: [{ name: 'picker-dependencies', setup(b) {
    b.onResolve({ filter: /.*/ }, a => a.kind === 'entry-point' ? undefined : { path: a.path, namespace: 'mock' });
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ loader: 'js', contents:
      names.map(name => `export const ${name} = globalThis.__pickerTest.dependencies.${name};`).join('\n'),
    }));
  } }],
});
let instance = 0;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function mount(onAdd) {
  const slots = [], closes = [], calls = [];
  let cursor = 0, tree;
  const dependencies = Object.fromEntries(names.map(name => [name, name]));
  Object.assign(dependencies, {
    useMemo: fn => fn(),
    useState(initial) {
      const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    normalizeColors: value => value,
    store: {
      getItems: () => [{ id: 'item', styleNo: 'STYLE', name: 'Bag', baseCostKrw: 100,
        colors: [{ name: 'black' }], erpCategory: 'Bag', season: 'FW' }],
      getBoms: () => [], getSettings: () => ({ usdKrw: 1380 }),
    },
  });
  globalThis.__pickerTest = { dependencies, element: (type, props, ...children) => ({ type, props: { ...props, children } }) };
  const source = bundle.outputFiles[0].text + `\n// instance ${++instance}`;
  const { default: Picker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const render = () => {
    cursor = 0;
    tree = Picker({ open: true, factories: [{ id: 'F', name: 'Factory' }],
      onOpenChange: value => closes.push(value),
      onAdd: (...args) => { calls.push(args); return onAdd(...args); },
    });
  };
  const nodes = () => {
    const result = [];
    const visit = value => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') { result.push(value); visit(value.props?.children); }
    };
    visit(tree); return result;
  };
  const find = predicate => {
    const node = nodes().find(predicate); assert.ok(node, 'Expected picker control'); return node.props;
  };
  const quantity = () => find(n => n.type === 'Input' && n.props.type === 'number');
  const submit = () => find(n => n.type === 'Button');
  const factory = () => find(n => n.type === 'select' && n.props.children.flat().some(c => c?.props?.value === 'F'));
  const route = () => find(n => n.type === 'select' && n.props.children.flat().some(c => c?.props?.value === 'direct'));
  render();
  return { render, nodes, find, quantity, submit, factory, route, closes, calls };
}

test('waits for save, locks all inputs and dismissal, and prevents reentry before render', async () => {
  const gate = deferred(); const h = await mount(() => gate.promise);
  h.quantity().onChange({ target: { value: '3' } });
  h.factory().onChange({ target: { value: 'F' } });
  h.route().onChange({ target: { value: 'direct' } }); h.render();
  const staleSubmit = h.submit().onClick, staleQty = h.quantity().onChange;
  const pending = staleSubmit(); await staleSubmit();
  staleQty({ target: { value: '99' } });
  h.find(n => n.type === 'Sheet').onOpenChange(false); h.render();
  assert.equal(h.calls.length, 1);
  assert.equal(h.quantity().value, 3);
  assert.equal(h.submit().children[0], '저장 중…');
  assert.ok(h.nodes().filter(n => n.type === 'select' || n.type === 'Input' || n.type === 'Button').every(n => n.props.disabled));
  let prevented = 0;
  const content = h.find(n => n.type === 'SheetContent');
  content.onEscapeKeyDown({ preventDefault() { prevented++; } });
  content.onInteractOutside({ preventDefault() { prevented++; } });
  assert.equal(prevented, 2);
  assert.deepEqual(h.closes, []);
  gate.resolve(); await pending; h.render();
  assert.deepEqual(h.closes, [false]);
  assert.equal(h.quantity().value, '');
  assert.equal(h.factory().value, 'F');
  assert.equal(h.route().value, 'direct');
  assert.equal(h.submit().children[0], '발주에 담기');
});

test('failure is caught, retains quantities/factory/route, unlocks and retries the same inputs', async () => {
  const first = deferred(); let attempt = 0;
  const h = await mount(() => ++attempt === 1 ? first.promise : Promise.resolve());
  h.quantity().onChange({ target: { value: '4' } });
  h.factory().onChange({ target: { value: 'F' } });
  h.route().onChange({ target: { value: 'direct' } }); h.render();
  const pending = h.submit().onClick(); first.reject(new Error('DB failure'));
  await pending; h.render();
  assert.deepEqual(h.closes, []);
  assert.equal(h.quantity().value, 4);
  assert.equal(h.factory().value, 'F');
  assert.equal(h.route().value, 'direct');
  assert.equal(h.submit().disabled, false);
  assert.equal(h.quantity().disabled, false);
  await h.submit().onClick(); h.render();
  assert.deepEqual(h.calls[0], h.calls[1]);
  assert.deepEqual(h.closes, [false]);
  assert.equal(h.quantity().value, '');
});

test('empty submission does nothing; failed submission permits dismissal and editing', async () => {
  const h = await mount(() => { throw new Error('sync failure'); });
  await h.submit().onClick(); assert.equal(h.calls.length, 0);
  h.quantity().onChange({ target: { value: '2' } }); h.render();
  await h.submit().onClick(); h.render();
  assert.equal(h.quantity().value, 2);
  h.quantity().onChange({ target: { value: '7' } }); h.render();
  assert.equal(h.quantity().value, 7);
  h.find(n => n.type === 'Sheet').onOpenChange(false);
  assert.deepEqual(h.closes, [false]);
});
