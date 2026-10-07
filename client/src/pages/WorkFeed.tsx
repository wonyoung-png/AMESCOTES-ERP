/**
 * 업무 피드 — 챗봇 위젯(오른쪽 아래)에서 쓴 것들이 팀 단위로 모이는 곳.
 *
 *  내 할 일 : 나한테 온 확인 요청, 등록 안 한 일정, 내 할 일
 *  우리 팀  : 팀원이 올린 카드 전부
 *  공유받음 : 다른 팀이 우리 팀에 공유한 일정
 *
 * 남이 올린 카드는 [확인]을 눌러 읽음 처리한다. 안 본 개수가 탭과 왼쪽 메뉴에 숫자로 뜬다.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, CheckCheck, Clock, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  type Card, type Me, KIND, CardActions, isTodo, isUnread, markRead, fetchWork, announceWorkChanged, fmtTime,
} from '@/components/WorkCardActions';

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
  const unreadOf = (t: Tab) => lists[t].filter(c => isUnread(c, me));

  const check = async (ids: string[]) => {
    const ok = await markRead(ids);
    // 실패해도 다시 읽는다 — 카드 처리 결과(완료 등)는 반영돼야 한다 (코덱스 지적)
    announceWorkChanged(); // 피드·위젯·왼쪽 메뉴 숫자가 같이 줄어든다
    if (!ok) toast.error('확인 처리 실패');
  };

  const tabs: Array<[Tab, string]> = [['todo', '내 할 일'], ['team', '우리 팀'], ['shared', '공유받음']];
  if (me?.isBoss) tabs.push(['all', '전체']);
  const unreadHere = unreadOf(tab);

  return (
    <div className="max-w-2xl mx-auto p-4 pb-28 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">업무 피드</h1>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          입력은 오른쪽 아래 <MessageCircle className="w-3.5 h-3.5 inline" /> 업무 비서에서 하세요.
          {me && <> · {me.name} ({me.team || '팀 미지정'})</>}
        </p>
      </div>

      <div className="flex items-end gap-1 border-b border-border">
        {tabs.map(([k, label]) => {
          // 내 할 일 = 처리할 개수, 나머지 탭 = 안 본 개수
          const n = k === 'todo' ? lists.todo.length : unreadOf(k).length;
          return (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`px-3 py-2 text-sm -mb-px border-b-2 flex items-center gap-1 ${tab === k ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground'}`}>
              {label}
              {n > 0 && (
                <span className="min-w-5 h-5 px-1.5 rounded-full bg-[var(--system-red)] text-white text-[11px] leading-5 text-center">{n}</span>
              )}
            </button>
          );
        })}
        {unreadHere.length > 0 && (
          <button type="button" onClick={() => check(unreadHere.map(c => c.id))}
            className="ml-auto mb-1.5 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <CheckCheck className="w-3.5 h-3.5" />모두 확인
          </button>
        )}
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
          const unread = isUnread(c, me);
          return (
            <div key={c.id}
              className={`rounded-lg border bg-card p-3 ${unread ? 'border-primary/60' : 'border-border'} ${c.status === 'done' ? 'opacity-80' : c.status === 'cancelled' ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2 text-xs">
                {unread && <span className="w-2 h-2 rounded-full bg-[var(--system-red)] shrink-0" aria-label="안 읽음" />}
                <Icon className={`w-3.5 h-3.5 shrink-0 ${k.cls}`} />
                <span className={`font-medium ${k.cls}`}>{k.label}</span>
                <span className="text-muted-foreground truncate">· {c.created_by_name}{c.team ? ` (${c.team})` : ''}</span>
                <span className="ml-auto text-muted-foreground shrink-0 flex items-center gap-1">
                  {c.status === 'done' ? <><Check className="w-3 h-3 text-[var(--system-green)]" />완료</>
                    : c.status === 'cancelled' ? <>취소</> : <><Clock className="w-3 h-3" />진행</>}
                  · {fmtTime(c.created_at)}
                </span>
              </div>
              <p className={`text-sm mt-1.5 break-words ${unread ? 'font-medium' : ''}`}>{c.raw_text}</p>
              <CardActions c={c} me={me} onDone={() => { if (unread) check([c.id]); else announceWorkChanged(); }} />
              {unread && (
                <button type="button" onClick={() => check([c.id])}
                  className="mt-2 h-8 px-3 rounded-md border border-border text-xs flex items-center gap-1 hover:bg-[var(--fill-quaternary)]">
                  <Check className="w-3.5 h-3.5" />확인
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
