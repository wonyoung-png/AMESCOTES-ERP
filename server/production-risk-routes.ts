import { Router } from 'express';
import { requireUser, rest } from './auth.js';
import { allRows } from './work-records.js';
import { productionRisks, productionScope } from './production-risk.js';

const router = Router();
router.get('/api/production/risks', requireUser(), async (req, res) => {
  const ws = String(req.query.workspace || 'OEM');
  if (!['OEM', 'LUMEN', 'AETALOOF'].includes(ws)) { res.status(400).json({ error: '사업 구분 오류' }); return; }
  try {
    // 브랜드가 OEM에 의뢰한 생산도 해당 브랜드의 납기 판단에 포함한다.
    const batches = ws === 'OEM' ? [] : await allRows(`brand_order_batches?workspace=eq.${ws}&select=id,workspace&order=id.asc`, rest);
    const scope = productionScope(ws, batches);
    // 기존 생산 조회와 동일한 DB 역할을 쓰며, 서버 전용 권한으로 범위를 넓히지 않는다.
    const orders = await allRows(`production_orders?${scope}&select=id,order_no,style_name,style_no,quantity,status,delivery_date,confirmed_date,confirmed_at,sent_at,received_qty&order=id.asc`, rest);
    const receipts: any[] = [];
    for (let offset = 0; offset < orders.length; offset += 100) {
      const ids = orders.slice(offset, offset + 100).map(o => `"${String(o.id).replace(/"/g, '')}"`).join(',');
      receipts.push(...await allRows(`receipt_logs?order_id=in.(${encodeURIComponent(ids)})&log_type=eq.inbound&select=id,order_id,log_type,qty&order=id.asc`, rest));
    }
    const asof = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    res.json({ asof, workspace: ws, rows: productionRisks(orders, receipts, asof) });
  } catch (e) {
    console.error('[production-risk] read failed', e);
    res.status(502).json({ error: '납기·입고 조회 실패 — 위험 판단을 보류합니다' });
  }
});
export default router;
