import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export async function verifyStockBrowserWorkflow({ client, page, reportContext }) {
  assert.equal(process.env.ERP_BROWSER_ISOLATED, '20261010');
  assert.equal(process.env.POSTGREST_URL, 'http://127.0.0.1:4192');
  const settings = await client.query("SELECT current_database() AS db,current_setting('port') AS port");
  assert.deepEqual(settings.rows[0], { db: 'erp_e2e', port: '4191' });
  const key = 'stock_ui_' + crypto.randomBytes(5).toString('hex');
  for (const [id, ws] of [[key, 'OEM'], [key + '_cn', 'LUMEN']]) await client.query(`INSERT INTO production_orders(id,order_no,style_no,style_name,workspace,quantity,color_qtys,status)
    VALUES($1,$1,$1,'격리 입출고 시험',$2,10,'[{"color":"BLACK","qty":10}]','생산중')`, [id, ws]);
  const click = async (text, selector = 'button') => {
    await page.bringToFront();
    await page.waitForFunction((text, selector) => [...document.querySelectorAll(selector)].some(b => b.textContent.trim() === text && !b.disabled), {}, text, selector);
    await page.evaluate((text, selector) => [...document.querySelectorAll(selector)].find(b => b.textContent.trim() === text && !b.disabled).click(), text, selector);
  };
  const fill = async (label, value) => page.evaluate(({ label, value }) => {
    const scope = document.querySelector('[role="dialog"]');
    const el = [...scope.querySelectorAll('label')].find(l => l.textContent.trim() === label);
    const input = el.htmlFor ? document.getElementById(el.htmlFor) : el.parentElement.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { label, value });
  const save = async (text, suffix) => {
    const response = page.waitForResponse(r => r.url().endsWith(suffix) && r.request().method() === 'POST');
    await click(text, '[role="dialog"] button'); assert.equal((await response).status(), 200);
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  };
  const rowButton = async text => page.evaluate(({ key, text }) => {
    const row = [...document.querySelectorAll('main tr')].find(r => r.querySelector('td')?.textContent.trim() === key);
    [...row.querySelectorAll('button')].find(b => b.textContent.trim() === text).click();
  }, { key, text });
  await page.bringToFront(); await page.goto('https://localhost:4189/receiving?ws=OEM');
  await page.waitForFunction(key => [...document.querySelectorAll('main tr')].some(r => r.textContent.includes(key)), {}, key);
  await rowButton('입고'); await page.waitForSelector('[role="dialog"]'); await fill('수량', 4);
  console.log('STOCK UI receipt filled');
  await save('저장', '/api/orders/' + key + '/receive');
  await rowButton('OEM출고'); await page.waitForSelector('[role="dialog"]'); await fill('수량', 2);
  console.log('STOCK UI shipment filled');
  await save('저장', '/api/orders/' + key + '/ship');
  await page.reload();
  await page.waitForFunction(key => document.querySelector('main')?.textContent.includes(key), {}, key);
  const order = (await client.query('SELECT received_qty,shipped_qty FROM production_orders WHERE id=$1', [key])).rows[0];
  assert.equal(order.received_qty, 4); assert.equal(order.shipped_qty, 2);
  const logs = await client.query('SELECT log_type,qty FROM receipt_logs WHERE order_id=$1 ORDER BY log_type', [key]);
  assert.deepEqual(logs.rows, [{ log_type: 'inbound', qty: 4 }, { log_type: 'outbound_oem', qty: 2 }]);
  const facts = (await reportContext()).watch.get('물류·CS').facts;
  assert.ok(facts.some(f => f.includes('id=' + key) && f.includes('정상품 출고 잔량 2') && f.includes('주문 대비 미출고 8')));
  // Initial China stock enters through the actual receiving API, not manual adjustment.
  const receipt = await page.evaluate(async key => {
    const r = await fetch('/api/orders/' + key + '_cn/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: key + '_cn_in', qty: 10, defectQty: 0, receivedDate: '2026-10-11', createPayable: false, disposition: 'deduct', destination: 'china', color: 'BLACK' }) });
    return r.status;
  }, key);
  assert.equal(receipt, 200);
  await page.goto('https://localhost:4189/china-stock?ws=LUMEN');
  await page.waitForFunction(key => document.querySelector('main')?.textContent.includes(key + '_cn'), {}, key);
  await click('출고', 'main tbody button'); await page.waitForSelector('[role="dialog"]');
  await page.click('[role="dialog"] input[type="checkbox"]'); await fill('수량', 4);
  await save('한국 이동 확정', '/api/inventory/china/transfer');
  const transfer = (await client.query('SELECT * FROM china_stock_transfers WHERE style_no=$1', [key + '_cn'])).rows[0];
  assert.equal(Number(transfer.qty), 4); assert.equal(transfer.status, 'in_transit');
  for (const n of [1, 2]) {
    await click('한국 도착 기록', 'main button'); await page.waitForSelector('#cn-arrival-qty');
    await fill('이번 도착 수량', 2); await fill('3PL 입고증·이지 입고이력 번호', 'TEST-3PL-' + n);
    await save('도착 수량 저장', '/api/inventory/china/transfer');
    await page.reload();
    await page.waitForFunction(key => document.querySelector('main')?.textContent.includes(key + '_cn'), {}, key);
    const t = (await client.query('SELECT received_qty,status FROM china_stock_transfers WHERE id=$1', [transfer.id])).rows[0];
    assert.equal(Number(t.received_qty), n * 2); assert.equal(t.status, n === 1 ? 'in_transit' : 'received');
  }
  assert.equal((await client.query('SELECT count(*)::int AS n FROM china_stock_arrivals WHERE transfer_id=$1', [transfer.id])).rows[0].n, 2);
  const balance = (await client.query("SELECT sum(CASE WHEN move_type='outbound' THEN -qty ELSE qty END)::int AS n FROM china_stock_moves WHERE style_no=$1", [key + '_cn'])).rows[0].n;
  assert.equal(balance, 6);
  return { status: 'PASS', receiving: 'Actual UI partial receipt 4 and OEM shipment 2, reload and real DB logs',
    secretary: 'Unshipped stock 2 and order unshipped 8 reach original report context', china: 'Actual UI sends 4 then records two arrivals of 2; physical China stock stays 6',
    limits: ['Synthetic orders seeded, China initial receipt through API', 'No external 3PL/EZ write; arrival proof synthetic', 'No real buyer billing or financial data'] };
}
