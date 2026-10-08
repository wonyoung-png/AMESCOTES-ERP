// 직원별 구글 캘린더 연결 (회사 구글 워크스페이스 @atlm.kr 계정만).
//
//  ERP → 구글: 직원 계정에 "ATLM 업무" 캘린더를 만들고, 내 할 일 마감·우리 팀에 공유된 기획전을 넣는다.
//             ERP 에서 바뀌면(완료·취소·날짜 변경) 구글에서도 바뀐다.
//  구글 → ERP: 본인 일정(다음 7일)을 업무 비서가 본인 질문에 답할 때만 읽는다. 남에게는 보여주지 않는다.
//
// 구글 앱 키(GOOGLE_CLIENT_ID/SECRET)가 없으면 기능 전체가 꺼진 채로 뜬다.
// 갱신 토큰은 서버 비밀키로 암호화해 저장한다.
import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { requireUser, userOf, restAsServer, signJwt, verifyJwt } from './auth.js';

const router = Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const ERP_URL = 'https://54-116-241-64.sslip.io';
const REDIRECT = process.env.GOOGLE_REDIRECT_URI || `${ERP_URL}/api/gcal/callback`;
const DOMAIN = 'atlm.kr'; // 회사 워크스페이스 계정만
const CAL_NAME = 'ATLM 업무';
const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.app.created',     // 우리가 만든 캘린더만 쓰기
  'https://www.googleapis.com/auth/calendar.events.readonly', // 본인 일정 읽기
];
export const gcalConfigured = () => !!(CLIENT_ID && CLIENT_SECRET);

// ───────── 토큰 암호화 (AES-256-GCM, 키 = 서버 비밀키에서 파생)
const KEY = crypto.createHash('sha256').update('gcal:' + (process.env.PGRST_JWT_SECRET || '')).digest();
function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64url')).join('.');
}
function open(sealed: string): string {
  const [iv, tag, enc] = sealed.split('.').map(s => Buffer.from(s, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ───────── 구글 호출
async function tokenFrom(params: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`token ${r.status} ${j.error || ''}`), { code: j.error });
  return j as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };
}

const accessCache = new Map<string, { token: string; exp: number }>();
async function accessFor(link: any): Promise<string> {
  const hit = accessCache.get(link.user_id);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const t = await tokenFrom({ grant_type: 'refresh_token', refresh_token: open(link.refresh_enc) });
  accessCache.set(link.user_id, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

async function gapi(token: string, path: string, init: RequestInit = {}) {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

async function linkOf(userId: string): Promise<any | null> {
  const r = await restAsServer(`gcal_links?user_id=eq.${encodeURIComponent(userId)}&select=*`);
  // 조회 실패를 '연결 없음'으로 바꾸면 재연결 때 캘린더가 하나 더 생긴다 — 실패는 실패로 (코덱스 지적)
  if (!r.ok) throw new Error(`gcal_links 조회 실패 ${r.status}`);
  return (await r.json())[0] || null;
}
/** 실패를 삼키지 않는다 — 토큰 지우기가 실패했는데 "해제됨"으로 답하면 안 된다 (코덱스 지적) */
async function patchLink(userId: string, patch: Record<string, unknown>, ifToken?: string) {
  // ifToken: 읽었던 토큰이 그대로일 때만 고친다 — 그사이 해제·재연결했으면 새 상태를 덮지 않는다
  const cond = ifToken ? `&refresh_enc=eq.${encodeURIComponent(ifToken)}` : '';
  const r = await restAsServer(`gcal_links?user_id=eq.${encodeURIComponent(userId)}${cond}`, { method: 'PATCH', body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`gcal_links 저장 실패 ${r.status}`);
}

/**
 * 구글 신원 확인. id_token 을 내용만 읽지 않고 구글 tokeninfo 로 서명·발급처·대상 앱·만료를 검증받는다 (코덱스 지적).
 * 회사 계정(hd=atlm.kr)이고 이메일 확인이 끝난 계정만 통과.
 */
async function verifiedEmail(idToken?: string): Promise<string | null> {
  if (!idToken) return null;
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
  if (!r.ok) return null;
  const c: any = await r.json();
  const email = String(c.email || '').toLowerCase();
  const okIss = c.iss === 'accounts.google.com' || c.iss === 'https://accounts.google.com';
  if (!okIss || c.aud !== CLIENT_ID || Number(c.exp) * 1000 < Date.now()) return null;
  if (c.hd !== DOMAIN || !email.endsWith('@' + DOMAIN) || String(c.email_verified) !== 'true') return null;
  return email;
}

// ───────── 연결
router.get('/api/gcal/status', requireUser(), async (req: Request, res: Response) => {
  let l: any;
  try { l = await linkOf(userOf(req).id); } catch { res.status(502).json({ error: 'db' }); return; }
  res.set({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' }); // 본인 이메일·캘린더 ID
  res.json({
    configured: gcalConfigured(),
    connected: l?.status === 'connected',
    email: l?.status === 'connected' ? l.google_email : null,
    calendarId: l?.status === 'connected' ? l.calendar_id : null,
    lastSync: l?.last_sync_at || null, error: l?.status === 'error' ? l.last_error : null,
  });
});

router.get('/api/gcal/connect', requireUser(), (req: Request, res: Response) => {
  if (!gcalConfigured()) { res.status(503).send('구글 캘린더 연결이 아직 설정되지 않았습니다'); return; }
  // state = 누가 요청했는지 서명한 10분짜리 표 — 콜백이 다른 사람 계정에 붙지 않게
  const state = signJwt({ uid: userOf(req).id, p: 'gcal', exp: Math.floor(Date.now() / 1000) + 600 });
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', hd: DOMAIN, state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
});

router.get('/api/gcal/callback', requireUser(), async (req: Request, res: Response) => {
  const back = (s: string) => res.redirect(`${ERP_URL}/work?gcal=${s}`);
  try {
    const st = verifyJwt(String(req.query.state || ''));
    const me = userOf(req);
    if (!st || st.p !== 'gcal' || st.uid !== me.id) { back('bad_state'); return; }
    if (req.query.error || !req.query.code) { back('denied'); return; }

    const t = await tokenFrom({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: REDIRECT });
    const email = await verifiedEmail(t.id_token);
    if (!email) { back('not_company'); return; }
    // ERP 로그인 계정과 같은 구글 계정만 — 남의 회사 계정을 붙여 그 사람 일정을 읽지 못하게 (코덱스 지적)
    if (email !== me.email.toLowerCase()) { back('wrong_account'); return; }
    if (!t.refresh_token) { back('no_refresh'); return; }

    // "ATLM 업무" 캘린더를 새로 만든다 (다시 연결하면 기존 것이 남아 있으면 그대로 쓴다)
    const prev = await linkOf(me.id);
    let calId: string | null = prev?.calendar_id || null;
    if (calId) {
      const chk = await gapi(t.access_token, `/calendars/${encodeURIComponent(calId)}`);
      // 정말 없을 때만 새로 만든다. 일시 오류(429·5xx)에 새로 만들면 캘린더가 두 개 생긴다
      if (chk.status === 404 || chk.status === 410) calId = null;
      else if (!chk.ok) { back('error'); return; }
    }
    let created = false;
    if (!calId) {
      const c = await gapi(t.access_token, '/calendars', { method: 'POST', body: JSON.stringify({ summary: CAL_NAME, timeZone: 'Asia/Seoul', description: 'AMESCOTES ERP 가 자동으로 채우는 업무 캘린더' }) });
      if (!c.ok) { console.error('[gcal] 캘린더 생성 실패', c.status, (await c.text()).slice(0, 200)); back('cal_failed'); return; }
      calId = (await c.json()).id;
      created = true;
    }
    const row = { user_id: me.id, google_email: email, refresh_enc: seal(t.refresh_token), calendar_id: calId, status: 'connected', connected_at: new Date().toISOString(), last_error: null };
    const w = await restAsServer('gcal_links', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
    if (!w.ok) {
      console.error('[gcal] 저장 실패', (await w.text()).slice(0, 200));
      // 방금 만든 캘린더를 거둔다 — 다시 연결할 때 "ATLM 업무"가 두 개 생기지 않게 (코덱스 지적)
      if (created && calId) {
        const d = await gapi(t.access_token, `/calendars/${encodeURIComponent(calId)}`, { method: 'DELETE' }).catch(() => null);
        if (!d || !(d.ok || d.status === 404 || d.status === 410)) {
          console.error(`[gcal] ${me.id} 남은 캘린더 정리 실패 (${d?.status}) — 구글에서 "${CAL_NAME}" 하나를 직접 지워야 할 수 있음`);
        }
      }
      back('save_failed'); return;
    }
    accessCache.set(me.id, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
    syncUser(me.id).catch(e => console.warn('[gcal] 첫 동기화 실패', String(e).split('\n')[0]));
    back('connected');
  } catch (e) {
    console.error('[gcal] 콜백 실패:', String(e).split('\n')[0]);
    back('error');
  }
});

router.post('/api/gcal/disconnect', requireUser(), async (req: Request, res: Response) => {
  const me = userOf(req);
  let l: any;
  try { l = await linkOf(me.id); } catch { res.status(502).json({ error: 'db' }); return; }
  if (l?.refresh_enc) {
    try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(open(l.refresh_enc)), { method: 'POST' }); }
    catch { /* 구글 쪽 해제가 실패해도 우리 쪽 토큰은 지운다 */ }
  }
  accessCache.delete(me.id);
  try { await patchLink(me.id, { status: 'disconnected', refresh_enc: null }); }
  catch { res.status(502).json({ error: 'db' }); return; }
  res.json({ ok: true });
});

router.post('/api/gcal/sync', requireUser(), async (req: Request, res: Response) => {
  try { res.json({ ok: true, ...(await syncUser(userOf(req).id)) }); }
  catch (e) { res.status(502).json({ error: 'sync_failed', message: String((e as Error).message).slice(0, 200) }); }
});

// ───────── ERP → 구글 동기화

const plusDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);

type Want = { key: string; summary: string; description: string; start: string; end: string };

async function wantedFor(userId: string): Promise<Want[]> {
  // work.ts 를 가져오면 서로 물고 물리므로(work.ts 가 이 파일을 쓴다) 팀만 직접 읽는다
  // 여기서 빠진 항목은 구글에서 지워진다. 그래서 읽기가 조금이라도 불완전하면 동기화를 멈춘다 (코덱스 지적)
  const ur = await restAsServer(`app_users?id=eq.${encodeURIComponent(userId)}&select=id,team`);
  if (!ur.ok) throw new Error('app_users ' + ur.status);
  const me = (await ur.json())[0];
  if (!me) throw new Error('user_not_found');

  const SEL = 'select=id,kind,status,raw_text,parsed,confirmed_payload,team,shared_teams,assignee_id,created_by,result_ref';
  const LIMIT = 1000;
  // 내 열린 할 일은 기간 제한 없이, 확정된 기획전은 1년 치 (지도·캘린더 범위보다 넉넉하게)
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString();
  const t = encodeURIComponent(`"${String(me.team || '').replace(/"/g, '')}"`);
  const [tr, sr] = await Promise.all([
    restAsServer(`work_cards?kind=eq.todo&status=eq.open&assignee_id=eq.${encodeURIComponent(userId)}&${SEL}&limit=${LIMIT}`),
    me.team
      ? restAsServer(`work_cards?kind=eq.schedule&status=eq.done&created_at=gte.${yearAgo}&or=(team.eq.${encodeURIComponent(me.team)},shared_teams.cs.{${t}})&${SEL}&limit=${LIMIT}`)
      : Promise.resolve(null),
  ]);
  if (!tr.ok || (sr && !sr.ok)) throw new Error('work_cards 조회 실패');
  const todos: any[] = await tr.json(), scheds: any[] = sr ? await sr.json() : [];
  // 조회마다 따로 본다 — 한쪽이라도 상한에 닿으면 빠진 게 있을 수 있다
  if (todos.length >= LIMIT || scheds.length >= LIMIT) throw new Error('항목이 너무 많아 동기화를 멈췄습니다');
  const rows = [...todos, ...scheds];
  // 기획전은 카드에 적힌 값이 아니라 운영캘린더의 지금 값을 쓴다 — ERP 캘린더에서 날짜를 고치면 구글도 따라간다.
  // 캘린더에서 지운 기획전은 구글에서도 빠진다 (코덱스 지적)
  const cmpIds = Array.from(new Set(rows.filter(c => c.kind === 'schedule' && c.result_ref?.table === 'campaigns')
    .map(c => String(c.result_ref.id)).filter(id => /^cmp_[A-Za-z0-9]+$/.test(id))));
  const camps = new Map<string, any>();
  for (let i = 0; i < cmpIds.length; i += 200) {
    const cr = await restAsServer(`campaigns?id=in.(${cmpIds.slice(i, i + 200).join(',')})&select=id,title,channel,start_date,end_date,discount_rate,status`);
    if (!cr.ok) throw new Error('campaigns 조회 실패');
    for (const x of await cr.json()) camps.set(x.id, x);
  }

  const out: Want[] = [];
  for (const c of rows) {
    // 내 할 일 — 마감일이 있는 것만, 열린 것만
    if (c.kind === 'todo' && c.status === 'open' && c.assignee_id === userId && /^\d{4}-\d{2}-\d{2}$/.test(c.parsed?.dueDate || '')) {
      out.push({ key: 'todo:' + c.id, summary: `할 일 · ${c.parsed?.title || c.raw_text}`.slice(0, 200),
        description: `${c.raw_text}\n\nERP 업무 피드: ${ERP_URL}/work`, start: c.parsed.dueDate, end: plusDay(c.parsed.dueDate) });
    }
    // 우리 팀이 올렸거나 우리 팀에 공유된, 캘린더에 확정된 기획전
    if (c.kind === 'schedule' && c.status === 'done' && c.result_ref?.table === 'campaigns' && me.team &&
        (c.team === me.team || (c.shared_teams || []).includes(me.team))) {
      const k = camps.get(String(c.result_ref.id));
      const start = String(k?.start_date || '').slice(0, 10);
      if (k && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
        const endRaw = String(k.end_date || '').slice(0, 10);
        const end = /^\d{4}-\d{2}-\d{2}$/.test(endRaw) && endRaw >= start ? endRaw : start;
        out.push({ key: 'cmp:' + k.id, summary: `${k.title || c.raw_text}`.slice(0, 200),
          description: `${k.channel || ''}${k.discount_rate != null ? ' · ' + k.discount_rate + '%' : ''}\n올린 팀: ${c.team || '-'}\n\nERP 운영캘린더: ${ERP_URL}/calendar`,
          start, end: plusDay(end) });
      }
    }
  }
  return out;
}

/** 한 사람의 동기화는 한 번에 하나만 — 겹치면 같은 일정을 둘 다 새로 만든다 (코덱스 지적) */
const inFlight = new Map<string, Promise<{ upserted: number; removed: number }>>();
export function syncUser(userId: string): Promise<{ upserted: number; removed: number }> {
  const prev = inFlight.get(userId) || Promise.resolve({ upserted: 0, removed: 0 });
  const next = prev.catch(() => null).then(() => syncUserNow(userId));
  inFlight.set(userId, next);
  next.finally(() => { if (inFlight.get(userId) === next) inFlight.delete(userId); }).catch(() => {});
  return next;
}
async function syncUserNow(userId: string): Promise<{ upserted: number; removed: number }> {
  const l = await linkOf(userId);
  if (!l || l.status !== 'connected' || !l.refresh_enc) return { upserted: 0, removed: 0 };
  try {
    const token = await accessFor(l);
    const cal = encodeURIComponent(l.calendar_id);
    const want = await wantedFor(userId);
    const wantKeys = new Set(want.map(w => w.key));

    // 우리 캘린더의 ERP 일정을 전부 읽어 ERP 항목 키(erpKey)로 짝을 짓는다.
    // 구글은 지운 일정의 id 를 다시 못 쓰므로 id 를 정해 두지 않고 키로 찾는다 (코덱스 지적)
    const existing = new Map<string, any>();
    let pageToken = '';
    do {
      const q = new URLSearchParams({ privateExtendedProperty: 'erp=1', maxResults: '250', showDeleted: 'false', ...(pageToken ? { pageToken } : {}) });
      const lr = await gapi(token, `/calendars/${cal}/events?${q}`);
      if (!lr.ok) throw new Error(`list ${lr.status}`);
      const lj: any = await lr.json();
      for (const ev of lj.items || []) {
        const k = ev.extendedProperties?.private?.erpKey;
        if (k && !existing.has(k)) existing.set(k, ev);
        else if (k) { // 같은 키 중복은 하나만 남긴다
          const d = await gapi(token, `/calendars/${cal}/events/${ev.id}`, { method: 'DELETE' });
          if (!d.ok && d.status !== 404 && d.status !== 410) throw new Error(`dedupe ${d.status}`);
        }
      }
      pageToken = lj.nextPageToken || '';
    } while (pageToken);

    for (const w of want) {
      const body = JSON.stringify({ summary: w.summary, description: w.description,
        start: { date: w.start }, end: { date: w.end }, transparency: 'transparent',
        extendedProperties: { private: { erp: '1', erpKey: w.key } } });
      const ev = existing.get(w.key);
      const r = ev
        ? await gapi(token, `/calendars/${cal}/events/${ev.id}`, { method: 'PUT', body })
        : await gapi(token, `/calendars/${cal}/events`, { method: 'POST', body });
      if (!r.ok) throw new Error(`${ev ? 'update' : 'insert'} ${r.status}`);
    }

    // ERP 에서 사라진 것(완료·취소)을 지운다. 우리가 만든 캘린더라 다른 일정은 없다.
    // 한 달 넘게 지난 일정은 기록으로 남겨 두고 건드리지 않는다
    let removed = 0;
    const keepBefore = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    for (const [k, ev] of Array.from(existing.entries())) {
      if (wantKeys.has(k)) continue;
      const end = String(ev.end?.date || ev.end?.dateTime || '').slice(0, 10);
      if (end && end < keepBefore) continue;
      const d = await gapi(token, `/calendars/${cal}/events/${ev.id}`, { method: 'DELETE' });
      if (d.ok || d.status === 404 || d.status === 410) removed++; else throw new Error(`delete ${d.status}`);
    }
    // status 는 건드리지 않는다 — 동기화 중에 해제했으면 해제된 채로 둔다 (코덱스 지적)
    await patchLink(userId, { last_sync_at: new Date().toISOString(), last_error: null });
    return { upserted: want.length, removed };
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 200);
    // 구글에서 권한을 끊었으면(invalid_grant) 연결이 풀린 것으로 표시해 다시 연결하게 한다
    try {
      await patchLink(userId, (e as any).code === 'invalid_grant'
        ? { status: 'error', last_error: '구글에서 권한이 해제됐습니다. 다시 연결해 주세요', refresh_enc: null }
        : { last_error: msg }, l.refresh_enc);
    } catch (pe) { console.error(`[gcal] ${userId} 오류 기록 실패:`, String(pe)); }
    throw e;
  }
}

/** 업무 카드가 바뀐 직후 — 연결한 사람 모두를 잠깐 모았다가 한 번에 맞춘다 (20초) */
let soon: NodeJS.Timeout | null = null;
export function syncSoon() {
  if (!gcalConfigured() || soon) return;
  soon = setTimeout(async () => { soon = null; await syncAll(); }, 20_000);
}
async function syncAll() {
  const r = await restAsServer('gcal_links?status=eq.connected&select=user_id');
  if (!r.ok) return;
  for (const { user_id } of await r.json()) {
    try { await syncUser(user_id); } catch (e) { console.warn(`[gcal] ${user_id} 동기화 실패:`, String(e).split('\n')[0]); }
  }
}
/** 놓친 변경을 메우는 정기 동기화 (15분) */
export function startGcalSync() {
  if (!gcalConfigured()) { console.log('[gcal] GOOGLE_CLIENT_ID 없음 — 구글 캘린더 연결 꺼짐'); return; }
  setInterval(() => { syncAll().catch(() => {}); }, 15 * 60_000);
}

// ───────── 구글 → ERP: 본인 일정 (본인 질문에만)

/** 다음 7일 본인 기본 캘린더 일정 — 업무 비서가 "오늘 내 일정"에 답할 때만 쓴다. 실패하면 빈 값 */
export async function myUpcoming(userId: string): Promise<string[]> {
  try {
    const l = await linkOf(userId);
    if (!l || l.status !== 'connected' || !l.refresh_enc) return [];
    const token = await accessFor(l);
    const q = new URLSearchParams({ timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + 7 * 864e5).toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '40' });
    const r = await gapi(token, `/calendars/primary/events?${q}`);
    if (!r.ok) return [];
    const j: any = await r.json();
    return (j.items || []).map((e: any) => {
      const s = e.start?.dateTime || e.start?.date || '';
      const when = e.start?.dateTime
        ? new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
        : s + ' 종일';
      return `- ${when} ${e.summary || '(제목 없음)'}${e.location ? ' @' + e.location : ''}`;
    });
  } catch { return []; }
}

export default router;
