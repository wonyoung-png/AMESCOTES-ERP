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
  const [mine, setMine] = useState<Capture[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/captures?status=all', { credentials: 'include' });
      if (r.ok) setMine((await r.json()).items || []);
    } catch { /* 목록은 못 불러와도 올리는 데 지장 없다 */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pick = async (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast.error('사진만 올릴 수 있습니다'); return; }
    try { setPhoto(await resizeImage(f)); }
    catch { toast.error('사진을 읽지 못했습니다'); }
  };

  const send = async () => {
    if (!photo && !text.trim()) { toast.error('사진이나 글 중 하나는 있어야 합니다'); return; }
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
        onChange={e => { pick(e.target.files?.[0]); }}
      />
      {photo ? (
        <div className="relative">
          <img src={photo} alt="올릴 사진" className="w-full rounded-lg border border-border object-contain max-h-72 bg-[var(--fill-quaternary)]" />
          <button
            type="button"
            onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ''; }}
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
          className="w-full h-40 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-muted-foreground active:bg-[var(--fill-quaternary)]"
        >
          <Camera className="w-8 h-8" />
          <span className="text-sm">사진 찍기</span>
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
