import { Router } from 'express';
import { requireUser, restAsServer, userOf } from './auth.js';
import { validDate } from '../shared/schedule.js';

const router = Router();
export function validReceipt(v: any) {
  return !!v && typeof v.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v.id)
    && typeof v.orderId === 'string' && v.orderId.length > 0
    && Number.isInteger(v.qty) && v.qty > 0 && v.qty <= 2147483647
    && Number.isInteger(v.defectQty) && v.defectQty >= 0 && v.defectQty <= v.qty
    && validDate(v.receivedDate) && typeof v.createPayable === 'boolean'
    && ['deduct', 'rework', 'repair'].includes(v.disposition)
    && (v.color === undefined || typeof v.color === 'string')
    && (v.memo === undefined || typeof v.memo === 'string')
    && (v.defectNote === undefined || typeof v.defectNote === 'string')
    && (v.isAdvance === undefined || typeof v.isAdvance === 'boolean')
    && (v.destination === undefined || ['korea','china'].includes(v.destination));
}
router.post('/api/orders/:id/receive', requireUser(), async (req, res) => {
  if (!validReceipt({...req.body,orderId:req.params.id})) {res.status(400).json({message:'입고 입력과 도착 위치를 확인해주세요'});return;}
  const input = { ...req.body, orderId: req.params.id, destination: req.body?.destination === 'china' ? 'china' : 'korea', actor: userOf(req).id };
  if (!validReceipt(input)) { res.status(400).json({ message: '입고 수량·불량·날짜·처리 방법을 확인해주세요' }); return; }
  try {
    const r = await restAsServer('rpc/record_korea_receipt', { method: 'POST', body: JSON.stringify({ p_input: input }) });
    if (!r.ok) {
      const detail = await r.text();
      const messages: Record<string, string> = { order_not_found: '생산 발주를 찾을 수 없습니다',
        invalid_order_status: '확정된 생산 발주만 입고할 수 있습니다', over_receipt: '서버의 최신 입고 잔량을 초과합니다',
        invalid_color: '발주 컬러와 컬러별 잔량을 확인해주세요', receipt_conflict: '같은 요청의 내용이 바뀌었습니다 — 입고 이력을 확인해주세요',
        invalid_receipt: '입고 수량·날짜를 확인해주세요', invalid_price: '공장 원화 단가를 확인해주세요',
        china_vendor_required: '거래처 마스터에 AMES-CN 중국법인을 정확히 한 건 등록해주세요 — 입고는 저장되지 않았습니다',
        invalid_stock_receipt: '중국입고의 브랜드·품번·컬러·정상 수량을 확인해주세요', stock_conflict: '기존 중국 재고 이력과 요청 내용이 다릅니다' };
      res.status(r.status >= 500 ? 502 : 409).json({ message: Object.entries(messages).find(([key]) => detail.includes(key))?.[1] || '입고 저장 결과를 확인하지 못했습니다 — 이력 확인 후 같은 요청으로 재시도해주세요' }); return;
    }
    res.json({ result: await r.json() });
  } catch (e) { console.error('[receipt] save', e); res.status(502).json({ message: '입고 결과를 확인하지 못했습니다 — 같은 내용으로 재시도하거나 입고 이력을 확인해주세요' }); }
});
export default router;
