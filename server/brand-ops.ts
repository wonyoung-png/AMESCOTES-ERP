// 브랜드 운영(옛 PMS) — PMS 탭을 ERP 로 옮겨 오는 자리. docs/PMS_MERGE_PLAN.md
//
// 1단계: 시트형 데이터(일일점검·재고관리·상품 리스트 …) 읽기·칸 고치기.
// 데이터는 pms_sheets (scripts/pms-import.mjs 로 PMS 에서 옮겨 온 것). 브랜드는 ?brand=lumen|aetaloof.
import { Router, type Request, type Response } from 'express';
import { requireUser, restAsServer, userOf } from './auth.js';

const router = Router();
const BRANDS = ['lumen', 'aetaloof'];
const brandOf = (req: Request) => {
  const b = String(req.query.brand || 'lumen').toLowerCase();
  return BRANDS.includes(b) ? b : null;
};

/** 이 브랜드에 있는 시트 이름들 */
router.get('/api/brand-ops/sheets', requireUser(), async (req: Request, res: Response) => {
  const brand = brandOf(req);
  if (!brand) { res.status(400).json({ error: 'bad_brand' }); return; }
  const r = await restAsServer(`pms_sheets?brand=eq.${brand}&select=name,updated_at&order=name`);
  if (!r.ok) { res.status(502).json({ error: 'db' }); return; }
  res.json({ brand, sheets: await r.json() });
});

router.get('/api/brand-ops/sheet/:name', requireUser(), async (req: Request, res: Response) => {
  const brand = brandOf(req);
  if (!brand) { res.status(400).json({ error: 'bad_brand' }); return; }
  const r = await restAsServer(`pms_sheets?brand=eq.${brand}&name=eq.${encodeURIComponent(String(req.params.name))}&select=name,headers,rows,updated_at`);
  if (!r.ok) { res.status(502).json({ error: 'db' }); return; }
  const s = (await r.json())[0];
  if (!s) { res.status(404).json({ error: 'not_found', message: `시트 없음: ${req.params.name}` }); return; }
  res.json(s);
});

/**
 * 칸 하나 고치기 (PMS /cell 대응). 읽고-고치고-쓰는 사이 남이 고쳤으면 덮지 않는다 — updated_at 으로 확인.
 * ponytail: 시트 통째 JSON 을 다시 쓴다. 동시 편집이 잦아지면 행 단위 테이블로.
 */
router.patch('/api/brand-ops/sheet/:name/cell', requireUser(), async (req: Request, res: Response) => {
  try {
    const brand = brandOf(req);
    const { row, col, value } = (req.body ?? {}) as { row?: number; col?: number; value?: unknown };
    if (!brand || !Number.isInteger(row) || !Number.isInteger(col) || row! < 0 || col! < 0) { res.status(400).json({ error: 'bad_input' }); return; }
    const name = String(req.params.name);
    const key = `brand=eq.${brand}&name=eq.${encodeURIComponent(name)}`;
    const r = await restAsServer(`pms_sheets?${key}&select=headers,rows,updated_at`);
    const s = r.ok ? (await r.json())[0] : null;
    if (!s) { res.status(404).json({ error: 'not_found' }); return; }
    if (!Array.isArray(s.headers) || !Array.isArray(s.rows) || !s.rows.every(Array.isArray)) { res.status(422).json({ error: 'bad_sheet_shape' }); return; }
    if (row! >= s.rows.length || col! >= Math.max(s.headers.length, (s.rows[row!] || []).length)) { res.status(400).json({ error: 'out_of_range' }); return; }
    const rows = s.rows.map((x: unknown[]) => [...x]);
    while (rows[row!].length <= col!) rows[row!].push('');
    rows[row!][col!] = value == null ? '' : typeof value === 'number' ? value : String(value).slice(0, 2000);
    const w = await restAsServer(`pms_sheets?${key}&updated_at=eq.${encodeURIComponent(s.updated_at)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ rows, updated_at: new Date().toISOString() }),
    });
    if (!w.ok) { res.status(502).json({ error: 'db' }); return; }
    if (!(await w.json()).length) { res.status(409).json({ error: 'conflict', message: '그사이 다른 사람이 고쳤어요. 새로고침하세요' }); return; }
    console.log(`[brand-ops] ${brand}/${name} [${row},${col}] by ${userOf(req).email}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('PATCH /api/brand-ops/sheet/:name/cell 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
