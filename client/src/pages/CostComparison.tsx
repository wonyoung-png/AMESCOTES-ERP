/**
 * 사전/사후 원가 비교 대시보드
 * Design: Maison Atelier — 에보니 사이드바, 골드 악센트, 아이보리 배경
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBoms, fetchItems } from '@/lib/supabaseQueries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Download, Search, TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ─── 타입 ─────────────────────────────────────────────────────────────────
interface CostRow {
  styleNo: string;
  styleName: string;
  season: string;
  erpCategory: string;
  preCost: number | null;
  postCost: number | null;
  diff: number | null;        // (postCost - preCost) / preCost * 100
  diffAmt: number | null;     // postCost - preCost
  isSimple: boolean;
  hasDetailedBom: boolean;
  bomId: string;
}

// ─── 포맷 헬퍼 ────────────────────────────────────────────────────────────
const fmtKrw = (n: number) => '₩' + Math.round(n).toLocaleString('ko-KR');

function DiffBadge({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="text-stone-300 text-xs">-</span>;
  const isPositive = diff > 0;
  const cls = isPositive
    ? 'bg-red-50 text-red-600 border-red-200'
    : diff < 0
    ? 'bg-green-50 text-green-700 border-green-200'
    : 'bg-stone-50 text-stone-500 border-stone-200';
  const Icon = isPositive ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${cls}`}>
      <Icon className="w-3 h-3" />
      {isPositive ? '+' : ''}{diff.toFixed(1)}%
    </span>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────
export default function CostComparison() {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'simple' | 'both' | 'nopre' | 'nopost'>('all');
  const [sortBy, setSortBy] = useState<'styleNo' | 'diff' | 'preCost' | 'postCost'>('styleNo');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data: rawBoms = [], isLoading: bomsLoading } = useQuery({
    queryKey: ['boms'],
    queryFn: fetchBoms,
  });
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['items'],
    queryFn: fetchItems,
  });

  const isLoading = bomsLoading || itemsLoading;

  // BOM 데이터를 CostRow로 변환
  const costRows = useMemo<CostRow[]>(() => {
    const itemMap = new Map(items.map((i: any) => [i.id, i]));

    return rawBoms.map((bom: any) => {
      const item = itemMap.get(bom.styleId) || itemMap.get(bom.styleNo);
      const isSimple = !!(bom as any).isSimpleCost;

      // 사전원가
      let preCost: number | null = null;
      if (isSimple && (bom as any).simpleCostKrw) {
        preCost = (bom as any).simpleCostKrw;
      } else if (item?.baseCostKrw && item.baseCostKrw > 0) {
        preCost = item.baseCostKrw;
      }

      // 사후원가
      let postCost: number | null = null;
      if (isSimple && (bom as any).simplePostCostKrw) {
        postCost = (bom as any).simplePostCostKrw;
      } else if (bom.postTotalCostKrw && bom.postTotalCostKrw > 0) {
        postCost = bom.postTotalCostKrw;
      }

      // 차이
      let diff: number | null = null;
      let diffAmt: number | null = null;
      if (preCost !== null && postCost !== null && preCost > 0) {
        diff = ((postCost - preCost) / preCost) * 100;
        diffAmt = postCost - preCost;
      }

      const hasDetailedBom = !isSimple && (
        ((bom.colorBoms || []).length > 0) ||
        ((bom.lines || []).some((l: any) => l.itemName))
      );

      return {
        styleNo: bom.styleNo || '',
        styleName: bom.styleName || item?.name || '',
        season: bom.season || item?.season || '',
        erpCategory: bom.erpCategory || item?.erpCategory || '',
        preCost,
        postCost,
        diff,
        diffAmt,
        isSimple,
        hasDetailedBom,
        bomId: bom.id,
      } as CostRow;
    });
  }, [rawBoms, items]);

  // 검색 & 필터 & 정렬
  const filtered = useMemo(() => {
    let rows = costRows;

    // 검색
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.styleNo.toLowerCase().includes(q) ||
        r.styleName.toLowerCase().includes(q) ||
        r.season.toLowerCase().includes(q)
      );
    }

    // 모드 필터
    if (filterMode === 'simple') rows = rows.filter(r => r.isSimple);
    if (filterMode === 'both') rows = rows.filter(r => r.preCost !== null && r.postCost !== null);
    if (filterMode === 'nopre') rows = rows.filter(r => r.preCost === null);
    if (filterMode === 'nopost') rows = rows.filter(r => r.preCost !== null && r.postCost === null);

    // 정렬
    rows = [...rows].sort((a, b) => {
      let va: any, vb: any;
      if (sortBy === 'styleNo') { va = a.styleNo; vb = b.styleNo; }
      else if (sortBy === 'preCost') { va = a.preCost ?? -1; vb = b.preCost ?? -1; }
      else if (sortBy === 'postCost') { va = a.postCost ?? -1; vb = b.postCost ?? -1; }
      else { va = a.diff ?? -999; vb = b.diff ?? -999; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return rows;
  }, [costRows, search, filterMode, sortBy, sortDir]);

  // 통계
  const stats = useMemo(() => {
    const withBoth = costRows.filter(r => r.preCost !== null && r.postCost !== null);
    const avgDiff = withBoth.length > 0
      ? withBoth.reduce((s, r) => s + (r.diff ?? 0), 0) / withBoth.length
      : null;
    const overBudget = withBoth.filter(r => (r.diff ?? 0) > 0).length;
    const underBudget = withBoth.filter(r => (r.diff ?? 0) < 0).length;
    return {
      total: costRows.length,
      withPre: costRows.filter(r => r.preCost !== null).length,
      withPost: costRows.filter(r => r.postCost !== null).length,
      withBoth: withBoth.length,
      avgDiff,
      overBudget,
      underBudget,
    };
  }, [costRows]);

  // 정렬 토글 핸들러
  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };
  const SortIndicator = ({ col }: { col: typeof sortBy }) =>
    sortBy === col ? <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span> : null;

  // 엑셀 다운로드
  const handleExcelDownload = async () => {
    try {
      const XLSX = await import('xlsx');
      const wsData = [
        ['스타일번호', '품목명', '시즌', '카테고리', '사전원가(KRW)', '사후원가(KRW)', '차이(KRW)', '차이(%)'],
        ...filtered.map(r => [
          r.styleNo,
          r.styleName,
          r.season,
          r.erpCategory,
          r.preCost ?? '',
          r.postCost ?? '',
          r.diffAmt ?? '',
          r.diff !== null ? parseFloat(r.diff.toFixed(2)) : '',
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      // 컬럼 너비
      ws['!cols'] = [
        { wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 14 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '원가비교');
      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `원가비교_${dateStr}.xlsx`);
      toast.success('엑셀 다운로드 완료');
    } catch (e) {
      toast.error('엑셀 다운로드 실패');
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800 tracking-tight">사전/사후 원가 비교</h1>
          <p className="text-sm text-stone-500 mt-0.5">등록된 BOM의 사전원가와 사후원가를 비교합니다</p>
        </div>
        <Button
          size="sm"
          onClick={handleExcelDownload}
          className="gap-1.5 text-xs bg-emerald-700 hover:bg-emerald-800 text-white"
        >
          <Download className="w-3.5 h-3.5" /> 엑셀 다운로드
        </Button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: '전체 BOM', value: stats.total, color: 'text-stone-700' },
          { label: '사전원가 입력', value: stats.withPre, color: 'text-emerald-700' },
          { label: '사후원가 입력', value: stats.withPost, color: 'text-blue-700' },
          { label: '양쪽 입력', value: stats.withBoth, color: 'text-amber-700' },
          { label: '사후원가↑ (초과)', value: stats.overBudget, color: 'text-red-600' },
          { label: '사후원가↓ (절감)', value: stats.underBudget, color: 'text-green-700' },
          {
            label: '평균 차이(%)',
            value: stats.avgDiff !== null ? `${stats.avgDiff > 0 ? '+' : ''}${stats.avgDiff.toFixed(1)}%` : '-',
            color: stats.avgDiff === null ? 'text-stone-400' : stats.avgDiff > 0 ? 'text-red-600' : 'text-green-700',
          },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm">
            <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
            <div className="text-xs text-stone-500 mt-0.5">{card.label}</div>
          </div>
        ))}
      </div>

      {/* 검색 & 필터 */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="스타일번호 / 품목명 / 시즌 검색"
              className="pl-8 h-8 text-xs border-stone-200"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {([
              { key: 'all', label: '전체' },
              { key: 'both', label: '양쪽 입력' },
              { key: 'simple', label: '간단 원가' },
              { key: 'nopre', label: '사전원가 없음' },
              { key: 'nopost', label: '사후원가 없음' },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setFilterMode(f.key)}
                className={`px-3 py-1 text-xs rounded-full border font-medium transition-colors ${
                  filterMode === f.key
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-stone-400">{filtered.length}개</span>
        </div>
      </div>

      {/* 테이블 */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-stone-200 p-12 text-center text-stone-400 text-sm">
          데이터 로딩 중...
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-stone-800 text-white">
                  <th className="px-3 py-2.5 text-center w-8">#</th>
                  <th
                    className="px-3 py-2.5 text-left cursor-pointer hover:bg-stone-700 select-none"
                    onClick={() => toggleSort('styleNo')}
                  >
                    스타일번호 <SortIndicator col="styleNo" />
                  </th>
                  <th className="px-3 py-2.5 text-left">품목명</th>
                  <th className="px-3 py-2.5 text-center w-20">시즌</th>
                  <th className="px-3 py-2.5 text-center w-20">유형</th>
                  <th
                    className="px-3 py-2.5 text-right cursor-pointer hover:bg-stone-700 select-none w-32"
                    onClick={() => toggleSort('preCost')}
                  >
                    사전원가 <SortIndicator col="preCost" />
                  </th>
                  <th
                    className="px-3 py-2.5 text-right cursor-pointer hover:bg-stone-700 select-none w-32"
                    onClick={() => toggleSort('postCost')}
                  >
                    사후원가 <SortIndicator col="postCost" />
                  </th>
                  <th className="px-3 py-2.5 text-right w-28">차이(KRW)</th>
                  <th
                    className="px-3 py-2.5 text-center cursor-pointer hover:bg-stone-700 select-none w-24"
                    onClick={() => toggleSort('diff')}
                  >
                    차이(%) <SortIndicator col="diff" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-stone-400">
                      조건에 맞는 데이터가 없습니다
                    </td>
                  </tr>
                ) : filtered.map((row, idx) => {
                  const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-stone-50/60';
                  return (
                    <tr key={row.bomId} className={`border-b border-stone-100 hover:bg-amber-50/30 transition-colors ${rowBg}`}>
                      <td className="px-3 py-2.5 text-center text-stone-400">{idx + 1}</td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-stone-700">
                        {row.styleNo}
                      </td>
                      <td className="px-3 py-2.5 text-stone-800">
                        <span className="font-medium">{row.styleName}</span>
                        {row.erpCategory && (
                          <span className="ml-1.5 text-[10px] text-stone-400">{row.erpCategory}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center text-stone-500">{row.season || '-'}</td>
                      <td className="px-3 py-2.5 text-center">
                        {row.isSimple ? (
                          <Badge className="text-[10px] py-0 h-4 bg-amber-100 text-amber-700 border-amber-300">간단</Badge>
                        ) : row.hasDetailedBom ? (
                          <Badge className="text-[10px] py-0 h-4 bg-emerald-100 text-emerald-700 border-emerald-300">상세</Badge>
                        ) : (
                          <Badge className="text-[10px] py-0 h-4 bg-stone-100 text-stone-500 border-stone-200">-</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {row.preCost !== null ? (
                          <span className="text-stone-800 font-semibold">{fmtKrw(row.preCost)}</span>
                        ) : (
                          <span className="text-stone-300">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {row.postCost !== null ? (
                          <span className="text-stone-800 font-semibold">{fmtKrw(row.postCost)}</span>
                        ) : (
                          <span className="text-stone-300">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {row.diffAmt !== null ? (
                          <span className={`font-semibold ${row.diffAmt > 0 ? 'text-red-600' : row.diffAmt < 0 ? 'text-green-700' : 'text-stone-500'}`}>
                            {row.diffAmt > 0 ? '+' : ''}{fmtKrw(row.diffAmt)}
                          </span>
                        ) : (
                          <span className="text-stone-300">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <DiffBadge diff={row.diff} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 요약 푸터 */}
          {filtered.some(r => r.preCost !== null && r.postCost !== null) && (
            <div className="px-4 py-3 border-t border-stone-200 bg-stone-50 flex items-center gap-6 text-xs text-stone-600">
              <span className="font-semibold text-stone-700">집계 (양쪽 입력된 건)</span>
              <span>
                사전원가 합계:{' '}
                <span className="font-semibold text-emerald-700">
                  {fmtKrw(filtered.filter(r => r.preCost !== null && r.postCost !== null).reduce((s, r) => s + (r.preCost ?? 0), 0))}
                </span>
              </span>
              <span>
                사후원가 합계:{' '}
                <span className="font-semibold text-blue-700">
                  {fmtKrw(filtered.filter(r => r.preCost !== null && r.postCost !== null).reduce((s, r) => s + (r.postCost ?? 0), 0))}
                </span>
              </span>
              <span>
                평균 차이:{' '}
                <span className={`font-semibold ${
                  filtered.filter(r => r.diff !== null).reduce((s, r) => s + (r.diff ?? 0), 0) /
                  (filtered.filter(r => r.diff !== null).length || 1) > 0 ? 'text-red-600' : 'text-green-700'
                }`}>
                  {(() => {
                    const rows = filtered.filter(r => r.diff !== null);
                    if (!rows.length) return '-';
                    const avg = rows.reduce((s, r) => s + (r.diff ?? 0), 0) / rows.length;
                    return `${avg > 0 ? '+' : ''}${avg.toFixed(1)}%`;
                  })()}
                </span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
