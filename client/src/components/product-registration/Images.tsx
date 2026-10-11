import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Listing, ListingImage } from '@shared/product-registration';

type Metadata = Pick<ListingImage, 'position' | 'role' | 'alt_ko' | 'alt_en'>;
export function ListingImages({ listing, images, disabled, upload, update, remove }: {
  listing: Listing; images: ListingImage[]; disabled: boolean;
  upload: (files: File[]) => Promise<void>; update: (id: string, metadata: Metadata) => Promise<void>; remove: (id: string) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <div id="field-images" tabIndex={-1} className="space-y-4 scroll-mt-20">
    <div className={`rounded-lg border border-dashed p-6 text-center ${dragging ? 'border-primary bg-primary/5' : 'border-border'}`}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); if (!disabled) void upload(Array.from(e.dataTransfer.files)); }}>
      <ImagePlus aria-hidden className="mx-auto mb-2 size-6 text-muted-foreground" />
      <p className="text-sm">이미지를 놓거나 파일을 선택하세요</p>
      <p className="my-2 text-xs text-muted-foreground">JPEG · PNG · WebP / 파일당 10MB 이하 / 권장 3:4 / 대표 1장 포함 최소 3장</p>
      <Button type="button" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>파일 선택</Button>
      <input ref={input} type="file" className="sr-only" aria-label="상품 이미지 업로드" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled}
        onChange={e => { void upload(Array.from(e.target.files || [])); e.target.value = ''; }} />
      {!listing.id && <p className="mt-2 text-xs text-muted-foreground">먼저 임시저장하면 원본 이미지를 업로드할 수 있습니다.</p>}
    </div>
    {!images.length && <p className="text-sm text-muted-foreground">등록된 이미지가 없습니다.</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[...images].sort((a, b) => a.position - b.position).map((image, index) => <ImageRow key={`${image.id}:${listing.revision}`} image={image} index={index} count={images.length} disabled={disabled} update={update} remove={remove} />)}
    </div>
  </div>;
}
function ImageRow({ image, index, count, disabled, update, remove }: {
  image: ListingImage; index: number; count: number; disabled: boolean; update: (id: string, metadata: Metadata) => Promise<void>; remove: (id: string) => Promise<void>;
}) {
  const [metadata, setMetadata] = useState<Metadata>({ position: image.position, role: image.role, alt_ko: image.alt_ko, alt_en: image.alt_en });
  const [broken, setBroken] = useState(false);
  const ratioWarning = image.height <= 0 || Math.abs(image.width / image.height - .75) > .01;
  return <div className="border-b border-border pb-4 space-y-3">
    <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-muted">
      {broken ? <p className="p-4 text-sm text-muted-foreground">이미지를 불러올 수 없습니다.</p> : <img src={image.source_url} alt={image.alt_ko || '상품 이미지'} loading="lazy" className="h-full w-full object-contain" onError={() => setBroken(true)} />}
      <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-1 text-xs tabular-nums">{index + 1}</span>
    </div>
    <p className={`text-xs ${ratioWarning ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>{image.width} × {image.height}{ratioWarning ? ' · 3:4 비율이 아닙니다' : ' · 3:4'}</p>
    <Label htmlFor={`role-${image.id}`}>역할</Label>
    <select id={`role-${image.id}`} value={metadata.role} disabled={disabled} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
      onChange={e => setMetadata({ ...metadata, role: e.target.value as ListingImage['role'] })}>
      <option value="main">대표</option><option value="list">목록</option><option value="extra">추가</option><option value="detail_view">상세 DETAIL VIEW</option>
    </select>
    <Label htmlFor={`alt-ko-${image.id}`}>이미지 설명 KO</Label><Input id={`alt-ko-${image.id}`} value={metadata.alt_ko} disabled={disabled} onChange={e => setMetadata({ ...metadata, alt_ko: e.target.value })} />
    <Label htmlFor={`alt-en-${image.id}`}>이미지 설명 EN</Label><Input id={`alt-en-${image.id}`} value={metadata.alt_en} disabled={disabled} onChange={e => setMetadata({ ...metadata, alt_en: e.target.value })} />
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void update(image.id, metadata)}>설명 · 역할 저장</Button>
      <Button type="button" size="icon" variant="ghost" aria-label={`${index + 1}번 이미지 앞으로`} disabled={disabled || index === 0} onClick={() => void update(image.id, { ...metadata, position: image.position - 1 })}><ArrowUp className="size-4" /></Button>
      <Button type="button" size="icon" variant="ghost" aria-label={`${index + 1}번 이미지 뒤로`} disabled={disabled || index === count - 1} onClick={() => void update(image.id, { ...metadata, position: image.position + 1 })}><ArrowDown className="size-4" /></Button>
      <Button type="button" size="icon" variant="ghost" aria-label={`${index + 1}번 이미지 삭제`} disabled={disabled} onClick={() => { if (window.confirm('이 상품에 등록한 이미지를 삭제할까요?')) void remove(image.id); }}><Trash2 className="size-4" /></Button>
    </div>
    {(image.shopify_media_id || image.cafe24_paths) && <p className="break-all text-xs text-muted-foreground">채널 업로드 결과: {image.shopify_media_id || JSON.stringify(image.cafe24_paths)}</p>}
  </div>;
}

export async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: 10MB를 초과합니다.`);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name}: JPEG·PNG·WebP만 업로드할 수 있습니다.`);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error(`${file.name}: 이미지 파일을 읽을 수 없습니다.`));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
