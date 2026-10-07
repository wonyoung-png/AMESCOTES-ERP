/**
 * 업무 입력 — 한 줄 쓰면 AI 가 카드로 바꾼다.
 *
 *  확인 요청 → 팀장에게 알림, 팀장이 여기서 답한다
 *  일정·기획전 → 쓴 사람이나 팀장이 값 확인 후 [캘린더 등록] → 운영캘린더 + 마케팅·물류CS 공유
 *  공유·메모 → 팀 피드에 남는다
 *
 * 폰에서 쓴다는 전제 — 입력창이 맨 위, 카드는 세로 한 줄.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Send, Check, Clock, MessageSquare, CalendarPlus, Share2 } from 'lucide-react';
import { Link } from 'wouter';
import { toast } from 'sonner';
import { fetchCampaignsSB } from '@/lib/campaignQueries';

type Card = {
  id: string; created_at: string; created_by: string; created_by_name: string; team: string;
  raw_text: string; kind: 'request_check' | 'schedule' | 'share'; parsed: Record<string, any>;
  confirmed_payload?: Record<string, any> | null;
  status: 'open' | 'done'; assignee_id?: string | null; assignee_name?: string | null;
  reply_text?: string | null; replied_by_name?: string | null; related_id?: string | null;
  shared_teams: string[]; result_ref?: { table: string; id: string } | null; done_by_name?: string | null;
};
type Me = { id: string; name: string; team: string; isLeader: boolean; isBoss: boolean };

const KIND: Record<Card['kind'], { label: string; icon: typeof Clock; cls: string }> = {
  request_check: { label: '확인 요청', icon: MessageSquare, cls: 'text-[var(--system-orange)]' },
  schedule: { label: '일정', icon: CalendarPlus, cls: 'text-[var(--system-blue)]' },
  share: { label: '공유', icon: Share2, cls: 'text-muted-foreground' },
};
const CHANNELS = ['자사몰', '센텀', '29CM', 'W컨셉', '쇼룸', '해외'];

type Tab = 'todo' | 'team' | 'shared' | 'all';

export default function WorkFeed() {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [items, setItems] = useState<Card[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('todo');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/work', { credentials: 'include' });
      if (!r.ok) return;
      const j = await r.json();
      setItems(j.items || []); setMe(j.me || null);
    } catch { /* 목록을 못 읽어도 쓰기는 된다 */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const canAct = (c: Card) => !!me && (me.isBoss || (me.isLeader && me.team === c.team));
  const todo = (c: Card) => c.status === 'open' && !!me && (
    c.assignee_id === me.id ||
    (c.kind === 'schedule' && (c.created_by === me.id || canAct(c)))
  );

  const lists = useMemo(() => ({
    todo: items.filter(todo),
    team: items.filter(c => c.team === me?.team),
    shared: items.filter(c => c.team !== me?.team && me && c.shared_teams?.includes(me.team)),
    all: items,
  }), [items, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const r = await fetch('/api/work', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error === 'no_session' ? '로그인이 풀렸습니다' : '올리기 실패'); return; }
      setText('');
      const c: Card = j.card;
      toast.success(
        c.kind === 'request_check' ? `${c.assignee_name || '팀장'}님께 확인 요청을 보냈습니다`
        : c.kind === 'schedule' ? '일정으로 읽었습니다. 값 확인 후 캘린더에 등록하세요'
        : '팀 피드에 올렸습니다');
      load();
    } catch { toast.error('올리기 실패 — 통신 상태를 확인해주세요'); }
    finally { setSending(false); }
  };

  const tabs: Array<[Tab, string]> = [['todo', '내 할 일'], ['team', '우리 팀'], ['shared', '공유받음']];
  if (me?.isBoss) tabs.push(['all', '전체']);

  return (
    <div className="max-w-2xl mx-auto p-4 pb-28 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">업무 입력</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          한 줄로 쓰세요. 확인이 필요하면 팀장에게, 일정이면 캘린더로 갑니다.
          {me && <> · {me.name} ({me.team || '팀 미지정'})</>}
        </p>
      </div>

      <div className="space-y-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          rows={3}
          placeholder="예) W컨셉 기획전 10/20 파니에 토트 20% 예정"
          className="w-full rounded-lg border border-border bg-card p-3 text-base resize-none outline-none focus:border-primary/50"
        />
        <button
          type="button" onClick={send} disabled={sending || !text.trim()}
          className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Send className="w-4 h-4" />{sending ? 'AI가 읽는 중…' : '올리기'}
        </button>
        {me && !me.team && (
          <p className="text-xs text-[var(--system-orange)]">팀이 지정되지 않은 계정입니다. 확인 요청은 대표에게 갑니다.</p>
        )}
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground'}`}>
            {label}
            {k === 'todo' && lists.todo.length > 0 && (
              <span className="ml-1 text-xs text-[var(--system-red)]">{lists.todo.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {lists[tab].length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {tab === 'todo' ? '처리할 일이 없습니다' : '아직 올라온 카드가 없습니다'}
          </p>
        )}
        {lists[tab].map(c => <WorkCard key={c.id} c={c} me={me} canAct={canAct(c)} onDone={load} />)}
      </div>
    </div>
  );
}

function WorkCard({ c, me, canAct, onDone }: { c: Card; me: Me | null; canAct: boolean; onDone: () => void }) {
  const k = KIND[c.kind] || KIND.share;
  const Icon = k.icon;
  const p = c.confirmed_payload || c.parsed || {};
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

  return (
    <div className={`rounded-lg border bg-card p-3 ${c.status === 'open' ? 'border-border' : 'border-border opacity-80'}`}>
      <div className="flex items-center gap-2 text-xs">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${k.cls}`} />
        <span className={`font-medium ${k.cls}`}>{k.label}</span>
        <span className="text-muted-foreground truncate">· {c.created_by_name}{c.team ? ` (${c.team})` : ''}</span>
        <span className="ml-auto text-muted-foreground shrink-0 flex items-center gap-1">
          {c.status === 'done' ? <><Check className="w-3 h-3 text-[var(--system-green)]" />완료</> : <><Clock className="w-3 h-3" />진행</>}
          · {c.created_at.slice(5, 16).replace('T', ' ')}
        </span>
      </div>
      <p className="text-sm mt-1.5 break-words">{c.raw_text}</p>

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
            className="flex-1 h-9 rounded-md border border-border bg-background px-2 text-sm" />
          <button type="button" disabled={busy || !reply.trim()}
            onClick={async () => { if (await post('reply', { text: reply }, '답변을 보냈습니다')) setReply(''); }}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-40">답변</button>
        </div>
      )}

      {c.kind === 'schedule' && (canConfirm ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="기획전 이름"
            className="col-span-2 h-9 rounded-md border border-border bg-background px-2" />
          <select value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })}
            className="h-9 rounded-md border border-border bg-background px-2">
            <option value="">채널 선택</option>
            {CHANNELS.map(ch => <option key={ch}>{ch}</option>)}
          </select>
          <input type="number" value={f.discountRate} onChange={e => setF({ ...f, discountRate: e.target.value })}
            placeholder="할인율 %" className="h-9 rounded-md border border-border bg-background px-2" />
          <input type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })}
            className="h-9 rounded-md border border-border bg-background px-2" />
          <input type="date" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })}
            className="h-9 rounded-md border border-border bg-background px-2" />
          <button type="button" disabled={busy} onClick={confirm}
            className="col-span-2 h-10 rounded-md bg-primary text-primary-foreground font-medium flex items-center justify-center gap-1.5 disabled:opacity-40">
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
    </div>
  );
}
