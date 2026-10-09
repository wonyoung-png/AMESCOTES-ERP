import { Router } from 'express';
import { requireUser, restAsServer, userOf } from './auth.js';
import { validDate } from '../shared/schedule.js';
import { dailyFetch } from './daily-bridge.js';
import { inventoryFromSheet } from '../shared/inventory.js';

const router = Router();
export function validChinaMove(v: any) {
  return !!v && typeof v.id==='string' && /^[a-zA-Z0-9_-]{1,160}$/.test(v.id) && ['LUMEN','AETALOOF'].includes(v.workspace)
    && typeof v.styleNo === 'string' && !!v.styleNo.trim() && typeof v.color === 'string' && !!v.color.trim()
    && Number.isSafeInteger(v.qty) && v.qty !== 0 && Math.abs(v.qty) <= 2147483647
    && ['inbound','outbound','adjust'].includes(v.moveType) && (v.moveType === 'adjust' || v.qty > 0)
    && validDate(v.moveDate) && (v.moveType !== 'adjust' || typeof v.memo === 'string' && !!v.memo.trim());
}
async function chinaRpc(name: string, body: object) {
  const result = await restAsServer(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  if (!result.ok) {
    const detail = await result.text();
    const messages: Record<string,string> = { insufficient_china_stock: '최신 중국 재고보다 많은 수량입니다',
      stock_conflict: '같은 요청의 내용이 변경됐습니다. 이력을 확인하세요', invalid_stock_receipt: '서버 입고 원본과 브랜드·품번·컬러·정상 수량이 다릅니다',
      receipt_required: '입고는 생산 의뢰의 중국입고에서 등록하세요', invalid_stock_move: '수량·날짜·조정 사유를 확인하세요',
      transfer_not_found: '이 브랜드의 이동 기록이 없습니다', invalid_transfer: '이동 날짜·수량·입고 확인 근거를 확인하세요' };
    throw new Error(Object.entries(messages).find(([key]) => detail.includes(key))?.[1] || '중국 재고 저장 결과를 확인하지 못했습니다. 새로 조회 후 같은 요청으로 재시도하세요');
  }
  return result.json();
}
router.get('/api/inventory/china', requireUser(), async (req,res) => {
  if (!['LUMEN','AETALOOF'].includes(String(req.query.workspace))) { res.status(400).json({ error:'브랜드 확인 필요' }); return; }
  try { res.set('Cache-Control','no-store').json(await chinaRpc('china_stock_snapshot',{p_workspace:req.query.workspace})); }
  catch(e) { res.status(502).json({error:(e as Error).message}); }
});
router.post('/api/inventory/china/move', requireUser(), async(req,res) => {
  if (!validChinaMove(req.body) || req.body.moveType==='inbound') { res.status(400).json({error:'출고·조정 수량과 사유를 확인하세요'}); return; }
  try { await chinaRpc('save_china_stock_move',{p_input:req.body,p_actor:userOf(req).id}); res.json(await chinaRpc('china_stock_snapshot',{p_workspace:req.body.workspace})); }
  catch(e) { res.status(409).json({error:(e as Error).message}); }
});
router.post('/api/inventory/china/import', requireUser(), async(req,res) => {
  const {workspace,moves,confirmed}=req.body || {};
  if (confirmed!==true || !['LUMEN','AETALOOF'].includes(workspace) || !Array.isArray(moves) || moves.length>5000
    || moves.some(v=>!validChinaMove(v) || v.workspace!==workspace)) { res.status(400).json({error:'브라우저 이력과 브랜드를 확인한 후 가져오세요'}); return; }
  try { res.json(await chinaRpc('import_china_stock_history',{p_workspace:workspace,p_moves:moves,p_actor:userOf(req).id})); }
  catch(e) { res.status(409).json({error:(e as Error).message}); }
});
router.post('/api/inventory/china/transfer', requireUser(), async(req,res) => {
  const v=req.body;
  if (!v || typeof v.id!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.id) || !['LUMEN','AETALOOF'].includes(v.workspace)
    || !(v.action==='send' && validChinaMove({...v,moveType:'outbound'}) || v.action==='receive' && validDate(v.receivedDate)
      && typeof v.confirmationRef==='string' && !!v.confirmationRef.trim())) { res.status(400).json({error:'이동 수량·날짜·입고 근거를 확인하세요'}); return; }
  try { res.json(await chinaRpc('save_china_transfer',{p_input:v,p_actor:userOf(req).id})); }
  catch(e) { res.status(409).json({error:(e as Error).message}); }
});
router.get('/api/inventory/overview', requireUser(), async (req, res) => {
  const workspace = String(req.query.workspace || '');
  if (!['LUMEN', 'AETALOOF'].includes(workspace)) {
    res.status(400).json({ error: '브랜드를 선택하세요' }); return;
  }
  try {
    const sheet = await dailyFetch(`/api/sheet/${encodeURIComponent('재고관리')}?brand=${workspace.toLowerCase()}`, 15000) as { headers: string[]; rows: unknown[][] };
    const rows = inventoryFromSheet(sheet);
    const note = sheet.rows.find(row => String(row[0] ?? '').trim().startsWith('※'));
    res.set('Cache-Control', 'no-store').json({ workspace, rows, asof: note ? String(note[0]) : '',
      warning: '국내 가용은 PMS 저장값입니다. 이지어드민 API stock·출고대기 의미 대조 전이며 물리 총재고로 사용하지 않습니다.' });
  } catch (e) {
    console.error('[inventory] overview', e);
    res.status(502).json({ error: '재고 원본 조회 실패 — 수량을 0으로 대체하지 않았습니다' });
  }
});
export default router;
