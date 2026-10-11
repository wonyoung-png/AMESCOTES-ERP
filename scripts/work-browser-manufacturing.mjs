import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function verifyManufacturingBrowserWorkflow({ client, page, reportContext, failNextWrite }) {
  assert.equal(process.env.ERP_BROWSER_ISOLATED, '20261010');
  const settings = (await client.query("SELECT current_database() AS db,current_setting('port') AS port")).rows[0];
  assert.deepEqual(settings, { db: 'erp_e2e', port: '4191' });
  const key = 'manufacturing_ui_' + crypto.randomBytes(5).toString('hex');
  const click = async (text, selector = 'main button') => {
    await page.waitForFunction((text, selector) => [...document.querySelectorAll(selector)].some(el => el.textContent.trim() === text && !el.disabled), {}, text, selector);
    await page.evaluate((text, selector) => [...document.querySelectorAll(selector)].find(el => el.textContent.trim() === text && !el.disabled).click(), text, selector);
  };
  const fill = async (selector, value) => page.$eval(selector, (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await client.query("INSERT INTO production_orders(id,order_no,style_no,style_name,workspace,quantity,status) VALUES($1,$1,$1,'합성 자재 연결','OEM',10,'발주생성')", [key]);
  await client.query("INSERT INTO purchase_items(id,order_id,order_no,item_name,qty,purchase_status) VALUES($1,$2,$2,'OTHER MATERIAL',1,'미발주')", [key + '_other', key]);
  await page.bringToFront(); await page.goto('https://localhost:4189/purchase?ws=OEM');
  await click('구매 등록'); await page.waitForSelector('[role="dialog"]');
  await page.$$eval('[role="dialog"] button[role="combobox"]', els => els[0].click());
  await click(key + ' — 합성 자재 연결', '[role="option"]');
  await fill('[role="dialog"] input[placeholder="예: 황동 버클 20mm"]', key + '_lining');
  await fill('[role="dialog"] input[placeholder="EA, m, kg"]', 'm');
  await fill('[role="dialog"] input[type="number"]', 2.5);
  const saved = page.waitForResponse(r => r.url().includes('/rest/v1/purchase_items') && r.request().method() === 'POST');
  await click('등록', '[role="dialog"] button'); assert.ok((await saved).ok());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const purchase = (await client.query('SELECT id,qty FROM purchase_items WHERE item_name=$1', [key + '_lining'])).rows[0];
  assert.equal(Number(purchase.qty), 2.5);
  // Expand the production-order group, then use the actual row status menu.
  await page.evaluate(key => [...document.querySelectorAll('main tr')].find(r => r.querySelector('td[colspan="10"]') && r.textContent.includes(key)).click(), key);
  const change = async status => {
    await page.evaluate(key => [...document.querySelectorAll('main tr')].find(r => r.textContent.includes(key + '_lining')).querySelector('button[role="combobox"]').click(), key);
    const response = page.waitForResponse(r => r.url().includes('/rest/v1/purchase_items') && r.request().method() === 'PATCH');
    await click(status, '[role="option"]'); assert.ok((await response).ok());
    await page.waitForFunction((key, status) => [...document.querySelectorAll('main tr')].find(r => r.textContent.includes(key + '_lining'))?.textContent.includes(status), {}, key, status);
  };
  const status = async () => (await client.query('SELECT status FROM production_orders WHERE id=$1', [key])).rows[0].status;
  for (const state of ['발주완료', '입고완료', '발송완료']) await change(state);
  assert.equal(await status(), '발주생성');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM receipt_logs WHERE order_id=$1', [key])).rows[0].n, 0, 'Material status is not a finished-goods receipt');
  await client.query("UPDATE purchase_items SET purchase_status='발송완료' WHERE id=$1", [key + '_other']);
  await page.reload();
  await page.waitForFunction(key => document.querySelector('main')?.textContent.includes(key + '_lining') || [...document.querySelectorAll('main tr')].some(r => r.querySelector('td[colspan="10"]') && r.textContent.includes(key)), {}, key);
  await page.evaluate(key => [...document.querySelectorAll('main tr')].find(r => r.querySelector('td[colspan="10"]') && r.textContent.includes(key)).click(), key);
  await change('입고완료');
  if (failNextWrite) failNextWrite('production_orders');
  const productionSaved = page.waitForResponse(r => r.url().includes('/rest/v1/production_orders') && r.request().method() === 'PATCH');
  await change('발송완료');
  if (failNextWrite) {
    assert.equal((await productionSaved).status(), 500); assert.equal(await status(), '발주생성');
    await page.waitForFunction(() => document.body.textContent.includes('저장·연결 다시 시도'));
    const retried = page.waitForResponse(r => r.url().includes('/rest/v1/production_orders') && r.request().method() === 'PATCH');
    await click('저장·연결 다시 시도'); assert.ok((await retried).ok());
  } else assert.ok((await productionSaved).ok());
  assert.equal(await status(), '생산중');
  assert.match((await reportContext()).watch.get('생산관리').facts.join('\n'), /자재 발주완료·입고 대기/);
  console.log('MANUFACTURING purchase UI persisted, partial-ready guard and write retry PASS');
  await client.query("UPDATE purchase_items SET purchase_status='미발주' WHERE order_id=$1", [key]);
  await client.query("INSERT INTO purchase_items(id,order_id,order_no,item_name,qty,purchase_status) VALUES($1,$2,$2,'THIRD MATERIAL',1,'미발주')", [key + '_third', key]);
  await page.reload();
  await page.waitForFunction(key => [...document.querySelectorAll('main tr')].some(r => r.querySelector('td[colspan="10"]') && r.textContent.includes(key)), {}, key);
  failNextWrite('purchase_items', 1);
  await page.evaluate(key => [...document.querySelectorAll('main tr')].find(r => r.querySelector('td[colspan="10"]') && r.textContent.includes(key)).querySelector('button[role="combobox"]').click(), key);
  const groupFailed = page.waitForResponse(r => r.url().includes('/rest/v1/purchase_items') && r.request().method() === 'PATCH' && r.status() === 500);
  await click('발주완료', '[role="option"]'); await groupFailed;
  await page.waitForFunction(() => !![...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '저장·연결 다시 시도' && !b.disabled));
  assert.equal((await client.query("SELECT count(*)::int AS n FROM purchase_items WHERE order_id=$1 AND purchase_status='발주완료'", [key])).rows[0].n, 1);
  await click('저장·연결 다시 시도');
  await page.waitForFunction(() => ![...document.querySelectorAll('main button')].some(b => b.textContent.trim() === '저장·연결 다시 시도'));
  // Retry resumes the two remaining rows; the first row already succeeded.
  await page.waitForFunction(() => document.body.textContent.includes('2종 → 발주완료'));
  assert.equal((await client.query("SELECT count(*)::int AS n FROM purchase_items WHERE order_id=$1 AND purchase_status='발주완료'", [key])).rows[0].n, 3);
  console.log('MANUFACTURING purchase group second-write failure resumes all remaining rows PASS');

  await client.query("INSERT INTO vendors(id,name,type,brands) VALUES($1,'SYNTHETIC BRANDS','바이어',$2)", [key + '_buyer', JSON.stringify([{ name: 'LUMEN', code: 'AA' }, { name: 'AETALOOF', code: 'BB' }])]);
  const month = new Date().toISOString().slice(0, 7);
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1kAAAAASUVORK5CYII=';
  for (const [suffix, brand, place] of [['_hq', 'AA', '내부개발실'], ['_hq2', 'AA', '내부개발실'], ['_cn', 'AA', '중국공장'], ['_aeta', 'BB', '내부개발실']]) {
    await client.query('INSERT INTO items(id,style_no,name,buyer_id,brand_code) VALUES($1,$1,$1,$2,$3)', [key + suffix, key + '_buyer', brand]);
    await client.query(`INSERT INTO samples(id,style_id,style_no,style_name,buyer_id,brand_code,season,stage,location,request_date,expected_date,billing_status,image_urls)
      VALUES($1,$1,$1,$1,$2,$3,'26SS','1차',$4,$5,$6,'미청구',$7)`, [key + suffix, key + '_buyer', brand, place, month + '-11', month + '-15', [photo]]);
  }
  await page.goto('https://localhost:4189/samples?ws=LUMEN');
  await page.waitForFunction(key => document.querySelector('main')?.textContent.includes(key + '_hq'), {}, key);
  assert.ok(!(await page.$eval('main', el => el.textContent)).includes(key + '_aeta'));
  await click('캘린더'); await click('내부개발실');
  const events = () => page.$$eval('[data-sample-event]', els => els.map(el => ({ id: el.dataset.sampleEvent, text: el.textContent, photo: !!el.querySelector('img') })));
  let shown = await events();
  assert.equal(shown.filter(e => e.id.endsWith('-r')).length, 2); assert.ok(shown.every(e => e.photo && e.text.includes('LUMEN') && !e.id.includes('_cn') && !e.id.includes('_aeta')));
  await click('중국개발실'); shown = await events(); assert.equal(shown.length, 2); assert.ok(shown.every(e => e.id.includes('_cn')));
  await click('내부개발실');
  // Exercise native DOM drag/drop, then confirm using the real date form.
  await page.evaluate(key => {
    const from = document.querySelector(`[data-sample-event="${key}_hq-r"]`), to = document.querySelector('[data-calendar-day="12"]');
    const dataTransfer = new DataTransfer(); from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer })); to.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
  }, key);
  await page.waitForSelector('[role="dialog"] input[type="date"]');
  assert.equal(await page.$eval('[role="dialog"] input[type="date"]', el => el.value), month + '-12');
  if (failNextWrite) failNextWrite('samples');
  await client.query('UPDATE samples SET memo=$2 WHERE id=$1', [key + '_hq', 'concurrent memo preserved']);
  const sampleSaved = page.waitForResponse(r => r.url().includes('/rest/v1/samples') && r.request().method() === 'PATCH');
  await click('날짜 저장', '[role="dialog"] button');
  if (failNextWrite) {
    assert.equal((await sampleSaved).status(), 500);
    await page.waitForFunction(() => document.body.textContent.includes('입력을 유지했습니다'));
    assert.ok(await page.$('[role="dialog"]'));
    const retried = page.waitForResponse(r => r.url().includes('/rest/v1/samples') && r.request().method() === 'PATCH');
    await click('날짜 저장', '[role="dialog"] button'); assert.ok((await retried).ok());
  } else assert.ok((await sampleSaved).ok());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  assert.equal((await client.query("SELECT request_date::text AS day FROM samples WHERE id=$1", [key + '_hq'])).rows[0].day, month + '-12');
  assert.equal((await client.query('SELECT memo FROM samples WHERE id=$1', [key + '_hq'])).rows[0].memo, 'concurrent memo preserved');
  await page.reload(); await click('캘린더'); await click('내부개발실');
  await page.waitForSelector(`[data-calendar-day="12"] [data-sample-event="${key}_hq-r"]`);
  assert.ok(!(await page.$eval('main', el => el.textContent)).includes(key + '_aeta'));
  const sampleFacts = (await reportContext()).watch.get('루멘 디자인').facts.join('\n');
  assert.ok(sampleFacts.includes(key + '_hq') && sampleFacts.includes('접수 ' + month + '-12') && !sampleFacts.includes(key + '_aeta'));
  console.log('MANUFACTURING sample calendar HQ/China brand filtering, photo, drag save retry, DB reload and report PASS');
  // New sample must wait for its item save; a later sample failure reuses that item.
  await click('샘플 접수'); await page.waitForSelector('[role="dialog"]');
  await page.$$eval('[role="dialog"] button[role="combobox"]', els => els[0].click());
  await click('LUMEN', '[role="option"]');
  await page.select('[role="dialog"] select', 'AA');
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] label')].find(el => el.textContent.trim() === '직접 입력').querySelector('input').click());
  await fill('[role="dialog"] input[placeholder="바이어를 선택하면 자동 생성됩니다"]', key + '_new');
  await fill('[role="dialog"] input[placeholder="예: 파니에 쁘띠 백"]', key + '_new');
  failNextWrite('items');
  const itemFailed = page.waitForResponse(r => r.url().includes('/rest/v1/items') && r.request().method() === 'POST');
  await click('접수', '[role="dialog"] button'); assert.equal((await itemFailed).status(), 500);
  await page.waitForFunction(() => document.body.textContent.includes('입력을 유지했습니다') && ![...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === '접수')?.disabled);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM samples WHERE style_no=$1', [key + '_new'])).rows[0].n, 0);
  failNextWrite('samples');
  const sampleFailed = page.waitForResponse(r => r.url().includes('/rest/v1/samples') && r.request().method() === 'POST');
  await click('접수', '[role="dialog"] button'); assert.equal((await sampleFailed).status(), 500);
  await page.waitForFunction(() => !![...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === '접수' && !b.disabled));
  assert.equal((await client.query('SELECT count(*)::int AS n FROM items WHERE style_no=$1', [key + '_new'])).rows[0].n, 1);
  const sampleRetried = page.waitForResponse(r => r.url().includes('/rest/v1/samples') && r.request().method() === 'POST');
  await click('접수', '[role="dialog"] button'); assert.ok((await sampleRetried).ok());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const linked = (await client.query('SELECT s.style_id,i.id FROM samples s JOIN items i ON i.id=s.style_id WHERE s.style_no=$1', [key + '_new'])).rows;
  assert.equal(linked.length, 1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM items WHERE style_no=$1', [key + '_new'])).rows[0].n, 1);
  console.log('MANUFACTURING new sample waits for item, failed item/sample retry keeps one linked record PASS');
  await page.goto('https://localhost:4189/samples?ws=LUMEN');
  await page.waitForFunction(key => [...document.querySelectorAll('main tbody tr')].some(r => r.textContent.includes(key + '_new')), {}, key);
  await page.evaluate(key => [...document.querySelectorAll('main tbody tr')].find(r => r.textContent.includes(key + '_new')).querySelectorAll('button').forEach(b => { if (b.textContent.trim() === '청구하기') b.click(); }), key);
  await page.waitForSelector('[role="dialog"]');
  failNextWrite('samples');
  const billingFailed = page.waitForResponse(r => r.url().includes('/rest/v1/samples') && r.request().method() === 'POST');
  await click('명세표 생성 + 청구완료', '[role="dialog"] button'); assert.equal((await billingFailed).status(), 500);
  await page.waitForFunction(() => !![...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === '명세표 생성 + 청구완료' && !b.disabled));
  const actualSampleId = (await client.query('SELECT id FROM samples WHERE style_no=$1', [key + '_new'])).rows[0].id;
  const statementId = 'sample-statement-' + actualSampleId;
  assert.equal((await client.query('SELECT count(*)::int AS n FROM trade_statements WHERE id=$1', [statementId])).rows[0].n, 1);
  const billingRetried = page.waitForResponse(r => r.url().includes('/rest/v1/samples') && r.request().method() === 'POST');
  await click('명세표 생성 + 청구완료', '[role="dialog"] button'); assert.ok((await billingRetried).ok());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const billed = (await client.query('SELECT billing_status,billing_statement_id FROM samples WHERE id=$1', [actualSampleId])).rows[0];
  assert.equal(billed.billing_status, '청구완료'); assert.equal(billed.billing_statement_id, statementId);
  assert.equal((await client.query('SELECT jsonb_array_length(lines) AS n FROM trade_statements WHERE id=$1', [statementId])).rows[0].n, 1);
  // Only this test-owned synthetic draft is removed. Production is never connected.
  assert.deepEqual((await client.query("SELECT current_database() AS db,current_setting('port') AS port")).rows[0], { db: 'erp_e2e', port: '4191' });
  await client.query("UPDATE samples SET billing_status='미청구',billing_statement_id=NULL WHERE id=$1", [actualSampleId]);
  await client.query('DELETE FROM trade_statements WHERE id=$1', [statementId]);
  console.log('MANUFACTURING synthetic sample billing retry keeps one statement/line, linkage saved, fixture cleaned PASS');
  await page.reload();
  await page.waitForFunction(key => document.querySelector('main')?.textContent.includes(key + '_new'), {}, key);
  const bulk = async () => page.evaluate(() => [...document.querySelectorAll('main button')].find(b => b.textContent.includes('명세표 발행')).click());
  failNextWrite('samples', 1);
  const bulkFailed = page.waitForResponse(r => r.url().includes('/rest/v1/samples') && r.request().method() === 'POST' && r.status() === 500);
  await bulk(); await bulkFailed;
  await page.waitForFunction(() => !![...document.querySelectorAll('main button')].find(b => b.textContent.includes('명세표 발행') && !b.disabled));
  await bulk(); await page.waitForFunction(() => document.body.textContent.includes('샘플 청구 연결 완료'));
  const batches = (await client.query('SELECT id,jsonb_array_length(lines) AS n FROM trade_statements WHERE vendor_id=$1', [key + '_buyer'])).rows;
  assert.equal(batches.length, 1); assert.equal(batches[0].n, 4);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM samples WHERE buyer_id=$1 AND brand_code='AA' AND billing_status='청구완료' AND billing_statement_id=$2", [key + '_buyer', batches[0].id])).rows[0].n, 4);
  assert.equal((await client.query('SELECT billing_status FROM samples WHERE id=$1', [key + '_aeta'])).rows[0].billing_status, '미청구');
  await client.query("UPDATE samples SET billing_status='미청구',billing_statement_id=NULL WHERE buyer_id=$1 AND billing_statement_id=$2", [key + '_buyer', batches[0].id]);
  await client.query('DELETE FROM trade_statements WHERE id=$1', [batches[0].id]);
  console.log('MANUFACTURING bulk sample second-link failure reuses one statement, all four links and other-brand exclusion PASS');
  // Visual evidence uses the compiled production stylesheet, not the unstyled functional wrapper.
  const assets = path.join(process.cwd(), 'dist/public/assets');
  const css = (await fs.readdir(assets)).find(name => /^index-.*\.css$/.test(name));
  assert.ok(css, 'Build production styles before collecting visual evidence');
  await page.goto('https://localhost:4189/samples?ws=LUMEN');
  await page.waitForFunction(key => document.querySelector('main')?.textContent.includes(key + '_hq'), {}, key);
  await click('캘린더');
  await page.waitForSelector('[data-sample-event]');
  await page.addStyleTag({ path: path.join(assets, css) });
  const visuals = [];
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 1000 });
    const file = path.join(process.cwd(), '.codex', `${key}-calendar-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    visuals.push({ width, file });
  }
  await page.setViewport({ width: 1440, height: 1000 });
  return { status: 'PASS', purchase: 'Actual decimal material registration, three status changes, all-materials sent guard, failed production write and safe retry',
    visuals,
    sample: 'Actual HQ/China calendar, brand-specific screen, photos, native drag event/date confirm, failed save retry, reload and original report evidence; new sample/item creation failure retry without duplicate items',
    billing: { status: 'PASS', syntheticStatements: 2, remaining: 0, scope: 'Single and grouped test-only unbilled sample statement failures/retries; removed exact synthetic statements after verification' },
    limits: ['Synthetic seeded production order and four linked samples; new fifth sample through actual UI', 'Native DOM drag events, not physical pointer movement', 'Brand UI filtering is not server permission proof', 'Only synthetic unbilled sample statement, no real finance or settlement', 'Material partial quantities are not supported by current status model'] };
}
