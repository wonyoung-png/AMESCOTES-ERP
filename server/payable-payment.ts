import { Router } from 'express';
import { requireUser, restAsServer } from './auth.js';
import { allRows } from './work-records.js';
import { validDate } from '../shared/schedule.js';
import { parsePlannedExpense, isSafeDocumentUrl, PLANNED_EXPENSE_ACCOUNTS } from '../client/src/lib/cashPlan.js';

const router = Router();
export const validPayment = (amount: unknown, expected: unknown) =>
  typeof amount === 'number' && Number.isFinite(amount) && amount > 0
  && typeof expected === 'number' && Number.isFinite(expected) && expected >= 0;

export function validPlannedPayables(id: unknown, rows: unknown) {
  return typeof id==='string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id) && Array.isArray(rows) && rows.length>0 && rows.length<=100
    && Number.isSafeInteger(rows.reduce((sum,v)=>sum+(v?.amountKrw ?? NaN),0)) && rows.every(v=>{
    if (!v || typeof v.memo!=='string') return false;
    const m=parsePlannedExpense(v.memo);
    return typeof v.vendorName==='string' && !!v.vendorName.trim() && Number.isSafeInteger(v.amountKrw) && v.amountKrw>0 && validDate(v.dueDate)
      && (v.vendorId===undefined || typeof v.vendorId==='string') && (v.projectNo===undefined || typeof v.projectNo==='string')
      && m?.groupId===id && m.stage==='예상' && !!m.installment?.trim() && !!m.description.trim()
      && PLANNED_EXPENSE_ACCOUNTS.includes(m.account as any) && Number.isSafeInteger(m.budgetKrw) && m.budgetKrw!>0
      && Array.isArray(m.documents) && m.documents.every(d=>d && typeof d.name==='string' && !!d.name.trim() && typeof d.url==='string' && isSafeDocumentUrl(d.url));
  });
}
async function generatePayables(res: any, name: string, body: object) {
  try {
    const r=await restAsServer(`rpc/${name}`,{method:'POST',body:JSON.stringify(body)});
    if (!r.ok) {
      const detail=await r.text();
      const messages:Record<string,string>={price_required:'공장 원화 단가를 확정한 후 등록해주세요',china_vendor_required:'AMES-CN 중국법인 거래처를 정확히 한 건 등록해주세요',ambiguous_payable:'기존 입고 미지급 연결이 중복되거나 일치하지 않습니다 — 원본 확인이 필요합니다',plan_conflict:'같은 요청 내용이 변경됐습니다 — 저장 이력 확인이 필요합니다',invalid_plan:'지급회차 금액·날짜·내용을 확인해주세요',order_not_found:'생산 발주를 찾을 수 없습니다'};
      res.status(409).json({message:Object.entries(messages).find(([key])=>detail.includes(key))?.[1] || '저장 결과 미확인 — 이력 조회 후 같은 요청으로 재시도해주세요'}); return;
    }
    res.json(await r.json());
  } catch(e) { res.status(502).json({message:'저장 결과 미확인 — 이력 조회 후 같은 요청으로 재시도해주세요'}); }
}
router.post('/api/orders/:id/receipt-payables',requireUser(),async(req,res)=>{ await generatePayables(res,'generate_receipt_payables',{p_order_id:req.params.id}); });
router.post('/api/payables/planned',requireUser(),async(req,res)=>{
  if(!validPlannedPayables(req.body?.id,req.body?.rows)) {res.status(400).json({message:'지급회차·계정·증빙을 확인해주세요'});return;}
  await generatePayables(res,'save_planned_payables',{p_id:req.body.id,p_rows:req.body.rows});
});

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
