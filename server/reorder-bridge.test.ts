import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderDraft } from './reorder-bridge';

test('리오더 참조 ID가 브랜드별로 고정되어 재시도 중복을 막는다', () => {
  const source = { id: 1, kind: '리오더', status: '초안', sku: 'SKU', qty: 20 };
  const a = reorderDraft(source, 'LUMEN', { style_no: 'STYLE' }, '대표');
  assert.equal(a.id, reorderDraft(source, 'LUMEN', { style_no: 'STYLE' }, '대표').id);
  assert.notEqual(a.id, reorderDraft(source, 'AETALOOF', { style_no: 'STYLE' }, '대표').id);
  assert.equal(a.qty, 20);
  assert.equal(a.style_no, 'STYLE');
});

test('기존 확정 발주·B2B 납품·비정상 수량은 신규 생산 의뢰로 중복 생성하지 않는다', () => {
  const source = { id: 1, kind: '리오더', status: '초안', qty: 20 };
  for (const patch of [{ kind: 'B2B 납품' }, { status: '확정' }, { qty: -1 }, { qty: 1.5 }]) {
    assert.throws(() => reorderDraft({ ...source, ...patch }, 'LUMEN', { style_no: 'S' }, '대표'));
  }
});
