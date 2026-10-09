import assert from 'node:assert/strict';
import test from 'node:test';
import { schedulePayload } from '../shared/schedule';
import { campaignTeams, gatherWatch } from './watch';

const input = { title: 'W컨셉 · 파니에 토트', workspace: 'LUMEN', channel: 'W컨셉', startDate: '2026-10-20', discountRate: 20 };
test('일정 확정은 브랜드·채널·할인율을 보존하고 종료일 누락만 시작일로 채운다', () => {
  const p = schedulePayload(input);
  assert.equal(p.endDate, '2026-10-20');
  assert.equal(p.discountRate, 20);
  assert.equal(p.workspace, 'LUMEN');
  assert.equal(schedulePayload({ ...input, discountRate: 0 }).discountRate, 0);
});
test('잘못된 날짜·종료일·브랜드·채널·할인율은 임의 보정하거나 저장하지 않는다', () => {
  for (const patch of [{ startDate: '2026-02-30' }, { endDate: '2026-10-19' }, { workspace: 'OEM' },
    { workspace: '' }, { channel: '' }, { discountRate: 101 }, { discountRate: -1 }, { discountRate: 'abc' }]) {
    assert.throws(() => schedulePayload({ ...input, ...patch }));
  }
});
test('캘린더의 현재 팀 표기도 대표 운영 감시에 전달된다', async () => {
  assert.deepEqual(campaignTeams('국내 MD', 'LUMEN'), ['국내 MD']);
  assert.deepEqual(campaignTeams('물류·CS', 'LUMEN'), ['물류·CS']);
  const read = async (path: string) => ({ ok: true, status: 200, json: async () => path.startsWith('campaigns?') ? [{
    ...input, start_date: '2026-10-20', end_date: '2026-10-25', status: 'draft',
    tasks: [{ team: '루멘 디자인', label: '이미지 준비', dueDate: '2020-01-01' }],
  }] : [] }) as Response;
  const w = await gatherWatch(read, async () => null);
  assert.equal(w.get('루멘 디자인')!.alerts, 1);
});
