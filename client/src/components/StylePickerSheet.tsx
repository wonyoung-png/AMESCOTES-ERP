// 발주 상품 담기 — 옆에서 열리는 창.
//
// MD는 품번을 외우지 않는다. 물건 사진을 보고 고르고, 컬러별로 수량을 친다.
// 드롭다운 하나로는 500개를 못 고른다. 그래서 사진 격자 + 검색 + 필터다.
//
// 공장·경로는 대부분 한 발주 안에서 같다. 위에서 한 번만 정하고 담은 것 전부에 건다.
import { useMemo, useState } from 'react';
import { store, normalizeColors, type Item } from '@/lib/store';
import { calcPostSummary } from '@/lib/costing';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ImageOff } from 'lucide-react';

const won = (n: number) => '₩' + Math.round(n).toLocaleString();

export interface PickedLine {
  styleNo: string;
  styleName: string;
  colorQtys: { color: string; qty: number }[];
  unitCostKrw: number;
}

/** 품목의 제조원가 — BOM이 있으면 계산값, 없으면 품목마스터의 기준원가 */
function unitCostOf(item: Item, boms: any[], usdKrw: number): number {
  const bom = boms.find(b => b.styleNo === item.styleNo);
  if (bom) {
    const ps = calcPostSummary(bom, usdKrw);
    if (ps.totalCostKrw > 0) return ps.totalCostKrw;
  }
  return item.baseCostKrw || 0;
}

export default function StylePickerSheet({
  open, onOpenChange, factories, onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  factories: { id: string; name: string }[];
  onAdd: (lines: PickedLine[], factoryId: string, route: 'oem' | 'direct') => void;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [season, setSeason] = useState('all');
  const [color, setColor] = useState('all');
  const [factoryId, setFactoryId] = useState('');
  const [route, setRoute] = useState<'oem' | 'direct'>('oem');
  /** styleNo → { 컬러명: 수량 } */
  const [qtys, setQtys] = useState<Record<string, Record<string, number>>>({});

  const items = useMemo(() => store.getItems(), [open]);
  const boms = useMemo(() => store.getBoms(), [open]);
  const usdKrw = useMemo(() => store.getSettings().usdKrw || 1380, [open]);

  const cats = useMemo(
    () => Array.from(new Set(items.map(i => i.erpCategory).filter(Boolean))).sort(),
    [items],
  );
  const seasons = useMemo(
    () => Array.from(new Set(items.map(i => i.season).filter(Boolean))).sort().reverse(),
    [items],
  );
  const colors = useMemo(() => {
    const s = new Set<string>();
    items.forEach(i => normalizeColors(i.colors || []).forEach(c => c.name && s.add(c.name)));
    return Array.from(s).sort();
  }, [items]);

  const shown = useMemo(() => {
    const s = q.trim().toUpperCase();
    return items
      .filter(i => cat === 'all' || i.erpCategory === cat)
      .filter(i => season === 'all' || i.season === season)
      .filter(i => color === 'all' || normalizeColors(i.colors || []).some(c => c.name === color))
      .filter(i => !s || `${i.styleNo} ${i.name || ''}`.toUpperCase().includes(s))
      .slice(0, 300);
  }, [items, q, cat, season, color]);

  // 담은 것 — 수량이 1개라도 들어간 품번
  const picked = useMemo(() => {
    const out: PickedLine[] = [];
    for (const [styleNo, byColor] of Object.entries(qtys)) {
      const cq = Object.entries(byColor)
        .filter(([, n]) => n > 0)
        .map(([c, n]) => ({ color: c, qty: n }));
      if (cq.length === 0) continue;
      const item = items.find(i => i.styleNo === styleNo);
      out.push({
        styleNo,
        styleName: item?.name || styleNo,
        colorQtys: cq,
        unitCostKrw: item ? unitCostOf(item, boms, usdKrw) : 0,
      });
    }
    return out;
  }, [qtys, items, boms, usdKrw]);

  const totalPcs = picked.reduce((s, l) => s + l.colorQtys.reduce((t, c) => t + c.qty, 0), 0);
  const totalKrw = picked.reduce(
    (s, l) => s + l.unitCostKrw * l.colorQtys.reduce((t, c) => t + c.qty, 0), 0,
  );

  const setQty = (styleNo: string, colorName: string, n: number) =>
    setQtys(prev => ({ ...prev, [styleNo]: { ...(prev[styleNo] || {}), [colorName]: Math.max(0, n) } }));

  const submit = () => {
    onAdd(picked, factoryId, route);
    setQtys({});
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl flex flex-col p-0 gap-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle>발주 상품 담기</SheetTitle>
          <div className="flex items-center gap-2 pt-2">
            <select value={factoryId} onChange={e => setFactoryId(e.target.value)}
              className="h-9 text-sm border border-border rounded-md bg-card px-2 min-w-[10rem]">
              <option value="">공장 미지정</option>
              {factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select value={route} onChange={e => setRoute(e.target.value as 'oem' | 'direct')}
              className="h-9 text-sm border border-border rounded-md bg-card px-2">
              <option value="oem">AMESCOTES 경유</option>
              <option value="direct">공장 직발주</option>
            </select>
            <span className="text-[11px] text-muted-foreground">담는 상품 전부에 적용됩니다</span>
          </div>
        </SheetHeader>

        {/* 찾기 */}
        <div className="px-5 py-3 border-b border-border space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)}
              placeholder="스타일번호 · 품명으로 검색" className="pl-9 h-9" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={cat} onChange={e => setCat(e.target.value)}
              className="h-8 text-xs border border-border rounded-md bg-card px-2">
              <option value="all">전체 카테고리</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={season} onChange={e => setSeason(e.target.value)}
              className="h-8 text-xs border border-border rounded-md bg-card px-2">
              <option value="all">전체 시즌</option>
              {seasons.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={color} onChange={e => setColor(e.target.value)}
              className="h-8 text-xs border border-border rounded-md bg-card px-2">
              <option value="all">전체 컬러</option>
              {colors.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-[11px] text-muted-foreground ml-auto">{shown.length}개</span>
          </div>
        </div>

        {/* 상품 격자 — 사진을 보고 고른다 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {shown.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-12">
              {q ? `"${q}" 에 걸리는 상품이 없습니다` : '조건에 맞는 상품이 없습니다'}
            </p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {shown.map(i => {
                const cs = normalizeColors(i.colors || []);
                const mine = qtys[i.styleNo] || {};
                const sum = Object.values(mine).reduce((s, n) => s + (n || 0), 0);
                const cost = unitCostOf(i, boms, usdKrw);
                return (
                  <div key={i.id}
                    className={`border rounded-lg overflow-hidden bg-card ${sum > 0 ? 'border-primary' : 'border-border'}`}>
                    <div className="aspect-square bg-[var(--fill-quaternary)] flex items-center justify-center overflow-hidden">
                      {i.imageUrl
                        ? <img src={i.imageUrl} alt={i.name} loading="lazy" className="w-full h-full object-cover" />
                        : <ImageOff className="w-6 h-6 text-muted-foreground" />}
                    </div>
                    <div className="px-2.5 pt-2 pb-1">
                      <p className="text-[11px] font-mono text-muted-foreground truncate">{i.styleNo}</p>
                      <p className="text-xs text-foreground truncate">{i.name || '—'}</p>
                      <p className="text-[11px] text-muted-foreground">
                        원가 {cost > 0 ? won(cost) : <span className="text-[var(--system-orange)]">미산출</span>}
                      </p>
                    </div>
                    <div className="px-2.5 pb-2.5 space-y-1">
                      {(cs.length ? cs : [{ name: '(단일)' }]).map(c => (
                        <div key={c.name} className="flex items-center gap-1.5">
                          <span className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate">{c.name}</span>
                          <Input
                            type="number" min={0} inputMode="numeric"
                            value={mine[c.name] || ''}
                            onChange={e => setQty(i.styleNo, c.name, Number(e.target.value) || 0)}
                            className="h-7 w-16 text-right text-xs"
                          />
                        </div>
                      ))}
                      {sum > 0 && (
                        <p className="text-[11px] text-right text-primary font-semibold pt-0.5">
                          {sum.toLocaleString()} PCS · {won(cost * sum)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 담은 결과 — 얼마짜리 발주인지 여기서 본다 */}
        <div className="border-t border-border px-5 py-3 flex items-center gap-4 bg-card">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {picked.length}개 품번 · {totalPcs.toLocaleString()} PCS
            </p>
            <p className="text-lg font-bold text-foreground tabular-nums">{won(totalKrw)}</p>
          </div>
          <Button className="ml-auto" disabled={picked.length === 0} onClick={submit}>
            발주에 담기
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
