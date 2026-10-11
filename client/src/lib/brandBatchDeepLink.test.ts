import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const page = readFileSync(new URL('../pages/BrandOrders.tsx', import.meta.url), 'utf8');
// Execute the actual effect body with injected state setters, not a browser test.
const effect = page.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[requestedBatch, batches, brandReadError, brandLoaded, brandLoading\]\);/)![1];
const run = new Function('requestedBatch', 'openedBatch', 'brandReadError', 'brandLoaded', 'brandLoading', 'batches', 'setMainTab', 'setSelected', 'toast', effect);
test('비서실 원본 링크는 조회 완료 후 작성·승인 탭과 지정 묶음을 연다', () => {
  let tab = '', selected: any;
  run('b', { current: null }, false, true, false, [{ id: 'b' }], (v: string) => { tab = v; }, (v: any) => { selected = v; }, { warning: () => { throw new Error('not missing'); } });
  assert.equal(tab, 'approval'); assert.equal(selected.id, 'b');
});
test('다른 브랜드·삭제된 원본은 안내하고 로딩 중에는 없음으로 오판하지 않는다', () => {
  let warnings = 0;
  const toast = { warning: () => { warnings++; } };
  run('missing', { current: null }, false, true, false, [], () => {}, () => {}, toast);
  assert.equal(warnings, 1);
  run('missing', { current: null }, false, true, true, [], () => {}, () => {}, toast);
  assert.equal(warnings, 1);
});
