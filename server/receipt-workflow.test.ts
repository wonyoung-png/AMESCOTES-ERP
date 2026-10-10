import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router, { validReceipt, validShipment, validStatementBilling, validSettlement } from './receipt-workflow.js';

test('receipt input rejects malformed quantity, date and disposition', () => {
  const v = { id: 'rcp_test', orderId: 'test', qty: 10, defectQty: 2, receivedDate: '2026-10-09', createPayable: true, disposition: 'deduct' };
  assert.equal(validReceipt(v), true);
  for (const patch of [{ qty: 0 }, { qty: 1.1 }, { qty: Infinity }, { qty: '10' }, { qty: 2147483648 },
    { defectQty: -1 }, { defectQty: 11 }, { receivedDate: '2026-02-30' }, { createPayable: 'true' },
    { disposition: 'unknown' }, { id: '' }, { memo: {} }, { isAdvance: 'false' }, {destination:'unknown'}]) {
    assert.equal(validReceipt({ ...v, ...patch }), false);
  }
});

test('shipment boundary accepts only valid integer quantities, destinations and dates', () => {
  const v = { id: 'shipment_test', orderId: 'test_order', qty: 10, logType: 'outbound_oem', deliveryMarket: 'b2b', receivedDate: '2026-10-10' };
  assert.equal(validShipment(v), true);
  assert.equal(validShipment({ ...v, logType: 'outbound_3pl' }), true);
  for (const patch of [{ qty: 0 }, { qty: 1.1 }, { qty: 2147483648 }, { qty: '10' }, { logType: 'inbound' },
    { deliveryMarket: 'unknown' }, { receivedDate: '2026-02-30' }, { id: '../test' }, { memo: {} }]) {
    assert.equal(validShipment({ ...v, ...patch }), false);
  }
});

test('billing boundary validates statement lines, invoice dates and version types', () => {
  const v = { statement: { id: 'statement_test', vendorId: 'test_buyer', status: '청구완료', issueDate: '2026-10-10',
    lines: [{ description: 'test', qty: 10, unitPrice: 100, taxType: '과세', taxRate: 0.1 }] },
    invoiceDate: '2026-10-10', expectedUpdatedAt: null };
  assert.equal(validStatementBilling(v), true);
  for (const patch of [{ invoiceDate: '2026-02-30' }, { expectedUpdatedAt: {} },
    { statement: { ...v.statement, lines: [] } }, { statement: { ...v.statement, lines: [null] } },
    { statement: { ...v.statement, lines: [{ ...v.statement.lines[0], qty: '10' }] } },
    { statement: { ...v.statement, lines: [{ ...v.statement.lines[0], taxRate: NaN }] } }]) {
    assert.equal(validStatementBilling({ ...v, ...patch }), false);
  }
});

test('shipment and billing APIs reject anonymous requests before writing', async () => {
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  try {
    for (const path of ['/api/orders/test_order/ship', '/api/statements/save-billing', '/api/settlements/save']) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 401);
      await response.arrayBuffer();
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test('settlement boundary rejects negative, excessive, missing date and malformed snapshots', () => {
  const settlement = { id: 'synthetic_settlement', buyerName: 'test', channel: '기타', invoiceDate: '2026-10-10',
    dueDate: '2026-11-10', billedAmountKrw: 1000, collectedAmountKrw: 0 };
  assert.equal(validSettlement({settlement, expected:null}), true);
  for (const patch of [{billedAmountKrw:0},{collectedAmountKrw:-1},{collectedAmountKrw:1001},
    {collectedAmountKrw:300},{billedAmountKrw:Infinity},{dueDate:'2026-02-30'},{buyerName:' '},{channel:'unknown'}]) {
    assert.equal(validSettlement({settlement:{...settlement,...patch}}), false);
  }
  assert.equal(validSettlement({settlement,expected:[]}),false);
  assert.equal(validSettlement({settlement,expected:{id:'wrong'}}),false);
});
