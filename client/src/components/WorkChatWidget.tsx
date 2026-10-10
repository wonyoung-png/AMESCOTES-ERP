/**
 * 업무 비서 — ERP 어느 화면에서든 오른쪽 아래 버튼으로 여는 챗봇.
 *
 * 한 줄 쓰면 AI 가 알아서 가른다:
 *  "팀장님 확인 필요"        → 팀장에게 확인 요청을 보내고 답이 오면 이 대화에 붙는다
 *  "10/20 W컨셉 20% 예정"   → 일정으로 읽고 대화 안에서 [캘린더 등록]
 *  "W컨셉 기획전 언제야?"     → 쌓인 기록(업무 카드·운영캘린더)에서 찾아 답한다
 *
 * 대화 기록 = 업무 카드다. 따로 채팅 저장소를 두지 않는다.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MessageCircle, X, Send, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { toast } from 'sonner';
import { createWorkSubmitAttempt } from '@/lib/workSubmitAttempt';
import {
  type Card, type Me, type WorkCounts, CardActions, isTodo, isUnread, fetchWork, postWork, announceWorkChanged, fmtTime,
  PROFILE_PLACEHOLDER, PROFILE_MAX,
} from '@/components/WorkCardActions';

const EXAMPLES = [
  'W컨셉 기획전 10/20 파니에 토트 20% 예정',
  '29CM 기획전 제안 왔는데 진행할지 팀장님 확인 필요',
  '이번 달 기획전 일정 뭐 있어?',
];

/** AI 쪽 말풍선 첫 줄 — 카드 상태를 사람 말로 */
function aiLine(c: Card, me: Me | null): string {
  if (c.status === 'cancelled') return '취소했어요.';
  if (c.created_by !== me?.id) {
    return c.kind === 'request_check' ? `${c.created_by_name}님이 확인을 요청했어요` : `${c.created_by_name}님이 올린 일정이에요. 등록할까요?`;
  }
  switch (c.kind) {
    case 'request_check':
      return c.status === 'open' ? `${c.assignee_name || '팀장'}님께 확인 요청을 보냈어요. 답이 오면 알려드릴게요.` : '답이 왔어요.';
    case 'todo':
      return c.status === 'open'
        ? `할 일로 적어 뒀어요${c.parsed?.dueDate ? ` (마감 ${c.parsed.dueDate})` : ''}. 업무 피드 '내 할 일'에도 올렸어요. 끝나면 완료를 눌러 주세요.`
        : '완료했어요.';
    case 'schedule':
      return c.status === 'open' ? '일정으로 읽었어요. 값 확인하고 등록해 주세요.' : '운영캘린더에 등록했어요.';
    case 'share':
      return '팀 피드에 공유했어요.';
    default:
      return '';
  }
}

/**
 * 기다리는 동안 몇 초 지났는지·보통 얼마 걸리는지 보여준다.
 * 실측(10/7, Opus): 판정만 3~5초, 질문은 답까지 두 번 불러 5~8초.
 * ponytail: 막대는 진짜 진행률이 아니라 8초 기준 추정치. 정확히 하려면 응답 스트리밍으로 바꿔야 한다.
 */
function WaitBubble() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(t);
  }, []);
  const step = sec < 3 ? '글을 읽는 중' : sec < 6 ? '기록을 찾는 중' : '답을 정리하는 중';
  return (
    <div className="w-56 rounded-2xl rounded-bl-sm bg-[var(--fill-quaternary)] px-3 py-2 text-sm text-muted-foreground">
      <div className="flex justify-between gap-2">
        {/* 단계 문구만 읽어 준다. 초 단위 숫자까지 읽으면 화면낭독기가 매초 끼어든다 (코덱스 지적) */}
        <span role="status" aria-live="polite">{sec < 15 ? `${step}…` : '평소보다 오래 걸리고 있어요…'}</span>
        <span className="tabular-nums shrink-0" aria-hidden="true">{sec}초</span>
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-border overflow-hidden">
        <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${Math.min(95, (sec / 8) * 100)}%` }} />
      </div>
      <p className="text-[11px] mt-1">보통 3~8초 걸려요</p>
    </div>
  );
}

/** 내 업무 프로필 — 비서가 담당·결정권·약어를 알고 답하게 한다 */
function ProfilePanel({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/work/profile', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: v }),
      });
      if (!r.ok) { toast.error('저장 실패'); return; }
      toast.success('저장했습니다. 다음 대화부터 반영됩니다');
      announceWorkChanged();
      onClose();
    } catch { toast.error('저장 실패 — 통신 상태를 확인해주세요'); }
    finally { setSaving(false); }
  };
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">내 업무 프로필</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          맡은 채널·업무·결정권을 적어 두면 비서가 그에 맞게 분류하고 답합니다. 다른 직원이 "누구한테 물어봐?"라고 할 때도 쓰입니다.
        </p>
      </div>
      <textarea value={v} onChange={e => setV(e.target.value.slice(0, PROFILE_MAX))} rows={9} placeholder={PROFILE_PLACEHOLDER}
        className="w-full rounded-lg border border-border bg-background p-3 text-sm resize-none outline-none focus:border-primary/50" />
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground tabular-nums">{v.length}/{PROFILE_MAX}</span>
        <button type="button" onClick={onClose} className="ml-auto h-9 px-3 rounded-md border border-border text-sm">취소</button>
        <button type="button" onClick={save} disabled={saving}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
      </div>
    </div>
  );
}

export default function WorkChatWidget() {
  const [open, setOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [items, setItems] = useState<Card[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [counts, setCounts] = useState<WorkCounts | undefined>();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const loadRevision = useRef(0);
  const identity = useRef<string | null>(null);
  useEffect(() => {
    if (!me?.id) return;
    if (identity.current && identity.current !== me.id) { setText(''); setPending(null); }
    identity.current = me.id;
  }, [me?.id]);
  const attempt = useMemo(() => {
    if (!me?.id) return null;
    try { return createWorkSubmitAttempt(me.id, window.sessionStorage); }
    catch { return null; }
  }, [me?.id]);
  const [, refreshAttempt] = useState(0);
  const frozen = attempt?.request;

  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    const j = await fetchWork();
    if (revision !== loadRevision.current) return;
    if (j) { setItems(j.items); setMe(j.me); setCounts(j.counts); }
  }, []);

  // 닫혀 있어도 "내 할 일" 수는 보여야 한다 — 1분마다, 그리고 피드에서 처리했을 때
  useEffect(() => {
    load();
    const refreshVisible = () => { if (!document.hidden) load(); };
    const t = setInterval(refreshVisible, 60_000);
    window.addEventListener('work:changed', load);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    // 상단 이름 메뉴의 "내 업무 프로필"
    const openProfile = () => { setOpen(true); setShowProfile(true); };
    window.addEventListener('work:open-profile', openProfile);
    return () => {
      clearInterval(t);
      ++loadRevision.current;
      window.removeEventListener('work:changed', load);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('work:open-profile', openProfile);
    };
  }, [load]);
  useEffect(() => { if (open) load(); }, [open, load]);

  // 대화 = 내가 쓴 것 + 나한테 온 것(확인 요청·팀원 일정). 오래된 것부터
  const thread = useMemo(() => items
    .filter(c => c.created_by === me?.id || isTodo(c, me))
    .slice(0, 60)
    .sort((a, b) => a.created_at.localeCompare(b.created_at)), [items, me]);
  // 버튼 숫자 = 업무 피드 '내 할 일'과 같은 기준 (내 할 일·받은 확인 요청·등록 안 한 일정)
  const todo = counts?.todo ?? items.filter(c => isTodo(c, me)).length;
  // 왼쪽 메뉴 '업무 피드' 옆 숫자 = 볼 것 = 안 본 카드 + 내가 처리할 일 (겹치는 카드는 한 번만).
  // 내가 쓴 할 일만 있을 때도 숫자가 떠야 한다. 위젯이 이미 1분마다 읽고 있으니 그 값을 알린다
  const attention = counts?.attention ?? items.filter(c => isUnread(c, me) || isTodo(c, me)).length;
  useEffect(() => { window.dispatchEvent(new CustomEvent('work:unread', { detail: attention })); }, [attention]);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'end' }); }, [open, thread.length, pending]);

  const send = async (t = text) => {
    const msg = t.trim();
    if (!msg || sending.current) return;
    if (!attempt || !me?.id) { toast.error('로그인·요청 보존 공간을 확인하지 못했습니다. 전송하지 않았습니다.'); return; }
    sending.current = true;
    setSendBusy(true);
    setPending(msg);
    try {
      await attempt.run(msg, request => postWork(request.text, request.requestId, me.id));
      if (identity.current === me.id) setText(current => current.trim() === msg ? '' : current);
      announceWorkChanged();
    } catch (error) {
      toast.error((error as Error).message || '저장 결과를 확인하지 못했습니다. 원문으로 재시도해주세요.');
    } finally {
      setPending(null);
      sending.current = false;
      setSendBusy(false);
      refreshAttempt(n => n + 1);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button" onClick={() => setOpen(true)} aria-label="업무 비서 열기"
          className="fixed right-4 bottom-20 md:bottom-6 z-30 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:opacity-90"
        >
          <MessageCircle className="w-6 h-6" />
          {todo > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[var(--system-red)] text-white text-[11px] leading-5 text-center">{todo}</span>
          )}
        </button>
      )}

      {open && (
        <div className="fixed z-40 inset-0 md:inset-auto md:right-6 md:bottom-6 md:w-[400px] md:h-[600px] md:max-h-[calc(100vh-3rem)] bg-card md:rounded-xl md:border border-border shadow-2xl flex flex-col">
          <div className="h-12 shrink-0 px-4 border-b border-border flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">업무 비서</span>
            {me && <span className="text-xs text-muted-foreground truncate">· {me.name}{me.team ? ` (${me.team})` : ''}</span>}
            <button type="button" onClick={() => setShowProfile(s => !s)}
              className={`ml-auto text-xs hover:text-foreground ${showProfile ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>내 프로필</button>
            <Link href="/work" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">팀 피드</Link>
            <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="p-1 rounded-md text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>

          {showProfile ? <ProfilePanel key={me?.id} initial={me?.profile || ''} onClose={() => setShowProfile(false)} /> : <>
          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
            {me && !me.profile && (
              <button type="button" onClick={() => setShowProfile(true)}
                className="w-full text-left text-xs px-3 py-2 rounded-lg border border-dashed border-border text-muted-foreground hover:bg-[var(--fill-quaternary)]">
                업무 프로필을 적어 두면 비서가 더 정확해져요 — 작성하기
              </button>
            )}
            {thread.length === 0 && !pending && (
              <div className="text-sm text-muted-foreground space-y-3 px-1">
                <p>업무를 한 줄로 쓰세요. 확인이 필요하면 팀장에게, 일정이면 캘린더로 보내고, 물어보면 기록에서 찾아 답합니다.</p>
                <div className="space-y-1.5">
                  {EXAMPLES.map(e => (
                    <button key={e} type="button" onClick={() => setText(e)}
                      className="block w-full text-left text-xs px-3 py-2 rounded-lg border border-border hover:bg-[var(--fill-quaternary)] text-foreground">
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {thread.map(c => {
              const mine = c.created_by === me?.id;
              const line = aiLine(c, me);
              return (
                <div key={c.id} className="space-y-1.5">
                  {mine && (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">{c.raw_text}</div>
                    </div>
                  )}
                  <div className="flex justify-start">
                    <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-[var(--fill-quaternary)] px-3 py-2 text-sm">
                      {line && <p className={mine ? '' : 'font-medium'}>{line}</p>}
                      {!mine && <p className="text-sm mt-1 break-words">“{c.raw_text}”</p>}
                      <CardActions c={c} me={me} onDone={announceWorkChanged} />
                      <p className="text-[11px] text-muted-foreground mt-1">{fmtTime(c.created_at)}</p>
                    </div>
                  </div>
                </div>
              );
            })}

            {pending && (
              <div className="space-y-1.5">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap break-words">{pending}</div>
                </div>
                <div className="flex justify-start">
                  <WaitBubble />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {sendBusy && !pending && <p role="status" className="px-3 py-2 text-xs border-t border-border">이전 계정의 요청 결과를 확인 중입니다. 확인이 끝나면 입력할 수 있습니다.</p>}
          {((frozen && !pending) || attempt?.blocked || (me && !attempt)) && <div role="alert" className="px-3 py-2 text-xs border-t border-border space-y-1">
            <p>{attempt?.blocked || (!attempt ? '요청 보존 공간을 사용할 수 없어 전송을 중단했습니다. 브라우저 저장 공간을 확인해주세요.' : '이전 요청의 저장 결과가 미확인입니다. 복원된 원문·동일 요청 ID로 재시도하세요.')}</p>
            {frozen && <><p className="whitespace-pre-wrap break-words">{frozen.text}</p>
              <button type="button" disabled={sendBusy || !!attempt?.blocked} onClick={() => send(frozen.text)} className="underline disabled:opacity-40">동일 요청 다시 확인</button></>}
            <p>이 탭에서만 요청이 보존됩니다. 다른 탭·기기에서 새로 등록하기 전 업무함에서 저장 여부를 확인하세요.</p>
          </div>}
          <div className="shrink-0 border-t border-border p-2 flex items-end gap-2">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              disabled={sendBusy || !!frozen || !!attempt?.blocked || !attempt}
              onKeyDown={e => {
                // 한글 조합 중 Enter 는 글자 확정이다. 그때 보내면 마지막 글자가 두 번 들어간다
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
              }}
              rows={1}
              placeholder="업무를 한 줄로 쓰거나 물어보세요"
              className="flex-1 max-h-32 min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none outline-none focus:border-primary/50"
            />
            <button type="button" onClick={() => send()} disabled={!text.trim() || sendBusy || !!frozen || !!attempt?.blocked || !attempt} aria-label="보내기"
              className="h-10 w-10 shrink-0 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40">
              <Send className="w-4 h-4" />
            </button>
          </div>
          </>}
        </div>
      )}
    </>
  );
}
