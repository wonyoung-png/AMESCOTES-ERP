import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('./PayablesManagement.tsx', import.meta.url), 'utf8');
const phase = readFileSync(new URL('../lib/phase1.ts', import.meta.url), 'utf8');
const labelBody = phase.match(/export const DEFECT_DISPOSITION_LABEL[^=]*=\s*(\{[\s\S]*?\n\});/);
assert.ok(labelBody, '실제 처리 라벨을 추출해야 합니다');
const labels = vm.runInNewContext('(' + labelBody[1] + ')');
const expression = page.match(/\{(\(d\.disposition && DEFECT_DISPOSITION_LABEL\[d\.disposition\]\) \|\| '[^']+')\}/);
assert.ok(expression, '실제 화면의 처리 라벨 표현식을 추출해야 합니다');
const render = new Function('d', 'DEFECT_DISPOSITION_LABEL', 'return ' + expression[1]);

test('과거 불량의 미선택 처리는 차감으로 간주하지 않는다', () => {
  for (const disposition of [undefined, null, '', 'unknown']) {
    const row = { disposition };
    assert.equal(render(row, labels), '미확정 · 처리 선택 필요');
    assert.equal(row.disposition, disposition, '화면 표시가 과거 선택값을 변경하면 안 됩니다');
  }
  assert.doesNotMatch(page, /d\.disposition\s*\|\|\s*'deduct'/);
});

test('명시적으로 선택한 처리만 해당 라벨과 차감 확정 버튼을 사용한다', () => {
  for (const disposition of ['deduct', 'rework', 'repair']) {
    assert.equal(render({ disposition }, labels), labels[disposition]);
  }
  assert.match(page, /d\.disposition === 'deduct'\s*\n\s*\? 'border-/);
  assert.match(page, /d\.status === 'pending' && d\.disposition === 'deduct' && <Button/);
});
