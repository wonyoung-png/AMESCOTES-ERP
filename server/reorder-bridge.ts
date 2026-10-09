import { Router } from 'express';
import { requireUser, userOf, restAsServer } from './auth.js';
import { dailyFetch } from './daily-bridge.js';

const router = Router();

export function reorderDraft(source: any, workspace: string, style: any, actor: string) {
  if (!['LUMEN', 'AETALOOF'].includes(workspace) || !Number.isSafeInteger(source.id) || source.id <= 0) throw new Error('브랜드/리오더 번호 오류');
  if (source.kind === 'B2B 납품' || !['초안', '승인대기'].includes(source.status)) throw new Error('신규 리오더 초안만 가져올 수 있습니다');
  if (!Number.isSafeInteger(source.qty) || source.qty <= 0 || !style?.style_no) throw new Error('상품/수량 확인 필요');
  const id = `pms-reorder-${workspace.toLowerCase()}-${source.id}`;
  return { id, workspace, project_no: `${workspace === 'LUMEN' ? 'LUM' : 'AET'}-PMS-R${source.id}`, title: `리오더 · ${source.name || source.sku}`, created_by: actor,
    style_no: style.style_no, style_name: style.name || source.name, qty: source.qty,
    memo: `PMS 리오더 #${source.id} · SKU ${source.sku} · ${source.note || ''}` };
}

router.get('/api/brand-orders/reorder/:id', requireUser(), async (req, res) => {
  try {
    const workspace = String(req.query.workspace || '');
    if (!['LUMEN', 'AETALOOF'].includes(workspace) || !/^\d+$/.test(req.params.id)) { res.status(400).json({ error: '입력 오류' }); return; }
    const rows = await dailyFetch(`/api/reorder/orders?brand=${workspace.toLowerCase()}`) as any[];
    const source = rows.find(r => String(r.id) === req.params.id);
    if (!source) { res.status(404).json({ error: '리오더를 찾을 수 없습니다' }); return; }
    res.json(source);
  } catch (e) { console.error('[reorder] preview', e); res.status(502).json({ error: '리오더 조회 실패' }); }
});

router.post('/api/brand-orders/reorder/:id', requireUser(), async (req, res) => {
  try {
    const workspace = String(req.body?.workspace || '');
    if (req.body?.confirmed !== true || !['LUMEN', 'AETALOOF'].includes(workspace) || !/^\d+$/.test(req.params.id)) { res.status(400).json({ error: '상품과 수량을 확인한 후 실행하세요' }); return; }
    const rows = await dailyFetch(`/api/reorder/orders?brand=${workspace.toLowerCase()}`) as any[];
    const source = rows.find(r => String(r.id) === req.params.id);
    if (!source) { res.status(404).json({ error: '리오더를 찾을 수 없습니다' }); return; }
    if (source.updated_at !== req.body.updatedAt) { res.status(409).json({ error: '추천 초안이 변경됐습니다. 다시 확인하세요' }); return; }
    const ir = await restAsServer(`items?style_no=eq.${encodeURIComponent(String(req.body.styleNo || ''))}&select=style_no,name&limit=2`);
    if (!ir.ok) throw new Error('상품 조회 실패');
    const items = await ir.json();
    if (items.length !== 1) { res.status(422).json({ error: 'ERP 품목을 정확히 선택하세요' }); return; }
    const payload = reorderDraft(source, workspace, items[0], userOf(req).name);
    const saved = await restAsServer('rpc/create_reorder_draft', { method: 'POST', body: JSON.stringify({ p: payload }) });
    if (!saved.ok) { console.error('[reorder] save', (await saved.text()).slice(0, 300)); res.status(502).json({ error: '생산 의뢰 저장 실패 — 기존 초안은 보존됐습니다' }); return; }
    res.json(await saved.json());
  } catch (e) { console.error('[reorder] create', e); res.status(400).json({ error: e instanceof Error ? e.message : '의뢰 생성 실패' }); }
});

export default router;
