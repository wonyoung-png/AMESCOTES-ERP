// 업무 카드 — 직원이 한 줄 쓰면 AI 가 카드로 바꾸고, 필요한 사람에게 알림을 보낸다.
//
//  "W컨셉 기획전 연락 옴, 아직 미정, 팀장님 확인 필요"  → 확인 요청 → 팀장 알림
//  "W컨셉 기획전 10/20 파니에 토트 20% 예정"           → 일정 → 확정하면 운영캘린더 + 마케팅 공유
//
// 접수함(capture.ts)과 같은 원칙: 누가 썼는지·누가 확정했는지는 서버가 세션에서 읽는다.
import { Router, type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireUser, userOf, restAsServer, type SessionUser } from './auth.js';

const router = Router();

const KINDS = ['request_check', 'schedule', 'share'] as const;
type Kind = typeof KINDS[number];

const CHANNELS = ['자사몰', '센텀', '29CM', 'W컨셉', '쇼룸', '해외'];

/** 일정·기획전이 확정되면 같이 알아야 하는 팀 — 올린 팀은 빼고 보낸다 */
const SCHEDULE_SHARE = ['마케팅', '물류CS'];

const genId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

type Member = { id: string; name: string; team: string; position: string; role: string; email: string };

/** 세션 사용자에 팀·직책을 붙여 읽는다 (auth.ts 의 SessionUser 에는 없다) */
async function members(): Promise<Member[]> {
  const r = await restAsServer('app_users?is_active=eq.true&select=id,name,team,position,role,email');
  if (!r.ok) return [];
  return (await r.json()).map((u: any) => ({
    id: String(u.id), name: String(u.name || u.email), team: String(u.team || ''),
    position: String(u.position || ''), role: String(u.role || ''), email: String(u.email || ''),
  }));
}

const isBoss = (m?: Member | SessionUser) => m?.role === '대표';

/** 팀장. 직책에 '팀장'이 든 사람. 없으면 대표(@atlm.kr)에게 간다 — 요청이 허공에 뜨면 안 된다 */
function leadersOf(team: string, all: Member[]): Member[] {
  const lead = all.filter(m => m.team === team && m.position.includes('팀장'));
  if (lead.length) return lead;
  return all.filter(m => m.role === '대표' && m.email.endsWith('@atlm.kr'));
}

async function notify(rows: Array<{ user_id: string; card_id: string; title: string; body?: string }>) {
  const uniq = new Map(rows.map(r => [r.user_id, r]));
  if (!uniq.size) return;
  const r = await restAsServer('notifications', {
    method: 'POST',
    body: JSON.stringify(Array.from(uniq.values()).map(n => ({ id: genId('ntf'), link: '/work', ...n }))),
  });
  // 알림이 안 가도 카드는 남아 있다. 저장을 되돌릴 일은 아니고 로그만 남긴다
  if (!r.ok) console.error('[work] 알림 저장 실패:', (await r.text()).slice(0, 300));
}

// ───────────────────────── AI 판정

async function classify(opts: {
  text: string; me: Member; open: Array<{ id: string; raw_text: string; kind: string }>;
}): Promise<{ kind: Kind; parsed: Record<string, any>; relatedId: string | null }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { kind: 'share', parsed: { summary: opts.text }, relatedId: null };

  const openList = opts.open.map(c => `- id=${c.id} [${c.kind}] ${c.raw_text}`).join('\n') || '(없음)';
  const sys = `너는 패션 브랜드 회사의 업무 비서다. 직원이 쓴 한 줄을 업무 카드로 바꾼다.
오늘(한국): ${kstToday()}. 쓴 사람: ${opts.me.name} (${opts.me.team || '팀 미지정'}).

종류(kind):
- request_check : 결정·확인을 윗사람에게 받아야 한다 ("팀장님 확인 필요", "결정 못함", "어떻게 할까요")
- schedule      : 날짜가 있는 기획전·할인·행사 일정이다 ("10/20 W컨셉 기획전 20%")
- share         : 그 밖의 진행 공유·메모

채널은 이 중 하나로 맞춘다: ${CHANNELS.join(' | ')} (없으면 비운다)
브랜드가 에탈루프(AETALOOF)면 workspace=AETALOOF, 아니면 LUMEN.

이 팀에 열려 있는 카드:
${openList}
같은 건(같은 채널·같은 기획전 등)이 위에 있으면 relatedId 에 그 id 를 넣는다. 아니면 null.

규칙:
- 적혀 있지 않은 것은 지어내지 마라. 연도가 없으면 오늘 이후 가장 가까운 날짜로 본다.
- endDate 가 없으면 startDate 와 같게 둔다.
- title 은 캘린더에 보일 짧은 이름이다. 예) "W컨셉 기획전 · 파니에 토트 20%"

JSON 하나만 출력한다. 설명 금지.
{"kind":"...","relatedId":null,"parsed":{"summary":"","title":"","channel":"","startDate":"","endDate":"","discountRate":null,"products":"","workspace":"LUMEN"}}`;

  try {
    const r = await new Anthropic({ apiKey: key }).messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system: sys,
      messages: [{ role: 'user', content: opts.text }],
    });
    const raw = r.content.find(c => c.type === 'text')?.text || '';
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const kind: Kind = KINDS.includes(j.kind) ? j.kind : 'share';
    const relatedId = opts.open.some(c => c.id === j.relatedId) ? j.relatedId : null;
    return { kind, parsed: j.parsed && typeof j.parsed === 'object' ? j.parsed : {}, relatedId };
  } catch (e) {
    // 판정이 안 돼도 기록은 남겨야 한다. 공유 카드로 두고 사람이 본다
    console.warn('[work] 판정 실패:', String(e).split('\n')[0]);
    return { kind: 'share', parsed: { summary: opts.text }, relatedId: null };
  }
}

// ───────────────────────── 올리기

router.post('/api/work', requireUser(), async (req: Request, res: Response) => {
  try {
    const all = await members();
    const me = all.find(m => m.id === userOf(req).id);
    if (!me) { res.status(401).json({ error: 'no_session' }); return; }
    const text = String((req.body ?? {}).text || '').trim();
    if (!text) { res.status(400).json({ error: 'empty' }); return; }
    if (text.length > 2000) { res.status(400).json({ error: 'too_long' }); return; }

    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const or = await restAsServer(
      `work_cards?status=eq.open&team=eq.${encodeURIComponent(me.team)}&created_at=gte.${since}` +
      `&select=id,raw_text,kind&order=created_at.desc&limit=20`);
    const open = or.ok ? await or.json() : [];

    const { kind, parsed, relatedId } = await classify({ text, me, open });

    // 확인 요청이면 팀장이 답할 사람이다. 팀장 본인이 쓴 것이면 대표에게 올린다
    let assignee: Member | undefined;
    if (kind === 'request_check') {
      const leads = leadersOf(me.team, all).filter(m => m.id !== me.id);
      assignee = leads[0] || leadersOf('', all).find(m => m.id !== me.id);
    }

    const card = {
      id: genId('wc'),
      created_by: me.id, created_by_name: me.name, team: me.team,
      raw_text: text, kind, parsed,
      status: 'open',
      assignee_id: assignee?.id || null, assignee_name: assignee?.name || null,
      related_id: relatedId,
    };
    const r = await restAsServer('work_cards', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(card),
    });
    if (!r.ok) { res.status(502).json({ error: 'save_failed', detail: (await r.text()).slice(0, 300) }); return; }

    if (assignee) {
      await notify([{ user_id: assignee.id, card_id: card.id, title: `${me.name} — 확인 요청`, body: text }]);
    }
    res.json({ ok: true, card: (await r.json())[0] });
  } catch (e) {
    console.error('POST /api/work 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ───────────────────────── 피드

router.get('/api/work', requireUser(), async (req: Request, res: Response) => {
  try {
    const all = await members();
    const me = all.find(m => m.id === userOf(req).id);
    if (!me) { res.status(401).json({ error: 'no_session' }); return; }

    // 대표는 전부. 나머지는 우리 팀 것 + 우리 팀에 공유된 것 + 내가 쓴 것 + 나한테 온 것
    const id = encodeURIComponent(me.id);
    const filter = isBoss(me) ? '' : (() => {
      const t = encodeURIComponent(`"${me.team.replace(/"/g, '')}"`);
      return `&or=(created_by.eq.${id},assignee_id.eq.${id}` +
        (me.team ? `,team.eq.${encodeURIComponent(me.team)},shared_teams.cs.{${t}}` : '') + ')';
    })();
    const r = await restAsServer(`work_cards?select=*&order=created_at.desc&limit=200${filter}`);
    if (!r.ok) { res.status(502).json({ error: 'db', detail: (await r.text()).slice(0, 300) }); return; }
    res.json({
      items: await r.json(),
      me: { id: me.id, name: me.name, team: me.team, isLeader: me.position.includes('팀장'), isBoss: isBoss(me) },
    });
  } catch (e) {
    console.error('GET /api/work 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

/** 카드를 손댈 수 있는 사람: 쓴 사람 · 받은 사람 · 그 팀 팀장 · 대표 */
async function loadForActor(req: Request, res: Response) {
  const all = await members();
  const me = all.find(m => m.id === userOf(req).id);
  if (!me) { res.status(401).json({ error: 'no_session' }); return null; }
  const r = await restAsServer(`work_cards?id=eq.${encodeURIComponent(String(req.params.id))}&select=*`);
  const card = r.ok ? (await r.json())[0] : null;
  if (!card) { res.status(404).json({ error: 'not_found' }); return null; }
  const leader = me.position.includes('팀장') && me.team === card.team;
  return { all, me, card, leader };
}

// ───────────────────────── 확인 요청에 답하기

router.post('/api/work/:id/reply', requireUser(), async (req: Request, res: Response) => {
  try {
    const ctx = await loadForActor(req, res);
    if (!ctx) return;
    const { me, card, leader } = ctx;
    if (!(card.assignee_id === me.id || leader || isBoss(me))) { res.status(403).json({ error: 'forbidden' }); return; }
    // 일정 카드를 답변으로 닫으면 캘린더 등록 없이 끝나버린다 (코덱스 지적)
    if (card.kind !== 'request_check') { res.status(400).json({ error: 'not_request' }); return; }
    const text = String((req.body ?? {}).text || '').trim();
    if (!text) { res.status(400).json({ error: 'reply_required' }); return; }

    const r = await restAsServer(`work_cards?id=eq.${encodeURIComponent(card.id)}&status=eq.open`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'done', reply_text: text, replied_by_name: me.name, replied_at: new Date().toISOString(),
        done_by_name: me.name, done_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }),
    });
    if (!r.ok) { res.status(502).json({ error: 'db', detail: (await r.text()).slice(0, 300) }); return; }
    if (!(await r.json()).length) { res.status(409).json({ error: 'already' }); return; }

    if (card.created_by && card.created_by !== me.id) {
      await notify([{ user_id: card.created_by, card_id: card.id, title: `${me.name} — 답변`, body: text }]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/work/:id/reply 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ───────────────────────── 일정 확정 → 운영캘린더

router.post('/api/work/:id/confirm', requireUser(), async (req: Request, res: Response) => {
  try {
    const ctx = await loadForActor(req, res);
    if (!ctx) return;
    const { all, me, card, leader } = ctx;
    if (!(card.created_by === me.id || leader || isBoss(me))) { res.status(403).json({ error: 'forbidden' }); return; }

    const payload = { ...(card.parsed || {}), ...((req.body ?? {}).payload || {}) };
    if (payload.channel && !CHANNELS.includes(payload.channel)) payload.channel = '';
    const shared = SCHEDULE_SHARE.filter(t => t !== card.team);

    const r = await restAsServer('rpc/confirm_schedule_card', {
      method: 'POST',
      body: JSON.stringify({ p_id: card.id, p_payload: payload, p_actor_name: me.name, p_shared: shared }),
    });
    if (!r.ok) {
      const detail = await r.text();
      const msg =
        detail.includes('already:')        ? '이미 처리된 카드입니다'
        : detail.includes('title_required') ? '기획전 이름을 넣어주세요'
        : detail.includes('start_required') ? '시작일을 넣어주세요'
        : detail.includes('not_schedule')   ? '일정 카드가 아닙니다'
        : '';
      console.error(`[work] 확정 실패 ${card.id} (${r.status}):`, detail.slice(0, 500));
      res.status(400).json({ error: 'confirm_failed', message: msg, detail: detail.slice(0, 300) });
      return;
    }
    const ref = await r.json();

    // 공유받는 팀원 + 쓴 사람(남이 확정했을 때)에게 알림
    const title = String(payload.title || card.raw_text);
    const when = payload.startDate === payload.endDate || !payload.endDate
      ? payload.startDate : `${payload.startDate}~${payload.endDate}`;
    await notify([
      ...all.filter(m => shared.includes(m.team) && m.id !== me.id)
        .map(m => ({ user_id: m.id, card_id: card.id, title: `[${card.team || '팀'}] 일정 공유`, body: `${when} ${title}` })),
      ...(card.created_by && card.created_by !== me.id
        ? [{ user_id: card.created_by, card_id: card.id, title: `${me.name} — 캘린더 등록`, body: `${when} ${title}` }] : []),
    ]);
    res.json({ ok: true, ref, shared });
  } catch (e) {
    console.error('POST /api/work/:id/confirm 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ───────────────────────── 알림

router.get('/api/notifications', requireUser(), async (req: Request, res: Response) => {
  try {
    const id = encodeURIComponent(userOf(req).id);
    const r = await restAsServer(`notifications?user_id=eq.${id}&select=*&order=created_at.desc&limit=30`);
    if (!r.ok) { res.status(502).json({ error: 'db' }); return; }
    const items = await r.json();
    res.json({ items, unread: items.filter((n: any) => !n.read_at).length });
  } catch (e) {
    console.error('GET /api/notifications 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/api/notifications/read', requireUser(), async (req: Request, res: Response) => {
  try {
    const id = encodeURIComponent(userOf(req).id);
    const r = await restAsServer(`notifications?user_id=eq.${id}&read_at=is.null`, {
      method: 'PATCH', body: JSON.stringify({ read_at: new Date().toISOString() }),
    });
    res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch (e) {
    console.error('POST /api/notifications/read 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
