import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { Bom, BomLine } from './store';
import type * as CartApi from './hqMaterialCart';

// 실제 모듈 전체를 실행하고 브라우저·DB에 의존하는 store 경계만 대체한다.
function loadCart() {
  const calls: unknown[][] = [];
  const cart = [{ itemName: 'existing', qty: 5 }];
  const source = readFileSync(new URL('./hqMaterialCart.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    assert.equal(name, './store');
    return {
      getBomForOrderFromList: (boms: Bom[]) => ({ bom: boms[0] ?? null }),
      store: { addToMaterialCart: (...args: unknown[]) => {
        calls.push(args);
        cart.push({ itemName: 'added', qty: args[3] as number });
      } },
    };
  }, module, module.exports);
  return { api: module.exports as typeof CartApi, calls, cart };
}

const line = (extra: Record<string, unknown> = {}): BomLine => ({
  id: 'line', category: '원자재', itemName: 'leather', spec: '1mm', unit: 'SF',
  netQty: 2, lossRate: 0.1, unitPriceCny: 12, vendorName: 'vendor', isHqProvided: true,
  ...extra,
});
const bom = (extra: Record<string, unknown> = {}): Bom => ({
  id: 'bom', styleNo: 'STYLE', styleId: 'item', lines: [line()],
  colorBoms: [{ color: 'BLACK', lines: [line()] }], ...extra,
} as Bom);

test('missing later positive color reports an actionable error before any cart write', () => {
  const { api, calls, cart } = loadCart();
  const before = structuredClone(cart);
  assert.throws(() => api.addHqMaterialsToCart(api.hqGroups(bom(), [
    { color: 'BLACK', qty: 10 }, { color: 'BLUE', qty: 2 }, { color: 'RED', qty: 1 },
  ], 13), 'STYLE', 'style'), (error: unknown) => {
    assert.ok(error instanceof api.MissingColorBomError);
    assert.equal(error.code, 'MISSING_COLOR_BOM');
    assert.equal(error.styleNo, 'STYLE');
    assert.deepEqual(error.missingColors, ['BLUE', 'RED']);
    assert.match(error.message, /BOM\/원가.*등록.*다시 담아/);
    return true;
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(cart, before);
});

test('positive colors require a matching BOM even when only flat lines or no BOM exist', () => {
  const { api } = loadCart();
  for (const value of [bom({ colorBoms: [] }), null, undefined]) {
    assert.throws(() => api.hqGroups(value, [{ color: 'BLUE', qty: 1 }], 1), api.MissingColorBomError);
  }
});

test('post color BOM has precedence; a pre-only color cannot fill a missing post color', () => {
  const { api } = loadCart();
  const value = bom({ postColorBoms: [{ color: 'BLACK', lines: [line({ netQty: 7 })] }] });
  assert.equal(api.hqGroups(value, [{ color: ' BLACK ', qty: 3 }], 3)[0].mats[0].netQty, 7);
  assert.throws(() => api.hqGroups(bom({
    postColorBoms: [{ color: 'RED', lines: [line()] }],
  }), [{ color: 'BLACK', qty: 3 }], 3), api.MissingColorBomError);
});

test('selected colors with no HQ lines never fall back to flat or first-color materials', () => {
  const { api } = loadCart();
  for (const lines of [[], [line({ isHqProvided: false })], undefined]) {
    assert.deepEqual(api.hqGroups(bom({ colorBoms: [{ color: 'BLUE', lines }] }),
      [{ color: 'BLUE', qty: 2 }], 2), []);
  }
});

test('non-positive colors are ignored and legacy no-color fallback keeps its precedence', () => {
  const { api } = loadCart();
  const variants = [
    { postMaterials: [line({ itemName: 'post-flat' })], postColorBoms: [{ color: 'RED', lines: [line({ itemName: 'post-color' })] }] },
    { postColorBoms: [{ color: 'RED', lines: [line({ itemName: 'post-color' })] }] },
    {}, { colorBoms: [], lines: [line({ itemName: 'pre-flat' })] },
  ];
  variants.forEach((extra, index) => {
    const groups = api.hqGroups(bom(extra), [{ color: 'MISSING', qty: 0 }, { color: 'OTHER', qty: -1 }], 4);
    assert.equal(groups[0].color, '');
    assert.equal(groups[0].qty, 4);
    assert.equal(groups[0].mats[0].itemName, ['post-flat', 'post-color', 'leather', 'pre-flat'][index]);
  });
  assert.deepEqual(api.hqGroups(null, undefined, 4), []);
  assert.deepEqual(api.hqGroups(bom(), [], 0), []);
});

test('line currency and appliedRate pass unchanged through display and the existing add contract', () => {
  const { api, calls } = loadCart();
  for (const [currency, appliedRate] of [['USD', 1400], ['KRW', 1], ['CNY', 191]] as const) {
    const value = bom({ postColorBoms: [{ color: 'BLACK', lines: [line({ currency, appliedRate })] }] });
    const groups = api.hqGroups(value, [{ color: 'BLACK', qty: 3 }], 3);
    const materials = api.hqMaterialsForDisplay(groups);
    assert.equal(materials[0].currency, currency);
    assert.equal(materials[0].appliedRate, appliedRate);
    const ref = { id: 'order', orderNo: 'PO-1' };
    assert.equal(api.addHqMaterialsToCart(groups, 'STYLE', 'style', ref), 1);
    assert.deepEqual(calls.at(-1), ['STYLE', 'style', materials, 3, ref]);
    assert.equal(materials[0].unitPriceCny, 12);
  }
});

test('untagged lines inherit the selected phase header; absent legacy metadata remains absent', () => {
  const { api } = loadCart();
  const material = api.hqGroups(bom({ currency: 'USD', exchangeRateUsd: 1500 }), [], 2)[0].mats[0];
  assert.equal(material.currency, 'USD');
  assert.equal(material.appliedRate, 1500);
  const legacy = api.hqGroups(bom(), [], 2)[0].mats[0];
  assert.equal(Object.hasOwn(legacy, 'currency'), false);
  assert.equal(Object.hasOwn(legacy, 'appliedRate'), false);
  const zero = api.hqGroups(bom({ colorBoms: [], lines: [line({ appliedRate: 0, unitPriceCny: 0 })] }), [], 2)[0].mats[0];
  assert.equal(zero.appliedRate, 0);
  assert.equal(zero.unitPriceCny, 0);
});

test('actual and pre-cost headers follow the source of flat and color BOM lines', () => {
  const { api } = loadCart();
  const headers = { currency: 'USD', exchangeRateUsd: 1500, preCurrency: 'CNY', preExchangeRateCny: 190 };
  for (const extra of [
    { postMaterials: [line()] },
    { postColorBoms: [{ color: 'BLACK', lines: [line()] }] },
  ]) {
    const material = api.hqGroups(bom({ ...headers, ...extra }), [], 2)[0].mats[0];
    assert.equal(material.currency, 'USD'); assert.equal(material.appliedRate, 1500);
  }
  for (const extra of [{}, { colorBoms: [] }]) {
    const material = api.hqGroups(bom({ ...headers, ...extra }), [], 2)[0].mats[0];
    assert.equal(material.currency, 'CNY'); assert.equal(material.appliedRate, 190);
  }
  const post = api.hqGroups(bom({ ...headers,
    postColorBoms: [{ color: 'BLACK', lines: [line()] }],
  }), [{ color: 'BLACK', qty: 2 }], 2)[0].mats[0];
  assert.equal(post.currency, 'USD'); assert.equal(post.appliedRate, 1500);
  const pre = api.hqGroups(bom(headers), [{ color: 'BLACK', qty: 2 }], 2)[0].mats[0];
  assert.equal(pre.currency, 'CNY'); assert.equal(pre.appliedRate, 190);
});

test('explicit line metadata overrides header; USD never inherits a CNY header rate', () => {
  const { api } = loadCart();
  const material = api.hqGroups(bom({ currency: 'USD', exchangeRateUsd: 1500,
    postMaterials: [line({ currency: 'KRW', appliedRate: 1 })],
  }), [], 2)[0].mats[0];
  assert.equal(material.currency, 'KRW'); assert.equal(material.appliedRate, 1);
  const usd = api.hqGroups(bom({ currency: 'USD', exchangeRateCny: 190,
    postMaterials: [line()],
  }), [], 2)[0].mats[0];
  assert.equal(usd.currency, 'USD'); assert.equal(usd.appliedRate, undefined);
});

test('display keeps identical names when pricing contracts differ', () => {
  const { api } = loadCart();
  const groups = api.hqGroups(bom({ colorBoms: [], lines: [
    line({ currency: 'USD', appliedRate: 1400 }), line({ currency: 'KRW', appliedRate: 1 }),
  ] }), [], 2);
  assert.equal(api.hqMaterialsForDisplay(groups).length, 2);
});

test('actual CNY editor exchange rate precedes stale post rate and snapshot', () => {
  const { api } = loadCart();
  for (const extra of [
    { postMaterials: [line()] },
    { postColorBoms: [{ color: 'BLACK', lines: [line()] }] },
  ]) {
    const value = bom({ currency: 'CNY', exchangeRateCny: 205, postExchangeRateCny: 190, snapshotCnyKrw: 180, ...extra });
    assert.equal(api.hqGroups(value, [], 2)[0].mats[0].appliedRate, 205);
    if ('postColorBoms' in extra) {
      assert.equal(api.hqGroups(value, [{ color: 'BLACK', qty: 2 }], 2)[0].mats[0].appliedRate, 205);
    }
  }
  const fallback = bom({ currency: 'CNY', postExchangeRateCny: 190, snapshotCnyKrw: 180, postMaterials: [line()] });
  assert.equal(api.hqGroups(fallback, [], 2)[0].mats[0].appliedRate, 190);
  const snapshot = bom({ currency: 'CNY', snapshotCnyKrw: 180, postMaterials: [line()] });
  assert.equal(api.hqGroups(snapshot, [], 2)[0].mats[0].appliedRate, 180);
});

test('duplicate BOM ambiguity includes differing currencies and rates', () => {
  const { api } = loadCart();
  const first = bom({ id: 'one', colorBoms: [], lines: [line({ currency: 'USD', appliedRate: 1400 })] });
  for (const extra of [{ currency: 'KRW', appliedRate: 1400 }, { currency: 'USD', appliedRate: 1500 }]) {
    const second = bom({ id: 'two', colorBoms: [], lines: [line(extra)] });
    assert.equal(api.pickBomForOrder([first, second], 'STYLE', 'item', [], 2).ambiguous, true);
  }
  assert.equal(api.pickBomForOrder([first, { ...first, id: 'same' }], 'STYLE', 'item', [], 2).ambiguous, false);
});

test('multiple matching colors preserve each quantity and material consumption', () => {
  const { api, calls } = loadCart();
  const groups = api.hqGroups(bom({ colorBoms: [
    { color: 'BLACK', lines: [line()] }, { color: 'BLUE', lines: [line({ netQty: 5 })] },
  ] }), [{ color: 'BLACK', qty: 3 }, { color: 'BLUE', qty: 2 }], 5);
  assert.equal(api.addHqMaterialsToCart(groups, 'STYLE', 'style'), 2);
  assert.deepEqual(calls.map(c => [(c[2] as CartApi.CartMaterial[])[0].netQty, c[3]]), [[2, 3], [5, 2]]);
});
