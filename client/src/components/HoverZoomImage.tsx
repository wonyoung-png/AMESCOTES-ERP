import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type HoverZoomImageProps = {
  src: string;
  alt?: string;
  className?: string;
  imgClassName?: string;
  previewSize?: number;
  children?: ReactNode;
};

/**
 * 썸네일 호버 시 크게 미리보기 (테이블 overflow에도 잘리치 않도록 portal)
 */
export function HoverZoomImage({
  src,
  alt = '',
  className = '',
  imgClassName = 'w-full h-full object-cover',
  previewSize = 320,
  children,
}: HoverZoomImageProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 12;
    const size = previewSize;
    let left = r.right + pad;
    let top = r.top;
    if (left + size > window.innerWidth - pad) {
      left = r.left - size - pad;
    }
    if (left < pad) left = pad;
    if (top + size > window.innerHeight - pad) {
      top = window.innerHeight - size - pad;
    }
    if (top < pad) top = pad;
    setStyle({
      position: 'fixed',
      left,
      top,
      width: size,
      height: size,
      zIndex: 9999,
    });
  }, [previewSize]);

  return (
    <>
      <div
        ref={wrapRef}
        className={`relative inline-flex ${className}`}
        onMouseEnter={() => {
          place();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onMouseMove={place}
      >
        {children ?? <img src={src} alt={alt} className={imgClassName} />}
      </div>
      {open &&
        createPortal(
          <div
            style={style}
            className="pointer-events-none rounded-xl border border-stone-200 bg-white shadow-2xl overflow-hidden ring-1 ring-black/5"
          >
            <img src={src} alt={alt} className="w-full h-full object-contain bg-stone-50" />
          </div>,
          document.body,
        )}
    </>
  );
}
