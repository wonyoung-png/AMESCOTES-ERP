// AMESCOTES ERP — 매출집계
// 품목 마스터의 「누적생산량」 탭을 별도 페이지로 이관 (2026-08-06)
import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { store, type Item, type ProductionOrder } from '@/lib/store';
import { fetchItems, fetchVendors, fetchOrders } from '@/lib/supabaseQueries';
import { isLegacyPackConsumable } from '@/lib/seedLumenPacking';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Factory, ChevronDown, ChevronRight, X } from 'lucide-react';

type ItemOrderRound = {
  orderId: string;
  orderNo: string;
  revision: number;
  qty: number;
  orderDate: string;
  status: string;
  colorQtys: { color: string; qty: number }[];
};

type ItemOrderStat = {
  orderCount: number;
  maxRevision: number;
  cumQty: number;
  lastOrderDate: string | null;
  byColor: Record<string, number>;
  rounds: ItemOrderRound[];
};

const EMPTY_ORDER_STAT: ItemOrderStat = {
  orderCount: 0, maxRevision: 0, cumQty: 0, lastOrderDate: null, byColor: {}, rounds: [],
};

const ERP_CATEGORIES = ['HB', 'ACC', 'SHOES', 'PACK'] as const;

export default function SalesSummary() {
  const { data: itemsRaw = [] } = useQuery({ queryKey: ['items'], queryFn: fetchItems });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });

  // 레거시 LPKG 소모품 품목은 숨김 (품목 마스터와 동일 규칙)
  const items = useMemo(
    () => (itemsRaw as Item[]).filter(i => !isLegacyPackConsumable(i) && !(i.styleNo || '').startsWith('LPKG-')),
    [itemsRaw],
  );

  const [search, setSearch] = useState('');
  const [filterSeason, setFilterSeason] = useState('전체');
  const [filterErpCategory, setFilterErpCategory] = useState('전체');
  const [filterBuyer, setFilterBuyer] = useState('전체');
  const [orderedOnly, setOrderedOnly] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const buyerVendors = useMemo(() => (vendors as any[]).filter(v => v.type === '바이어'), [vendors]);
  const vendorMap = useMemo(() => {
    const m = new Map<string, any>();
    (vendors as any[]).forEach(v => m.set(v.id, v));
    return m;
  }, [vendors]);

  const seasons = useMemo(() => {
    const s = new Set<string>();
    items.forEach(i => { if (i.season) s.add(i.season); });
    return [...s].sort().reverse();
  }, [items]);

  // 발주 통계 (styleId + styleNo 매칭) — 품목 마스터와 동일 로직
  const mergedOrders = useMemo(() => {
    const map = new Map<string, ProductionOrder>();
    [...(orders as ProductionOrder[]), ...store.getOrders()].forEach(o => map.set(o.id, o as ProductionOrder));
    return [...map.values()];
  }, [orders]);

  const itemOrderStats = useMemo(() => {
    const byKey = new Map<string, ProductionOrder[]>();
    const push = (key: string, o: ProductionOrder) => {
      if (!key) return;
      const list = byKey.get(key) || [];
      list.push(o);
      byKey.set(key, list);
    };
    mergedOrders.forEach(o => {
      push(o.styleId || '', o);
      push(o.styleNo || '', o);
    });

    const result = new Map<string, ItemOrderStat>();
    items.forEach(item => {
      const seen = new Set<string>();
      const list: ProductionOrder[] = [];
      for (const key of [item.id, item.styleNo]) {
        for (const o of byKey.get(key) || []) {
          if (seen.has(o.id)) continue;
          seen.add(o.id);
          list.push(o);
        }
      }
      if (list.length === 0) {
        result.set(item.id, EMPTY_ORDER_STAT);
        return;
      }
      const byColor: Record<string, number> = {};
      let cumQty = 0;
      let maxRevision = 0;
      let lastOrderDate: string | null = null;
      const rounds: ItemOrderRound[] = list
        .map(o => {
          const qty = o.qty || 0;
          cumQty += qty;
          maxRevision = Math.max(maxRevision, o.revision || 1);
          const d = (o.orderDate || o.createdAt || '').slice(0, 10);
          if (d && (!lastOrderDate || d > lastOrderDate)) lastOrderDate = d;
          const cqs = (o.colorQtys || []).length
            ? o.colorQtys!
            : [{ color: '(미지정)', qty }];
          cqs.forEach(cq => {
            const c = (cq.color || '').trim() || '(미지정)';
            byColor[c] = (byColor[c] || 0) + (cq.qty || 0);
          });
          return {
            orderId: o.id,
            orderNo: o.orderNo,
            revision: o.revision || 1,
            qty,
            orderDate: d,
            status: o.status || '',
            colorQtys: cqs.map(cq => ({ color: cq.color || '(미지정)', qty: cq.qty || 0 })),
          };
        })
        .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.revision - b.revision);
      result.set(item.id, { orderCount: list.length, maxRevision, cumQty, lastOrderDate, byColor, rounds });
    });
    return result;
  }, [items, mergedOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(item => {
      const buyerName = vendorMap.get(item.buyerId || '')?.name || '';
      const matchSearch = !q
        || item.styleNo.toLowerCase().includes(q)
        || item.name.toLowerCase().includes(q)
        || (item.nameEn || '').toLowerCase().includes(q)
        || buyerName.toLowerCase().includes(q);
      const matchSeason = filterSeason === '전체' || item.season === filterSeason || item.erpCategory === 'PACK';
      const matchErpCat = filterErpCategory === '전체' || item.erpCategory === filterErpCategory;
      const matchBuyer = filterBuyer === '전체' || item.buyerId === filterBuyer;
      return matchSearch && matchSeason && matchErpCat && matchBuyer;
    });
  }, [items, search, filterSeason, filterErpCategory, filterBuyer, vendorMap]);

  const summary = useMemo(() => {
    let styles = 0, ordersN = 0, qty = 0;
    filtered.forEach(item => {
      const s = itemOrderStats.get(item.id) || EMPTY_ORDER_STAT;
      if (s.orderCount > 0) { styles += 1; ordersN += s.orderCount; qty += s.cumQty; }
    });
    return { styles, ordersN, qty };
  }, [filtered, itemOrderStats]);

  /** 발주 있는 품목 우선 정렬 */
  const displayItems = useMemo(() => {
    const base = orderedOnly
      ? filtered.filter(i => (itemOrderStats.get(i.id)?.orderCount || 0) > 0)
      : filtered;
    return [...base].sort((a, b) => {
      const sa = itemOrderStats.get(a.id) || EMPTY_ORDER_STAT;
      const sb = itemOrderStats.get(b.id) || EMPTY_ORDER_STAT;
      if (sb.orderCount !== sa.orderCount) return sb.orderCount - sa.orderCount;
      if (sb.cumQty !== sa.cumQty) return sb.cumQty - sa.cumQty;
      return (a.styleNo || '').localeCompare(b.styleNo || '');
    });
  }, [filtered, itemOrderStats, orderedOnly]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetFilters = () => {
    setSearch('');
    setFilterSeason('전체');
    setFilterErpCategory('전체');
    setFilterBuyer('전체');
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">매출집계</h1>
        <p className="text-sm text-muted-foreground mt-1">스타일별 누적생산량 · 발주차수 · 컬러별 생산수량</p>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-border">
          <CardContent className="p-4">
            <p className="text-2xl font-bold tabular-nums text-foreground">{summary.styles.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">발주 스타일 (종)</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <p className="text-2xl font-bold tabular-nums text-foreground">{summary.ordersN.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">누적 발주 (회)</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <p className="text-2xl font-bold tabular-nums text-primary">{summary.qty.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">누적 생산량 (pcs)</p>
          </CardContent>
        </Card>
      </div>

      {/* 필터 */}
      <Card className="border-border">
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="스타일번호 · 품명 · 바이어 검색"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
            <Select value={filterSeason} onValueChange={setFilterSeason}>
              <SelectTrigger className="w-[130px] h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체 시즌</SelectItem>
                {seasons.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterErpCategory} onValueChange={setFilterErpCategory}>
              <SelectTrigger className="w-[140px] h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체 카테고리</SelectItem>
                {ERP_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterBuyer} onValueChange={setFilterBuyer}>
              <SelectTrigger className="w-[150px] h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체 바이어</SelectItem>
                {buyerVendors.map(v => <SelectItem key={v.id} value={v.id}>{v.code || v.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="accent-primary"
                checked={orderedOnly}
                onChange={e => setOrderedOnly(e.target.checked)}
              />
              발주 있는 품목만
            </label>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-[var(--fill-quaternary)]"
            >
              <X size={13} />필터 초기화
            </button>
          </div>
        </CardContent>
      </Card>

      {/* 스타일별 누적생산량 */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-[var(--fill-quaternary)] flex flex-wrap items-center gap-2">
          <Factory size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">스타일별 누적생산량</span>
          <span className="text-xs text-muted-foreground">발주차수 = 누적 발주 횟수 (5번 발주면 5차) · 컬러별 수량 · 행 클릭 시 발주 상세</span>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm min-w-[880px]">
            <thead>
              <tr className="border-b border-border bg-card text-xs text-muted-foreground">
                <th className="w-8" />
                <th>스타일번호</th>
                <th>품명</th>
                <th>시즌</th>
                <th>바이어</th>
                <th className="ctr whitespace-nowrap">발주차수</th>
                <th className="num whitespace-nowrap">누적생산량</th>
                <th className="min-w-[280px]">컬러별 생산수량</th>
                <th className="ctr">최종발주</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map(item => {
                const st = itemOrderStats.get(item.id) || EMPTY_ORDER_STAT;
                const open = expanded.has(item.id);
                const colorEntries = Object.entries(st.byColor).sort((a, b) => b[1] - a[1]);
                const totalForBar = st.cumQty || colorEntries.reduce((s, [, q]) => s + q, 0) || 1;
                return (
                  <Fragment key={item.id}>
                    <tr
                      className={`border-t border-border hover:bg-[var(--fill-quaternary)] cursor-pointer align-top ${st.orderCount === 0 ? 'opacity-50' : ''}`}
                      onClick={() => st.orderCount > 0 && toggleExpand(item.id)}
                    >
                      <td className="text-muted-foreground">
                        {st.orderCount > 0 ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                      </td>
                      <td className="font-mono text-xs text-primary whitespace-nowrap">{item.styleNo}</td>
                      <td>
                        <p className="font-medium text-foreground truncate max-w-[200px]" title={item.name}>{item.name}</p>
                        {item.nameEn && <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{item.nameEn}</p>}
                      </td>
                      <td className="text-xs text-muted-foreground">{item.season || '—'}</td>
                      <td className="text-xs">
                        {item.buyerId
                          ? (vendorMap.get(item.buyerId)?.code || vendorMap.get(item.buyerId)?.name || '—')
                          : '—'}
                      </td>
                      <td className="ctr">
                        {st.orderCount > 0 ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20 text-base font-bold tabular-nums text-primary">
                            {st.orderCount}차
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">미발주</span>
                        )}
                      </td>
                      <td className="num">
                        {st.cumQty > 0 ? (
                          <div className="inline-flex flex-col items-end">
                            <span className="text-base font-bold tabular-nums text-foreground leading-none">{st.cumQty.toLocaleString()}</span>
                            <span className="text-[11px] text-muted-foreground mt-0.5">pcs</span>
                          </div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td>
                        {colorEntries.length > 0 ? (
                          <div className="space-y-1.5 min-w-[260px]">
                            {colorEntries.map(([c, q]) => {
                              const pct = Math.round((q / totalForBar) * 100);
                              return (
                                <div key={c} className="grid grid-cols-[minmax(72px,1fr)_64px_minmax(80px,1.2fr)] gap-2 items-center">
                                  <span className="text-xs font-medium text-foreground truncate" title={c}>{c}</span>
                                  <span className="text-xs font-mono font-semibold text-foreground text-right tabular-nums">{q.toLocaleString()}</span>
                                  <div className="flex items-center gap-1.5">
                                    <div className="flex-1 h-2 rounded-full bg-[var(--fill-tertiary)] overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-primary/80"
                                        style={{ width: `${Math.max(pct, q > 0 ? 4 : 0)}%` }}
                                      />
                                    </div>
                                    <span className="text-[11px] text-muted-foreground w-7 text-right tabular-nums">{pct}%</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="ctr text-xs text-muted-foreground whitespace-nowrap">
                        {st.lastOrderDate || '—'}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-[var(--fill-quaternary)] border-t border-border">
                        <td colSpan={9} className="px-4 py-3">
                          <p className="text-[11px] font-semibold text-muted-foreground mb-2">발주 상세 (누적 {st.orderCount}차)</p>
                          <div className="rounded-md border border-border overflow-hidden bg-card">
                            <table className="data-table w-full text-xs">
                              <thead>
                                <tr className="bg-[var(--fill-quaternary)] text-muted-foreground">
                                  <th>차수</th>
                                  <th>발주번호</th>
                                  <th>발주일</th>
                                  <th>상태</th>
                                  <th className="num">수량</th>
                                  <th>컬러별</th>
                                </tr>
                              </thead>
                              <tbody>
                                {st.rounds.map((r, idx) => (
                                  <tr key={`${item.id}-${r.orderId}`} className="border-t border-border">
                                    <td className="font-semibold text-foreground">{idx + 1}차</td>
                                    <td className="font-mono text-primary">{r.orderNo}</td>
                                    <td className="text-muted-foreground">{r.orderDate || '—'}</td>
                                    <td className="text-muted-foreground">{r.status || '—'}</td>
                                    <td className="num font-mono font-semibold">{r.qty.toLocaleString()}</td>
                                    <td>
                                      <div className="flex flex-wrap gap-1.5">
                                        {(r.colorQtys || []).map(cq => (
                                          <span
                                            key={`${r.orderId}-${cq.color}`}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-[var(--fill-quaternary)]"
                                          >
                                            <span className="text-muted-foreground">{cq.color}</span>
                                            <span className="font-mono font-semibold text-foreground">{cq.qty.toLocaleString()}</span>
                                          </span>
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {displayItems.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-muted-foreground">
                    {orderedOnly ? '발주 이력이 있는 품목이 없습니다 · 「발주 있는 품목만」 해제해 보세요' : '필터에 해당하는 품목이 없습니다'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
