import test from 'node:test';
import assert from 'node:assert/strict';
import { validReceipt } from './receipt-workflow.js';

test('receipt input rejects malformed quantity, date and disposition', () => {
  const v = { id: 'rcp_test', orderId: 'test', qty: 10, defectQty: 2, receivedDate: '2026-10-09', createPayable: true, disposition: 'deduct' };
  assert.equal(validReceipt(v), true);
  for (const patch of [{ qty: 0 }, { qty: 1.1 }, { qty: Infinity }, { qty: '10' }, { qty: 2147483648 },
    { defectQty: -1 }, { defectQty: 11 }, { receivedDate: '2026-02-30' }, { createPayable: 'true' },
    { disposition: 'unknown' }, { id: '' }, { memo: {} }, { isAdvance: 'false' }]) {
    assert.equal(validReceipt({ ...v, ...patch }), false);
  }
});
