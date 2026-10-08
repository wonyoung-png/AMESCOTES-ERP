/**
 * 내 캘린더 — 연결한 회사 구글 캘린더(본인 기본 + "ATLM 업무")를 ERP 안에 그대로 띄운다.
 * 구글 공식 임베드라 브라우저가 같은 구글 계정으로 로그인돼 있어야 보인다. 편집은 구글에서.
 * ponytail: 임베드라 ERP 데이터와 섞어 그리진 못한다 — ERP 항목은 "ATLM 업무" 캘린더로 이미 들어간다.
 */
import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

type Status = { configured: boolean; connected: boolean; email: string | null; calendarId: string | null };

export default function MyCalendar() {
  const [st, setSt] = useState<Status | null | 'error'>(null);
  useEffect(() => {
    fetch('/api/gcal/status', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setSt, () => setSt('error'));
  }, []);

  if (st === null) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>;
  if (st === 'error' || !st.configured) return <div className="p-6 text-sm text-muted-foreground">구글 캘린더 연결을 쓸 수 없습니다.</div>;

  if (!st.connected || !st.email) {
    return (
      <div className="max-w-md mx-auto p-8 text-center space-y-3">
        <h1 className="text-lg font-bold text-foreground">내 캘린더</h1>
        <p className="text-sm text-muted-foreground">회사 구글 계정(@atlm.kr)을 연결하면 내 구글 캘린더가 여기 보입니다.</p>
        <a href="/api/gcal/connect" className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          구글 캘린더 연결
        </a>
      </div>
    );
  }

  const q = new URLSearchParams({ ctz: 'Asia/Seoul', mode: 'MONTH', showTitle: '0', showPrint: '0', hl: 'ko' });
  q.append('src', st.email);
  if (st.calendarId) q.append('src', st.calendarId);

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] p-4 gap-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">내 캘린더</h1>
          <p className="text-xs text-muted-foreground">{st.email} · 내 일정 + ATLM 업무(할 일 마감·팀 기획전)</p>
        </div>
        <a href="https://calendar.google.com/" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
          구글에서 편집 <ArrowUpRight size={12} />
        </a>
      </div>
      <iframe
        title="내 구글 캘린더"
        referrerPolicy="no-referrer"
        src={`https://calendar.google.com/calendar/embed?${q}`}
        className="flex-1 w-full rounded-lg border border-border bg-white"
      />
      <p className="text-[11px] text-muted-foreground">
        안 보이면 이 브라우저에서 {st.email} 로 구글에 로그인돼 있는지 확인하세요.
      </p>
    </div>
  );
}
