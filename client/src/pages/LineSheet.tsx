/**
 * LUMEN Line Sheet — 해외 홀세일 라인시트 (LUMEN 워크스페이스 전용)
 */
import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'wouter';
import { fetchItems, fetchBoms } from '@/lib/supabaseQueries';
import { formatKRW, normalizeColors, type Item } from '@/lib/store';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { DEFAULT_GLOBAL_MARKUP } from '@/lib/salesPricing';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileSpreadsheet } from 'lucide-react';

type RoundMode = 'd0' | 'd1' | 'd2' | 'u10' | 'u100' | 'u1000';

const MARKETS: Record<string, { name: string; currency: string; symbol: string; fx: number; roundDefault: RoundMode }> = {
  ID: { name: 'Indonesia', currency: 'IDR', symbol: 'Rp', fx: 16.65, roundDefault: 'u1000' },
  JP: { name: 'Japan', currency: 'JPY', symbol: '¥', fx: 0.111, roundDefault: 'u10' },
  SG: { name: 'Singapore', currency: 'SGD', symbol: 'S$', fx: 0.00098, roundDefault: 'd2' },
  EU: { name: 'EU', currency: 'EUR', symbol: '€', fx: 0.00066, roundDefault: 'd2' },
  US: { name: 'USA', currency: 'USD', symbol: '$', fx: 0.00072, roundDefault: 'd2' },
};

const ROUND_LABELS: { value: RoundMode; label: string }[] = [
  { value: 'd0', label: '정수 (0자리)' },
  { value: 'd1', label: '소수 1자리' },
  { value: 'd2', label: '소수 2자리' },
  { value: 'u10', label: '10 단위' },
  { value: 'u100', label: '100 단위' },
  { value: 'u1000', label: '1,000 단위' },
];

type CatalogItem = {
  id: string;
  styleNo: string;
  name: string;
  nameEn: string;
  season: string;
  erpCategory: string;
  imageUrl: string;
  colors: { name: string }[];
  kmsrp: number;
  global: number;
};

type SheetRow = {
  key: string;
  season: string;
  img: string;
  sku: string;
  model: string;
  colour: string;
  coo: string;
  kmsrp: number;
  global: number;
};

function roundMoney(n: number, mode: RoundMode): number {
  if (!Number.isFinite(n)) return 0;
  switch (mode) {
    case 'd1': return Math.round(n * 10) / 10;
    case 'd2': return Math.round(n * 100) / 100;
    case 'u10': return Math.round(n / 10) * 10;
    case 'u100': return Math.round(n / 100) * 100;
    case 'u1000': return Math.round(n / 1000) * 1000;
    default: return Math.round(n);
  }
}

function displayDecimals(mode: RoundMode): number {
  if (mode === 'd1') return 1;
  if (mode === 'd2') return 2;
  return 0;
}

function fmtLocal(n: number, symbol: string, mode: RoundMode): string {
  const dec = displayDecimals(mode);
  const v = roundMoney(n, mode);
  return symbol + v.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function parseBomPnl(bom: any): any {
  if (!bom) return {};
  if (bom.pnl && typeof bom.pnl === 'object') return bom.pnl;
  if (typeof bom.pnl === 'string') {
    try { return JSON.parse(bom.pnl); } catch { /* */ }
  }
  if (bom.pnl_data) {
    try {
      return typeof bom.pnl_data === 'string' ? JSON.parse(bom.pnl_data) : bom.pnl_data;
    } catch { /* */ }
  }
  return {};
}

function buildCatalog(items: Item[], boms: any[]): CatalogItem[] {
  const bomMap = new Map<string, any>();
  for (const b of boms) {
    if (b.styleId) bomMap.set(b.styleId, b);
    if (b.styleNo) bomMap.set(b.styleNo, b);
  }

  return items
    .filter(i => i.erpCategory !== 'PACK')
    .filter(i => ['HB', 'ACC', 'SHOES'].includes(i.erpCategory || 'HB') || !i.erpCategory)
    .map(i => {
      const bom = bomMap.get(i.id) || bomMap.get(i.styleNo);
      const pnl = parseBomPnl(bom);
      const kmsrp = Number(pnl.confirmedSalePrice || (i as any).confirmedSalePrice || i.deliveryPrice || 0) || 0;
      const globalFromPnl = Number(pnl.globalSalePrice || 0);
      const markup = Number(pnl.globalMarkup || DEFAULT_GLOBAL_MARKUP);
      const global = globalFromPnl > 0 ? globalFromPnl : (kmsrp > 0 ? Math.round(kmsrp * markup) : 0);
      const colors = normalizeColors(i.colors || []).map(c => ({ name: c.name }));
      return {
        id: i.id,
        styleNo: i.styleNo || '',
        name: i.name || '',
        nameEn: i.nameEn || '',
        season: i.season || '',
        erpCategory: i.erpCategory || 'HB',
        imageUrl: i.imageUrl || '',
        colors: colors.length > 0 ? colors : [{ name: '-' }],
        kmsrp,
        global,
      };
    })
    .sort((a, b) => a.styleNo.localeCompare(b.styleNo));
}

function ChipBtn({
  children, onClick, primary,
}: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
        primary
          ? 'bg-stone-800 text-stone-50 border-stone-800 hover:bg-stone-700'
          : 'bg-white text-stone-600 border-stone-200 hover:border-amber-400 hover:text-amber-800'
      }`}
    >
      {children}
    </button>
  );
}

export default function LineSheet() {
  const { workspace } = useWorkspace();
  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: fetchItems });
  const { data: boms = [] } = useQuery({ queryKey: ['boms'], queryFn: fetchBoms });

  const catalog = useMemo(() => buildCatalog(items as Item[], boms as any[]), [items, boms]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [filterSeason, setFilterSeason] = useState('all');
  const [filterCat, setFilterCat] = useState('all');
  const [marketCode, setMarketCode] = useState('ID');
  const [fx, setFx] = useState(MARKETS.ID.fx);
  const [discountPct, setDiscountPct] = useState(50);
  const [roundMode, setRoundMode] = useState<RoundMode>(MARKETS.ID.roundDefault);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [seasonInit, setSeasonInit] = useState(false);

  const seasons = useMemo(
    () => [...new Set(catalog.map(i => i.season).filter(Boolean))].sort(),
    [catalog],
  );

  useEffect(() => {
    if (seasonInit || seasons.length === 0) return;
    if (seasons.includes('27SS')) setFilterSeason('27SS');
    setSeasonInit(true);
  }, [seasons, seasonInit]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter(i => {
      if (filterSeason !== 'all' && i.season !== filterSeason) return false;
      if (filterCat !== 'all' && i.erpCategory !== filterCat) return false;
      if (!q) return true;
      return (
        i.styleNo.toLowerCase().includes(q)
        || i.name.toLowerCase().includes(q)
        || i.nameEn.toLowerCase().includes(q)
      );
    });
  }, [catalog, search, filterSeason, filterCat]);

  const sheetRows = useMemo(() => {
    const rows: SheetRow[] = [];
    catalog.filter(i => selected.has(i.id)).forEach(item => {
      item.colors.forEach((c, idx) => {
        rows.push({
          key: `${item.id}::${c.name || idx}`,
          season: item.season,
          img: item.imageUrl,
          sku: item.styleNo + (item.colors.length > 1 && c.name !== '-'
            ? `-${String(c.name).slice(0, 3).toUpperCase()}`
            : ''),
          model: item.nameEn || item.name,
          colour: c.name || '-',
          coo: 'China',
          kmsrp: item.kmsrp,
          global: item.global || (item.kmsrp ? Math.round(item.kmsrp * DEFAULT_GLOBAL_MARKUP) : 0),
        });
      });
    });
    return rows;
  }, [catalog, selected]);

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectIds = useCallback((ids: string[], mode: 'add' | 'set' | 'invert') => {
    setSelected(prev => {
      if (mode === 'set') return new Set(ids);
      const next = new Set(prev);
      if (mode === 'add') {
        ids.forEach(id => next.add(id));
        return next;
      }
      ids.forEach(id => {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, []);

  const applyMarket = (code: string) => {
    const m = MARKETS[code];
    setMarketCode(code);
    setFx(m.fx);
    setRoundMode(m.roundDefault);
  };

  if (workspace !== 'LUMEN') {
    return <Redirect to="/items" />;
  }

  const market = MARKETS[marketCode];
  const rate = fx > 0 ? fx : market.fx;
  const disc = Math.min(90, Math.max(0, discountPct)) / 100;

  let totalPcs = 0;
  let totalLocal = 0;
  let totalKrw = 0;
  for (const row of sheetRows) {
    const q = qtys[row.key] || 0;
    const wsLocal = roundMoney(row.global * rate * (1 - disc), roundMode);
    const wsKrw = roundMoney(row.global * (1 - disc), 'd0');
    totalPcs += q;
    totalLocal += wsLocal * q;
    totalKrw += wsKrw * q;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <div className="flex items-center gap-2 text-stone-800">
            <FileSpreadsheet size={20} className="text-amber-700" />
            <h1 className="text-xl font-bold tracking-tight">라인시트</h1>
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800">LUMEN</span>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Wholesale Line Sheet · 품목 마스터 기반 · 국가별 현지통화
          </p>
        </div>
        <div className="text-right text-xs text-stone-500">
          <div><span className="font-semibold text-stone-700">{market.name}</span> · 1 KRW = <b>{rate}</b> {market.currency}</div>
          <div>R-{Math.round(disc * 100)}% · {ROUND_LABELS.find(r => r.value === roundMode)?.label}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
        {/* 품목 지정 */}
        <aside className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100 bg-stone-50">
            <h2 className="text-sm font-semibold text-stone-700">품목 지정</h2>
            <p className="text-[11px] text-stone-400 mt-0.5 leading-relaxed">
              필터 후 일괄 선택 · 시즌/카테고리 일괄 · KMSRP·이미지 있는 것만 · 개별 체크
            </p>
          </div>
          <div className="p-3 space-y-2">
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="스타일·품명 검색"
              className="h-8 text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <Select value={filterSeason} onValueChange={setFilterSeason}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="시즌" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">시즌 전체</SelectItem>
                  {seasons.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterCat} onValueChange={setFilterCat}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="카테고리" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">카테고리 전체</SelectItem>
                  <SelectItem value="HB">HB</SelectItem>
                  <SelectItem value="ACC">ACC</SelectItem>
                  <SelectItem value="SHOES">SHOES</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <ChipBtn primary onClick={() => selectIds(filtered.map(i => i.id), 'add')}>필터 전체 선택</ChipBtn>
              <ChipBtn onClick={() => setSelected(new Set())}>선택 해제</ChipBtn>
              <ChipBtn onClick={() => selectIds(filtered.map(i => i.id), 'invert')}>선택 반전</ChipBtn>
              <ChipBtn onClick={() => {
                if (filterSeason === 'all') { alert('시즌을 먼저 선택하세요'); return; }
                selectIds(catalog.filter(i => i.season === filterSeason).map(i => i.id), 'add');
              }}>시즌 일괄</ChipBtn>
              <ChipBtn onClick={() => {
                if (filterCat === 'all') { alert('카테고리를 먼저 선택하세요'); return; }
                selectIds(catalog.filter(i => i.erpCategory === filterCat).map(i => i.id), 'add');
              }}>카테고리 일괄</ChipBtn>
              <ChipBtn onClick={() => selectIds(filtered.filter(i => i.kmsrp > 0).map(i => i.id), 'add')}>KMSRP 있는 것만</ChipBtn>
              <ChipBtn onClick={() => selectIds(filtered.filter(i => !!i.imageUrl).map(i => i.id), 'add')}>이미지 있는 것만</ChipBtn>
            </div>

            <div className="max-h-[420px] overflow-y-auto border border-stone-200 rounded-lg">
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-xs text-stone-400">조건에 맞는 품목 없음</div>
              ) : filtered.map(i => (
                <label
                  key={i.id}
                  className="flex items-center gap-2 px-2 py-1.5 border-b border-stone-100 hover:bg-stone-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(i.id)}
                    onChange={() => toggle(i.id)}
                    className="accent-amber-700"
                  />
                  {i.imageUrl ? (
                    <img src={i.imageUrl} alt="" className="w-9 h-9 rounded object-cover border border-stone-200" />
                  ) : (
                    <div className="w-9 h-9 rounded bg-stone-100 border border-stone-200" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-stone-800 truncate">{i.nameEn || i.name}</div>
                    <div className="text-[10px] text-stone-400 truncate">
                      {i.styleNo} · {i.season || '-'} · {i.erpCategory} · {i.colors.length}c
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-stone-600 whitespace-nowrap">
                    {i.kmsrp > 0 ? formatKRW(i.kmsrp) : '—'}
                  </div>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-stone-500">
              선택 <strong className="text-stone-800">{selected.size}</strong> 품목
              · 라인 행 <strong className="text-stone-800">{sheetRows.length}</strong>
              · 마스터 {catalog.length}건
            </p>
          </div>
        </aside>

        {/* 시트 */}
        <section className="space-y-3">
          <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-[10px] uppercase tracking-wide text-stone-400 block mb-1">Market</label>
                <Select value={marketCode} onValueChange={applyMarket}>
                  <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MARKETS).map(([code, m]) => (
                      <SelectItem key={code} value={code}>{m.name} ({m.currency})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-stone-400 block mb-1">환율 (1 KRW→Local)</label>
                <Input
                  type="number"
                  step="any"
                  value={fx}
                  onChange={e => setFx(Number(e.target.value) || 0)}
                  className="h-8 text-xs w-28"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-stone-400 block mb-1">Discount %</label>
                <Input
                  type="number"
                  min={0}
                  max={90}
                  value={discountPct}
                  onChange={e => setDiscountPct(Number(e.target.value) || 0)}
                  className="h-8 text-xs w-20"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-stone-400 block mb-1">반올림</label>
                <Select value={roundMode} onValueChange={v => setRoundMode(v as RoundMode)}>
                  <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROUND_LABELS.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="ml-auto grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-stone-500">
                <span>Total pcs</span>
                <strong className="text-stone-800 text-right tabular-nums">{totalPcs} pcs</strong>
                <span>Total (Local)</span>
                <strong className="text-stone-800 text-right tabular-nums">
                  {totalPcs ? fmtLocal(totalLocal, market.symbol, roundMode) : '—'}
                </strong>
                <span>Total (KRW)</span>
                <strong className="text-stone-800 text-right tabular-nums">
                  {totalPcs ? formatKRW(totalKrw) : '—'}
                </strong>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-800 text-white text-sm font-semibold">
              Line Sheet
            </div>
            <div className="overflow-auto max-h-[70vh]">
              {sheetRows.length === 0 ? (
                <div className="p-12 text-center text-sm text-stone-400">왼쪽에서 품목을 선택하세요.</div>
              ) : (
                <table className="w-full text-xs min-w-[1080px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-stone-800 text-stone-100">
                      <th className="px-2 py-2.5 text-left font-medium">Season</th>
                      <th className="px-2 py-2.5 text-left font-medium">Photo</th>
                      <th className="px-2 py-2.5 text-left font-medium">SKU</th>
                      <th className="px-2 py-2.5 text-left font-medium">Model</th>
                      <th className="px-2 py-2.5 text-left font-medium">Colour</th>
                      <th className="px-2 py-2.5 text-left font-medium">COO</th>
                      <th className="px-2 py-2.5 text-right font-medium">KMSRP<br />KRW</th>
                      <th className="px-2 py-2.5 text-right font-medium">Global<br />KRW</th>
                      <th className="px-2 py-2.5 text-right font-medium">MSRP<br />{market.currency}</th>
                      <th className="px-2 py-2.5 text-right font-medium bg-stone-700">Wholesale<br />{market.currency}</th>
                      <th className="px-2 py-2.5 text-right font-medium bg-stone-700">Submit Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetRows.map(row => {
                      const localMsrp = roundMoney(row.global * rate, roundMode);
                      const wsLocal = roundMoney(row.global * rate * (1 - disc), roundMode);
                      const q = qtys[row.key] || 0;
                      return (
                        <tr key={row.key} className="border-b border-stone-100 hover:bg-stone-50">
                          <td className="px-2 py-2">{row.season || '—'}</td>
                          <td className="px-2 py-2">
                            {row.img ? (
                              <img src={row.img} alt="" className="w-11 h-11 rounded object-cover border border-stone-200" />
                            ) : (
                              <div className="w-11 h-11 rounded bg-stone-100 border border-stone-200" />
                            )}
                          </td>
                          <td className="px-2 py-2 font-mono text-[11px]">{row.sku}</td>
                          <td className="px-2 py-2 font-medium">{row.model}</td>
                          <td className="px-2 py-2 text-stone-500">{row.colour}</td>
                          <td className="px-2 py-2">{row.coo}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{row.kmsrp ? formatKRW(row.kmsrp) : '—'}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{row.global ? formatKRW(row.global) : '—'}</td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {row.global ? fmtLocal(localMsrp, market.symbol, roundMode) : '—'}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold text-amber-900">
                            {row.global ? fmtLocal(wsLocal, market.symbol, roundMode) : '—'}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <Input
                              type="number"
                              min={0}
                              value={q || ''}
                              placeholder="0"
                              onChange={e => setQtys(prev => ({
                                ...prev,
                                [row.key]: Math.max(0, Number(e.target.value) || 0),
                              }))}
                              className="h-7 w-16 text-xs text-right ml-auto"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-4 py-2 border-t border-stone-100 text-[10px] text-stone-400">
              Wholesale = round(Global MSRP(KRW) × FX × (1 − Discount)). KMSRP/Global은 BOM·품목 마스터 연동.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
