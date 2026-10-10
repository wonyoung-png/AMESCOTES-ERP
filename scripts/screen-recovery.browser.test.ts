import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';

test('격리 브라우저: 로딩/오류 시 메뉴 유지, 새로고침 취소, 다른 경로 복구', async () => {
  const bundled = await build({
    stdin: { contents: `
      import React, { lazy } from 'react';
      import { createRoot } from 'react-dom/client';
      import { useLocation, useSearch } from 'wouter';
      import RouteContent from './client/src/components/RouteContent';
      const Broken = lazy(() => new Promise((_, reject) => setTimeout(() => reject(new TypeError('Failed to fetch dynamically imported module: /assets/old.js')), 600)));
      function Healthy() { return <section><h1>정상 업무 화면</h1><input id="page-draft" aria-label="업무 입력" /></section>; }
      function Harness() {
        const [path, navigate] = useLocation();
        const search = useSearch();
        return <main><nav><button id="go" onClick={() => navigate('/broken?view=fail')}>실패 화면</button><button id="query" onClick={() => navigate('/broken?view=ok')}>같은 메뉴 다른 보기</button><button id="query2" onClick={() => navigate('/broken?view=ok2')}>정상 보기 변경</button><button id="home" onClick={() => navigate('/')}>대시보드</button></nav>
          <input id="draft" aria-label="셸 입력" defaultValue="" />
          <RouteContent>{path === '/broken' && !search.startsWith('view=ok') ? <Broken /> : <Healthy />}</RouteContent>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<Harness />);
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const server = createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundled.outputFiles[0].text);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<div id="root"></div><script type="module" src="/fixture.js"></script>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
    const page = await browser.newPage();
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForSelector('#draft');
    await page.type('#draft', '저장하지 않은 입력');
    await page.click('#go');
    await page.waitForSelector('[role="status"]');
    assert.equal(await page.$eval('#draft', el => (el as HTMLInputElement).value), '저장하지 않은 입력');
    await page.waitForFunction(() => document.body.textContent?.includes('업무 화면을 불러오지 못했습니다.'));
    assert.ok(await page.$('#home'));
    assert.equal(await page.$eval('#draft', el => (el as HTMLInputElement).value), '저장하지 않은 입력');
    const documentLoads = requests.filter(url => url.endsWith('/')).length;
    const cancelled = new Promise<void>(resolve => page.once('dialog', async dialog => {
      assert.match(dialog.message(), /저장하지 않은 입력/);
      await dialog.dismiss(); resolve();
    }));
    await page.click('button[aria-label="화면 새로 불러오기"]');
    await cancelled;
    assert.equal(requests.filter(url => url.endsWith('/')).length, documentLoads);
    assert.equal(await page.$eval('#draft', el => (el as HTMLInputElement).value), '저장하지 않은 입력');
    await page.click('#query');
    await page.waitForFunction(() => document.body.textContent?.includes('정상 업무 화면'));
    await page.type('#page-draft', '업무 폼 입력');
    await page.click('#query2');
    await page.waitForFunction(() => location.search === '?view=ok2');
    assert.equal(await page.$eval('#page-draft', el => (el as HTMLInputElement).value), '업무 폼 입력');
    await page.click('#go');
    await page.waitForFunction(() => document.body.textContent?.includes('업무 화면을 불러오지 못했습니다.'));
    await page.click('#home');
    await page.waitForFunction(() => document.body.textContent?.includes('정상 업무 화면'));
    assert.equal(await page.$eval('#draft', el => (el as HTMLInputElement).value), '저장하지 않은 입력');
    assert.ok(requests.every(url => url.startsWith(`http://127.0.0.1:${address.port}/`)));
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
