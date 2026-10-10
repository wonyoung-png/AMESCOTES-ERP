import assert from 'node:assert/strict';
import test from 'node:test';
import { attachCampaignEvidence } from './campaign-evidence';
import { cardEvidence, currentCampaignCards } from './work-records';
import { findCouncilCandidates } from './council';

const card = { id: 'card_a', team: '국내 MD', kind: 'schedule', status: 'done', raw_text: 'x'.repeat(1000),
  confirmed_payload: { startDate: '2026-01-01', discountRate: 20 }, result_ref: { table: 'campaigns', id: 'cmp_a' }, shared_teams: ['마케팅', '물류·CS'] };
const current = { id: 'cmp_a', title: 'changed', start_date: '2026-11-20', end_date: '2026-11-21', status: 'draft', discount_rate: 15, updated_at: '2026-10-10T00:00:00Z' };

test('history remains immutable; current changed date/discount and source time are separate', async () => {
  let query = '';
  const [enriched] = await attachCampaignEvidence([card], async path => { query = path; return { ok: true, json: async () => [current] }; });
  assert.match(query, /^campaigns\?id=in\.\(cmp_a\)/);
  assert.equal(card.confirmed_payload.discountRate, 20);
  assert.equal((card as any)._campaignEvidence, undefined);
  const text = cardEvidence(enriched);
  assert.match(text, /당시 확정.*"discountRate":20/);
  assert.match(text, /현재 운영캘린더.*"discountRate":15/);
  assert.match(text, /"startDate":"2026-11-20"/);
  assert.match(text, /조회/);
  const [council] = findCouncilCandidates([enriched], new Map());
  assert.match(council.evidence['마케팅'][0], /당시 확정.*"discountRate":20/);
  assert.match(council.evidence['마케팅'][0], /현재 운영캘린더.*"discountRate":15/);
});

test('missing, unavailable, invalid result and absent links cannot imply cancellation/deletion', async () => {
  for (const response of [{ ok: true, json: async () => [] }, { ok: false, json: async () => [] }, { ok: true, json: async () => [{ id: 'foreign' }] }]) {
    const [c] = await attachCampaignEvidence([card], async () => response);
    assert.match(cardEvidence(c), /미확인/);
    assert.doesNotMatch(cardEvidence(c), /삭제됐|취소됐/);
    assert.equal(c._campaignEvidence.state, response.ok && (await response.json()).length === 0 ? 'missing' : 'unavailable');
  }
  let reads = 0;
  const cards = await attachCampaignEvidence([{ ...card, result_ref: null }, { ...card, result_ref: { table: 'campaigns', id: 'unsafe,id' } }], async () => { reads++; throw Error(); });
  assert.equal(reads, 0);
  assert.ok(cards.every(c => c._campaignEvidence.state === 'unlinked'));
});

test('linked lookups deduplicate and batch; partial failure stays unknown', async () => {
  let reads = 0;
  const cards = Array.from({ length: 81 }, (_, i) => ({ ...card, result_ref: { table: 'campaigns', id: `cmp_${i}` } }));
  const result = await attachCampaignEvidence([...cards, cards[0]], async () => ({ ok: ++reads === 1, json: async () => [] }));
  assert.equal(reads, 2);
  assert.equal(result[0]._campaignEvidence.state, 'missing');
  assert.equal(result[80]._campaignEvidence.state, 'unavailable');
});

test('closed, missing and cancelled cards are history, not new operational council proposals', async () => {
  const [closed] = await attachCampaignEvidence([card], async () => ({ ok: true, json: async () => [{ ...current, status: 'closed' }] }));
  const [missing] = await attachCampaignEvidence([card], async () => ({ ok: true, json: async () => [] }));
  assert.deepEqual(findCouncilCandidates([closed, missing, { ...card, status: 'cancelled' }], new Map()), []);
});

test('future reschedule supplements old decisions with authorized card query; errors fail closed', async () => {
  const paths: string[] = [];
  const result = await currentCampaignCards('*', '&or=(team.eq.MD)', async path => {
    paths.push(path);
    return { ok: true, status: 200, json: async () => path.startsWith('campaigns?') ? [{ id: 'cmp_a' }] : [card] };
  });
  assert.equal(result[0].confirmed_payload.startDate, '2026-01-01');
  assert.match(paths[1], /result_ref->>id=in\.\(cmp_a\)/);
  assert.match(paths[1], /&or=\(team.eq.MD\)/);
  assert.doesNotMatch(paths[1], /created_at|confirmed_payload->>endDate/);
  await assert.rejects(currentCampaignCards('*', '', async () => ({ ok: false, status: 503, json: async () => [] })), /503/);
});
