// 전자서명 — 마우스·손가락으로 그려 이미지로 남긴다.
// 종이에 사인하고 다시 찍어 보내던 왕복을 없애기 위한 것.
import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export type Signature = { name?: string; dataUrl?: string; at?: string };

/** 서류에 박히는 서명 칸 — 값이 있으면 그림, 없으면 빈 칸 */
export function SignatureSlot({ label, sign, onClick }: {
  label: string; sign?: Signature; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className="border border-neutral-400 px-3 py-2 flex items-center gap-2 text-left w-full h-[62px] disabled:cursor-default">
      <span className="text-[10.5px] text-neutral-500 whitespace-nowrap shrink-0">{label}</span>
      {sign?.dataUrl ? (
        <span className="flex-1 min-w-0 flex items-center justify-between gap-2">
          <img src={sign.dataUrl} alt={`${label} 서명`} className="h-10 object-contain" />
          <span className="text-[10px] text-neutral-500 whitespace-nowrap">
            {sign.name}{sign.at ? ` · ${sign.at.slice(0, 10)}` : ''}
          </span>
        </span>
      ) : (
        <span className="flex-1 text-right text-[10.5px] text-neutral-400 whitespace-nowrap">
          {onClick ? '클릭해 서명' : '(서명)'}
        </span>
      )}
    </button>
  );
}

/** 서명 입력 창 — 그리고 이름 적고 저장 */
export function SignatureDialog({ open, title, defaultName, onClose, onSave }: {
  open: boolean; title: string; defaultName?: string;
  onClose: () => void; onSave: (s: Signature) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [name, setName] = useState(defaultName || '');

  useEffect(() => { if (open) { setName(defaultName || ''); dirty.current = false; clear(); } }, [open, defaultName]);

  const ctx = () => {
    const c = canvasRef.current!;
    const g = c.getContext('2d')!;
    g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
    return g;
  };
  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    drawing.current = true; dirty.current = true;
    const g = ctx(); const p = pos(e); g.beginPath(); g.moveTo(p.x, p.y);
    canvasRef.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const g = ctx(); const p = pos(e); g.lineTo(p.x, p.y); g.stroke();
  };
  const up = () => { drawing.current = false; };
  const clear = () => {
    const c = canvasRef.current; if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent onInteractOutside={e => e.preventDefault()} className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="이름" className="h-9" />
          <div className="rounded-md border border-border bg-white">
            <canvas
              ref={canvasRef} width={420} height={150}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
              className="w-full h-[150px] touch-none cursor-crosshair"
            />
          </div>
          <p className="text-xs text-muted-foreground">마우스나 손가락으로 서명하세요</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={clear}>지우기</Button>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={() => {
            const c = canvasRef.current!;
            onSave({
              name: name.trim() || undefined,
              dataUrl: dirty.current ? c.toDataURL('image/png') : undefined,
              at: new Date().toISOString(),
            });
          }}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
