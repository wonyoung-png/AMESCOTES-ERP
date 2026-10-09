import { Router } from 'express';
import { requireUser, restAsServer } from './auth.js';
import { allRows } from './work-records.js';

const router = Router();
export const validPayment = (amount: unknown, expected: unknown) =>
  typeof amount === 'number' && Number.isFinite(amount) && amount > 0
  && typeof expected === 'number' && Number.isFinite(expected) && expected >= 0;

router.get('/api/payables', requireUser(), async (_req, res) => {
  try { res.json({ items: await allRows('payables?select=*&order=id.asc') }); }
  catch (e) { console.error('[payables] read', e); res.status(502).json({ message: '미지급 조회에 실패했습니다' }); }
});
router.post('/api/payables/:id/payment', requireUser(), async (req, res) => {
  const { amount, expectedPaid } = req.body || {};
  if (!validPayment(amount, expectedPaid)) { res.status(400).json({ message: '올바른 지급 금액을 입력해주세요' }); return; }
  try {
    const r = await restAsServer('rpc/record_payable_payment', { method: 'POST', body: JSON.stringify({ p_id: req.params.id, p_amount: amount, p_expected_paid: expectedPaid }) });
    if (!r.ok) {
      const detail = await r.text();
      const messages: Record<string, string> = { stale_payment: '지급액이 변경됐습니다 — 최신 지급 기록을 확인해주세요',
        overpayment: '미지급 잔액을 초과할 수 없습니다', planned_only: '예상 계획을 먼저 확정해주세요',
        invalid_payment: '올바른 지급 금액을 입력해주세요', not_found: '미지급을 찾을 수 없습니다' };
      res.status(r.status >= 500 ? 502 : 409).json({ message: Object.entries(messages).find(([key]) => detail.includes(key))?.[1] || '지급 기록 저장 실패' }); return;
    }
    res.json({ item: await r.json() });
  } catch (e) { console.error('[payables] payment', e); res.status(502).json({ message: '지급 결과를 확인하지 못했습니다 — 재입력 전에 최신 기록을 조회해주세요' }); }
});
export default router;
