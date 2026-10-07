/**
 * 업무 카드 공용부 — 업무 입력 화면(팀 피드)과 챗봇 위젯이 같이 쓴다.
 * 답변·캘린더 등록 버튼이 두 군데서 다르게 동작하면 안 되므로 한 곳에 둔다.
 */
import { useState } from 'react';
import { Clock, MessageSquare, CalendarPlus, Share2, HelpCircle } from 'lucide-react';
import { Link } from 'wouter';
import { toast } from 'sonner';
import { fetchCampaignsSB } from '@/lib/campaignQueries';

export type Card = {
  id: string; created_at: string; created_by: string; created_by_name: string; team: string;
  raw_text: string; kind: 'request_check' | 'schedule' | 'share' | 'question'; parsed: Record<string, any>;
  confirmed_payload?: Record<string, any> | null;
  status: 'open' | 'done'; assignee_id?: string | null; assignee_name?: string | null;
  reply_text?: string | null; replied_by_name?: string | null; related_id?: string | null;
  shared_teams: string[]; result_ref?: { table: string; id: string } | null; done_by_name?: string | null;
};
export type Me = { id: string; name: string; team: string; isLeader: boolean; isBoss: boolean };

export const KIND: Record<Card['kind'], { label: string; icon: typeof Clock; cls: string }> = {
  request_check: { label: '확인 요청', icon: MessageSquare, cls: 'text-[var(--system-orange)]' },
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

export async function postWork(text: string): Promise<Card | null> {
  try {
    const r = await fetch('/api/work', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error === 'no_session' ? '로그인이 풀렸습니다' : '올리기 실패'); return null; }
    return j.card as Card;
  } catch { toast.error('올리기 실패 — 통신 상태를 확인해주세요'); return null; }
}

/** 실패하면 null — 순간 장애에 대화·배지가 통째로 비면 안 되니 부르는 쪽이 이전 값을 유지한다 */
export async function fetchWork(): Promise<{ items: Card[]; me: Me | null } | null> {
  try {
    const r = await fetch('/api/work', { credentials: 'include' });
    if (!r.ok) return null;
    const j = await r.json();
    return { items: j.items || [], me: j.me || null };
  } catch { return null; }
}

/** 처리 후 위젯·피드 양쪽을 다시 읽게 한다 */
export const announceWorkChanged = () => window.dispatchEvent(new Event('work:changed'));

/** 카드 아래 붙는 부분: 대기 표시 · 답변 · 질문의 답 · 일정 등록 폼 */
export function CardActions({ c, me, onDone }: { c: Card; me: Me | null; onDone: () => void }) {
  const p = c.confirmed_payload || c.parsed || {};
  const canAct = canActOn(c, me);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    title: p.title || '', channel: CHANNELS.includes(p.channel) ? p.channel : '',
    startDate: p.startDate || '', endDate: p.endDate || '', discountRate: p.discountRate ?? '',
  });

  const canReply = c.kind === 'request_check' && c.status === 'open' && !!me && (c.assignee_id === me.id || canAct);
  const canConfirm = c.kind === 'schedule' && c.status === 'open' && !!me && (c.created_by === me.id || canAct);

  const post = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/work/${c.id}/${path}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.message || (j.error === 'already' ? '이미 처리됐습니다' : '처리 실패')); return false; }
      toast.success(ok);
      onDone();
      return true;
    } catch { toast.error('처리 실패 — 통신 상태를 확인해주세요'); return false; }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!f.title.trim() || !f.startDate) { toast.error('이름과 시작일은 있어야 합니다'); return; }
    const payload = { ...f, discountRate: f.discountRate === '' ? null : Number(f.discountRate), workspace: p.workspace };
    if (await post('confirm', { payload }, '운영캘린더에 등록하고 마케팅·물류CS에 공유했습니다')) {
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

  return (
    <>
      {c.kind === 'question' && p.answer && (
        <p className="text-sm mt-1 whitespace-pre-wrap break-words">{p.answer}</p>
      )}
      {c.kind === 'request_check' && c.assignee_name && c.status === 'open' && (
        <p className="text-xs text-muted-foreground mt-1">→ {c.assignee_name}님 확인 대기</p>
      )}
      {c.reply_text && (
        <p className="text-xs mt-1.5 p-2 rounded bg-[var(--fill-quaternary)]">
          <span className="font-medium">{c.replied_by_name}</span>: {c.reply_text}
        </p>
      )}

      {canReply && (
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
          <select value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })} className={input}>
            <option value="">채널 선택</option>
            {CHANNELS.map(ch => <option key={ch}>{ch}</option>)}
          </select>
          <input type="number" value={f.discountRate} onChange={e => setF({ ...f, discountRate: e.target.value })}
            placeholder="할인율 %" className={input} />
          <input type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} className={input} />
          <input type="date" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} className={input} />
          <button type="button" disabled={busy} onClick={confirm}
            className="col-span-2 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-40">
            <CalendarPlus className="w-4 h-4" />캘린더 등록 · 마케팅 공유
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
    </>
  );
}
