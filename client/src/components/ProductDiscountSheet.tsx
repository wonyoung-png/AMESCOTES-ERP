// 기획전 상품별 할인율 — 옆에서 열리는 창.
//
// 기획전 전체에 한 율만 걸면 실제와 안 맞는다. 어떤 건 30%, 어떤 건 정가 유지다.
// 여기서 상품을 골라 각각 율을 매기고, 안 고른 상품은 기본율을 따른다.
import { useMemo, useState } from 'react';
import { store } from '@/lib/store';
import type { ProductDiscount } from '@/lib/phase1';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const won = (n: number) => '₩' + Math.round(n).toLocaleString();

export default function ProductDiscountSheet({
  open, onOpenChange, baseRate, value, onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** 기본 할인율 — 고르지 않은 상품에 적용된다 */
  baseRate: number;
  value: ProductDiscount[];
  onChange: (v: ProductDiscount[]) => void;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [season, setSeason] = useState('all');
  const items = useMemo(() => store.getItems(), [open]);

  const picked = new Map(value.map(d => [d.styleNo, d]));
  const cats = useMemo(
    () => Array.from(new Set(items.map((i: any) => i.erpCategory).filter(Boolean))).sort(),
    [items],
  );
  const seasons = useMemo(
    () => Array.from(new Set(items.map((i: any) => i.season).filter(Boolean))).sort().reverse(),
    [items],
  );
  const matched = useMemo(() => {
    const s = q.trim().toUpperCase();
    return items
      .filter((i: any) => cat === 'all' || i.erpCategory === cat)
      .filter((i: any) => season === 'all' || i.season === season)
      .filter((i: any) => !s || `${i.styleNo} ${i.name || ''}`.toUpperCase().includes(s));
  }, [items, q, cat, season]);
  // 조건에 맞는 전부 — "이 조건 전부 담기"는 이걸 쓴다
  const candidates = useMemo(
    () => matched.filter((i: any) => !picked.has(i.styleNo)),
    [matched, value],
  );
  // 목록은 200개만 그린다 (화면 보호용)
  const shown = useMemo(() => candidates.slice(0, 200), [candidates]);

  const add = (i: any) =>
    onChange([...value, { styleNo: i.styleNo, name: i.name, rate: baseRate }]);
  const setRate = (styleNo: string, rate: number) =>
    onChange(value.map(d => (d.styleNo === styleNo ? { ...d, rate } : d)));
  const remove = (styleNo: string) => onChange(value.filter(d => d.styleNo !== styleNo));
  const applyAll = () => onChange(value.map(d => ({ ...d, rate: baseRate })));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle>상품별 할인율</SheetTitle>
          <p className="text-xs text-muted-foreground">
            여기서 고른 상품만 개별 할인율이 적용됩니다. 고르지 않은 상품은 카테고리별 할인율,
            그것도 없으면 기본 {baseRate}%를 따릅니다.
          </p>
        </SheetHeader>

        {/* 고른 상품 — 위에 둬야 뭘 넣었는지 보인다 */}
        <div className="px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-foreground">적용 상품 {value.length}개</span>
            {value.length > 0 && (
              <button type="button" onClick={applyAll}
                className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">
                담은 것 전부 {baseRate}%로
              </button>
            )}
          </div>
          {value.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              아직 없습니다. 아래에서 상품을 눌러 추가하세요.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {value.map(d => (
                <div key={d.styleNo} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-muted-foreground">{d.styleNo}</p>
                    <p className="text-sm text-foreground truncate">{d.name || '—'}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Input
                      type="number" min={0} max={100} value={d.rate}
                      onChange={e => setRate(d.styleNo, Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                      className="h-8 w-16 text-right"
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                    <button type="button" onClick={() => remove(d.styleNo)}
                      className="text-muted-foreground hover:text-[var(--system-red)] p-1">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 상품 찾기 */}
        <div className="px-5 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)}
              placeholder="스타일번호 · 품명으로 검색" className="pl-9 h-9" />
          </div>
          <div className="flex items-center gap-2 mt-2">
            <select value={cat} onChange={e => setCat(e.target.value)}
              className="h-8 text-xs border border-border rounded-md bg-card px-2">
              <option value="all">전체 카테고리</option>
              {cats.map(c => <option key={c as string} value={c as string}>{c as string}</option>)}
            </select>
            <select value={season} onChange={e => setSeason(e.target.value)}
              className="h-8 text-xs border border-border rounded-md bg-card px-2">
              <option value="all">전체 시즌</option>
              {seasons.map(v => <option key={v as string} value={v as string}>{v as string}</option>)}
            </select>
            <span className="text-[11px] text-muted-foreground">{candidates.length}개</span>
            {candidates.length > 0 && (
              <button type="button"
                onClick={() => onChange([...value, ...candidates.map((i: any) => ({ styleNo: i.styleNo, name: i.name, rate: baseRate }))])}
                className="ml-auto text-[11px] text-primary hover:underline">
                이 조건 전부 담기
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {shown.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {q ? `"${q}" 에 걸리는 상품이 없습니다` : '추가할 상품이 없습니다'}
            </p>
          ) : (
            <div className="border border-border rounded-md divide-y divide-border">
              {shown.map((i: any) => (
                <button
                  key={i.id || i.styleNo}
                  type="button"
                  onClick={() => add(i)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--fill-quaternary)]"
                >
                  <span className="w-32 shrink-0 text-xs font-mono text-muted-foreground truncate">{i.styleNo}</span>
                  <span className="flex-1 min-w-0 text-sm text-foreground truncate">{i.name || '—'}</span>
                  {i.erpCategory && <Badge variant="outline" className="text-[10px] h-4 shrink-0">{i.erpCategory}</Badge>}
                  {i.season && <span className="text-[10px] text-muted-foreground shrink-0">{i.season}</span>}
                  {i.sellPriceKrw ? (
                    <span className="text-[11px] text-muted-foreground font-mono shrink-0">{won(i.sellPriceKrw)}</span>
                  ) : null}
                  <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
          {candidates.length > shown.length && (
            <p className="text-[11px] text-muted-foreground text-center pt-2">
              목록엔 {shown.length}개만 보입니다 — 검색으로 좁히거나 <b>이 조건 전부 담기</b>로 {candidates.length}개를 한 번에 담으세요.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border">
          <Button className="w-full" onClick={() => onOpenChange(false)}>완료</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
