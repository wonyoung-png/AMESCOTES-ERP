import assert from 'node:assert/strict';
import test from 'node:test';
import { gatherWatch, campaignTeams } from './watch';
import { kstToday } from './work';

const pms = async () => ({ sales: { daily30: [{ total: 100 }] }, inventory: { skus: 1 } });
function reader(tables: Record<string, any[]>, fail = '') {
  return async (path: string) => {
    const [table, query] = path.split('?');
    const params = new URLSearchParams(query);
    const offset = Number(params.get('offset'));
    return { ok: table !== fail, status: table === fail ? 503 : 200,
      json: async () => (tables[table] || []).slice(offset, offset + 500) } as Response;
  };
}

test('디자인 준비 요청은 해당 브랜드 팀에만 전달한다', () => {
  assert.deepEqual(campaignTeams('디자인', 'LUMEN'), ['루멘 디자인']);
  assert.deepEqual(campaignTeams('디자인', 'AETALOOF'), ['에탈루프 디자인']);
  assert.deepEqual(campaignTeams('디자인', 'OEM'), []);
});

test('2,000건 이상도 전수 집계하고 실제 입고완료 건을 납기 지연으로 세지 않는다', async () => {
  const orders = Array.from({ length: 2101 }, (_, i) => ({ id: String(i), order_no: String(i), quantity: 10,
    status: '생산중', delivery_date: '2020-01-01', workspace: 'OEM', factory_unit_price_krw: 1 }));
  const receipts = orders.map(o => ({ order_id: o.id, log_type: 'inbound', qty: 10 }));
  const w = await gatherWatch(reader({ production_orders: orders, receipt_logs: receipts }), pms);
  assert.match(w.get('생산관리')!.facts.join('\n'), /입고완료·상태 확인/);
  assert.match(w.get('생산관리')!.facts.join('\n'), /확인 필요 2101건/);
  assert.match(w.get('생산관리')!.facts.join('\n'), /납기 지남 0/);
});

test('조회 실패는 정상 상태로 표시하지 않고 입고 실패 때 납기 판단을 보류한다', async () => {
  const w = await gatherWatch(reader({}, 'receipt_logs'), async () => null);
  assert.ok(w.get('생산관리')!.alerts > 0);
  assert.match(w.get('생산관리')!.facts.join('\n'), /판단 보류/);
  assert.ok(w.get('국내 MD')!.alerts > 0);
});

test('미수금은 부분수금 차감, 자금계획은 확정입고 비용 중복 차감, 은행잔고 단정 금지', async () => {
  const today = kstToday();
  const w = await gatherWatch(reader({
    settlements: [{ billed_amount_krw: 100000, collected_amount_krw: 40000, status: '부분수금', due_date: today }],
    payables: [
      { source_type: 'processing', order_id: 'o', amount_krw: 100000, paid_amount_krw: 0, due_date: today },
      { source_type: 'order_receipt', order_id: 'o', amount_krw: 60000, paid_amount_krw: 20000, due_date: today },
    ],
  }), pms);
  const facts = w.get('경영지원')!.facts.join('\n');
  assert.match(facts, /미수금 1건 6만원/);
  assert.match(facts, /입금 6만원 \(확정 6만원\), 출금 8만원 \(확정 4만원\)/);
  assert.match(facts, /은행 잔고 미연동/);
});

test('숫자가 같더라도 분리된 브랜드의 매출 근거를 버리지 않는다', async () => {
  const w = await gatherWatch(reader({}), pms);
  const facts = w.get('국내 MD')!.facts.join('\n');
  assert.match(facts, /LUMEN 이번 달/);
  assert.match(facts, /AETALOOF 이번 달/);
});

test('종료 확인 누락은 경고하지만 이미 종료한 행사 준비업무는 재촉하지 않는다', async () => {
  const w = await gatherWatch(reader({ campaigns: [
    { title: '지난 행사', status: 'active', start_date: '2020-01-01', end_date: '2020-01-02' },
    { title: '완료 행사', status: 'closed', tasks: [{ team: '디자인', label: '완료한 준비', dueDate: '2020-01-01' }], workspace: 'LUMEN' },
  ] }), pms);
  assert.match(w.get('마케팅')!.facts.join('\n'), /종료 확인 필요/);
  assert.equal(w.has('루멘 디자인'), false);
});
