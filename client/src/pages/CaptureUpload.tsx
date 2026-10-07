/**
 * 현장 접수 — 사진 한 장 찍고 한 줄 쓰면 끝.
 *
 * 전표는 여기서 만들지 않는다. 팀장이 승인할 때 만들어진다.
 * 현장에서 급한 건 "나중에 못 적는 것"을 막는 일이지, 장부를 정확히 쓰는 일이 아니다.
 *
 * 폰에서 한 손으로 쓴다는 전제로 짰다 — 큰 버튼, 세로 한 줄, 단계 없음.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Send, X, Check, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { resizeImage } from '@/lib/utils';

type Capture = {
  id: string;
  created_at: string;
  raw_text: string;
  kind: string;
  parsed: Record<string, any>;
  confidence: number | null;
  status: string;
  reject_reason?: string | null;
  photo?: string | null;
};

const KIND_LABEL: Record<string, string> = {
  sample: '샘플 제작',
  material: '자재 구매',
  delivery: '메인 납품',
  billing: '바이어 청구',
  unknown: '종류 미정',
};

const STATUS: Record<string, { label: string; cls: string; icon: typeof Check }> = {
  pending: { label: '승인 대기', cls: 'text-[var(--system-orange)]', icon: Clock },
  approved: { label: '승인됨', cls: 'text-[var(--system-green)]', icon: Check },
  rejected: { label: '반려', cls: 'text-[var(--system-red)]', icon: AlertTriangle },
};

export default function CaptureUpload() {
  const [photo, setPhoto] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mine, setMine] = useState<Capture[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/captures?status=all', { credentials: 'include' });
      if (r.ok) setMine((await r.json()).items || []);
    } catch { /* 목록은 못 불러와도 올리는 데 지장 없다 */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  /**
   * 사진 한 장을 받는다.
   *
   * 줄이는 데 시간이 걸려서, 연달아 두 장을 넣으면 먼저 시작한 쪽이 늦게 끝나 나중 것을 덮을 수 있다.
   * 번호를 매겨 마지막 것만 남긴다 (코덱스 지적).
   * 화면을 떠난 뒤 끝나는 경우도 같은 번호 검사로 걸러진다 — 엉뚱한 화면에서 토스트가 뜨지 않는다.
   */
  const pickSeq = useRef(0);
  const alive = useRef(true);
  const busy = useRef(false);          // 전송 중에는 새 사진을 받지 않는다
  useEffect(() => () => { alive.current = false; }, []);

  const pick = useCallback(async (f?: File | null): Promise<boolean> => {
    if (!f) return false;
    // 보내는 중에 새 사진을 받으면 이번 접수에 들어갈지 다음 접수에 들어갈지가 모호해진다.
    // 끝나고 넣게 한다 (코덱스 지적)
    if (busy.current) { toast.info('접수 중입니다. 끝나면 넣어주세요'); return false; }
    if (!f.type.startsWith('image/')) { toast.error('사진만 올릴 수 있습니다'); return false; }
    const mine = ++pickSeq.current;
    try {
      const data = await resizeImage(f);
      if (mine !== pickSeq.current || !alive.current) return false;   // 더 나중 것이 들어왔다
      setPhoto(data);
      return true;
    } catch {
      if (mine === pickSeq.current && alive.current) toast.error('사진을 읽지 못했습니다');
      return false;
    }
  }, []);

  /** 여러 개를 끌어다 놔도 그림 하나를 골라낸다 */
  const firstImage = (files?: FileList | null) =>
    Array.from(files || []).find(f => f.type.startsWith('image/')) || null;

  /**
   * PC 에서는 캡처해서 Ctrl+V 로 붙여넣는 게 가장 빠르다.
   *
   * 기준은 포커스가 아니라 클립보드다. 글칸에 커서가 있어도 클립보드에 그림이 있으면 사진으로 받는다 —
   * 글칸에 그림을 붙여 넣을 일은 없다. 글을 복사해 붙이는 경우는 그대로 통과시킨다.
   */
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      const f = Array.from(cd?.items || []).find(i => i.type.startsWith('image/'))?.getAsFile()
        || Array.from(cd?.files || []).find(x => x.type.startsWith('image/'));
      if (!f) return;                       // 글 붙여넣기는 건드리지 않는다
      e.preventDefault();
      if (await pick(f)) toast.success('사진을 붙여넣었습니다');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pick]);

  /**
   * 처리 중인 사진 변환을 버린다.
   * 안 버리면, 변환이 끝난 뒤 이미 보냈거나 지운 자리에 사진이 되살아난다 (코덱스 지적).
   */
  const dropPending = () => { pickSeq.current += 1; };

  const send = async () => {
    if (!photo && !text.trim()) { toast.error('사진이나 글 중 하나는 있어야 합니다'); return; }
    dropPending();            // 보내는 순간 들어오던 사진은 이 접수에 들어가지 않는다
    busy.current = true;
    setSending(true);
    try {
      const r = await fetch('/api/captures', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, photo }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        toast.error(e.error === 'no_session' ? '로그인이 풀렸습니다. 다시 로그인해주세요' : '접수 실패');
        return;
      }
      setPhoto(null); setText('');
      if (fileRef.current) fileRef.current.value = '';
      toast.success('접수됐습니다. 팀장 승인 후 전표가 만들어집니다');
      load();
    } catch {
      toast.error('접수 실패 — 통신 상태를 확인해주세요');
    } finally {
      busy.current = false;
      setSending(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-4 pb-28 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">현장 접수</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          사진 찍고 한 줄만 쓰세요. 전표는 팀장 승인 후 자동으로 만들어집니다.
        </p>
      </div>

      {/* 사진 — 폰에서는 바로 카메라가 뜬다 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        // 고른 값을 비워둬야 같은 파일을 다시 골랐을 때도 change 가 뜬다 (코덱스 지적)
        onChange={e => { const f = firstImage(e.target.files); e.target.value = ''; pick(f); }}
      />
      {photo ? (
        <div className="relative">
          <img src={photo} alt="올릴 사진" className="w-full rounded-lg border border-border object-contain max-h-72 bg-[var(--fill-quaternary)]" />
          <button
            type="button"
            onClick={() => { dropPending(); setPhoto(null); if (fileRef.current) fileRef.current.value = ''; }}
            aria-label="사진 지우기"
            className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async e => {
            e.preventDefault(); setDragOver(false);
            const f = firstImage(e.dataTransfer.files);
            if (!f) { toast.error('사진만 올릴 수 있습니다'); return; }
            if (await pick(f)) toast.success('사진을 넣었습니다');
          }}
          className={`w-full h-40 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 text-muted-foreground active:bg-[var(--fill-quaternary)] transition-colors ${
            dragOver ? 'border-primary bg-primary/5 text-primary' : 'border-border'
          }`}
        >
          <Camera className="w-8 h-8" />
          <span className="text-sm">사진 찍기</span>
          {/* PC 에서만 알려준다. 폰에는 Ctrl 키도 끌어다 놓기도 없다 */}
          <span className="text-[11px] hidden md:block">끌어다 놓거나 Ctrl+V 로 붙여넣기</span>
        </button>
      )}

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder="예) 로우클래식 토트백 블랙 샘플 완료"
        className="w-full rounded-lg border border-border bg-card p-3 text-base resize-none outline-none focus:border-primary/50"
      />

      <button
        type="button"
        onClick={send}
        disabled={sending || (!photo && !text.trim())}
        className="w-full h-14 rounded-lg bg-primary text-primary-foreground font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <Send className="w-5 h-5" />
        {sending ? '올리는 중…' : '접수'}
      </button>

      {/* 내가 올린 것 — 승인됐는지 반려됐는지 여기서 본다 */}
      {mine.length > 0 && (
        <div className="pt-2">
          <p className="text-xs font-semibold text-muted-foreground mb-2">내가 올린 것</p>
          <div className="space-y-2">
            {mine.map(c => {
              const st = STATUS[c.status] || STATUS.pending;
              const Icon = st.icon;
              return (
                <div key={c.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${st.cls}`} />
                    <span className={`font-medium ${st.cls}`}>{st.label}</span>
                    <span className="text-muted-foreground">· {KIND_LABEL[c.kind] || c.kind}</span>
                    <span className="text-muted-foreground ml-auto">{c.created_at?.slice(5, 16).replace('T', ' ')}</span>
                  </div>
                  <p className="text-sm mt-1.5 break-words">{c.raw_text || '(글 없음)'}</p>
                  {c.status === 'rejected' && c.reject_reason && (
                    <p className="text-xs mt-1.5 text-[var(--system-red)]">반려 사유: {c.reject_reason}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
