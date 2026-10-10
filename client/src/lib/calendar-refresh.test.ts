import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// Real page + React; all persistence/services are synthetic. No ERP/DB requests.
test('calendar: local refresh, work/campaign events, cross-tab storage and listener cleanup', { timeout: 90000 }, async () => {
  const bundled = await build({
    stdin: { contents: `
      import React, { StrictMode, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import Calendar from './client/src/pages/OperationalCalendar';
      window.fixtureReads = 0;
      window.fixtureListeners = new Map();
      const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
      const watched = ['work:changed', 'campaigns:changed', 'storage'];
      window.addEventListener = (name, handler, ...args) => {
        if (watched.includes(name)) {
          if (!window.fixtureListeners.has(name)) window.fixtureListeners.set(name, new Set());
          window.fixtureListeners.get(name).add(handler);
        }
        return add(name, handler, ...args);
      };
      window.removeEventListener = (name, handler, ...args) => {
        window.fixtureListeners.get(name)?.delete(handler);
        return remove(name, handler, ...args);
      };
      const today = new Date();
      const day = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
      window.fixtureRow = { id: 'cmp_fixture', workspace: 'LUMEN', title: 'INITIAL_CAMPAIGN', channel: 'W컨셉',
        startDate: day, endDate: day, status: 'onboarded', tasks: [] };
      localStorage.setItem('ames_campaigns', JSON.stringify([window.fixtureRow]));
      function Harness() {
        const [visible, setVisible] = useState(true);
        return <><button id="toggle" onClick={() => setVisible(v => !v)}>mount</button>{visible && <Calendar />}</>;
      }
      createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'isolated-calendar', setup(b) {
      b.onResolve({ filter: /^@\// }, args => args.path === '@/lib/calendarTimeline' ? undefined : ({ path: args.path, namespace: 'fixture' }));
      b.onResolve({ filter: /^sonner$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
        let contents: string;
        if (args.path === '@/lib/phase1') contents = `
          export const CAMPAIGN_CHANNELS = ['W컨셉'];
          export const phase1 = {
            getCampaigns: ws => { window.fixtureReads++; return JSON.parse(localStorage.getItem('ames_campaigns') || '[]').filter(c => c.workspace === ws); },
            getCampaign: id => JSON.parse(localStorage.getItem('ames_campaigns') || '[]').find(c => c.id === id),
            getCampaignProgress: () => 0, getCampaignTeamProgress: () => 0,
          };`;
        else if (args.path === '@/contexts/WorkspaceContext') contents = 'export const useWorkspace = () => ({ workspace: "LUMEN" });';
        else if (args.path === '@/lib/store') contents = 'export const store = { getItems: () => [] };';
        else if (args.path === '@/lib/projectQueries') contents = 'export const fetchProjects = async () => []; export const upsertProject = async () => { throw Error("No writes"); }; export const labelOfKind = x => x;';
        else if (args.path === 'sonner') contents = 'export const toast = { success: () => {}, error: () => {} };';
        else if (args.path === '@/components/CampaignProjectPanel') contents = `
          export default function Panel({campaign,onRefresh}) {
            return <section id="selected-panel"><h2 id="panel-title">{campaign.title}</h2><button id="local-refresh" onClick={() => {
              const rows = JSON.parse(localStorage.getItem('ames_campaigns'));
              localStorage.setItem('ames_campaigns', JSON.stringify(rows.map(c => c.id === campaign.id ? {...c,title:'LOCAL_REFRESH',status:'active'} : c)));
              onRefresh();
            }}>local refresh</button></section>;
          }`;
        else if (args.path === '@/components/ProductDiscountSheet') contents = 'export default function Sheet() { return null; }';
        else contents = `
          const Box = ({children, variant, size, ...props}) => <div {...props}>{children}</div>;
          export const Button = ({children, variant, size, ...props}) => <button {...props}>{children}</button>;
          export const Input = props => <input {...props}/>;
          export const Label=Box, Badge=Box, DialogContent=Box, DialogHeader=Box, DialogTitle=Box, DialogFooter=Box;
          export const Dialog = ({open,children}) => open ? <div>{children}</div> : null;`;
        return { contents, loader: 'tsx', resolveDir: process.cwd() };
      });
    } }],
  });
  const server = createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundled.outputFiles[0].text); }
    else if (req.url === '/' || req.url === '/peer') { res.setHeader('Content-Type', 'text/html'); res.end(req.url === '/peer' ? '<p>storage peer</p>' : '<div id="root"></div><script type="module" src="/fixture.js"></script>'); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ headless: true, protocolTimeout: 30000, ...(chrome ? { executablePath: chrome } : {}) });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [], forbidden: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (!request.url().startsWith(origin + '/')) { forbidden.push(request.url()); void request.abort(); }
      else void request.continue();
    });
    await page.goto(origin);
    const shown = async (title: string) => {
      try { await page.waitForFunction(t => Array.from(document.querySelectorAll('button')).some(button => button.textContent?.includes(t)), {}, title); }
      catch (error) { throw new Error(`Missing ${title}; page errors: ${errors.join('; ')}; ${String(error)}`); }
    };
    await shown('INITIAL_CAMPAIGN');
    assert.deepEqual(await page.evaluate('Array.from(window.fixtureListeners.values(), s => s.size)'), [1, 1, 1]);
    // Actual page onRefresh path: setter-only memo dependency would keep INITIAL_CAMPAIGN.
    await page.evaluate(() => (Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('INITIAL_CAMPAIGN')) as HTMLButtonElement).click());
    await page.waitForFunction(() => document.querySelector('#panel-title')?.textContent === 'INITIAL_CAMPAIGN');
    await page.evaluate(() => (document.querySelector('#local-refresh') as HTMLButtonElement).click());
    await shown('LOCAL_REFRESH');
    await page.waitForFunction(() => document.querySelector('#panel-title')?.textContent === 'LOCAL_REFRESH');
    for (const [event, title] of [['work:changed', 'WORK_REFRESH'], ['campaigns:changed', 'SERVER_ACK'], ['campaigns:changed', 'CONFLICT_ROLLBACK']]) {
      await page.evaluate((name, value) => {
        const rows = JSON.parse(localStorage.getItem('ames_campaigns')!);
        localStorage.setItem('ames_campaigns', JSON.stringify(rows.map((c: object) => ({ ...c, title: value }))));
        window.dispatchEvent(new Event(name));
      }, event, title);
      await shown(title);
      await page.waitForFunction(t => document.querySelector('#panel-title')?.textContent === t, {}, title);
    }
    const settle = async () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const reads = await page.evaluate('window.fixtureReads');
    await page.evaluate(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', storageArea: localStorage }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'ames_campaigns', storageArea: sessionStorage }));
    });
    await settle();
    assert.equal(await page.evaluate('window.fixtureReads'), reads, 'Ignore unrelated keys/session storage');
    const peer = await browser.newPage();
    await peer.goto(origin + '/peer');
    await peer.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem('ames_campaigns')!);
      localStorage.setItem('ames_campaigns', JSON.stringify(rows.map((c: object) => ({ ...c, title: 'CROSS_TAB_REFRESH' }))));
    });
    await page.bringToFront();
    await shown('CROSS_TAB_REFRESH');
    await page.waitForFunction(() => document.querySelector('#panel-title')?.textContent === 'CROSS_TAB_REFRESH');
    await peer.evaluate(() => localStorage.clear());
    await page.waitForFunction(() => !document.body.textContent?.includes('CROSS_TAB_REFRESH'));
    assert.equal(await page.$('#selected-panel'), null, 'Deleted selected row closes the panel');
    await page.click('#toggle');
    assert.deepEqual(await page.evaluate('Array.from(window.fixtureListeners.values(), s => s.size)'), [0, 0, 0]);
    const unmountedReads = await page.evaluate('window.fixtureReads');
    await page.evaluate(() => { window.dispatchEvent(new Event('work:changed')); window.dispatchEvent(new Event('campaigns:changed')); });
    await settle();
    assert.equal(await page.evaluate('window.fixtureReads'), unmountedReads);
    await page.click('#toggle');
    await page.waitForFunction(() => document.body.textContent?.includes('운영 캘린더 · 기획전'));
    assert.deepEqual(await page.evaluate('Array.from(window.fixtureListeners.values(), s => s.size)'), [1, 1, 1]);
    assert.deepEqual(errors, []);
    assert.deepEqual(forbidden, []);
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
