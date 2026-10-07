// 접수함 — 현장에서 사진 한 장 + 한 줄로 올리고, 팀장이 승인하면 ERP 전표가 된다.
//
// 왜 서버에서 다 하나:
//  - "누가 올렸나"는 클라이언트 말을 믿으면 안 된다. 쿠키를 열어 app_users 를 다시 읽는다.
//  - 승인은 되돌리기 어렵다. 역할 검사를 화면이 아니라 여기서 한다.
//  - 승인 한 번에 "원본 레코드 생성 + 접수함 상태 변경"이 같이 끝나야 한다.
//    화면에서 두 번 부르면 중간에 끊겼을 때 전표만 생기고 접수함은 pending 으로 남는다.
import { Router, type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireUser, requireRole, userOf, rest, restAsServer } from './auth.js';

const router = Router();

/** 승인할 수 있는 사람 */
const APPROVER_ROLES = ['대표', '생산관리팀장'];

const genId = () => `cap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ───────────────────────── AI 판정

const KINDS = ['sample', 'material', 'delivery', 'billing', 'unknown'] as const;
type Kind = typeof KINDS[number];

/**
 * 올린 사진과 한 줄을 읽어 무슨 일인지 가린다.
 *
 * 브랜드·거래처 목록을 같이 넘긴다. 안 넘기면 "로우클래식"을 그대로 적어 두고 끝나서,
 * 승인할 때 사람이 다시 거래처를 골라야 한다 — 그러면 자동으로 한 뜻이 없다.
 */
async function classify(opts: {
  text: string;
  photo?: string;
  brands: Array<{ buyerId: string; buyerName: string; brand: string; brandCode: string }>;
  stages: string[];
}): Promise<{ kind: Kind; parsed: Record<string, unknown>; confidence: number }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { kind: 'unknown', parsed: { note: 'AI 키 없음' }, confidence: 0 };

  const brandList = opts.brands
    .map(b => `- ${b.brand} (거래처: ${b.buyerName}, buyerId: ${b.buyerId}, brandCode: ${b.brandCode})`)
    .join('\n') || '(등록된 브랜드 없음)';

  const sys = `너는 핸드백 OEM 공장의 접수 담당이다. 직원이 현장에서 올린 사진 한 장과 한 줄을 읽고 무슨 일인지 가린다.

종류(kind):
- sample   : 샘플을 만들었다/받았다/수정했다
- material : 자재를 샀다 (영수증·거래명세서 사진이면 대개 이것)
- delivery : 본생산을 납품했다
- billing  : 바이어에게 청구할 건이다
- unknown  : 못 가리겠다

등록된 브랜드:
${brandList}

샘플 단계(stage)는 반드시 이 중 하나다: ${opts.stages.join(' | ')}
"완료"나 "승인"이라고 쓰여 있으면 최종승인으로 본다.

규칙:
- 적혀 있지 않은 것은 지어내지 마라. 모르면 그 칸을 비워라.
- styleNo 는 품번(예: AT2603HB01)이 적혀 있을 때만 넣는다. 품명에서 만들어내지 마라.
- delivery 면 qty(납품 수량)를 꼭 찾아라. 몇 개 나갔는지가 핵심이다.
- 브랜드는 위 목록에서만 고른다. 목록에 없으면 brand 에 들은 그대로 적고 buyerId 는 비운다.
- confidence 는 네가 얼마나 확신하는지다. 브랜드를 못 찾았거나 금액이 없으면 낮춰라.

JSON 하나만 출력한다. 설명 금지.
{"kind":"...","confidence":0.0~1.0,"parsed":{
  "brand":"","buyerId":"","brandCode":"",
  "styleNo":"","styleName":"","color":"","stage":"","qty":null,
  "amountKrw":null,"vendorName":"","note":""
}}`;

  const content: Anthropic.MessageParam['content'] = [];
  if (opts.photo?.startsWith('data:')) {
    const [meta, data] = opts.photo.split(',');
    const mt = /data:([^;]+)/.exec(meta)?.[1] || 'image/jpeg';
    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mt) && data) {
      content.push({ type: 'image', source: { type: 'base64', media_type: mt as any, data } });
    }
  }
  content.push({ type: 'text', text: opts.text || '(글 없음)' });

  try {
    const r = await new Anthropic({ apiKey: key }).messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      system: sys,
      messages: [{ role: 'user', content }],
    });
    const raw = r.content.find(c => c.type === 'text')?.text || '';
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const kind: Kind = KINDS.includes(j.kind) ? j.kind : 'unknown';
    return {
      kind,
      parsed: j.parsed && typeof j.parsed === 'object' ? j.parsed : {},
      confidence: Number(j.confidence) >= 0 ? Math.min(1, Number(j.confidence)) : 0,
    };
  } catch (e) {
    // 판정이 안 되는 건 올리기를 막을 이유가 아니다. unknown 으로 접수하고 사람이 고른다
    console.warn('[capture] 판정 실패:', String(e).split('\n')[0]);
    return { kind: 'unknown', parsed: {}, confidence: 0 };
  }
}

/** 거래처에 달린 브랜드를 평평하게 — AI 에게 넘길 목록 */
async function brandList() {
  try {
    const r = await rest('vendors?select=id,name,name_en,type,brands');
    if (!r.ok) return [];
    const rows = await r.json();
    const out: Array<{ buyerId: string; buyerName: string; brand: string; brandCode: string }> = [];
    // 한 브랜드가 거래처 두 곳에 걸려 있기도 하다 (아뜰리에드루멘 = LUMEN).
    // 목록에 두 번 적으면 AI 가 어느 쪽을 고를지 헷갈린다 — 이름 기준으로 한 번만 넣는다
    const seen = new Set<string>();
    for (const v of rows) {
      const raw = v.brands;
      const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);
      for (const b of arr) {
        const name = typeof b === 'string' ? b : b?.name;
        if (!name) continue;
        const key = String(name).normalize('NFC').replace(/\s+/g, '').toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          buyerId: String(v.id), buyerName: String(v.name || ''),
          brand: String(name), brandCode: String((typeof b === 'object' && b?.code) || ''),
        });
      }
    }
    return out;
  } catch { return []; }
}

const SAMPLE_STAGES = ['1차', '2차', '3차', '4차', '최종승인', '반려'];

// ───────────────────────── 접수

router.post('/api/captures', requireUser(), async (req: Request, res: Response) => {
  try {
    const me = userOf(req);
    const { text, photo } = (req.body ?? {}) as { text?: string; photo?: string };
    if (!text?.trim() && !photo) { res.status(400).json({ error: 'empty' }); return; }

    const { kind, parsed, confidence } = await classify({
      text: (text || '').trim(),
      photo,
      brands: await brandList(),
      stages: SAMPLE_STAGES,
    });

    const row = {
      id: genId(),
      created_by: me.id,
      created_by_name: me.name || me.email,
      photo: photo || null,
      raw_text: (text || '').trim(),
      kind,
      parsed,
      confidence,
      status: 'pending',
    };
    const r = await restAsServer('capture_inbox', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!r.ok) { res.status(502).json({ error: 'save_failed', detail: await r.text() }); return; }
    res.json({ ok: true, capture: (await r.json())[0] });
  } catch (e) {
    console.error('POST /api/captures 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ───────────────────────── 목록

router.get('/api/captures', requireUser(), async (req: Request, res: Response) => {
  try {
    const me = userOf(req);
    const status = String(req.query.status || 'pending');
    // 승인권자는 전부 본다. 나머지는 자기가 올린 것만 — 남의 경비 사진을 볼 이유가 없다
    const mineOnly = !APPROVER_ROLES.includes(me.role);
    const q = [
      'select=*',
      status === 'all' ? '' : `status=eq.${encodeURIComponent(status)}`,
      mineOnly ? `created_by=eq.${encodeURIComponent(me.id)}` : '',
      'order=created_at.desc',
      'limit=200',
    ].filter(Boolean).join('&');
    const r = await restAsServer(`capture_inbox?${q}`);
    if (!r.ok) { res.status(502).json({ error: 'db', detail: await r.text() }); return; }
    res.json({ items: await r.json(), canApprove: !mineOnly });
  } catch (e) {
    console.error('GET /api/captures 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ───────────────────────── 승인 / 반려

/**
 * 승인 = 원본 레코드 생성 + 접수함 상태 변경.
 *
 * 둘을 서버에서 나눠 부르면 안 된다 (코덱스 지적):
 *  - 두 사람이 동시에 누르면 샘플이 두 개 생긴다
 *  - 레코드는 생겼는데 상태 변경이 실패하면 다음 승인 때 또 생긴다
 * PostgREST 로는 트랜잭션을 못 걸어서 DB 함수 하나로 묶었다 (approve_capture).
 * 그 안에서 행을 잠그고(for update) 검사·생성·갱신을 한 번에 한다.
 */
router.post('/api/captures/:id/approve', requireRole(...APPROVER_ROLES), async (req: Request, res: Response) => {
  try {
    const me = userOf(req);
    const capId = String(req.params.id);
    const { payload } = (req.body ?? {}) as { payload?: Record<string, any> };
    const kind = String(payload?.kind || 'sample');

    const r = await restAsServer('rpc/approve_capture', {
      method: 'POST',
      body: JSON.stringify({
        p_id: capId,
        p_kind: kind,
        p_payload: payload || {},
        p_reviewer: me.id,
        p_reviewer_name: me.name || me.email,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      // 아는 사유는 사람 말로, 모르는 사유는 그대로 내보낸다.
      // "승인 실패" 한 마디로 뭉개면 왜 안 되는지 아무도 알 수 없다
      // 청구 쪽 사유를 먼저 본다 — bill_amount_required 는 amount_required 를,
      // bill_buyer_not_found 는 not_found 를 품고 있어서 순서가 바뀌면 엉뚱한 말이 나간다
      const msg =
        detail.includes('already:')            ? '이미 처리된 접수입니다'
        : detail.includes('bill_buyer_not_found') ? '청구할 거래처를 찾지 못했습니다'
        : detail.includes('bill_buyer_required')  ? '청구금액을 적었으면 청구할 곳도 골라주세요'
        : detail.includes('bill_amount_required') ? '청구금액을 넣어주세요'
        : detail.includes('statement_not_found')  ? '고른 거래명세표를 찾지 못했습니다'
        : detail.includes('statement_locked')     ? '이미 청구·수금이 끝난 명세표입니다. 새 명세표로 만들어주세요'
        : detail.includes('order_required')       ? '어느 발주의 납품인지 골라주세요'
        : detail.includes('qty_required')          ? '납품 수량을 넣어주세요'
        : detail.includes('not_found')          ? '접수를 찾지 못했습니다'
        : detail.includes('style_name_required')? '품명을 넣어주세요'
        : detail.includes('kind_not_ready')     ? '이 종류는 아직 전표를 만들지 않습니다'
        : detail.includes('amount_required')    ? '금액을 넣어주세요'
        : detail.includes('description_required')? '무엇을 샀는지 적어주세요'
        : '';
      // 서버 로그에도 남긴다 — 화면만 보고는 원인을 못 쫓는다
      console.error(`[capture] 승인 실패 ${capId} (${r.status}):`, detail.slice(0, 500));
      res.status(400).json({ error: 'approve_failed', message: msg, detail: detail.slice(0, 500) });
      return;
    }
    res.json({ ok: true, ref: await r.json() });
  } catch (e) {
    console.error('POST /api/captures/:id/approve 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/api/captures/:id/reject', requireRole(...APPROVER_ROLES), async (req: Request, res: Response) => {
  try {
    const me = userOf(req);
    const { reason } = (req.body ?? {}) as { reason?: string };
    if (!reason?.trim()) { res.status(400).json({ error: 'reason_required' }); return; }

    const r = await restAsServer(`capture_inbox?id=eq.${encodeURIComponent(String(req.params.id))}&status=eq.pending`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'rejected',
        reject_reason: reason.trim(),
        reviewed_by: me.id,
        reviewed_by_name: me.name || me.email,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // 반려는 올린 사람이 보고 고쳐야 하니 사진을 남긴다
      }),
    });
    if (!r.ok) { res.status(502).json({ error: 'db', detail: await r.text() }); return; }
    const rows = await r.json();
    if (rows.length === 0) { res.status(409).json({ error: 'already' }); return; }
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/captures/:id/reject 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
