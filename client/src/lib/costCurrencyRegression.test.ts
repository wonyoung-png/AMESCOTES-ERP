import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { calcQty, calcLineAmt, ceil10 } from './costing';

// Exercise the actual page helpers without importing React or starting a server.
const source = readFileSync(new URL('../pages/BomManagement.tsx', import.meta.url), 'utf8');
const compile = (code: string) => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const buildSource = source.slice(source.indexOf('function buildQuoteRows('), source.indexOf('/** 마진 계산 로직'));
const buildQuoteRows = new Function('calcQty', 'calcLineAmt', 'ceil10', 'genId',
  compile(buildSource) + '; return buildQuoteRows;')(calcQty, calcLineAmt, ceil10, () => 'test-row');
const createSource = source.slice(source.indexOf('function createNewBom('), source.indexOf('function normalizeBom('));
const createNewBom = new Function('genId', 'BOM_SECTIONS', 'newExtLine', 'newPostLine', 'defaultPnl',
  compile(createSource) + '; return createNewBom;')(() => 'test-bom', [], () => ({}), () => ({}), () => ({}));
const quoteRateSource = source.slice(source.indexOf('  const quoteCurrency ='), source.indexOf('  const [marginInfo,', source.indexOf('  const quoteCurrency =')));
const quoteRate = new Function('bom', 'tab', quoteRateSource + '; return { quoteCurrency, quoteRate };');
const settings = { usdKrw: 1400, cnyKrw: 190, currentSeason: '27SS' };
const line = { category: '원자재', itemName: '가죽', unitPriceCny: 10, netQty: 2, lossRate: 0 };

test('new costs use USD in both phases with the configured USD rate', () => {
  const bom = createNewBom(settings);
  assert.equal(bom.currency, 'USD');
  assert.equal(bom.preCurrency, 'USD');
  assert.equal(bom.exchangeRateUsd, 1400);
  assert.equal(bom.preExchangeRateUsd, 1400);
});

test('historical CNY costs retain their currency, amounts and conversion', () => {
  const bom = { currency: 'CNY', lines: [line], snapshotCnyKrw: 190, postProcessLines: [] };
  const before = JSON.stringify(bom);
  const rows = buildQuoteRows(bom, 'pre');
  assert.equal(rows[0].supplyAmt, 3800);
  assert.equal(JSON.stringify(bom), before);
  assert.deepEqual(quoteRate(bom, 'pre'), { quoteCurrency: 'CNY', quoteRate: 190 });
});

test('USD quotation calculation and printed exchange rate agree in each phase', () => {
  const bom = { currency: 'USD', preCurrency: 'USD', exchangeRateUsd: 1400,
    preExchangeRateUsd: 1350, lines: [line], postMaterials: [line], postProcessLines: [] };
  assert.equal(buildQuoteRows(bom, 'pre')[0].supplyAmt, 27000);
  assert.equal(buildQuoteRows(bom, 'post')[0].supplyAmt, 28000);
  assert.deepEqual(quoteRate(bom, 'pre'), { quoteCurrency: 'USD', quoteRate: 1350 });
  assert.deepEqual(quoteRate(bom, 'post'), { quoteCurrency: 'USD', quoteRate: 1400 });
});

test('domestic KRW costs are not converted', () => {
  const bom = { currency: 'KRW', lines: [line], postProcessLines: [] };
  assert.equal(buildQuoteRows(bom, 'pre')[0].supplyAmt, 20);
  assert.deepEqual(quoteRate(bom, 'pre'), { quoteCurrency: 'KRW', quoteRate: 1 });
});

test('CNY is not offered for new cost entry or factory uploads', () => {
  assert.match(source, /const CURRENCY_OPTIONS = \['USD', 'KRW'\]/);
  assert.doesNotMatch(source, /SelectItem value="CNY" className/);
  assert.match(source, /value="CNY" disabled/);
});

test('item upload applies USD only to the selected phase, preserving historical CNY', () => {
  const itemSource = readFileSync(new URL('../pages/ItemMaster.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(itemSource, /<option value="CNY">/);
  const start = itemSource.indexOf("    if (costSheetMode === 'pre') {");
  const end = itemSource.indexOf('    const { totalCostKrw, factoryUnitCostKrw }', start);
  assert.ok(start > 0 && end > start);
  const apply = new Function('bom', 'costSheetMode', 'costSheetCurrency', 'exchangeRateCny', 'store',
    itemSource.slice(start, end));
  const bom = { currency: 'CNY', exchangeRateCny: 190, snapshotCnyKrw: 190, preCurrency: 'CNY' };
  apply(bom, 'pre', 'USD', 1400, { getSettings: () => settings });
  assert.equal(bom.currency, 'CNY');
  assert.equal(bom.exchangeRateCny, 190);
  assert.equal(bom.snapshotCnyKrw, 190);
  assert.equal(bom.preCurrency, 'USD');
  assert.equal((bom as any).preExchangeRateUsd, 1400);
});
