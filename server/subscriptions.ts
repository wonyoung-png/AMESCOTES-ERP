import crypto from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { CEO_EMAILS, currentUser, requireUser, restAsServer, userOf, type SessionUser } from './auth.js';
import { detectSubscriptionCandidates, normalizeMerchant, type CardTransaction } from './subscription-detection.js';
import { genId, kstToday, members, notify } from './work.js';

const router = Router();
const text = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
const dateOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const last4 = (v: unknown) => (text(v).replace(/\D/g, '').slice(-4) || null);
const isSubscriptionAdmin = (u: SessionUser, team?: string) =>
  CEO_EMAILS.includes(u.email.toLowerCase()) || ['경영지원', '경영관리'].includes(team || '');

async function requireSubscriptionAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const u = await currentUser(req);
    if (!u) { res.status(401).json({ error: 'no_session' }); return; }
    const all = await members();
    const me = all.find(x => x.id === u.id);
    if (!isSubscriptionAdmin(u, me?.team)) { res.status(403).json({ error: 'forbidden' }); return; }
    (req as Request & { user: SessionUser }).user = u;
    next();
  } catch (e) { console.error('[subscriptions] 권한 확인 실패', e); res.status(500).json({ error: 'internal' }); }
}

router.get('/api/subscriptions/access', async (req, res) => {
  try {
    const u = await currentUser(req);
    if (!u) { res.json({ allowed: false }); return; }
    const me = (await members()).find(x => x.id === u.id);
    res.json({ allowed: isSubscriptionAdmin(u, me?.team) });
  } catch (e) { console.error('[subscriptions] 접근 확인 실패', e); res.status(500).json({ error: 'internal' }); }
});

router.use('/api/subscriptions', requireSubscriptionAdmin);
router.use('/api/card-transactions', requireSubscriptionAdmin);

async function db(path: string) {
  const r = await restAsServer(path);
  if (!r.ok) throw new Error(`${path.split('?')[0]} 조회 실패 ${r.status}`);
  return r.json();
}

router.get('/api/subscriptions', async (_req, res) => {
  try {
    const [subscriptions, candidates, users] = await Promise.all([
      db('subscriptions?select=*&order=next_billing_on.asc.nullslast'),
      db('subscription_candidates?status=eq.검토 필요&select=*&order=last_paid_on.desc'),
      db('app_users?is_active=eq.true&select=id,name,team&order=name.asc'),
    ]);
    res.json({ subscriptions, candidates, users });
  } catch (e) { console.error('[subscriptions] 목록 실패', e); res.status(502).json({ error: 'db' }); }
});

router.post('/api/card-transactions/upload', async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 10000) : [];
    const valid: CardTransaction[] = raw.flatMap((x: any) => {
      const approvedOn = text(x.approvedOn, 10), merchantName = text(x.merchantName), amount = Number(x.amount);
      if (!dateOk(approvedOn) || !merchantName || !Number.isFinite(amount) || amount <= 0) return [];
      return [{ approvedOn, merchantName, amount, cardLast4: last4(x.cardNumber || x.cardLast4), currency: text(x.currency, 3).toUpperCase() || 'KRW' }];
    });
    if (!valid.length) { res.status(400).json({ error: 'no_valid_rows', message: '승인일·가맹점·금액 열을 확인해주세요.' }); return; }
    const me = userOf(req);
    const records = valid.flatMap(x => {
      const merchantKey = normalizeMerchant(x.merchantName);
      if (!merchantKey) return [];
      const fingerprint = crypto.createHash('sha256').update([x.approvedOn, merchantKey, x.cardLast4, x.amount, x.currency].join('|')).digest('hex');
      return [{ id: `ctx_${fingerprint.slice(0, 24)}`, fingerprint, approved_on: x.approvedOn, merchant_name: x.merchantName,
        merchant_key: merchantKey, card_last4: x.cardLast4, amount: x.amount, currency: x.currency, uploaded_by: me.id }];
    });
    if (records.length) {
      const wr = await restAsServer('card_transactions?on_conflict=fingerprint', { method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(records) });
      if (!wr.ok) { res.status(502).json({ error: 'save_failed', detail: (await wr.text()).slice(0, 300) }); return; }
    }
    const all = await db('card_transactions?select=approved_on,merchant_name,card_last4,amount,currency&order=approved_on.asc&limit=20000');
    const candidates = detectSubscriptionCandidates(all.map((x: any) => ({ approvedOn: x.approved_on, merchantName: x.merchant_name,
      cardLast4: x.card_last4, amount: Number(x.amount), currency: x.currency })));
    for (const c of candidates) {
      const id = 'sc_' + crypto.createHash('sha1').update([c.merchantKey, c.cardLast4, c.currency].join('|')).digest('hex').slice(0, 20);
      await restAsServer('subscription_candidates?on_conflict=merchant_key,card_last4,currency', { method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id, merchant_key: c.merchantKey,
          merchant_name: c.merchantName, card_last4: c.cardLast4, latest_amount: c.latestAmount,
          average_amount: c.averageAmount, currency: c.currency, month_count: c.monthCount,
          first_paid_on: c.firstPaidOn, last_paid_on: c.lastPaidOn, updated_at: new Date().toISOString() }) });
      const cardFilter = c.cardLast4 ? `card_last4=eq.${c.cardLast4}` : 'card_last4=is.null';
      await restAsServer(`subscriptions?merchant_pattern=eq.${encodeURIComponent(c.merchantKey)}&${cardFilter}&currency=eq.${encodeURIComponent(c.currency)}&status=neq.해지됨`, {
        method: 'PATCH', body: JSON.stringify({ latest_amount: c.latestAmount, average_amount: c.averageAmount, updated_at: new Date().toISOString() }),
      });
    }
    res.json({ ok: true, accepted: records.length, rejected: raw.length - valid.length, candidates: candidates.length });
  } catch (e) { console.error('[subscriptions] 업로드 실패', e); res.status(500).json({ error: 'internal' }); }
});

const CATEGORIES = ['AI 도구','마케팅','업무 도구','인프라'];
const STATUSES = ['사용 중','검토 필요','해지 예정','해지됨'];
router.post('/api/subscriptions/candidates/:id/confirm', async (req, res) => {
  try {
    const rows = await db(`subscription_candidates?id=eq.${encodeURIComponent(req.params.id)}&select=*`);
    const c = rows[0];
    if (!c) { res.status(404).json({ error: 'not_found' }); return; }
    const existing = await db(`subscriptions?candidate_id=eq.${encodeURIComponent(c.id)}&select=*`);
    if (existing[0]) {
      const cr = await restAsServer(`subscription_candidates?id=eq.${encodeURIComponent(c.id)}&status=eq.검토 필요`, { method: 'PATCH', body: JSON.stringify({ status: '확정', updated_at: new Date().toISOString() }) });
      if (!cr.ok) { res.status(502).json({ error: 'candidate_update_failed' }); return; }
      res.json({ ok: true, subscription: existing[0] }); return;
    }
    const serviceName = text(req.body?.serviceName) || c.merchant_name;
    const category = CATEGORIES.includes(req.body?.category) ? req.body.category : '업무 도구';
    const cycle = req.body?.billingCycle === '연' ? '연' : '월';
    const inferredNext = new Date(c.last_paid_on + 'T00:00:00Z');
    inferredNext.setUTCMonth(inferredNext.getUTCMonth() + (cycle === '연' ? 12 : 1));
    const sub = { id: genId('sub'), service_name: serviceName, merchant_pattern: c.merchant_key, card_last4: c.card_last4,
      latest_amount: c.latest_amount, average_amount: c.average_amount, currency: c.currency, billing_cycle: cycle,
      next_billing_on: dateOk(text(req.body?.nextBillingOn, 10)) ? req.body.nextBillingOn : inferredNext.toISOString().slice(0, 10),
      owner_id: text(req.body?.ownerId) || null, purpose: text(req.body?.purpose, 500) || null, category,
      status: '사용 중', memo: text(req.body?.memo, 1000) || null, candidate_id: c.id };
    const wr = await restAsServer('subscriptions?on_conflict=candidate_id', { method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(sub) });
    if (!wr.ok) { res.status(502).json({ error: 'save_failed' }); return; }
    const inserted = (await wr.json())[0];
    const subscription = inserted || (await db(`subscriptions?candidate_id=eq.${encodeURIComponent(c.id)}&select=*`))[0];
    const cr = await restAsServer(`subscription_candidates?id=eq.${encodeURIComponent(c.id)}&status=eq.검토 필요`, { method: 'PATCH', body: JSON.stringify({ status: '확정', updated_at: new Date().toISOString() }) });
    if (!cr.ok) { res.status(502).json({ error: 'candidate_update_failed' }); return; }
    res.json({ ok: true, subscription });
  } catch (e) { console.error('[subscriptions] 후보 확정 실패', e); res.status(500).json({ error: 'internal' }); }
});

router.post('/api/subscriptions/candidates/:id/exclude', async (req, res) => {
  try {
    const r = await restAsServer(`subscription_candidates?id=eq.${encodeURIComponent(req.params.id)}&status=eq.검토 필요`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: '제외', updated_at: new Date().toISOString() }) });
    res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true } : { error: 'save_failed' });
  } catch (e) { console.error('[subscriptions] 후보 제외 실패', e); res.status(500).json({ error: 'internal' }); }
});

router.patch('/api/subscriptions/:id', async (req, res) => {
  try {
    const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (STATUSES.includes(req.body?.status)) body.status = req.body.status;
    if (CATEGORIES.includes(req.body?.category)) body.category = req.body.category;
    if (dateOk(text(req.body?.nextBillingOn, 10))) body.next_billing_on = req.body.nextBillingOn;
    if ('ownerId' in (req.body || {})) body.owner_id = text(req.body.ownerId) || null;
    for (const [from, to, max] of [['purpose','purpose',500], ['memo','memo',1000]] as const) if (from in (req.body || {})) body[to] = text(req.body[from], max) || null;
    const r = await restAsServer(`subscriptions?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
    res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true, subscription: (await r.json())[0] } : { error: 'save_failed' });
  } catch (e) { console.error('[subscriptions] 수정 실패', e); res.status(500).json({ error: 'internal' }); }
});

export async function runSubscriptionUsageChecks() {
  const today = kstToday(), now = new Date().toISOString();
  const [subs, all, openChecks] = await Promise.all([
    db('subscriptions?status=in.(사용 중,검토 필요)&select=*'), members(),
    db('subscription_usage_checks?answered_at=is.null&select=*'),
  ]);
  const ceo = all.find(x => CEO_EMAILS.includes(x.email.toLowerCase()));
  for (const check of openChecks) {
    if (check.escalated_at || Date.now() - Date.parse(check.requested_at) < 7 * 864e5 || !ceo) continue;
    const reassigned = await restAsServer(`work_cards?id=eq.${encodeURIComponent(check.work_card_id)}&status=eq.open`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ assignee_id: ceo.id, assignee_name: ceo.name, updated_at: now }) });
    if (!reassigned.ok || !(await reassigned.json())[0]) continue;
    const escalated = await restAsServer(`subscription_usage_checks?id=eq.${encodeURIComponent(check.id)}`, { method: 'PATCH', body: JSON.stringify({ escalated_at: now }) });
    if (!escalated.ok) continue;
    await notify([{ user_id: ceo.id, card_id: check.work_card_id, title: '구독 사용 확인이 7일째 답이 없습니다' }]);
  }
  for (const s of subs) {
    const dueSoon = s.next_billing_on && s.next_billing_on >= today && Date.parse(s.next_billing_on) - Date.parse(today) <= 5 * 864e5;
    const monthly = !s.last_usage_checked_at || new Date(s.last_usage_checked_at).toISOString().slice(0, 7) < today.slice(0, 7);
    if (!dueSoon && !monthly) continue;
    if (openChecks.some((x: any) => x.subscription_id === s.id)) continue;
    const owner = all.find(x => x.id === s.owner_id) || ceo;
    if (!owner) continue;
    const cardId = genId('wc'), amount = `${Number(s.latest_amount).toLocaleString()} ${s.currency}`;
    const card = { id: cardId, created_by: 'subscription-watch', created_by_name: '구독 감시', team: owner.team || '경영지원',
      raw_text: `이 구독 계속 쓰나요? ${s.service_name} · ${amount} · 다음 결제 ${s.next_billing_on || '미정'}`,
      kind: 'request_check', status: 'open', parsed: { title: `${s.service_name} 사용 확인`, subscriptionId: s.id, subscriptionCheck: true },
      assignee_id: owner.id, assignee_name: owner.name };
    const checkId = genId('suc');
    const reserved = await restAsServer('subscription_usage_checks', { method: 'POST',
      body: JSON.stringify({ id: checkId, subscription_id: s.id, work_card_id: cardId, owner_id: owner.id }) });
    if (!reserved.ok) continue;
    const wr = await restAsServer('work_cards', { method: 'POST', body: JSON.stringify(card) });
    if (!wr.ok) {
      await restAsServer(`subscription_usage_checks?id=eq.${encodeURIComponent(checkId)}`, { method: 'DELETE' });
      continue;
    }
    await notify([{ user_id: owner.id, card_id: cardId, title: '구독 사용 확인', body: card.raw_text }]);
  }
}

router.post('/api/subscription-checks/:cardId/answer', requireUser(), async (req, res) => {
  try {
    const answer = text(req.body?.answer, 10);
    if (!['계속 씀','안 씀','모름'].includes(answer)) { res.status(400).json({ error: 'bad_answer' }); return; }
    const checks = await db(`subscription_usage_checks?work_card_id=eq.${encodeURIComponent(req.params.cardId)}&select=*`);
    const check = checks[0];
    if (!check) { res.status(404).json({ error: 'not_found' }); return; }
    const me = userOf(req), all = await members(), actor = all.find(x => x.id === me.id);
    if (check.owner_id !== me.id && !CEO_EMAILS.includes(me.email.toLowerCase())) { res.status(403).json({ error: 'forbidden' }); return; }
    const risky = answer !== '계속 씀', ceo = all.find(x => CEO_EMAILS.includes(x.email.toLowerCase()));
    const result = await restAsServer('rpc/answer_subscription_check', { method: 'POST', body: JSON.stringify({
      p_check_id: check.id, p_answer: answer, p_actor_id: me.id, p_actor_name: actor?.name || me.name,
      p_ceo_id: risky && ceo ? ceo.id : null, p_ceo_name: risky && ceo ? ceo.name : null,
    }) });
    if (!result.ok) {
      const detail = await result.text();
      res.status(detail.includes('already_answered') ? 409 : detail.includes('not_found') ? 404 : 502).json({ error: 'answer_update_failed' }); return;
    }
    const rpcResult = await result.json();
    if (risky && ceo && rpcResult.newly_answered) await notify([{ user_id: ceo.id, card_id: req.params.cardId, title: '구독 검토가 필요합니다', body: answer }]);
    res.json({ ok: true });
  } catch (e) { console.error('[subscriptions] 사용 확인 답변 실패', e); res.status(500).json({ error: 'internal' }); }
});

export default router;
