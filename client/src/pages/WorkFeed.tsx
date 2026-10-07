/**
 * 업무 피드 — 챗봇 위젯(오른쪽 아래)에서 쓴 것들이 팀 단위로 모이는 곳.
 *
 *  내 할 일 : 나한테 온 확인 요청, 등록 안 한 일정
 *  우리 팀  : 팀원이 올린 카드 전부
 *  공유받음 : 다른 팀이 우리 팀에 공유한 일정
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, Clock, MessageCircle } from 'lucide-react';
import { type Card, type Me, KIND, CardActions, isTodo, fetchWork, announceWorkChanged, fmtTime } from '@/components/WorkCardActions';

type Tab = 'todo' | 'team' | 'shared' | 'all';

export default function WorkFeed() {
  const [items, setItems] = useState<Card[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('todo');

  const load = useCallback(async () => {
    const j = await fetchWork();
    if (j) { setItems(j.items); setMe(j.me); }
  }, []);
  useEffect(() => {
    load();
    // 위젯에서 올리면 여기도 갱신한다
    window.addEventListener('work:changed', load);
    return () => window.removeEventListener('work:changed', load);
  }, [load]);

  const lists = useMemo(() => {
    const noQ = items.filter(c => c.kind !== 'question');
    return {
      todo: noQ.filter(c => isTodo(c, me)),
      team: noQ.filter(c => c.team === me?.team),
      shared: noQ.filter(c => c.team !== me?.team && !!me && c.shared_teams?.includes(me.team)),
      all: noQ,
    };
  }, [items, me]);

  const tabs: Array<[Tab, string]> = [['todo', '내 할 일'], ['team', '우리 팀'], ['shared', '공유받음']];
  if (me?.isBoss) tabs.push(['all', '전체']);

  return (
    <div className="max-w-2xl mx-auto p-4 pb-28 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">업무 피드</h1>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          입력은 오른쪽 아래 <MessageCircle className="w-3.5 h-3.5 inline" /> 업무 비서에서 하세요.
          {me && <> · {me.name} ({me.team || '팀 미지정'})</>}
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground'}`}>
            {label}
            {k === 'todo' && lists.todo.length > 0 && <span className="ml-1 text-xs text-[var(--system-red)]">{lists.todo.length}</span>}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {lists[tab].length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {tab === 'todo' ? '처리할 일이 없습니다' : '아직 올라온 카드가 없습니다'}
          </p>
        )}
        {lists[tab].map(c => {
          const k = KIND[c.kind] || KIND.share;
          const Icon = k.icon;
          return (
            <div key={c.id} className={`rounded-lg border border-border bg-card p-3 ${c.status === 'done' ? 'opacity-80' : c.status === 'cancelled' ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2 text-xs">
                <Icon className={`w-3.5 h-3.5 shrink-0 ${k.cls}`} />
                <span className={`font-medium ${k.cls}`}>{k.label}</span>
                <span className="text-muted-foreground truncate">· {c.created_by_name}{c.team ? ` (${c.team})` : ''}</span>
                <span className="ml-auto text-muted-foreground shrink-0 flex items-center gap-1">
                  {c.status === 'done' ? <><Check className="w-3 h-3 text-[var(--system-green)]" />완료</>
                    : c.status === 'cancelled' ? <>취소</> : <><Clock className="w-3 h-3" />진행</>}
                  · {fmtTime(c.created_at)}
                </span>
              </div>
              <p className="text-sm mt-1.5 break-words">{c.raw_text}</p>
              <CardActions c={c} me={me} onDone={announceWorkChanged} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
