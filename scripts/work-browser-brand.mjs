import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Actual approval/issue/OEM UI, with synthetic draft fixtures in the isolated DB.
export async function verifyBrandBrowserWorkflow({ client, boss, staff, production, reportContext }) {
  assert.equal(process.env.ERP_BROWSER_ISOLATED, '20261010');
  assert.equal(process.env.POSTGREST_URL, 'http://127.0.0.1:4192');
  const settings = await client.query("SELECT current_setting('port') AS port,current_database() AS db");
  assert.deepEqual(settings.rows[0], { port: '4191', db: 'erp_e2e' });
  const prefix = 'browser_brand_' + crypto.randomBytes(6).toString('hex');
  const batch = prefix + '_lumen', other = prefix + '_aeta', factory = prefix + '_factory';
  await client.query('INSERT INTO vendors(id,name,type) VALUES($1,$2,$3)', [factory, '격리 시험 공장', '공장']);
  for (const [id, ws, title] of [[batch, 'LUMEN', 'E2E 루멘 생산 의뢰'], [other, 'AETALOOF', 'E2E 타브랜드 비공개 의뢰']]) {
    await client.query('INSERT INTO brand_order_batches(id,workspace,project_no,title,status) VALUES($1,$2,$1,$3,\'draft\')', [id, ws, title]);
    await client.query(`INSERT INTO brand_order_lines(id,batch_id,style_no,style_name,factory_id,factory_name,qty,color_qtys,route)
      VALUES($1,$2,$3,'격리 시험 토트',$4,'격리 시험 공장',10,'[{"color":"BLACK","qty":10}]','oem')`, [id + '_line', id, id + '_sku', factory]);
  }
  const request = (page, endpoint, body) => page.evaluate(async ({ endpoint, body }) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
    return { status: response.status, data: await response.json() };
  }, { endpoint, body });
  const click = async (page, text) => {
    await page.bringToFront();
    await page.waitForFunction(text => [...document.querySelectorAll('main button')].some(b => b.textContent.trim() === text && !b.disabled), {}, text);
    await page.evaluate(text => [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === text && !b.disabled).click(), text);
  };
  const source = () => client.query('SELECT status,expected_dely FROM brand_order_batches WHERE id=$1', [batch]);
  const brandFacts = async () => (await reportContext()).watch.get('루멘 디자인').facts.join('\n');
  assert.match(await brandFacts(), /LUMEN 브랜드 생산 의뢰 대표 승인 대기 1건/);
  const open = async page => {
    await page.bringToFront();
    await page.goto('https://localhost:4189/brand-orders?ws=LUMEN&batch=' + batch);
    try { await page.waitForFunction(() => document.querySelector('main h2')?.textContent === 'E2E 루멘 생산 의뢰'); }
    catch (error) {
      console.error('BRAND_OPEN_STATE ' + await page.$eval('body', body => body.textContent));
      throw error;
    }
    const text = await page.$eval('main', main => main.textContent);
    assert.ok(!text.includes('E2E 타브랜드 비공개 의뢰'), 'LUMEN screen must exclude AETALOOF batch');
  };
  await open(staff);
  assert.ok(!(await staff.$eval('main', main => [...main.querySelectorAll('button')].some(b => b.textContent.trim() === '대표 승인'))));
  assert.equal((await request(staff, '/api/brand-batches/' + batch + '/approve')).status, 403);
  assert.equal((await request(staff, '/api/brand-batches/' + batch + '/issue')).status, 409);
  assert.equal((await source()).rows[0].status, 'draft');
  await open(boss);
  const approved = boss.waitForResponse(r => r.url().endsWith('/' + batch + '/approve') && r.request().method() === 'POST');
  await click(boss, '대표 승인');
  assert.equal((await approved).status(), 200);
  await boss.waitForFunction(() => document.querySelector('main')?.textContent.includes('승인 완료 · 발행 대기'));
  assert.equal((await source()).rows[0].status, 'approved');
  assert.match(await brandFacts(), /LUMEN 승인 후 발행 대기 1건 \/ 발행 후 OEM 수주 확인 대기 0건/);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM approval_logs WHERE batch_id=$1', [batch])).rows[0].n, 1);
  await open(staff);
  const issued = staff.waitForResponse(r => r.url().endsWith('/' + batch + '/issue') && r.request().method() === 'POST');
  await click(staff, '발주서 발행');
  assert.equal((await issued).status(), 200);
  await staff.waitForFunction(() => document.querySelector('main')?.textContent.includes('수주함에서 납기 회신 대기'));
  const po = (await client.query('SELECT po_no FROM brand_order_lines WHERE batch_id=$1', [batch])).rows[0].po_no;
  assert.ok(po);
  assert.match(await brandFacts(), /LUMEN 승인 후 발행 대기 0건 \/ 발행 후 OEM 수주 확인 대기 1건/);
  await production.goto('https://localhost:4189/inbound-po?ws=OEM');
  await production.waitForSelector('main input[type="date"]');
  assert.ok((await production.$eval('main', main => main.textContent)).includes(po));
  await production.$eval('main input[type="date"]', input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2026-11-20');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const accepted = production.waitForResponse(r => r.url().endsWith('/' + encodeURIComponent(po) + '/accept') && r.request().method() === 'POST');
  await click(production, '납기 확정 · 생산발주');
  assert.equal((await accepted).status(), 200);
  await production.waitForFunction(() => document.querySelector('main')?.textContent.includes('받을 발주서가 없습니다'));
  const orders = await client.query('SELECT id,workspace,brand_batch_id,project_no,delivery_date::text AS due,quantity FROM production_orders WHERE brand_batch_id=$1', [batch]);
  assert.equal(orders.rows.length, 1);
  const order = orders.rows[0];
  assert.equal(order.workspace, 'OEM'); assert.equal(order.project_no, batch); assert.equal(order.due, '2026-11-20'); assert.equal(order.quantity, 10);
  assert.match(await brandFacts(), /LUMEN 승인 후 발행 대기 0건 \/ 발행 후 OEM 수주 확인 대기 0건/);
  assert.equal((await client.query('SELECT expected_dely::text AS due FROM brand_order_batches WHERE id=$1', [batch])).rows[0].due, '2026-11-20');
  assert.equal((await request(production, '/api/brand-pos/' + encodeURIComponent(po) + '/accept', { dueDate: '2026-11-21' })).data.result.already, true);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM production_orders WHERE brand_batch_id=$1', [batch])).rows[0].n, 1);
  assert.equal((await client.query('SELECT delivery_date::text AS due FROM production_orders WHERE id=$1', [order.id])).rows[0].due, '2026-11-20');
  await open(staff);
  assert.ok((await staff.$eval('main', main => main.textContent)).includes('2026-11-20'));
  await production.reload();
  await production.waitForFunction(() => document.querySelector('main')?.textContent.includes('받을 발주서가 없습니다'));
  const receipt = { id: prefix + '_receipt', qty: 4, defectQty: 0, receivedDate: '2026-10-11', createPayable: false, disposition: 'deduct', color: 'BLACK', destination: 'korea' };
  const endpoint = '/api/orders/' + order.id + '/receive';
  assert.equal((await request(production, endpoint, receipt)).status, 200);
  assert.equal((await request(production, endpoint, receipt)).data.result.retry, true);
  assert.equal((await request(production, endpoint, { ...receipt, qty: 5 })).status, 409);
  assert.equal((await client.query('SELECT received_qty FROM production_orders WHERE id=$1', [order.id])).rows[0].received_qty, 4);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM receipt_logs WHERE order_id=$1', [order.id])).rows[0].n, 1);
  const logistics = (await reportContext()).watch.get('물류·CS').facts;
  assert.ok(logistics.some(fact => fact.includes('id=' + order.id) && fact.includes('정상품 출고 잔량 4')));
  return { status: 'PASS', approval: 'CEO UI + staff API denied', issuance: 'brand staff UI', acceptance: 'OEM production UI',
    deadline: '2026-11-20 on both original batch and generated OEM order, brand UI after reload',
    duplicateAcceptance: 'No duplicate order or changed deadline', brandScreenScope: 'LUMEN screen excludes AETALOOF fixture',
    receipt: 'Real HTTP + DB, quantity 4 persisted once; changed replay rejected',
    secretaryEvidence: 'Real report context updates approval/issuance/acceptance queues and logistics balance from original DB, no duplicate work card',
    limits: ['Synthetic draft seeded directly, not draft-entry screen', 'Receipt screen not exercised', 'Full ERP menu/API authorization matrix not tested'] };
}
