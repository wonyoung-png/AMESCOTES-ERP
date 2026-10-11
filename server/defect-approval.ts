import { Router } from 'express';
import { requireUser, userOf, restAsServer, CEO_EMAILS } from './auth.js';
import { allRows } from './work-records.js';

// Parent integration: app.use(defectApprovalRouter) after express.json/auth host gates.
// SQL contract uses existing defect_carryovers (receipt candidates), not a new ledger.
// GET /api/defects/approval-context -> {ready,canApprove,defects,payables} raw SQL row snapshots.
// POST /api/defects/:id/approve -> {payableId,factoryResponsible:true,amount,reason,expectedDefect,expectedPayable}.
// Response -> {defectId,payable,approvedAmount,approvedBy,approvedAt,reason,retry}; retry is the saved result.
export function validDefectApproval(body: any) {
  return !!body && typeof body.payableId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(body.payableId)
    && body.factoryResponsible === true && Number.isSafeInteger(body.amount) && body.amount > 0
    && typeof body.reason === 'string' && !!body.reason.trim() && body.reason.length <= 1000
    && body.expectedDefect && typeof body.expectedDefect === 'object' && !Array.isArray(body.expectedDefect)
    && body.expectedPayable && typeof body.expectedPayable === 'object' && !Array.isArray(body.expectedPayable);
}
export function createDefectApprovalRouter(deps = { auth: requireUser, write: restAsServer, rows: allRows }) {
  const router = Router();
  const canApprove = (req: any) => userOf(req).role === '대표' && CEO_EMAILS.includes(String(userOf(req).email || '').toLowerCase());
  router.get('/api/defects/approval-context', deps.auth(), async (req, res) => {
    if (!canApprove(req)) { res.status(403).json({ message: '대표 권한으로만 불량 확정 자료를 확인할 수 있습니다.' }); return; }
    try {
      const r = await deps.write('rpc/defect_approval_version', { method: 'POST', body: '{}' });
      if (!r.ok || await r.json() !== 1) {
        res.status(503).json({ message: '불량 확정 기능 준비 전입니다 — 서버 연결과 승인 마이그레이션이 필요합니다.' }); return;
      }
      const [defects, payables] = await Promise.all([
        deps.rows('defect_carryovers?select=*&order=id.asc'), deps.rows('payables?select=*&order=id.asc'),
      ]);
      res.json({ ready: true, canApprove: true, defects, payables });
    } catch { res.status(503).json({ message: '불량 확정 자료를 조회하지 못했습니다. 새로고침 후 다시 확인해주세요.' }); }
  });
  router.post('/api/defects/:id/approve', deps.auth(), async (req, res) => {
    if (!canApprove(req)) { res.status(403).json({ message: '대표 권한으로만 불량 차감을 확정할 수 있습니다.' }); return; }
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(req.params.id)) || !validDefectApproval(req.body)) {
      res.status(400).json({ message: '공장 책임·확정 금액·사유·선택 자료를 확인해주세요.' }); return;
    }
    try {
      const r = await deps.write('rpc/approve_defect_deduction', { method: 'POST', body: JSON.stringify({
        p_id: req.params.id, p_actor_id: userOf(req).id, p_input: req.body,
      }) });
      if (!r.ok) {
        const detail = await r.text();
        const errors: Record<string, string> = {
          forbidden: '대표 권한을 다시 확인해주세요.', stale_defect: '불량 후보가 변경됐습니다. 새로고침 후 다시 선택해주세요.',
          stale_payable: '미지급 자료가 변경됐습니다. 새로고침 후 다시 선택해주세요.',
          defect_mismatch: '같은 입고·발주·공장의 미지급만 차감할 수 있습니다.',
          not_deductible: '차감 후보만 확정할 수 있습니다. 재작업·수정은 대금 차감 대상이 아닙니다.',
          payable_not_pending: '지급 완료·취소·계획 자료는 차감할 수 없습니다.',
          over_deduction: '확정 금액이 미지급 잔액을 초과합니다.', invalid_approval: '확정 금액·공장 책임·사유를 확인해주세요.',
          approval_conflict: '이미 다른 미지급에 반영된 후보입니다.', not_found: '불량 후보 또는 미지급을 찾을 수 없습니다.',
        };
        const known = Object.entries(errors).find(([key]) => detail.includes(key));
        res.status(known ? (known[0] === 'forbidden' ? 403 : 409) : 503).json({ message: known?.[1]
          || '불량 확정 기능 준비 전이거나 결과 미확인입니다. 같은 후보로 재시도하면 기존 확정 금액을 반환합니다.' }); return;
      }
      res.json(await r.json());
    } catch { res.status(503).json({ message: '확정 결과 미확인입니다. 같은 후보·미지급으로 재시도해 기존 결과를 확인해주세요.' }); }
  });
  return router;
}
export default createDefectApprovalRouter();
