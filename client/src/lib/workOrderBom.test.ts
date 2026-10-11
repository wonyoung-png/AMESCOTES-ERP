import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import type { Bom, BomLine, ProductionOrder } from './store';
import { pickWorkOrderBom } from './workOrderBom';
import { workOrderColors } from './workOrderColors';

const line = (name: string, extra = {}) => ({
  id: name, itemName: name, category: '원자재', subPart: '바디', unit: 'SF',
  netQty: 1, lossRate: 0, unitPriceCny: 10, isHqProvided: false, ...extra,
} as BomLine);
const bom = (id: string, color = 'BLACK', name = '가죽', extra = {}) => ({
  id, styleNo: 'STYLE', styleId: 'ITEM', version: 1, lines: [],
  colorBoms: [{ color, lines: [line(name)] }], ...extra,
} as unknown as Bom);
const order = (extra = {}) => ({ id: 'ORDER', styleNo: 'STYLE', styleId: 'ITEM', qty: 3,
  colorQtys: [{ color: 'BLACK', qty: 3 }], ...extra } as ProductionOrder);

test('duplicate candidate missing color returns an explicit ambiguity without throwing', () => {
  const result = pickWorkOrderBom([bom('a'), bom('b', 'RED')], order());
  assert.equal(result.bom, null);
  assert.equal(result.ambiguous, true);
  assert.match(result.error!, /자재가 다른 BOM/);
});

test('different factory main materials block selection even without HQ materials', () => {
  const result = pickWorkOrderBom([bom('a', 'BLACK', '가죽A'), bom('b', 'BLACK', '가죽B')], order());
  assert.equal(result.ambiguous, true);
  assert.equal(result.bom, null);
});

test('all document material contracts and first-match ordering participate in comparison', () => {
  const a = bom('a');
  for (const change of [{ spec: '2mm' }, { unit: 'YD' }, { vendorName: '다른 공장' },
    { netQty: 2 }, { lossRate: 0.2 }, { subPart: '안감' }, { isHqProvided: true }]) {
    const b = bom('b', 'BLACK', '가죽', { colorBoms: [{ color: 'BLACK', lines: [line('가죽', change)] }] });
    assert.equal(pickWorkOrderBom([a, b], order()).ambiguous, true);
  }
  const lines = [line('가죽A'), line('가죽B')];
  assert.equal(pickWorkOrderBom([
    bom('a', 'BLACK', '', { colorBoms: [{ color: 'BLACK', lines }] }),
    bom('b', 'BLACK', '', { colorBoms: [{ color: 'BLACK', lines: [...lines].reverse() }] }),
  ], order()).ambiguous, true);
});

test('equivalent copies ignore IDs and property order, retaining latest-version selection', () => {
  const a = bom('a');
  const b = bom('b', 'BLACK', '', { version: 2, colorBoms: [{ color: 'BLACK', lines: [
    Object.fromEntries(Object.entries({ ...line('가죽'), id: 'new-line' }).reverse()),
  ] }] });
  const result = pickWorkOrderBom([a, b], order());
  assert.equal(result.ambiguous, false);
  assert.equal(result.bom, b);
});

test('styleId matching takes precedence over same styleNo from another item', () => {
  const mine = bom('mine');
  const foreign = bom('foreign', 'RED', '다른 품목', { styleId: 'OTHER', version: 99 });
  assert.equal(pickWorkOrderBom([foreign, mine], order()).bom, mine);
  assert.equal(pickWorkOrderBom([foreign], order()).bom, foreign);
});

test('explicit bomId pins an older canonical BOM without comparing other versions', () => {
  const old = bom('old', 'BLACK', '구버전', { version: 1 });
  const latest = bom('latest', 'BLACK', '신버전', { version: 99 });
  const result = pickWorkOrderBom([latest, old], order({ bomId: 'old' }));
  assert.deepEqual(result, { bom: old, ambiguous: false });
  assert.equal(workOrderColors(order(), result.bom).rows[0].lines[0].itemName, '구버전');
});

test('explicit missing or foreign bomId fails closed without falling back to a matching BOM', () => {
  const mine = bom('mine');
  for (const foreign of [bom('foreign', 'BLACK', '외부', { styleId: 'OTHER' }),
    bom('foreign', 'BLACK', '외부', { styleNo: 'OTHER' }),
    bom('foreign', 'BLACK', '외부', { styleNo: 'OTHER', styleId: 'OTHER' })]) {
    const result = pickWorkOrderBom([mine, foreign], order({ bomId: 'foreign' }));
    assert.equal(result.bom, null);
    assert.equal(result.ambiguous, false);
    assert.match(result.error!, /다른 품목/);
  }
  assert.match(pickWorkOrderBom([mine], order({ bomId: 'deleted' })).error!, /지정된 BOM이 없습니다/);
});

test('pinned missing color remains a color warning; no fallback to another version', () => {
  const pinned = bom('pinned', 'RED');
  const result = pickWorkOrderBom([pinned, bom('other')], order({ bomId: 'pinned' }));
  assert.deepEqual(result, { bom: pinned, ambiguous: false });
  assert.deepEqual(workOrderColors(order(), result.bom).missingColors, ['BLACK']);
});

test('pinned legacy BOM without item ID validates styleNo; absent order styleId still validates styleNo', () => {
  const legacy = bom('legacy', 'BLACK', '가죽', { styleId: undefined });
  assert.equal(pickWorkOrderBom([legacy], order({ bomId: 'legacy' })).bom, legacy);
  const tagged = bom('tagged');
  assert.equal(pickWorkOrderBom([tagged], order({ bomId: 'tagged', styleId: undefined })).bom, tagged);
});

test('post phase wins; missing selected color returns BOM for workOrderColors warning', () => {
  const pre = bom('pre', 'BLACK');
  const post = bom('post', 'BLACK', '가죽', {
    postColorBoms: [{ color: 'RED', lines: [line('사후')] }],
  });
  const result = pickWorkOrderBom([post], order());
  assert.equal(result.bom, post);
  assert.equal(result.error, undefined);
  assert.deepEqual(workOrderColors(order(), result.bom).missingColors, ['BLACK']);
  const samePost = bom('same', 'RED', '', {
    postColorBoms: [{ color: 'BLACK', lines: [line('가죽')] }],
  });
  assert.equal(pickWorkOrderBom([pre, samePost], order()).bom, samePost);
});

test('legacy default retains one set; unrelated unselected color does not create ambiguity', () => {
  const a = bom('a');
  const b = bom('b', 'BLACK', '가죽', { colorBoms: [
    { color: 'BLACK', lines: [line('가죽')] }, { color: 'RED', lines: [line('다른')] },
  ] });
  assert.equal(pickWorkOrderBom([a, b], order()).ambiguous, false);
  assert.equal(workOrderColors(order({ colorQtys: [] }), pickWorkOrderBom([a, b], order({ colorQtys: [] })).bom).rows.length, 1);
});

test('malformed candidate returns a reason rather than leaking a selector exception', () => {
  const result = pickWorkOrderBom([bom('bad', '', '', { colorBoms: {} })], order());
  assert.equal(result.bom, null);
  assert.equal(result.ambiguous, false);
  assert.match(result.error!, /확인할 수 없습니다/);
});

// 실제 부모 함수와 실제 선택·컬러 검증을 실행한다. 저장·화면 경계만 대체한다.
const source = readFileSync(new URL('../pages/ProductionOrders.tsx', import.meta.url), 'utf8');
function transmission(boms: Bom[]) {
  let writes = 0;
  const errors: string[] = [];
  const snippet = source.slice(source.indexOf('  const markSent = async'), source.indexOf('  /** 공장 회신 기록'));
  const code = transformSync(snippet, { loader: 'ts' }).code;
  const mark = new Function('transmissionPending', 'transmissionRecorded', 'upsertOrder', 'setPoTarget',
    'setBatchSheet', 'refresh', 'onSaveFail', 'pickWorkOrderBom', 'workOrderColors', 'boms', 'toast', code + ';return markSent;')(
    { current: new Set() }, { current: new Set() }, async () => writes++, () => {}, () => {}, () => {},
    () => (e: Error) => errors.push(e.message), pickWorkOrderBom, workOrderColors, boms,
    { error: (message: string) => errors.push(message) },
  );
  return { mark, state: () => ({ writes, errors }) };
}

test('real parent refuses both P1 scenarios and missing colors even with manual HTML', async () => {
  for (const boms of [[bom('a'), bom('b', 'RED')],
    [bom('a', 'BLACK', '가죽A'), bom('b', 'BLACK', '가죽B')], [bom('missing', 'RED')]]) {
    const t = transmission(boms);
    assert.equal(await t.mark(order({ workOrderHtml: '수기 메모와 서명' })), false);
    assert.equal(t.state().writes, 0);
    assert.equal(t.state().errors.length, 1);
  }
});

test('real parent permits valid single/equivalent BOMs and keeps legacy manual document', async () => {
  for (const boms of [[bom('a')], [bom('a'), bom('b')]]) {
    const t = transmission(boms);
    assert.equal(await t.mark(order()), true);
    assert.equal(t.state().writes, 1);
    assert.deepEqual(t.state().errors, []);
  }
  const t = transmission([]);
  assert.equal(await t.mark(order({ colorQtys: [], workOrderHtml: '수기' })), true);
  assert.equal(t.state().writes, 1);
});

test('real parent honors explicit BOM version and refuses missing/foreign pins even with manual HTML', async () => {
  const old = bom('old', 'BLACK', '구버전');
  const latest = bom('latest', 'BLACK', '신버전', { version: 99 });
  const valid = transmission([latest, old]);
  assert.equal(await valid.mark(order({ bomId: 'old' })), true);
  assert.equal(valid.state().writes, 1);
  for (const boms of [[old], [old, bom('foreign', 'BLACK', '외부', { styleId: 'OTHER' })]]) {
    const blocked = transmission(boms);
    assert.equal(await blocked.mark(order({ bomId: 'foreign', workOrderHtml: '수기' })), false);
    assert.equal(blocked.state().writes, 0);
    assert.equal(blocked.state().errors.length, 1);
  }
});

test('parent document prop uses the same dedicated picker and exposes selection errors', () => {
  assert.match(source, /bom=\{pickWorkOrderBom\(boms as Bom\[\], workOrderTarget\)\.bom as any\}/);
  assert.match(source, /전달 준비 불가 — \{pickWorkOrderBom\(boms as Bom\[\], workOrderTarget\)\.error\}/);
});
