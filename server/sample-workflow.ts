import { Router } from 'express';
import { requireUser, userOf, restAsServer } from './auth.js';
import { deliverWorkNotifications } from './work-notifications.js';

export function validSampleAction(body: any, action: string) {
  if (!body || !Number.isInteger(body.version) || body.version < 0) return false;
  if(action==='unbill')return true;
  if (action === 'complete') return Array.isArray(body.imageUrls) && body.imageUrls.length > 0 && body.imageUrls.length <= 5
    && body.imageUrls.every((url: unknown) => typeof url === 'string' && url.length <= 2_000_000
      && (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url) || /^https:\/\//.test(url)));
  return action === 'accept' && typeof body.styleName === 'string' && body.styleName.trim().length > 0 && body.styleName.length <= 200
    && typeof body.buyerId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(body.buyerId)
    && (body.brandCode == null || typeof body.brandCode === 'string' && body.brandCode.length <= 100)
    && typeof body.sampleUnitPrice === 'number' && Number.isFinite(body.sampleUnitPrice) && body.sampleUnitPrice >= 0 && body.sampleUnitPrice <= 100000000;
}

export function createSampleWorkflowRouter(deps={auth:requireUser,write:restAsServer,notify:deliverWorkNotifications}) {
const router = Router();
router.get('/api/samples/workflow/context', deps.auth(), async (req, res) => {
  try {
    const response = await deps.write('rpc/sample_workflow_version', { method: 'POST', body: '{}' });
    const actor=userOf(req);
    res.json({ actorId: actor.id, isBoss:actor.role==='대표'&&actor.email.toLowerCase()==='wonyoung@atlm.kr',ready: response.ok && await response.json() === 1 });
  } catch { res.status(503).json({ error: 'sample_workflow_unavailable' }); }
});
router.post('/api/samples/workflow/bill', deps.auth(), async (req,res) => {
  const { ids, statementId, month } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || ids.length>500 || new Set(ids).size!==ids.length
    || ids.some(id=>typeof id!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
    || (statementId!=null && (typeof statementId!=='string' || !/^[A-Za-z0-9_-]{1,150}$/.test(statementId)))
    || (month!=null && (typeof month!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)))) {
    res.status(400).json({error:'invalid_sample_ids'});return;
  }
  try {
    const response=await deps.write('rpc/bill_accepted_samples',{method:'POST',body:JSON.stringify({
      p_ids:ids,p_actor_id:userOf(req).id,p_statement_id:statementId||null,p_month:month||null,
    })});
    if(!response.ok){
      const detail=await response.text();
      const error=['forbidden','sample_not_accepted','buyer_required','buyer_mismatch','statement_not_editable','statement_not_found',
        'sample_billing_conflict','sample_selection_changed'].find(key=>detail.includes(key));
      res.status(error?(response.status>=400&&response.status<500?response.status:409):503).json({error:error||'sample_workflow_unavailable'});return;
    }
    res.json({links:await response.json()});
  } catch {res.status(503).json({error:'sample_workflow_unavailable'});}
});
router.post('/api/samples/:id/:action', deps.auth(), async (req, res) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(req.params.id)) || !validSampleAction(req.body, String(req.params.action))) {
    res.status(400).json({ error: 'invalid_sample_action' }); return;
  }
  try {
    const response = await deps.write('rpc/act_sample_workflow', { method: 'POST', body: JSON.stringify({
      p_id: req.params.id, p_action: req.params.action, p_actor_id: userOf(req).id,
      p_version: req.body.version, p_payload: req.body,
    }),headers:{'X-Work-Actor-Id':userOf(req).id} });
    if (!response.ok) {
      const detail = await response.text();
      const known = ['forbidden','stale_sample','photo_required','before_reception','sample_not_completed','sample_not_editable',
        'sample_lead_required','sample_lead_ambiguous','sample_review_invalid','buyer_required','brand_required','statement_not_editable','not_found'].find(key => detail.includes(key));
      res.status(known ? (response.status >= 400 && response.status <= 499 ? response.status : 409) : 503)
        .json({ error: known || 'sample_workflow_unavailable' }); return;
    }
    const sample=await response.json();
    res.json({ sample,notified:await deps.notify(sample.review_card_id) });
  } catch { res.status(503).json({ error: 'sample_workflow_unavailable' }); }
});
return router;
}
export default createSampleWorkflowRouter();
