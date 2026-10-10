/**
 * 업무 카드 공용부 — 업무 입력 화면(팀 피드)과 챗봇 위젯이 같이 쓴다.
 * 답변·캘린더 등록 버튼이 두 군데서 다르게 동작하면 안 되므로 한 곳에 둔다.
 */
import { useState } from 'react';
import { Clock, MessageSquare, CalendarPlus, Share2, HelpCircle, ListTodo, Check } from 'lucide-react';
import { Link } from 'wouter';
import { toast } from 'sonner';
import { fetchCampaignsSB } from '@/lib/campaignQueries';
import { CAMPAIGN_TEAMS } from '@/lib/phase1';
import { schedulePayload } from '../../../shared/schedule';

export type Card = {
  id: string; created_at: string; created_by: string; created_by_name: string; team: string;
  raw_text: string; kind: 'request_check' | 'todo' | 'schedule' | 'share' | 'question'; parsed: Record<string, any>;
  confirmed_payload?: Record<string, any> | null;
  status: 'open' | 'done' | 'cancelled'; assignee_id?: string | null; assignee_name?: string | null;
  reply_text?: string | null; replied_by_name?: string | null; related_id?: string | null;
  shared_teams: string[]; result_ref?: { table: string; id: string } | null; done_by_name?: string | null;
  read_by?: string[];
};

/** 안 본 카드 = 남이 올렸고 내가 아직 확인 안 함. 내가 쓴 것·질문은 셀 필요 없다 */
export const isUnread = (c: Card, me: Me | null) =>
  !!me && c.created_by !== me.id && c.kind !== 'question' && !(c.read_by || []).includes(me.id);

export async function markRead(ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  try {
    for (let offset = 0; offset < ids.length; offset += 500) {
      const r = await fetch('/api/work/read', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids.slice(offset, offset + 500) }),
      });
      if (!r.ok) return false;
    }
    return true;
  } catch { return false; }
}
export type Me = { id: string; name: string; team: string; isLeader: boolean; isBoss: boolean; profile?: string };
export type WorkCounts = { attention: number; todo: number; unread: number; teamUnread: number; sharedUnread: number };
export type WorkCursor = { created_at: string; id: string };

/** 업무 프로필 작성 안내 — 위젯과 사용자관리가 같이 쓴다 */
export const PROFILE_PLACEHOLDER = `담당 채널·브랜드: W컨셉, 29CM / LUMEN
업무 범위: 기획전 협의, 샘플 발송
결정권: 할인 15%까지는 본인 결정, 그 이상은 팀장 확인
자주 쓰는 말: 파토 = 파니에 토트`;
export const PROFILE_MAX = 1000;

export const KIND: Record<Card['kind'], { label: string; icon: typeof Clock; cls: string }> = {
  request_check: { label: '확인 요청', icon: MessageSquare, cls: 'text-[var(--system-orange)]' },
  todo: { label: '할 일', icon: ListTodo, cls: 'text-primary' },
  schedule: { label: '일정', icon: CalendarPlus, cls: 'text-[var(--system-blue)]' },
  share: { label: '공유', icon: Share2, cls: 'text-muted-foreground' },
  question: { label: '질문', icon: HelpCircle, cls: 'text-muted-foreground' },
};
const CHANNELS = ['자사몰', '센텀', '29CM', 'W컨셉', '쇼룸', '해외'];

/** 팀장(같은 팀)·대표는 남의 카드에도 손댈 수 있다 — 서버 검사와 같은 기준 */
export const canActOn = (c: Card, me: Me | null) => !!me && (me.isBoss || (me.isLeader && me.team === c.team));

/** 지금 내가 처리해야 하는 카드 */
export const isTodo = (c: Card, me: Me | null) => c.status === 'open' && !!me && (
  c.assignee_id === me.id || (c.kind === 'schedule' && (c.created_by === me.id || canActOn(c, me)))
);

export async function postWork(text: string, requestId?: string): Promise<Card | null> {
  try {
    const r = await fetch('/api/work', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, requestId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error === 'no_session' ? '로그인이 풀렸습니다' : j.error === 'request_conflict' ? '이전 요청과 내용이 다릅니다. 내용을 확인해주세요' : '올리기 실패'); return null; }
    if (j.notified === false) toast.warning('업무는 저장됐지만 확인 요청 알림 전달에 실패했습니다 — 업무함에서 확인해주세요');
    return j.card as Card;
  } catch { toast.error('올리기 실패 — 통신 상태를 확인해주세요'); return null; }
}

/** 실패하면 null — 순간 장애에 대화·배지가 통째로 비면 안 되니 부르는 쪽이 이전 값을 유지한다 */
export async function fetchWork(before?: WorkCursor | null, countsOnly = false): Promise<{ items: Card[]; me: Me | null; counts?: WorkCounts; nextCursor: WorkCursor | null } | null> {
  try {
    const params = new URLSearchParams();
    if (before) params.set('before', JSON.stringify(before));
    if (countsOnly) params.set('countsOnly', '1');
    const r = await fetch(`/api/work${params.size ? '?' + params : ''}`, { credentials: 'include' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j.items)) return null;
    return { items: j.items, me: j.me || null, counts: j.counts, nextCursor: j.nextCursor || null };
  } catch { return null; }
}

/** DB 시각은 UTC 다. 그대로 자르면 9시간 이르게 보인다 */
export const fmtTime = (iso: string) => new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** 처리 후 위젯·피드 양쪽을 다시 읽게 한다 */
export const announceWorkChanged = () => window.dispatchEvent(new Event('work:changed'));

/** 카드 아래 붙는 부분: 대기 표시 · 답변 · 질문의 답 · 일정 등록 폼 */
export function CardActions({ c, me, onDone }: { c: Card; me: Me | null; onDone: () => void }) {
  const p = c.confirmed_payload || c.parsed || {};
  const canAct = canActOn(c, me);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    title: p.title || '', channel: CHANNELS.includes(p.channel) ? p.channel : '', workspace: p.workspace || '',
    startDate: p.startDate || '', endDate: p.endDate || '', discountRate: p.discountRate ?? '',
  });
  // 같이 알릴 팀 — AI 추천이 먼저 체크돼 있고, 확정하는 사람이 고친다
  const teamChoices = CAMPAIGN_TEAMS.filter(t => t !== c.team);
  const [teams, setTeams] = useState<string[]>(Array.isArray(p.shareTeams) ? p.shareTeams : []);
  const toggleTeam = (t: string) => setTeams(v => v.includes(t) ? v.filter(x => x !== t) : [...v, t]);

  // 답변칸은 요청을 받은 사람 몫이다. 쓴 사람 본인에게 띄우면 자기 질문에 자기가 답하게 된다
  const canReply = c.kind === 'request_check' && c.status === 'open' && !!me && c.created_by !== me.id &&
    (c.assignee_id === me.id || canAct);
  const isSubscriptionCheck = !!p.subscriptionCheck;
  const canFinish = c.kind === 'todo' && c.status === 'open' && !!me &&
    (c.created_by === me.id || c.assignee_id === me.id || canAct);
  const [note, setNote] = useState('');
  const canConfirm = c.kind === 'schedule' && c.status === 'open' && !!me && (c.created_by === me.id || canAct);
  // AI 가 잘못 가른 걸 바로잡는다 — 쓴 사람·팀장·대표. 질문은 '끝남'으로 저장되지만 바꿀 수 있다
  const canFix = !!me && (c.created_by === me.id || canAct) && (c.status === 'open' || c.kind === 'question');

  const post = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/work/${c.id}/${path}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.message || (j.error === 'already' ? '이미 처리됐습니다' : '처리 실패')); return false; }
      if (j.notified === false) toast.warning('저장은 완료됐지만 알림 전달에 실패했습니다 — 업무함에서 확인해주세요');
      else toast.success(ok);
      onDone();
      return true;
    } catch { toast.error('처리 실패 — 통신 상태를 확인해주세요'); return false; }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!f.title.trim() || !f.startDate) { toast.error('이름과 시작일은 있어야 합니다'); return; }
    let payload;
    try { payload = schedulePayload(f); }
    catch (e) { toast.error((e as Error).message); return; }
    const ok = teams.length ? `운영캘린더에 등록하고 ${teams.join('·')}에 알렸습니다` : '운영캘린더에 등록했습니다 (알린 팀 없음)';
    if (await post('confirm', { payload, shareTeams: teams }, ok)) {
      // 캘린더는 로컬 사본을 읽는다. 앱을 다시 열 때까지 기다리지 않게 새 기획전을 바로 내려받는다
      try {
        const remote = await fetchCampaignsSB();
        const local = JSON.parse(localStorage.getItem('ames_campaigns') || '[]');
        const ids = new Set(local.map((x: any) => x.id));
        localStorage.setItem('ames_campaigns', JSON.stringify([...local, ...remote.filter(x => !ids.has(x.id))]));
      } catch { /* 다음 동기화 때 들어온다 */ }
    }
  };

  const input = 'h-9 rounded-md border border-border bg-background px-2 text-sm min-w-0';

  const answerSubscription = async (answer: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/subscription-checks/${c.id}/answer`, { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer }) });
      if (!r.ok) throw new Error();
      toast.success('사용 여부를 전달했습니다.'); onDone();
    } catch { toast.error('사용 여부를 전달하지 못했습니다.'); } finally { setBusy(false); }
  };

  return (
    <>
      {c.kind === 'question' && p.answer && (
        <p className="text-sm mt-1 whitespace-pre-wrap break-words">{p.answer}</p>
      )}
      {c.kind === 'todo' && p.dueDate && (
        <p className={`text-xs mt-1 ${c.status === 'open' && p.dueDate <= new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) ? 'text-[var(--system-red)]' : 'text-muted-foreground'}`}>
          마감 {p.dueDate}{c.status === 'done' && c.done_by_name ? ` · ${c.done_by_name} 완료` : ''}
        </p>
      )}
      {canFinish && (
        <div className="flex gap-2 mt-2">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="결과 한 줄 (선택, 예: 참여하기로 함)"
            className={`flex-1 ${input}`} />
          <button type="button" disabled={busy}
            onClick={() => post('done', { note }, '완료했습니다')}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm flex items-center gap-1 disabled:opacity-40">
            <Check className="w-4 h-4" />완료
          </button>
        </div>
      )}
      {c.kind === 'request_check' && c.assignee_name && c.status === 'open' && (
        <p className="text-xs text-muted-foreground mt-1">→ {c.assignee_name}님 확인 대기</p>
      )}
      {c.reply_text && (
        <p className="text-xs mt-1.5 p-2 rounded bg-[var(--fill-quaternary)]">
          <span className="font-medium">{c.replied_by_name}</span>: {c.reply_text}
        </p>
      )}

      {canReply && isSubscriptionCheck && (
        <div className="flex flex-wrap gap-2 mt-2">
          {['계속 씀','안 씀','모름'].map(answer => <button key={answer} type="button" disabled={busy}
            onClick={() => answerSubscription(answer)} className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-40">{answer}</button>)}
        </div>
      )}
      {canReply && !isSubscriptionCheck && (
        <div className="flex gap-2 mt-2">
          <input value={reply} onChange={e => setReply(e.target.value)} placeholder="답변 (예: 20%로 진행)"
            className={`flex-1 ${input}`} />
          <button type="button" disabled={busy || !reply.trim()}
            onClick={async () => { if (await post('reply', { text: reply }, '답변을 보냈습니다')) setReply(''); }}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-40">답변</button>
        </div>
      )}

      {c.kind === 'schedule' && (canConfirm ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="기획전 이름"
            className={`col-span-2 ${input}`} />
          <select aria-label="기획전 브랜드" value={f.workspace} onChange={e => setF({ ...f, workspace: e.target.value })} className={`col-span-2 ${input}`}>
            <option value="">브랜드 선택</option><option>LUMEN</option><option>AETALOOF</option>
          </select>
          <select value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })} className={input}>
            <option value="">채널 선택</option>
            {CHANNELS.map(ch => <option key={ch}>{ch}</option>)}
          </select>
          <input type="number" value={f.discountRate} onChange={e => setF({ ...f, discountRate: e.target.value })}
            placeholder="할인율 %" className={input} />
          <input type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} className={input} />
          <input type="date" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} className={input} />
          <fieldset className="col-span-2">
            <legend className="text-xs text-muted-foreground mb-1">같이 알릴 팀 (AI 추천)</legend>
            <div className="flex flex-wrap gap-1.5">
              {teamChoices.map(t => {
                const on = teams.includes(t);
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => toggleTeam(t)}
                    className={`h-7 px-2.5 rounded-full border text-xs ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
                    {on && <Check className="w-3 h-3 inline mr-0.5" />}{t}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <button type="button" disabled={busy} onClick={confirm}
            className="col-span-2 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-40">
            <CalendarPlus className="w-4 h-4" />캘린더 등록{teams.length ? ` · ${teams.length}개 팀에 알림` : ''}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mt-1.5">
          {p.startDate}{p.endDate && p.endDate !== p.startDate ? `~${p.endDate}` : ''} · {p.channel || '채널 미정'}
          {p.discountRate != null && p.discountRate !== '' ? ` · ${p.discountRate}%` : ''}
          {c.result_ref?.table === 'campaigns' && <> · <Link href="/calendar" className="underline">캘린더에서 보기</Link></>}
          {c.shared_teams?.length > 0 && <> · 공유: {c.shared_teams.join(', ')}</>}
        </p>
      ))}

      {c.status === 'cancelled' && (
        <p className="text-xs text-muted-foreground mt-1">취소됨{c.done_by_name ? ` · ${c.done_by_name}` : ''}</p>
      )}
      {canFix && (
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">
            종류
            <select value={c.kind} disabled={busy}
              onChange={e => post('kind', { kind: e.target.value }, `'${KIND[e.target.value as Card['kind']].label}'(으)로 바꿨습니다`)}
              className="h-7 rounded-md border border-border bg-background px-1 text-xs">
              {(Object.keys(KIND) as Card['kind'][]).map(k => <option key={k} value={k}>{KIND[k].label}</option>)}
            </select>
          </label>
          {c.status === 'open' && (
            <button type="button" disabled={busy} className="ml-auto underline-offset-2 hover:underline hover:text-[var(--system-red)]"
              onClick={() => { if (window.confirm('이 카드를 취소할까요? 기록은 남고 할 일에서 빠집니다')) post('cancel', {}, '취소했습니다'); }}>
              취소
            </button>
          )}
        </div>
      )}
    </>
  );
}
