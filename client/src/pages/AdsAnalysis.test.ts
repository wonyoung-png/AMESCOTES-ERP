import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import puppeteer from 'puppeteer';
import { adsApi, modelContribution, adsRouteTarget } from './AdsAnalysis';
import type { AdsIndex, AdsMarket, AdsOpinion, AdsRun } from '@shared/ads-analysis';

test('transport is authenticated LUMEN ERP only, accepts 202 and reports unavailable/denied APIs', async () => {
  const originalFetch = globalThis.fetch;
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'synthetic-token' } });
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/ads-council/run'); assert.equal(init?.credentials, 'include');
      assert.equal(new Headers(init?.headers).get('X-Workspace'), 'LUMEN');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-token');
      assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json');
      return new Response(JSON.stringify({ run: { status: 'queued' } }), { status: 202 });
    };
    assert.deepEqual(await adsApi('/run', { method: 'POST', body: '{}' }), { run: { status: 'queued' } });
    globalThis.fetch = async () => new Response('<html>missing route</html>', { status: 404 });
    await assert.rejects(adsApi('/access'), /아직 준비되지/);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'ads_access_denied' }), { status: 403 });
    await assert.rejects(adsApi('/access'), /권한이 없습니다/);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'ads_analysis_disabled' }), { status: 503 });
    await assert.rejects(adsApi('/run'), /활성화가 아직 완료되지 않았습니다/);
  } finally {
    globalThis.fetch = originalFetch;
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('office link target only accepts known markets and bounded non-path run IDs',()=>{
  assert.deepEqual(adsRouteTarget('?market=lm-gl&run=synthetic-lm-gl'),{market:'lm-gl',run:'synthetic-lm-gl'});
  assert.deepEqual(adsRouteTarget('?market=OEM&run=other'),{market:'lm-kr',run:''});
  assert.equal(adsRouteTarget('?run=../../private').run,'');
});

test('contribution uses created_at within 28 days and valid scored counts only, not fabricated zeroes', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  const row = (days: number, state: 'scored' | 'unavailable', evaluated: number, correct: number): AdsRun => ({
    id: `synthetic-${days}`, market: 'lm-kr', kind: 'daily', question: '', day: '', status: 'completed',
    created_at: new Date(now - days * 86400_000).toISOString(), updated_at: new Date(now).toISOString(),
    score: { state, checkedAt: new Date(now).toISOString(), models: { claude: { evaluated, correct } } },
  });
  const rows = [row(14, 'scored', 3, 2), row(27, 'scored', 1, 1), row(29, 'scored', 100, 100), row(1, 'unavailable', 5, 0), row(1, 'scored', 1, 2), row(-1, 'scored', 5, 5), row(1, 'scored', 0, 0), row(1, 'scored', NaN, 0)];
  assert.deepEqual(modelContribution(rows, now), [
    { model: 'claude', evaluated: 4, correct: 3, scoredRuns: 2, percent: 75 },
    { model: 'codex', evaluated: 0, correct: 0, scoredRuns: 0, percent: null },
    { model: 'meta', evaluated: 0, correct: 0, scoredRuns: 0, percent: null },
  ]);
});

test('actual React page mocked API: originals/reviews, stable retry/new UUID, polling, access, markets and responsive themes', async () => {
  const root = process.cwd();
  const vite = await createServer({ configFile: false, envFile: false, root: resolve(root, 'client'), plugins: [react(), tailwind()],
    resolve: { alias: { '@': resolve(root, 'client/src'), '@shared': resolve(root, 'shared') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  assert.equal(vite.config.server.hmr, false);
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from "react";import {createRoot} from "react-dom/client";import Page from "/src/pages/AdsAnalysis.tsx";import {WorkspaceProvider} from "/src/contexts/WorkspaceContext.tsx";import "/src/index.css";createRoot(document.getElementById("root")).render(React.createElement(WorkspaceProvider,null,React.createElement(Page)));</script></body></html>';
  const server = createHttpServer(async (req, res) => {
    if (req.url?.startsWith('/__ads')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(await vite.transformIndexHtml(req.url, html)); }
    else vite.middlewares(req, res, () => { res.statusCode = 404; res.end(); });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture unavailable');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const calls: { path: string; market: string | null; method: string; body: Record<string, string> }[] = [];
  const now = new Date().toISOString();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const opinion = (model: 'claude' | 'codex' | 'meta', conclusion: string): AdsOpinion => ({ model, state: 'ok', conclusion, evidence: [{ factId: 'f1', value: 2.5 }], confidence: 'medium', actions: [] });
  const fixture = (market: AdsMarket): AdsRun => ({ id: `synthetic-${market}`, market, kind: 'daily', question: '합성 분석 · 실제 광고 데이터 아님', day, status: 'completed', created_at: now, updated_at: now, costUsd: 0.32,
    snapshot: { id: 'synthetic-snapshot', market, collectedAt: now, hash: 'synthetic-hash', facts: [{ id: 'f1', source: 'SYNTHETIC Meta Insights', metric: 'ROAS', value: 2.5, entityId: 'synthetic-adset', period: '합성 비교 기간' }], sources: [{ source: 'SYNTHETIC Meta', state: 'ok', checkedAt: now }], signals: [], alerts: [{ id: 'a1', kind: 'fixture', message: '합성 경보 · 재고 확인 필요', factIds: ['f1'] }], dataAvailable: true, tokenExpiresOn: '2026-11-24', tokenNeedsRenewal: false },
    opinions: { claude: opinion('claude', '합성 Claude 원문: 표본을 먼저 확인합니다.'), codex: opinion('codex', '합성 Codex 원문: 즉시 확대에 이견이 있습니다.'), meta: opinion('meta', '합성 Meta 원본 신호: 해당 광고세트의 ROAS입니다.') },
    reviews: { claude: { model: 'claude', decision: 'revise', reason: '합성 검토 이유: Codex 의견을 반영했습니다.', opinion: opinion('claude', '합성 검토 후: 표본 확인 후 판단합니다.') }, codex: { model: 'codex', decision: 'keep', reason: '합성 검토 이유: 원문 판단을 유지합니다.', opinion: opinion('codex', '합성 Codex 검토 후: 확대 보류 의견 유지.') } },
    final: { conclusion: '합성 최종 결론 · 실제 광고 변경 없음. 재고와 표본을 확인한 뒤 대표님이 판단합니다.', agreements: ['합성 합의: 현재는 유지 제안'], disagreements: [{ model: 'codex', reason: '합성 이견: 확대 판단을 보류합니다.' }], evidence: [{ factId: 'f1', value: 2.5 }], confidence: 'medium', decisions: ['합성 결정 질문: 재고 확인 후 확대를 검토할까요?'], codexParticipated: true },
    score: { state: 'scored', checkedAt: now, snapshotId: 'synthetic-after', models: { claude: { evaluated: 3, correct: 2 }, codex: { evaluated: 1, correct: 1 }, meta: { evaluated: 0, correct: 0, reason: '평가할 권장 조치 없음' } } } });
  let pending: AdsRun | null = null, posts = 0, pendingReads = 0, deny = false, empty = false, noData = false, enabled: boolean | undefined = true;
  let contributionRuns: AdsRun[] | undefined;
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) { void (url.origin === origin || url.protocol === 'data:' ? request.continue() : request.abort()); return; }
    try {
      assert.ok(url.pathname.startsWith('/api/ads-council')); assert.equal(request.headers()['x-workspace'], 'LUMEN');
      assert.equal(request.headers()['authorization'], 'Bearer synthetic-browser-token');
      const body = request.postData() ? JSON.parse(request.postData()!) : {};
      calls.push({ path: url.pathname, market: url.searchParams.get('market'), method: request.method(), body });
      const market = url.searchParams.get('market') as AdsMarket;
      let data: unknown, status = 200;
      if (url.pathname.endsWith('/access')) { data = deny ? { error: 'ads_access_denied' } : { allowed: true }; if (deny) status = 403; }
      else if (url.pathname.endsWith('/run') && request.method() === 'POST') {
        assert.match(body.requestId, /^[0-9a-f-]{36}$/); assert.equal(body.kind, 'question'); assert.equal(body.market, 'lm-kr');
        posts++;
        if (posts === 1) { status = 503; data = { error: 'synthetic ambiguous transport failure' }; }
        else { pending = { ...fixture(body.market), id: `synthetic-question-${posts}`, kind: 'question', question: body.question, status: 'independent', costUsd: undefined, opinions: {}, reviews: {}, final: undefined, score: undefined }; pendingReads = 0; data = { run: pending }; status = 202; }
      } else if (url.pathname.includes('/runs/')) {
        const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
        if (pending && id === pending.id) {
          pendingReads++;
          if (pendingReads >= 2) pending = { ...pending, status: 'completed', opinions: { claude: opinion('claude', '合成 Claude 답변'), codex: { model: 'codex', state: 'unavailable', reason: '합성 맥미니 연결 없음', conclusion: '', confidence: 'unknown', evidence: [], actions: [] }, meta: { model: 'meta', state: 'not_applicable', conclusion: '', confidence: 'unknown', evidence: [], actions: [] } }, final: { ...fixture(market).final!, codexParticipated: false } };
          data = { run: pending };
        } else data = { run: {...fixture(market),id} };
      } else if (url.pathname === '/api/ads-council' && request.method() === 'GET') data = { runs: empty ? [] : [fixture(market), ...(pending?.market === market ? [pending] : [])], contributionRuns, allowed: true, enabled, market, dailyCapUsd: 5, spentUsd: 0.8, tokenExpiresOn: '2026-11-24', tokenNeedsRenewal: false } satisfies AdsIndex;
      else throw Error(`unauthorized fixture operation ${request.method()} ${url.pathname}`);
      const addSourceStates = (run: AdsRun) => { if (run.snapshot && !run.snapshot.sources.some(source => source.source === 'SYNTHETIC Shopify 주문')) run.snapshot.sources.push({ source: 'SYNTHETIC Shopify 주문', state: 'unavailable', reason: '합성 접근 권한 없음', checkedAt: now }, { source: 'SYNTHETIC 재고', state: 'partial', reason: '합성 일부 품목만 수집', checkedAt: now }); };
      if (data && typeof data === 'object' && 'run' in data) addSourceStates((data as { run: AdsRun }).run);
      else if (data && typeof data === 'object' && 'runs' in data) (data as AdsIndex).runs.forEach(addSourceStates);
      if (noData && status === 200 && data && typeof data === 'object') {
        const withoutData = (run: AdsRun): AdsRun => ({ ...run, opinions: {}, reviews: {}, final: undefined, score: undefined,
          snapshot: run.snapshot && { ...run.snapshot, dataAvailable: false, facts: [], alerts: [], signals: [], sources: [{ source: 'SYNTHETIC Meta', state: 'unavailable', reason: '합성 수집 실패', checkedAt: now }] } });
        if ('run' in data) data = { run: withoutData((data as { run: AdsRun }).run) };
        else if ('runs' in data) data = { ...data, runs: (data as AdsIndex).runs.map(withoutData) };
      }
      void request.respond({ status, contentType: 'application/json', body: JSON.stringify(data) });
    } catch (e) { errors.push(String(e)); void request.respond({ status: 500, body: '{}' }); }
  });
  async function click(text: string) {
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(el => el.textContent?.trim() === text && !el.disabled), {}, text);
    await page.evaluate(text => { const button = [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === text && !el.disabled); if (!button) throw Error(`button missing ${text}`); button.click(); }, text);
  }
  async function capture(name: string, width: number, dark: boolean) {
    await page.setViewport({ width, height: 1000 });
    await page.evaluate(dark => { document.documentElement.classList.toggle('dark', dark); window.scrollTo(0, 0); }, dark);
    await page.waitForFunction(() => !document.body.textContent?.includes('분석 기록을 불러오는 중입니다') && [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === '다시 조회' && !button.disabled));
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].filter(button => button.textContent?.includes('lm-kr') || button.textContent?.includes('lm-gl')).every(button => !button.disabled)), `${name}: market controls enabled`);
    if (name !== 'ads-progress-mobile' && !name.includes('history')) assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === '오늘 분석 실행' && !button.disabled)), `${name}: analysis action enabled`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: overflow`);
    if (process.env.ADS_UI_CAPTURE === '1') await page.screenshot({ path: resolve(root, `.impeccable/review/${name}.png`), fullPage: true });
  }
  try {
    await mkdir(resolve(root, '.impeccable/review'), { recursive: true });
    await page.evaluateOnNewDocument(() => { if (!localStorage.getItem('erp_workspace')) localStorage.setItem('erp_workspace', 'LUMEN'); localStorage.setItem('erp_token', 'synthetic-browser-token'); });
    await page.goto(`${origin}/__ads`, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
    assert.ok(await page.evaluate(() => document.body.textContent?.includes('합성 Claude 원문') && document.body.textContent?.includes('합성 검토 후')));
    assert.ok(await page.evaluate(() => document.body.textContent?.includes('오늘 사용·예약 한도 $0.80') && document.body.textContent?.includes('확인된 분석 호출 비용 · $0.3200') && document.body.textContent?.includes('합성 접근 권한 없음') && document.body.textContent?.includes('일부 수집')));
    assert.equal(await page.$eval('[aria-label="분석 진행 상태"] ol', node => node.textContent?.includes('중')), false, 'completed step labels never imply ongoing work');
    for (const [name, width, dark] of [['ads-desktop', 1440, false], ['ads-desktop-dark', 1440, true], ['ads-mobile', 390, false], ['ads-mobile-dark', 390, true]] as const) await capture(name, width, dark);
    await click('기록'); assert.ok(await page.evaluate(() => document.body.textContent?.includes('67%') && document.body.textContent?.includes('100%')));
    await capture('ads-history-mobile', 390, false);
    contributionRuns = Array.from({ length: 101 }, (_, i) => ({ ...fixture('lm-kr'), id: `synthetic-contribution-${i}`, score: { state: 'scored', checkedAt: now, models: { claude: { evaluated: 1, correct: 1 } } } }));
    await click('다시 조회'); await page.waitForFunction(() => document.body.textContent?.includes('101 / 101'));
    assert.equal(await page.$$eval('[aria-labelledby="history-heading"] li', rows => rows.length), 1, '4-week aggregation is independent of latest history rows');
    contributionRuns = [];
    await click('다시 조회'); await page.waitForFunction(() => !document.body.textContent?.includes('101 / 101') && !document.body.textContent?.includes('67%'));
    contributionRuns = undefined;
    await click('다시 조회'); await page.waitForFunction(() => document.body.textContent?.includes('67%'));
    await click('해외 · lm-gl'); await page.waitForFunction(() => document.body.textContent?.includes('분석 완료'));
    assert.ok(calls.some(call => call.path === '/api/ads-council' && call.market === 'lm-gl'));
    await click('국내 · lm-kr'); await page.waitForFunction(() => document.body.textContent?.includes('분석 완료'));
    await click('질문하기'); await page.type('#ads-question', '합성 질문: 해외 ROAS를 확인해 주세요.');
    await click('질문 분석 요청'); await page.waitForFunction(() => document.body.textContent?.includes('synthetic ambiguous transport failure'));
    await click('질문 분석 요청'); await page.waitForFunction(() => document.body.textContent?.includes('완료 시간은 아직 알 수 없습니다'));
    assert.ok(await page.evaluate(() => document.body.textContent?.includes('확인된 분석 호출 비용 · 확인되지 않음')));
    assert.equal(await page.$eval('[aria-label="분석 진행 상태"] ol', node => node.textContent?.match(/중/g)?.length), 1, 'only actual current phase is ongoing');
    const submissions = calls.filter(call => call.method === 'POST'); assert.equal(submissions[0].body.requestId, submissions[1].body.requestId);
    await capture('ads-progress-mobile', 390, false);
    await page.waitForFunction(() => document.body.textContent?.includes('Codex 미참여 · Claude 정리'), { timeout: 16000 });
    assert.equal(pendingReads, 2); assert.ok(await page.evaluate(() => document.body.textContent?.includes('합성 맥미니 연결 없음')));
    await click('질문 분석 요청'); await page.waitForFunction(() => document.body.textContent?.includes('완료 시간은 아직 알 수 없습니다'));
    assert.notEqual(calls.filter(call => call.method === 'POST')[2].body.requestId, submissions[1].body.requestId);
    await click('해외 · lm-gl');
    await page.waitForFunction(() => document.body.textContent?.includes('질문을 입력하면 분석이 시작됩니다'));
    const beforeLeave = pendingReads;
    await new Promise(done => setTimeout(done, 8000)); assert.equal(pendingReads, beforeLeave, 'poll stops on market switch');
    assert.ok(calls.filter(call => call.path.includes('/runs/synthetic-question')).every(call => call.market === 'lm-kr'), 'never read old run under new market');
    deny = true; await click('다시 조회'); await page.waitForFunction(() => document.body.textContent?.includes('권한이 없습니다'));
    assert.equal(await page.$('#ads-question'), null);
    deny = false; empty = true; await click('다시 조회'); await page.waitForSelector('#ads-question'); await click('기록'); await page.waitForFunction(() => document.body.textContent?.includes('저장된 분석 기록이 없습니다'));
    empty = false; noData = true; await click('다시 조회'); await page.waitForFunction(() => document.body.textContent?.includes('데이터 없음 · 수집한 근거가 부족합니다'));
    assert.ok(await page.evaluate(() => document.body.textContent?.includes('최종 결론이 제공되지 않았습니다') && document.body.textContent?.includes('합성 수집 실패')));
    enabled = false; noData = false; await click('다시 조회'); await page.waitForFunction(() => document.body.textContent?.includes('서비스 활성화가 아직 완료되지 않았습니다'));
    await click('오늘의 분석');
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === '오늘 분석 실행' && button.disabled)));
    const beforeDisabled = posts; await click('질문하기');
    assert.ok(await page.$eval('#ads-question', node => (node as HTMLTextAreaElement).disabled));
    await page.$eval('form', node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(posts, beforeDisabled, 'disabled service never submits even through form submit');
    enabled = undefined; await click('다시 조회'); await page.waitForFunction(() => !document.body.textContent?.includes('서비스 활성화가 아직 완료되지 않았습니다') && !!document.getElementById('ads-question'));
    assert.equal(await page.$eval('#ads-question', node => (node as HTMLTextAreaElement).disabled), false);
    calls.length=0;
    await page.goto(`${origin}/__ads?ws=LUMEN&market=lm-gl&run=synthetic-lm-gl`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>document.body.textContent?.includes('합성 최종 결론'));
    assert.ok(calls.some(c=>c.path==='/api/ads-council/runs/synthetic-lm-gl'&&c.market==='lm-gl'));
    assert.ok(!calls.some(c=>c.market==='lm-kr'),'office overseas link never fetches domestic market');
    calls.length=0;
    await page.goto(`${origin}/__ads?ws=LUMEN&market=lm-gl&run=synthetic-old-gl`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>document.body.textContent?.includes('합성 최종 결론'));
    assert.ok(calls.some(c=>c.path==='/api/ads-council/runs/synthetic-old-gl'&&c.market==='lm-gl'),'linked history older than index is fetched directly');
    await page.evaluate(() => localStorage.setItem('erp_workspace', 'OEM')); calls.length = 0;
    await page.goto(`${origin}/__ads`, { waitUntil: 'networkidle0' });
    assert.equal(calls.length, 0); assert.ok(await page.evaluate(() => document.body.textContent?.includes('LUMEN 워크스페이스에서만')));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await vite.close(); await new Promise<void>(done => server.close(() => done())); }
});
