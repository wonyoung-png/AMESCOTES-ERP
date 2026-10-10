import assert from 'node:assert/strict';
import test from 'node:test';

test('campaign transport: changed-only conditional PATCH, stale conflict reconciliation, empty reads never insert', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map<string, string>();
  let events = 0;
  const old = { id: 'transport-a', workspace: 'LUMEN', title: 'Fixture', channel: 'W컨셉', startDate: '2026-10-20', endDate: '2026-10-20', status: 'draft', tasks: [], createdAt: '', updatedAt: '2026-10-01T00:00:00Z' };
  let stored: any = { id: old.id, workspace: old.workspace, title: old.title, channel: old.channel, start_date: old.startDate, end_date: old.endDate, status: old.status, tasks: [], updated_at: old.updatedAt };
  const methods: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://campaign.fixture.invalid' }, dispatchEvent: () => { events++; return true; } } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'http://campaign.fixture.invalid');
    assert.equal(url.pathname, '/rest/v1/campaigns');
    const method = init?.method || 'GET';
    methods.push(method);
    let rows: any[];
    if (method === 'PATCH') {
      assert.equal(url.searchParams.get('id'), 'eq.' + old.id);
      assert.ok(url.searchParams.get('updated_at'), 'Version filter must be sent to actual SDK transport');
      const matches = url.searchParams.get('updated_at') === 'eq.' + stored.updated_at;
      if (matches) stored = { ...stored, ...JSON.parse(String(init?.body)) };
      rows = matches ? [stored] : [];
    } else {
      assert.equal(method, 'GET', 'No blind upserts or sample inserts allowed');
      rows = [stored];
    }
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const { pushCampaigns } = await import('./campaignQueries');
    await pushCampaigns([], []);
    await pushCampaigns([old], [structuredClone(old)]);
    assert.deepEqual(methods, []);
    const edited = { ...old, title: 'Marketing complete' };
    storage.set('ames_campaigns', JSON.stringify([edited]));
    await pushCampaigns([edited], [old]);
    assert.equal(stored.title, edited.title);
    const ack = JSON.parse(storage.get('ames_campaigns')!)[0];
    assert.equal(ack.updatedAt, stored.updated_at);
    assert.notEqual(ack.updatedAt, old.updatedAt);
    const staleEdit = { ...old, title: 'Logistics stale' };
    storage.set('ames_campaigns', JSON.stringify([staleEdit]));
    await pushCampaigns([staleEdit], [old]);
    assert.equal(stored.title, 'Marketing complete');
    assert.equal(JSON.parse(storage.get('ames_campaigns')!)[0].title, 'Marketing complete');
    assert.deepEqual(methods, ['PATCH', 'PATCH', 'GET']);
    assert.equal(events, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
