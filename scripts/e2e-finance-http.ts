import assert from 'node:assert/strict';
import { buildMonthlyCashPlan } from '../client/src/lib/cashPlan';

// Real session/router/PostgREST/SQL path. Only the isolated harness calls this.
export async function verifyFinanceHttp(base: string, fixture: { bossEmail: string; password: string }) {
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.bossEmail, password: fixture.password }) });
  assert.equal(login.status, 200, 'finance login failed');
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.ok(cookie.startsWith('erp_token='));
  const call = async (path: string, body?: unknown, status = 200, method?: string): Promise<any> => {
    const r = await fetch(base + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Cookie: cookie, 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await r.text();
    assert.equal(r.status, status, `${path}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  assert.equal((await call('/api/session')).user.email, fixture.bossEmail);
  const wrong = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.bossEmail, password: 'wrong' }) });
  assert.equal(wrong.status, 401);
  assert.equal((await fetch(base + '/api/orders/e2e_order/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  const today = '2026-10-10';
  await call('/rest/v1/vendors', { id: 'e2e_buyer', name: 'ISOLATED E2E BUYER', code: 'E2E_BUYER' }, 201);
  await call('/rest/v1/items', { id: 'e2e_item', style_no: 'E2E_ITEM', name: 'ISOLATED E2E ITEM', delivery_price: 1500 }, 201);
  await call('/rest/v1/production_orders', { id: 'e2e_order', order_no: 'E2E_ORDER', quantity: 100, status: '생산중', buyer_id: 'e2e_buyer', style_id: 'e2e_item', style_no: 'E2E_ITEM', workspace: 'OEM', project_no: 'E2E_PROJECT', factory_unit_price_krw: 1000 }, 201);
  const input = { id: 'e2e_in_1', qty: 60, defectQty: 0, receivedDate: today, createPayable: true, disposition: 'deduct', destination: 'korea' };
  const receipt = (await call('/api/orders/e2e_order/receive', input)).result;
  assert.equal(Number(receipt.payable.amount_krw), 60000);
  await call('/api/orders/e2e_order/receive', input);
  await call('/api/orders/e2e_order/receive', { ...input, qty: 61 }, 409);
  await call('/api/orders/e2e_order/receive', { ...input, id: 'e2e_in_2', qty: 40 });
  await call('/api/orders/e2e_order/receive', { ...input, id: 'e2e_over_in', qty: 1 }, 409);
  const shipInput = { id: 'e2e_out_1', qty: 100, logType: 'outbound_oem', deliveryMarket: 'b2b', receivedDate: today };
  const shipped = (await call('/api/orders/e2e_order/ship', shipInput)).result;
  const statement = shipped.statement;
  assert.ok(statement?.id);
  await call('/api/orders/e2e_order/ship', shipInput);
  await call('/api/orders/e2e_order/ship', { ...shipInput, id: 'e2e_over_ship', qty: 1 }, 409);
  const rows = await call('/rest/v1/production_orders?id=eq.e2e_order');
  assert.equal(Number(rows[0].received_qty), 100);
  assert.equal(Number(rows[0].shipped_qty), 100);
  assert.equal(rows[0].trade_statement_id, statement.id);
  const billing = { statement: { id: statement.id, statementNo: statement.statement_no, vendorId: 'e2e_buyer', vendorName: 'ISOLATED E2E BUYER', vendorCode: 'E2E_BUYER', workspace: 'OEM', projectNo: 'E2E_PROJECT', issueDate: today, status: '청구완료', lines: statement.lines }, invoiceDate: today, expectedUpdatedAt: statement.updated_at };
  const billed = (await call('/api/statements/save-billing', billing)).result;
  const settlement = billed.settlement;
  assert.equal(Number(settlement.billed_amount_krw), 165000);
  assert.equal(settlement.invoice_no, statement.statement_no);
  await call('/api/statements/save-billing', billing); // Same request: not a second receivable.
  const collection = { id: settlement.id, buyerId: settlement.buyer_id, buyerName: settlement.buyer_name, workspace: 'OEM', projectNo: 'E2E_PROJECT', channel: settlement.channel, invoiceNo: settlement.invoice_no, invoiceDate: settlement.invoice_date, dueDate: settlement.due_date, billedAmountKrw: 165000, collectedAmountKrw: 50000, collectedDate: today };
  const partial = (await call('/api/settlements/save', { settlement: collection, expected: settlement })).result;
  assert.equal(partial.statement.status, '청구완료');
  assert.equal(Number(partial.settlement.collected_amount_krw), 50000);
  const assertForecast = async (expected: number) => {
    const persisted = await call('/rest/v1/settlements?project_no=eq.E2E_PROJECT');
    const mapped = persisted.map((r: any) => ({ dueDate: r.due_date, billedAmountKrw: Number(r.billed_amount_krw), collectedAmountKrw: Number(r.collected_amount_krw) }));
    const months = buildMonthlyCashPlan(mapped as any, [], [], new Date('2026-10-01T12:00:00Z'), 12);
    assert.equal(months.reduce((n, m) => n + m.confirmedIncoming, 0), expected, 'Persisted receivable -> monthly cash plan');
  };
  await assertForecast(115000);
  await call('/api/settlements/save', { settlement: { ...collection, memo: 'other writer' }, expected: settlement }, 409);
  await call('/api/payables/pay_e2e_in_1/payment', { amount: 20000, expectedPaid: 0 });
  await call('/api/payables/pay_e2e_in_1/payment', { amount: 20000, expectedPaid: 0 }, 409);
  assert.equal(Number((await call('/api/payables')).items.find((r: any) => r.id === 'pay_e2e_in_1').paid_amount_krw), 20000);
  await call('/api/payables/pay_e2e_in_1/payment', { amount: 10000, expectedPaid: 0 }, 409);
  const full = (await call('/api/settlements/save', { settlement: { ...collection, collectedAmountKrw: 165000 }, expected: partial.settlement })).result;
  assert.equal(full.statement.status, '수금완료');
  assert.equal(full.settlement.status, '완납');
  assert.equal(Number(full.settlement.billed_amount_krw) - Number(full.settlement.collected_amount_krw), 0);
  await assertForecast(0);
  await call('/api/payables/pay_e2e_in_1/payment', { amount: 40000, expectedPaid: 20000 });
  await call('/api/payables/pay_e2e_in_2/payment', { amount: 40000, expectedPaid: 0 });
  const payables = (await call('/api/payables')).items;
  const ownPayables = payables.filter((r: any) => r.order_id === 'e2e_order');
  assert.equal(ownPayables.length, 2);
  assert.equal(ownPayables.reduce((n: number, r: any) => n + Number(r.amount_krw) - Number(r.paid_amount_krw), 0), 0);
  assert.equal((await call('/rest/v1/trade_statements?project_no=eq.E2E_PROJECT')).length, 1);
  assert.equal((await call('/rest/v1/settlements?project_no=eq.E2E_PROJECT')).length, 1);
  await call('/api/logout', {});
  return { realHttp: true, realDatabase: true, authentication: true, orderReceiptShipmentBillingCollectionPayment: true, persistedReceivablesToCashPlan: true, retryAndStaleGuards: true, finalBalances: 0 };
}
