import { Router } from 'express';
import { requireUser } from './auth.js';
import { dailyFetch } from './daily-bridge.js';
import { inventoryFromSheet } from '../shared/inventory.js';

const router = Router();
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
