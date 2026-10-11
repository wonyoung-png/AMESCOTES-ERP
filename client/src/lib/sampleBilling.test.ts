import assert from 'node:assert/strict';
import test from 'node:test';
import { billSampleGroups } from './sampleBilling';
import type { Sample, TradeStatement, Vendor } from './store';

test('bulk sample billing reuses one saved statement after partial sample-link failure and next-day retry', async () => {
  const rows = ['one', 'two', 'three'].map(id => ({ id, buyerId: 'buyer', styleNo: id, styleName: id, stage: '1차', costKrw: 100 } as Sample));
  const statements: TradeStatement[] = [], linked: Sample[] = [];
  let fail = true;
  const deps = { statements: async () => [...statements], saveStatement: async (s: TradeStatement) => { statements.push(s); return s; },
    saveSample: async (s: Sample) => { if (s.id === 'two' && fail) { fail = false; throw Error('link failed'); } linked.push(s); } };
  await assert.rejects(billSampleGroups(rows, [{ id: 'buyer', name: 'Synthetic' } as Vendor], '2026-10-11', 190, deps), /link failed/);
  assert.equal(statements.length, 1); assert.equal(linked.length, 1);
  await billSampleGroups(rows.slice(1), [], '2026-10-12', 190, deps);
  assert.equal(statements.length, 1); assert.equal(statements[0].lines.length, 3);
  assert.equal(linked.length, 3);
  assert.ok(linked.every(s => s.billingStatementId === statements[0].id && s.billingDate === '2026-10-11'));
});
test('buyerless sample billing is rejected before any statement save', async () => {
  let writes = 0;
  await assert.rejects(billSampleGroups([{ id: 's' } as Sample], [], '2026-10-11', 190, {
    statements: async () => [], saveStatement: async s => { writes++; return s; }, saveSample: async () => { writes++; },
  }), /바이어 미지정/);
  assert.equal(writes, 0);
});
