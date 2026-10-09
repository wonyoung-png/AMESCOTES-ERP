import { Router } from 'express';
import { requireUser, requireRole, restAsServer, userOf } from './auth.js';
import { validDate } from '../shared/schedule.js';

const router = Router();
export const brandWorkflowError = (detail: string) => {
  const errors: Record<string, string> = {
    not_found: '발주를 찾을 수 없습니다', not_approved: '대표 승인 후 발행해주세요',
    invalid_status: '현재 상태에서 처리할 수 없습니다', invalid_lines: '품번·공장·수량·컬러 합계를 확인해주세요',
    empty_lines: '상품을 먼저 담아주세요', invalid_due: '올바른 납기를 입력해주세요',
    conflicting_orders: '이미 생성된 생산발주가 있습니다 — 원본 확인이 필요합니다',
    already_accepted: '이미 OEM에서 수주했습니다 — 생산발주에서 확인해주세요',
    too_many_factories: '한 발주 묶음은 공장·경로 26개까지 발행할 수 있습니다',
  };
  return Object.entries(errors).find(([key]) => detail.includes(key))?.[1] || '브랜드 발주 서버 처리 실패';
};
async function rpc(name: string, body: Record<string, unknown>, res: any) {
  const r = await restAsServer(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) {
    const detail = await r.text();
    console.error(`[brand-workflow] ${name} ${r.status}`, detail.slice(0, 300));
    res.status(r.status >= 500 ? 502 : 409).json({ error: 'workflow_failed', message: brandWorkflowError(detail) });
    return;
  }
  res.json({ ok: true, result: await r.json() });
}
router.post('/api/brand-batches/:id/approve', requireRole('대표'), async (req, res) => {
  try { const me = userOf(req); await rpc('approve_brand_batch', { p_id: req.params.id, p_actor_id: me.id, p_actor_name: me.name }, res); }
  catch (e) { console.error('[brand-workflow] approve', e); res.status(502).json({ error: 'unavailable', message: '승인 결과를 확인하지 못했습니다 — 다시 조회해주세요' }); }
});
router.post('/api/brand-batches/:id/issue', requireUser(), async (req, res) => {
  try { await rpc('issue_brand_batch', { p_id: req.params.id }, res); }
  catch (e) { console.error('[brand-workflow] issue', e); res.status(502).json({ error: 'unavailable', message: '발행 결과를 확인하지 못했습니다 — 다시 조회해주세요' }); }
});
router.post('/api/brand-batches/:id/cancel-issue', requireUser(), async (req, res) => {
  try { await rpc('cancel_brand_issue', { p_id: req.params.id }, res); }
  catch (e) { console.error('[brand-workflow] cancel', e); res.status(502).json({ error: 'unavailable', message: '취소 결과를 확인하지 못했습니다 — 다시 조회해주세요' }); }
});
router.post('/api/brand-pos/:poNo/accept', requireUser(), async (req, res) => {
  if (!validDate(req.body?.dueDate)) { res.status(400).json({ error: 'invalid_due', message: '올바른 납기를 입력해주세요' }); return; }
  try { await rpc('accept_brand_po', { p_po_no: req.params.poNo, p_due_date: req.body.dueDate }, res); }
  catch (e) { console.error('[brand-workflow] accept', e); res.status(502).json({ error: 'unavailable', message: '수주 결과를 확인하지 못했습니다 — 다시 조회해주세요' }); }
});
export default router;
