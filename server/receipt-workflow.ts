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
export function validShipment(v: any) {
  return !!v && typeof v.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v.id)
    && typeof v.orderId === 'string' && v.orderId.length > 0
    && Number.isInteger(v.qty) && v.qty > 0 && v.qty <= 2147483647
    && ['outbound_oem', 'outbound_3pl'].includes(v.logType)
    && ['domestic', 'b2b', 'overseas'].includes(v.deliveryMarket) && validDate(v.receivedDate)
    && (v.memo === undefined || typeof v.memo === 'string');
}
export function validStatementBilling(v: any) {
  const s = v?.statement;
  return !!s && typeof s.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s.id)
    && typeof s.vendorId === 'string' && !!s.vendorId && validDate(s.issueDate) && validDate(v.invoiceDate)
    && ['미청구', '청구완료', '수금완료'].includes(s.status)
    && (v.expectedUpdatedAt === undefined || v.expectedUpdatedAt === null
      || (typeof v.expectedUpdatedAt === 'string' && Number.isFinite(Date.parse(v.expectedUpdatedAt))))
    && Array.isArray(s.lines) && s.lines.length > 0 && s.lines.length <= 500
    && s.lines.every((l: any) => l && typeof l.description === 'string' && l.description.trim()
      && Number.isFinite(l.qty) && l.qty > 0 && Number.isFinite(l.unitPrice) && l.unitPrice >= 0
      && ['과세', '면세'].includes(l.taxType) && Number.isFinite(l.taxRate) && l.taxRate >= 0 && l.taxRate <= 1);
}
const workflowMessages: Record<string, string> = {
  invalid_settlement: '청구금액·수금액·날짜를 확인해주세요',
  stale_settlement: '다른 작업에서 미수금이 변경되었습니다 — 최신 내용을 다시 열어주세요',
  settlement_number_changed: '기존 명세서번호 변경은 별도 정정이 필요합니다',
  collection_reversal_required: '수금액을 줄이는 처리는 별도 입금 정정이 필요합니다',
  settlement_not_found: '미수금 원본을 찾을 수 없습니다',
  statement_not_billed: '청구 완료된 명세표만 수금을 연결할 수 있습니다',
  linked_bill_locked: '연결 명세표의 바이어·청구금액·사업 구분은 명세표에서 수정해주세요',
  order_not_found: '생산 발주를 찾을 수 없습니다', invalid_order_status: '확정된 생산 발주만 출고할 수 있습니다',
  over_shipment: '서버의 최신 출고 잔량을 초과합니다', invalid_shipment: '출고 수량·날짜·판매처를 확인해주세요',
  receipt_conflict: '같은 출고 요청의 내용이 바뀌었습니다 — 출고 이력을 확인해주세요',
  duplicate_statement: '명세표 번호 또는 자동 초안이 중복되어 확인이 필요합니다',
  statement_link_conflict: '발주에 연결된 명세표를 먼저 확인해주세요',
  invalid_statement: '명세표 품목·수량·단가·날짜를 확인해주세요', zero_bill: '0원 명세표는 청구할 수 없습니다',
  invalid_tax_invoice: '계산서 금액과 명세표 합계·청구 상태를 확인해주세요',
  bill_buyer_not_found: '거래처 마스터의 바이어를 확인해주세요', statement_number_changed: '기존 명세표 번호는 변경할 수 없습니다',
  stale_statement: '다른 작업에서 명세표가 변경되었습니다 — 최신 내용을 다시 열어주세요',
  issued_statement_locked: '계산서 발행 후 거래처·금액 변경은 정정 절차가 필요합니다',
  statement_not_found: '기존 명세표를 찾을 수 없습니다 — 목록을 다시 확인해주세요',
  duplicate_settlement: '같은 명세표의 미수금이 중복되어 확인이 필요합니다',
  linked_settlement: '연결된 미수금이 있습니다 — 청구 취소는 별도로 확인해주세요',
  settlement_buyer_changed: '미수금이 연결된 명세표의 바이어는 변경할 수 없습니다',
  below_collected: '이미 입금된 금액보다 청구금액을 줄일 수 없습니다',
  collection_required: '매출·미수에서 실제 수금 내역을 먼저 확인해주세요',
};
async function saveWorkflow(res: any, rpc: string, input: any) {
  try {
    const r = await restAsServer(`rpc/${rpc}`, { method: 'POST', body: JSON.stringify({ p_input: input }) });
    if (!r.ok) {
      const detail = await r.text();
      res.status(r.status >= 500 ? 502 : 409).json({ message: Object.entries(workflowMessages).find(([key]) => detail.includes(key))?.[1]
        || '저장 결과를 확인하지 못했습니다 — 이력 확인 후 같은 내용으로 재시도해주세요' }); return;
    }
    res.json({ result: await r.json() });
  } catch (e) { console.error('[workflow] save', e); res.status(502).json({ message: '저장 결과 확인이 필요합니다 — 같은 내용으로 재시도해주세요' }); }
}
router.post('/api/orders/:id/ship', requireUser(), async (req, res) => {
  const input = { ...req.body, orderId: req.params.id };
  if (!validShipment(input)) { res.status(400).json({ message: '출고 수량·날짜·판매처를 확인해주세요' }); return; }
  await saveWorkflow(res, 'record_order_shipment', input);
});
router.post('/api/statements/save-billing', requireUser(), async (req, res) => {
  if (!validStatementBilling(req.body)) { res.status(400).json({ message: '명세표 품목·수량·단가·날짜를 확인해주세요' }); return; }
  await saveWorkflow(res, 'save_statement_billing', req.body);
});
export function validSettlement(v: any) {
  const s = v?.settlement;
  return !!s && typeof s.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s.id)
    && typeof s.buyerName === 'string' && !!s.buyerName.trim()
    && ['W Concept','29CM','자사몰','해외T/T','B2B직납','기타'].includes(s.channel)
    && Number.isFinite(s.billedAmountKrw) && s.billedAmountKrw > 0 && s.billedAmountKrw <= Number.MAX_SAFE_INTEGER
    && Number.isFinite(s.collectedAmountKrw) && s.collectedAmountKrw >= 0 && s.collectedAmountKrw <= s.billedAmountKrw
    && validDate(s.invoiceDate) && validDate(s.dueDate)
    && (!s.collectedAmountKrw || validDate(s.collectedDate))
    && (v.expected == null || (typeof v.expected === 'object' && !Array.isArray(v.expected) && v.expected.id === s.id));
}
router.post('/api/settlements/save', requireUser(), async (req, res) => {
  if (!validSettlement(req.body)) { res.status(400).json({ message: '청구금액·수금액·날짜를 확인해주세요' }); return; }
  await saveWorkflow(res, 'save_settlement', req.body);
});
export default router;
