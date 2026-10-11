// 25 independent Chrome cookie sessions, real API and disposable PostgreSQL only.
import assert from 'node:assert/strict';

export async function verifyBrowserCapacity({ browser, client, harness, password, bossContext, ceoProof }) {
  assert.equal(process.env.ERP_BROWSER_ISOLATED, '20261010');
  assert.equal(process.env.POSTGREST_URL, 'http://127.0.0.1:4192');
  assert.equal(process.env.ANTHROPIC_API_KEY, 'isolated-fixture-not-real');
  assert.equal((await client.query("SELECT current_setting('port') AS port")).rows[0].port, '4191');
  assert.equal(harness.capacityTeams.length, 14);
  let hash = 0; for (const c of password) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  const people = Array.from({ length: 25 }, (_, i) => ({ id: `load25_${i}`, email: `load25-${i}@test.invalid`,
    name: `부하시험 직원 ${i}`, team: harness.capacityTeams[i % 14] }));
  for (const person of people) await client.query(`INSERT INTO public.app_users (id,email,name,team,role,position,password_hash,is_active)
    VALUES ($1,$2,$3,$4,'사원','사원',$5,true)`, [person.id, person.email, person.name, person.team, Math.abs(hash).toString(36)]);
  const beforeCards = (await client.query('SELECT count(*)::int AS n FROM public.work_cards')).rows[0].n;
  const beforeCalls = { ...harness.calls };
  harness.enableCapacityFixtures();
  const actors = [], elapsed = [], failures = [];
  const request = (page, endpoint, body) => page.evaluate(async ({ endpoint, body }) => {
    const started = performance.now();
    const response = await fetch(endpoint, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000) });
    return { status: response.status, data: await response.json(), ms: performance.now() - started };
  }, { endpoint, body });
  try {
    // Settle all actors before cleanup even when one login fails.
    const logins = await Promise.allSettled(people.map(async (person, index) => {
      const context = await browser.createBrowserContext();
      const actor = { person, index, context, page: await context.newPage() }; actors.push(actor);
      await actor.page.setRequestInterception(true);
      actor.page.on('request', req => {
        const url = new URL(req.url());
        if (url.origin === 'https://localhost:4189' || url.protocol === 'data:') req.continue();
        else req.abort();
      });
      await actor.page.goto('https://localhost:4189/');
      const login = await request(actor.page, '/api/login', { email: person.email, password });
      assert.equal(login.status, 200); assert.equal(login.data.user.id, person.id);
      const session = await request(actor.page, '/api/session');
      assert.equal(session.status, 200); assert.equal(session.data.user.id, person.id);
    }));
    assert.ok(logins.every(r => r.status === 'fulfilled'), 'All 25 real cookie logins must succeed');
    const started = performance.now();
    const posted = await Promise.allSettled(actors.map(async ({ page, index, person }) => {
      for (let n = 0; n < 40; n++) {
        const text = `E2E_LOAD_${String(index).padStart(2, '0')}_${String(n).padStart(2, '0')}`;
        const requestId = `wc_load25${String(index).padStart(2, '0')}${String(n).padStart(2, '0')}`;
        const r = await request(page, '/api/work', { text, requestId, expectedUserId: person.id });
        elapsed.push(r.ms);
        if (r.status !== 200) failures.push({ index, n, status: r.status, error: r.data.error });
        assert.equal(r.status, 200); assert.equal(r.data.card.id, requestId);
        assert.equal(r.data.card.created_by, person.id); assert.equal(r.data.card.assignee_id, person.id);
        assert.equal(r.data.card.kind, 'todo');
      }
    }));
    const totalMs = performance.now() - started;
    assert.deepEqual(failures, []); assert.ok(posted.every(r => r.status === 'fulfilled'), 'All 1,000 submissions must succeed');
    assert.equal(elapsed.length, 1000);
    const rows = (await client.query("SELECT id,created_by,team FROM public.work_cards WHERE id LIKE 'wc_load25%' ORDER BY id")).rows;
    assert.equal(rows.length, 1000); assert.equal(new Set(rows.map(r => r.id)).size, 1000);
    for (const person of people) assert.equal(rows.filter(r => r.created_by === person.id).length, 40);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.work_cards')).rows[0].n, beforeCards + 1000);
    const feedChecks = await Promise.allSettled(actors.map(async ({ page, index, person }) => {
      const feed = await request(page, '/api/work');
      assert.equal(feed.status, 200); assert.equal(feed.data.me.id, person.id); assert.equal(feed.data.counts.todo, 40);
      for (const item of feed.data.items.filter(r => r.id.startsWith('wc_load25'))) assert.equal(item.team, person.team);
      const today = await request(page, '/api/work/today');
      assert.equal(today.status, 200); assert.equal(today.data.counts.open, 40);
      assert.equal(today.data.items.filter(r => r.id.startsWith('wc_load25')).length, 40);
      const body = { text: `E2E_LOAD_${String(index).padStart(2, '0')}_00`, requestId: `wc_load25${String(index).padStart(2, '0')}00`, expectedUserId: person.id };
      const replay = await Promise.all([request(page, '/api/work', body), request(page, '/api/work', body)]);
      for (const r of replay) { assert.equal(r.status, 200); assert.equal(r.data.reused, true); }
      assert.equal((await request(page, '/api/work', { ...body, text: '변경된 재전송' })).status, 409);
      assert.equal((await request(page, '/api/work', { ...body, expectedUserId: 'e2e_boss' })).status, 409);
    }));
    assert.ok(feedChecks.every(r => r.status === 'fulfilled'), 'Feed isolation and duplicate recovery must pass for all 25 sessions');
    assert.equal((await client.query("SELECT count(*)::int AS n FROM public.work_cards WHERE id LIKE 'wc_load25%'")).rows[0].n, 1000);
    assert.equal(harness.calls.classify - beforeCalls.classify, 1000, 'Replays cannot reclassify');
    const boss = await bossContext.newPage();
    await boss.goto('https://localhost:4189/');
    const ids = new Set(); let cursor;
    for (let n = 0; n < 10; n++) {
      const r = await request(boss, '/api/work' + (cursor ? '?before=' + encodeURIComponent(JSON.stringify(cursor)) : ''));
      assert.equal(r.status, 200, 'Boss page: ' + JSON.stringify({ cursor, data: r.data }));
      for (const item of r.data.items) { assert.ok(!ids.has(item.id), 'Cursor pages cannot overlap'); ids.add(item.id); }
      cursor = r.data.nextCursor; if (!cursor) break;
    }
    assert.equal(cursor, null); for (const row of rows) assert.ok(ids.has(row.id), 'Boss pagination must include every source record');
    const ceo = await bossContext.newPage();
    await bossContext.setCookie({ name: 'ceo_g', value: ceoProof, domain: 'ceo.localhost', path: '/', secure: true, httpOnly: true });
    await ceo.goto('https://ceo.localhost:4189/');
    const reportsStarted = performance.now();
    const generated = await request(ceo, '/api/ceo/agents/run', {});
    assert.equal(generated.status, 200);
    const reportsMs = performance.now() - reportsStarted;
    const reports = (await client.query("SELECT DISTINCT ON (team) team, stats FROM public.team_agent_runs WHERE trigger='manual' ORDER BY team,created_at DESC")).rows;
    assert.equal(reports.length, 14);
    assert.equal(reports.reduce((n, r) => n + r.stats.open, 0), 1000, 'Shared evidence must not inflate team-owned totals');
    for (const team of harness.capacityTeams) {
      const report = reports.find(r => r.team === team); assert.ok(report); assert.equal(report.stats.reportAvailable, true);
      assert.equal(report.stats.open, people.filter(p => p.team === team).length * 40);
    }
    assert.equal(harness.calls.report - beforeCalls.report, 14);
    const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const morning = new Date(day + 'T08:30:00+09:00');
    const scheduledBefore = (await client.query("SELECT count(*)::int AS n FROM public.team_agent_runs WHERE trigger='schedule'")).rows[0].n;
    await harness.scheduledAllTeamsTick(new Date(morning.getTime() - 1));
    assert.equal((await client.query("SELECT count(*)::int AS n FROM public.team_agent_runs WHERE trigger='schedule'")).rows[0].n, scheduledBefore);
    await Promise.all([harness.scheduledAllTeamsTick(morning), harness.scheduledAllTeamsTick(morning)]);
    const scheduled = (await client.query("SELECT team,count(*)::int AS n FROM public.team_agent_runs WHERE trigger='schedule' AND stats->>'reportAvailable'='true' GROUP BY team")).rows;
    assert.equal(scheduled.length, 14); assert.ok(scheduled.every(r => r.n === 1));
    const count = (await client.query("SELECT count(*)::int AS n FROM public.team_agent_runs WHERE trigger='schedule'")).rows[0].n;
    await harness.scheduledAllTeamsTick(morning);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM public.team_agent_runs WHERE trigger='schedule'")).rows[0].n, count);
    assert.equal(harness.calls.report - beforeCalls.report, 27, '14 manual reports plus 13 missing scheduled teams');
    elapsed.sort((a, b) => a - b);
    return { status: 'PASS', browserSessions: 25, submissions: 1000, replayRequests: 50, conflictsBlocked: 50,
      manualTeamReports: 14, scheduledSuccessfulTeams: 14, pagination: 'all 1000 source IDs present, no overlapping pages',
      timing: { submissionsMs: Math.round(totalMs), requestP50Ms: Math.round(elapsed[499]), requestP95Ms: Math.round(elapsed[949]),
        requestMaxMs: Math.round(elapsed.at(-1)), manualReportsMs: Math.round(reportsMs) },
      limits: ['Local test-machine timing, not production SLA', 'Fixed model fixtures, not live inference', 'CEO proof test-signed, not Google OAuth'] };
  } finally { await Promise.allSettled(actors.map(a => a.context.close())); }
}
