/**
 * 상단 알림 벨 — 업무 카드에서 나한테 온 확인 요청·답변·일정 공유.
 * 1분마다 다시 읽는다. 실시간 푸시는 없다 (ponytail: 폴링, 직원 수가 늘면 SSE 로).
 */
import { useEffect, useState, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { Link } from 'wouter';
import { fmtTime } from '@/components/WorkCardActions';

type Ntf = { id: string; title: string; body?: string; link?: string; read_at?: string | null; created_at: string };

export default function NotificationBell() {
  const [items, setItems] = useState<Ntf[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications', { credentials: 'include' });
      if (!r.ok) return;
      const j = await r.json();
      setItems(j.items || []); setUnread(j.unread || 0);
      return j as { items: Ntf[]; unread: number };
    } catch { /* 알림을 못 읽어도 화면은 써야 한다 */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener('work:changed', load);
    return () => { clearInterval(t); window.removeEventListener('work:changed', load); };
  }, [load]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await load();
  };

  const [marking, setMarking] = useState(false);
  const mark = async (ids: string[]) => {
    if (!ids.length || marking) return;
    setMarking(true);
    // 읽음 처리가 실패하면 배지를 그대로 둔다 — 안 읽은 알림이 사라져 보이면 안 된다
    try {
      const r = await fetch('/api/notifications/read', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      if (r.ok) await load();
    } catch { /* 배지 유지 */ }
    finally { setMarking(false); }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`알림 ${unread}건`}
        className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--fill-quaternary)]"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[var(--system-red)] text-white text-[10px] leading-4 text-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 w-80 max-w-[90vw] max-h-96 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
            {items.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">알림이 없습니다</p>
            ) : items.map(n => (
              <Link key={n.id} href={n.link || '/work'} onClick={() => { setOpen(false); if (!n.read_at) void mark([n.id]); }}
                className="block px-3 py-2.5 border-b border-border last:border-0 hover:bg-[var(--fill-quaternary)]">
                <div className="flex items-center gap-2">
                  {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-[var(--system-red)] shrink-0" />}
                  <span className="text-xs font-medium text-foreground truncate">{n.title}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{fmtTime(n.created_at)}</span>
                </div>
                {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
              </Link>
            ))}
            {items.some(n => !n.read_at) && <button type="button" disabled={marking} onClick={() => mark(items.filter(n => !n.read_at).map(n => n.id))} className="w-full p-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">{marking ? '확인 중…' : '표시된 알림 확인'}</button>}
          </div>
        </>
      )}
    </div>
  );
}
