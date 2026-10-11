import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import type { Bom, BomLine, ProductionOrder } from './store';
import { workOrderColors } from './workOrderColors';

const require = createRequire(import.meta.url);
function loadSource(path: string, imports: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', compiled)((name: string) =>
    Object.hasOwn(imports, name) ? imports[name] : require(name), module, module.exports);
  return module.exports;
}
// 현재 소스를 직접 실행하고 DB·브라우저 경계만 대체한다.
const cart = loadSource('./hqMaterialCart.ts', { './store': {} });
const { WorkOrderDoc } = loadSource('../components/WorkOrderDoc.tsx', {
  '@/lib/workOrderColors': { workOrderColors },
  './SignaturePad': { SignatureSlot: () => null },
});
const line = (name: string, extra: Partial<BomLine> = {}): BomLine => ({
  id: name, category: '원자재', subPart: '바디', itemName: name, spec: '1mm',
  unit: 'SF', netQty: 2, lossRate: 0.1, unitPriceCny: 10, isHqProvided: true, ...extra,
});
const bom = (extra: Record<string, unknown> = {}) => ({
  lines: [line('flat')], colorBoms: [{ color: 'BLACK', lines: [line('pre-black')] }], ...extra,
} as unknown as Bom);
const order = (extra: Partial<ProductionOrder> = {}) => ({
  id: 'order', styleNo: 'STYLE', styleName: '품명', qty: 3,
  colorQtys: [{ color: 'BLACK', qty: 3 }], ...extra,
} as ProductionOrder);
const html = (o: ProductionOrder, b?: Bom | null, extra = {}) =>
  renderToStaticMarkup(WorkOrderDoc({ order: o, bom: b, ...extra }));

test('selected phase exact matches agree with current hqMaterialCart source', () => {
  const values = [
    bom(),
    bom({ postColorBoms: [{ color: 'BLACK', lines: [line('post-black')] }] }),
    bom({ postColorBoms: [{ color: 'RED', lines: [line('post-red')] }] }),
    bom({ colorBoms: [] }), null, undefined,
  ];
  for (const value of values) {
    for (const color of ['BLACK', ' BLACK ', 'RED', 'black', 'BLUE']) {
      const o = order({ colorQtys: [{ color, qty: 3 }] });
      const result = workOrderColors(o, value);
      if (result.ready) {
        const groups = cart.hqGroups(value, o.colorQtys, o.qty);
        assert.deepEqual(result.rows[0].lines.map(l => l.itemName), groups[0].mats.map((l: BomLine) => l.itemName));
      } else {
        assert.throws(() => cart.hqGroups(value, o.colorQtys, o.qty), cart.MissingColorBomError);
        assert.deepEqual(result.rows[0].lines, []);
      }
    }
  }
});

test('pre-only color cannot fill a missing post color, including header and HQ totals', () => {
  const value = bom({ postColorBoms: [{ color: 'RED', lines: [line('other-post', { unit: 'WRONG' })] }] });
  const result = workOrderColors(order(), value);
  assert.deepEqual(result.missingColors, ['BLACK']);
  const output = html(order(), value);
  assert.match(output, /data-work-order-ready="false"/);
  assert.match(output, /role="alert"/);
  assert.match(output, /전달 준비 불가.*BLACK/);
  assert.doesNotMatch(output, /other-post|pre-black|WRONG/);
});

test('missing later positive colors warn while matched rows keep their own materials', () => {
  const o = order({ colorQtys: [{ color: 'BLACK', qty: 3 }, { color: 'BLUE', qty: 2 }, { color: '', qty: 1 }] });
  assert.deepEqual(workOrderColors(o, bom()).missingColors, ['BLUE', '']);
  const output = html(o, bom());
  assert.match(output, /BLUE, \(컬러명 없음\)/);
  assert.match(output, /pre-black/);
  assert.match(output, /7 SF/); // BLACK만: 2 × 1.1 × 3, 올림.
});

test('empty matched BOM never borrows another color or pre/flat materials', () => {
  for (const lines of [[], undefined, [line('factory-only', { isHqProvided: false })]]) {
    const value = bom({ postColorBoms: [{ color: 'BLACK', lines }, { color: 'RED', lines: [line('other')] }] });
    const result = workOrderColors(order(), value);
    assert.equal(result.ready, true); // 현재 장바구니 계약: 등록된 빈 컬러는 누락이 아니다.
    assert.deepEqual(cart.hqGroups(value, order().colorQtys, 3), []);
    assert.doesNotMatch(html(order(), value), /pre-black|other|flat/);
  }
});

test('legacy no explicit colors uses one default set with current flat precedence', () => {
  const values = [
    bom({ postMaterials: [line('post-flat')], postColorBoms: [{ color: 'RED', lines: [line('post-color')] }] }),
    bom({ postColorBoms: [{ color: 'RED', lines: [line('post-color')] }] }),
    bom(), bom({ colorBoms: [] }),
  ];
  for (const value of values) {
    for (const colorQtys of [undefined, []]) {
      const result = workOrderColors(order({ colorQtys }), value);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].color, '기본');
      assert.equal(result.ready, true);
      assert.equal(result.rows[0].lines[0].itemName, cart.hqGroups(value, colorQtys, 3)[0].mats[0].itemName);
    }
  }
});

test('non-positive explicit rows do not warn or contribute borrowed/negative HQ totals', () => {
  const o = order({ colorQtys: [{ color: 'BLUE', qty: 0 }, { color: 'BLACK', qty: -2 }] });
  assert.equal(workOrderColors(o, bom()).ready, true);
  assert.match(html(o, bom()), /본사제공 자재 없음/);
  assert.doesNotMatch(html(o, bom()), /전달 준비 불가/);
});

test('HQ quantity and header unit come only from positive selected colors', () => {
  const value = bom({ colorBoms: [
    { color: 'RED', lines: [line('unselected', { unit: 'WRONG' })] },
    { color: 'BLACK', lines: [line('selected', { unit: 'YD', netQty: 3 })] },
  ] });
  const output = html(order(), value);
  assert.match(output, /3\.30 YD/);
  assert.match(output, /10 YD/);
  assert.doesNotMatch(output, /unselected|WRONG/);
});

function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}

test('manual specs retain inherited values, functional updates and concurrent edits', () => {
  const o = order({ specNumbers: { BLACK: { thread: 'saved' } } });
  const updates: any[] = [];
  const nodes = elements(WorkOrderDoc({ order: o, bom: bom(), inherited: { BLACK: { zipper: 'inherited' } },
    onPatch: (make: any) => updates.push(make) }));
  const inputs = nodes.filter(n => n.type === 'input');
  assert.deepEqual(inputs.map(n => n.props.defaultValue), ['saved', 'inherited']);
  inputs[1].props.onBlur({ target: { value: ' new zipper ' } });
  const prev = order({ specNumbers: { BLACK: { thread: 'concurrent' }, BLUE: { thread: 'other' } } });
  assert.deepEqual(updates[0](prev).specNumbers, {
    BLACK: { thread: 'concurrent', zipper: 'new zipper' }, BLUE: { thread: 'other' },
  });
});

test('nine-column form, notes and three signature callbacks remain intact even with warnings', () => {
  const o = order({ colorQtys: [{ color: 'MISSING', qty: 2 }], cautionNote: '주의문', changeNote: '변경문',
    signatures: { writer: { name: '작성자' } } });
  const clicks: string[] = [];
  const updates: any[] = [];
  const props = { note: '추가메모', onSign: (slot: string) => clicks.push(slot), onPatch: (make: any) => updates.push(make) };
  const nodes = elements(WorkOrderDoc({ order: o, bom: bom(), ...props }));
  assert.equal(nodes.filter(n => n.type === 'th').length, 9);
  const signatures = nodes.filter(n => typeof n.type === 'function');
  assert.equal(signatures.length, 3);
  assert.equal(signatures[0].props.sign.name, '작성자');
  signatures.forEach(n => n.props.onClick());
  assert.deepEqual(clicks, ['writer', 'checker', 'receiver']);
  const notes = nodes.filter(n => n.type === 'textarea');
  assert.deepEqual(notes.map(n => n.props.defaultValue), ['주의문', '변경문']);
  notes[0].props.onBlur({ target: { value: ' 새 주의문 ' } });
  assert.deepEqual(updates[0](o), { cautionNote: '새 주의문' });
  const output = html(o, bom(), { note: '추가메모', inherited: { MISSING: { thread: '수기실' } } });
  for (const text of ['주의문', '변경문', '추가메모', '수기실', '전달 준비 불가']) assert.ok(output.includes(text));
});
