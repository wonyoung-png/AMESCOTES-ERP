import { Router } from 'express';
import { requireUser, userOf, restAsServer, CEO_EMAILS } from './auth.js';

// Parent must mount this router in server/index.ts. SQL is the authorization boundary.
export function validExpenseDueDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value >= '1900-01-01' && value <= '9999-12-31'
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function createExpensePayableRouter(deps = { auth: requireUser, write: restAsServer }) {
  const router = Router();
  async function act(req: any, res: any, action: 'inspect' | 'link') {
    const actor = userOf(req);
    if (actor.role === '대표' && !CEO_EMAILS.includes(String(actor.email).toLowerCase())) {
      res.status(403).json({ error: 'forbidden' }); return;
    }
    if (!/^[A-Za-z0-9_-]{1,150}$/.test(String(req.params.id))
      || action === 'link' && !validExpenseDueDate(req.body?.dueDate)) {
      res.status(400).json({ error: 'invalid_expense_link' }); return;
    }
    try {
      const response = await deps.write('rpc/expense_payable_action', { method: 'POST', body: JSON.stringify({
        p_id: req.params.id, p_actor_id: actor.id, p_action: action,
        p_due_date: action === 'link' ? req.body.dueDate : null,
      }) });
      if (!response.ok) {
        const detail = await response.text();
        const error = ['forbidden', 'expense_not_found', 'expense_not_approved', 'expense_snapshot_mismatch',
          'expense_payable_conflict', 'expense_mapping_required', 'invalid_expense_link'].find(key => detail.includes(key));
        res.status(error === 'forbidden' ? 403 : error === 'expense_not_found' ? 404 : error ? 409 : 503)
          .json({ error: error || 'expense_link_unavailable' }); return;
      }
      res.json(await response.json());
    } catch { res.status(503).json({ error: 'expense_link_unavailable' }); }
  }
  router.get('/api/expenses/:id/payable', deps.auth(), (req, res) => act(req, res, 'inspect'));
  router.post('/api/expenses/:id/payable', deps.auth(), (req, res) => act(req, res, 'link'));
  return router;
}
export default createExpensePayableRouter();
