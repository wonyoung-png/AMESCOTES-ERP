// 실제 업무 페이지/캐시/저장 요청을 격리 브라우저에서 검사한다. HTTP 응답만 모의 처리한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

test('실제 미수 화면: 저장 실패·재시도·중복 클릭·수금 후 자금계획 연결', async () => {
  const bundle = await build({ stdin: { contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { Toaster } from 'sonner';
    import Settlement from './client/src/pages/SettlementManagement';
    import CashPlan from './client/src/pages/CashPlan';
    function App() { const [cash, setCash] = useState(true); return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <button id="cash" onClick={()=>setCash(true)}>자금계획 보기</button>
      <button id="settlement" onClick={()=>setCash(false)}>미수 보기</button>
      {cash ? <CashPlan /> : <Settlement />}<Toaster />
    </QueryClientProvider>; }
    createRoot(document.getElementById('root')).render(<App />);
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const date = new Date();
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const stale = { id: 'synthetic_stale', buyerName: 'STALE_BALANCE', channel: '기타', invoiceDate: `${month}-01`, dueDate: `${month}-20`,
    billedAmountKrw: 1000, collectedAmountKrw: 400, status: '완납', createdAt: date.toISOString() };
  const requests: any[] = [];
  const rows: any[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (req.url?.startsWith('/rest/v1/')) { res.end(JSON.stringify(req.url.includes('/settlements') ? rows : [])); return; }
    if (req.url === '/api/payables') { res.end(JSON.stringify({ items: [] })); return; }
    if (req.url === '/api/settlements/save') {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
      await new Promise(resolve => setTimeout(resolve, 180));
      if (requests.length === 1) { res.statusCode = 503; res.end(JSON.stringify({ message: 'SYNTHETIC_SAVE_FAILURE' })); return; }
      const s = body.settlement;
      const row = { id: s.id, buyer_name: s.buyerName, channel: s.channel, invoice_no: s.invoiceNo || null,
        invoice_date: s.invoiceDate, due_date: s.dueDate, billed_amount_krw: s.billedAmountKrw,
        collected_amount_krw: s.collectedAmountKrw, collected_date: s.collectedDate || null,
        status: s.status, created_at: s.createdAt, memo: s.memo || null };
      const index = rows.findIndex(r => r.id === row.id);
      if (index < 0) rows.push(row); else rows[index] = row;
      res.end(JSON.stringify({ result: { settlement: row, statement: null } })); return;
    }
    if (req.url === '/' || req.url?.startsWith('/favicon')) {
      res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/fixture.js"></script>'); return;
    }
    res.statusCode = 500; res.end(JSON.stringify({ message: 'Unexpected test endpoint' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
  const browser = await puppeteer.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
  try {
    const page = await browser.newPage();
    const errors: string[] = []; const unexpected: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith(`http://127.0.0.1:${address.port}/`) || request.url().startsWith('data:image/')) void request.continue();
      else { unexpected.push(request.url()); void request.abort(); }
    });
    await page.evaluateOnNewDocument((s) => {
      localStorage.setItem('ames_settlements', JSON.stringify([s]));
      localStorage.setItem('ames_trade_statements', '[]'); localStorage.setItem('ames_vendors', '[]');
    }, stale);
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.click('#cash');
    await page.waitForFunction(() => document.body.textContent?.includes('STALE_BALANCE'), { timeout: 5000 }).catch(async error => {
      throw new Error(`${error}: ${JSON.stringify(errors)} | ${(await page.evaluate(() => document.body.textContent))?.slice(0, 1200)}`);
    });
    await page.click('#settlement');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('정산 등록') && !b.disabled));
    const clickText = async (text: string, scope = 'body') => {
      const button = await page.evaluateHandle((text, scope) => [...document.querySelectorAll(`${scope} button`)].find(b => b.textContent?.trim() === text), text, scope);
      const element = button.asElement(); assert.ok(element, `missing button: ${text}`); await element.click(); await button.dispose();
    };
    await clickText('정산 등록');
    await page.waitForSelector('[role="dialog"]');
    await page.type('input[placeholder="바이어명 직접 입력"]', 'SYNTHETIC_BUYER');
    await page.evaluate((due) => {
      const input = document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="date"]')[1];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, due);
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    }, `${month}-25`);
    const numbers = await page.$$('[role="dialog"] input[type="number"]');
    await numbers[0].type('1000');
    await clickText('등록', '[role="dialog"]');
    await page.waitForFunction(() => document.body.textContent?.includes('SYNTHETIC_SAVE_FAILURE'));
    assert.equal(requests.length, 1); assert.equal(rows.length, 0);
    assert.ok(await page.$('[role="dialog"]'));
    await clickText('등록', '[role="dialog"]');
    await page.waitForFunction(() => document.querySelector('[role="dialog"] fieldset')?.hasAttribute('disabled'));
    await clickText('저장 중…', '[role="dialog"]');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    assert.equal(requests.length, 2); assert.equal(requests[0].settlement.id, requests[1].settlement.id);
    assert.equal(rows.length, 1);
    await clickText('수금완료', 'table');
    await page.waitForFunction(() => document.body.textContent?.includes('수금 내역과 연결 명세표 상태가 저장되었습니다'));
    assert.equal(requests.length, 3); assert.equal(rows[0].collected_amount_krw, 1000);
    assert.equal(requests[2].expected.collected_amount_krw, 0);
    await page.click('#cash');
    await page.waitForFunction(() => document.body.textContent?.includes('자금 잔액 시뮬레이션'));
    assert.equal(await page.evaluate(() => document.body.textContent?.includes('SYNTHETIC_BUYER')), false);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  } finally {
    await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
