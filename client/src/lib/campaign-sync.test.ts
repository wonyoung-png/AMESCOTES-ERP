import assert from 'node:assert/strict';
import test from 'node:test';
import { createCampaignSync } from './campaignSync';

const row = (id = 'a', updatedAt = 'v1', done = false) => ({ id, updatedAt, tasks: [{ done }] });

test('campaign: viewing/unchanged rows never write; only changed campaign is saved', async () => {
  const writes: string[] = [];
  const sync = createCampaignSync(async next => { writes.push(next.id); return next; }, () => {}, async () => {});
  const old = [row(), row('b')];
  await sync(structuredClone(old), old);
  assert.deepEqual(writes, []);
  await sync([row('a', 'v2', true), row('b')], old);
  assert.deepEqual(writes, ['a']);
});

test('campaign: stale second browser cannot revert another team completion', async () => {
  let stored = row();
  let conflicts = 0;
  const write = async (next: any, previous: any) => {
    if (stored.updatedAt !== previous.updatedAt) throw Error('conflict');
    stored = { ...next, updatedAt: 'server-v2' };
    return stored;
  };
  const first = createCampaignSync(write, () => {}, async () => { conflicts++; });
  const stale = createCampaignSync(write, () => {}, async () => { conflicts++; });
  const original = row();
  await first([row('a', 'local-v2', true)], [original]);
  await stale([{ ...original, owner: 'other team' }], [original]);
  assert.equal(stored.tasks[0].done, true);
  assert.equal(conflicts, 1);
});

test('campaign: rapid edits use acknowledged server version, not optimistic version', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const expected: string[] = [];
  const sync = createCampaignSync(async (next, previous) => {
    expected.push(previous!.updatedAt);
    if (expected.length === 1) await gate;
    return { ...next, updatedAt: `server-${expected.length}` };
  }, () => {}, async () => assert.fail('Unexpected rejection'));
  const a = row(), b = row('a', 'local2', true), c = { ...b, owner: 'MD' };
  const first = sync([b], [a]);
  const second = sync([c], [b]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(expected, ['v1', 'server-1']);
});

test('campaign: rejected predecessor prevents blind dependent write and preserves baseline', async () => {
  let calls = 0;
  const baselines: any[] = [];
  const sync = createCampaignSync(async () => { calls++; throw Error('offline'); }, () => {}, async (_next, base) => { baselines.push(base); });
  const a = row(), b = row('a', 'local2', true), c = { ...b, owner: 'MD' };
  await Promise.all([sync([b], [a]), sync([c], [b])]);
  assert.equal(calls, 1);
  assert.deepEqual(baselines, [a, a]);
});

test('campaign: failed later edit rolls back to successful predecessor, not stale initial row', async () => {
  const bases: any[] = [];
  let calls = 0;
  const sync = createCampaignSync(async next => {
    if (++calls === 2) throw Error('offline');
    return { ...next, updatedAt: 'acknowledged' };
  }, () => {}, async (_next, base) => { bases.push(base); });
  const a = row(), b = row('a', 'local2', true), c = { ...b, owner: 'MD' };
  await Promise.all([sync([b], [a]), sync([c], [b])]);
  assert.equal(bases[0].updatedAt, 'acknowledged');
  assert.equal(bases[0].tasks[0].done, true);
});
