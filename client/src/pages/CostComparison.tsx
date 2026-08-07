/**
 * 사전/사후 원가 비교 대시보드
 * Design: Maison Atelier — 에보니 사이드바, 골드 악센트, 아이보리 배경
 */

import { useState, useMemo, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBoms, fetchItems, fetchVendors } from '@/lib/supabaseQueries';
import { CATEGORY_CODE_MAP } from '@/lib/styleNo';
import type { Category } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Download, Search, TrendingUp, TrendingDown, Minus, Check, X, Pencil } from 'lucide-react';

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
  salePrice: number | null;   // 확정판매가 (postDeliveryPrice)
  multiplier: number | null;  // 실현배수 = salePrice / postCost
  isSimple: boolean;
  hasDetailedBom: boolean;
  bomId: string;
  brandText: string;   // 바이어 회사명 + 브랜드명들 (검색 전용)
  subCategory: string; // 세부 카테고리 (숄더백·토트백 …)
}

// ─── 포맷 헬퍼 ────────────────────────────────────────────────────────────
const fmtKrw = (n: number) => '₩' + Math.round(n).toLocaleString('ko-KR');

function DiffBadge({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="text-muted-foreground text-xs">-</span>;
  const isPositive = diff > 0;
  const cls = isPositive
    ? 'bg-[var(--system-red)]/10 text-[var(--system-red)] border-transparent'
    : diff < 0
    ? 'bg-[var(--system-green)]/10 text-[var(--system-green)] border-transparent'
    : 'bg-[var(--fill-quaternary)] text-muted-foreground border-transparent';
  const Icon = isPositive ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${cls}`}>
      <Icon className="w-3 h-3" />
      {isPositive ? '+' : ''}{diff.toFixed(1)}%
    </span>
  );
}

// ─── 편집 셀 타입 ─────────────────────────────────────────────────────────
type EditField = 'pre' | 'post' | 'salePrice';
interface EditingCell { bomId: string; field: EditField; }

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────
export default function CostComparison() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [filterSeason, setFilterSeason] = useState('전체');
  const [filterCat, setFilterCat] = useState('전체');
  const [filterSubCat, setFilterSubCat] = useState('전체');
  const [filterBrand, setFilterBrand] = useState('전체');
  const [filterMode, setFilterMode] = useState<'all' | 'simple' | 'both' | 'nopre' | 'nopost'>('all');
  const [sortBy, setSortBy] = useState<'styleNo' | 'diff' | 'preCost' | 'postCost'>('styleNo');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // 인라인 편집 상태
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();

  const { data: rawBoms = [], isLoading: bomsLoading } = useQuery({
    queryKey: ['boms'],
    queryFn: fetchBoms,
  });
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['items'],
    queryFn: fetchItems,
  });
  // 브랜드명으로도 찾을 수 있게 바이어(거래처)를 함께 읽는다
  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors'],
    queryFn: fetchVendors,
  });

  const isLoading = bomsLoading || itemsLoading;

  // BOM 데이터를 CostRow로 변환
  const costRows = useMemo<CostRow[]>(() => {
    const itemMap = new Map(items.map((i: any) => [i.id, i]));
    const vendorMap = new Map((vendors as any[]).map(v => [v.id, v]));

    return rawBoms.map((bom: any) => {
      const item = itemMap.get(bom.styleId) || itemMap.get(bom.styleNo);
      const isSimple = !!(bom as any).isSimpleCost;
      const buyer: any = item?.buyerId ? vendorMap.get(item.buyerId) : undefined;
      const brandText = [buyer?.name, buyer?.companyName, buyer?.nameEn, ...(buyer?.brands || []), item?.buyerStyleNo]
        .filter(Boolean).join(' ');

      // 사전원가
      let preCost: number | null = null;
      if (isSimple && (bom as any).simpleCostKrw) {
        preCost = (bom as any).simpleCostKrw;
      } else if (item?.baseCostKrw && item.baseCostKrw > 0) {
        preCost = item.baseCostKrw;
      }

      // 사후원가 - 종원가액(생산마진 포함) 기준
      let postCost: number | null = null;
      if (isSimple && (bom as any).simplePostCostKrw) {
        postCost = (bom as any).simplePostCostKrw;
      } else if (bom.postTotalCostKrw && bom.postTotalCostKrw > 0) {
        // postTotalCostKrw는 저장 시점(BomManagement.tsx handleSave)에 이미
        // 생산마진이 곱해진 값이다. 여기서 또 곱하면 마진이 이중 계상된다.
        postCost = Math.round(bom.postTotalCostKrw);
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

      // 확정판매가 (postDeliveryPrice 우선, 없으면 item.deliveryPrice)
      const salePrice: number | null =
        bom.postDeliveryPrice != null && bom.postDeliveryPrice > 0
          ? bom.postDeliveryPrice
          : item?.deliveryPrice != null && item.deliveryPrice > 0
          ? item.deliveryPrice
          : null;

      // 실현배수 = 확정판매가 / 사후원가
      const multiplier: number | null =
        salePrice !== null && postCost !== null && postCost > 0
          ? Math.round((salePrice / postCost) * 100) / 100
          : null;

      return {
        styleNo: bom.styleNo || '',
        styleName: bom.styleName || item?.name || '',
        season: bom.season || item?.season || '',
        erpCategory: bom.erpCategory || item?.erpCategory || '',
        preCost,
        postCost,
        diff,
        diffAmt,
        salePrice,
        multiplier,
        isSimple,
        hasDetailedBom,
        bomId: bom.id,
        brandText,
        subCategory: item?.category
          || (CATEGORY_CODE_MAP[(bom.erp_category || '') as Category] ? bom.erp_category : ''),
      } as CostRow;
    });
  }, [rawBoms, items, vendors]);

  // 필터 선택지 — 실제 데이터에 있는 값만 보여준다
  const seasonOptions = useMemo(
    () => Array.from(new Set(costRows.map(r => r.season).filter(Boolean))).sort(),
    [costRows],
  );
  // 대분류는 4종으로 고정 (HANDBAG 같은 옛 표기는 HB로 묶는다)
  const normCat = (c?: string) => {
    const raw = (c || '').trim();
    const v = raw.toUpperCase();
    if (v.startsWith('HB') || v.startsWith('HAND') || v === 'BP') return 'HB';
    if (v.startsWith('SLG') || v.startsWith('ACC') || v === 'SL') return 'SLG';
    if (v.startsWith('SHOE') || v === 'SH') return 'SHOES';
    if (v.startsWith('PACK') || v === 'PK') return 'PACK';
    // erpCategory 자리에 세부명(숄더백·지갑 …)이 들어온 옛 데이터도 대분류로 묶는다
    const code = CATEGORY_CODE_MAP[raw as Category];
    if (code === 'HB' || code === 'BP') return 'HB';
    if (code === 'SL') return 'SLG';
    if (code === 'SH') return 'SHOES';
    if (code === 'PK') return 'PACK';
    return '';
  };
  const catOptions = ['HB', 'SLG', 'SHOES', 'PACK'];
  // 대분류를 고르면 그 안의 세부 카테고리만 보여준다
  const subCatOptions = useMemo(() => Array.from(new Set(
    costRows.filter(r => filterCat === '전체' || normCat(r.erpCategory) === filterCat)
      .map(r => r.subCategory).filter(Boolean),
  )).sort(), [costRows, filterCat]);
  const brandOptions = useMemo(
    () => Array.from(new Set((vendors as any[]).filter(v => v.type === '바이어')
      .flatMap(v => (v.brands?.length ? v.brands : [v.nameEn || v.name])).filter(Boolean))).sort(),
    [vendors],
  );

  // 검색 & 필터 & 정렬
  const filtered = useMemo(() => {
    let rows = costRows;

    // 검색
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.styleNo.toLowerCase().includes(q) ||
        r.styleName.toLowerCase().includes(q) ||
        r.season.toLowerCase().includes(q) ||
        r.brandText.toLowerCase().includes(q)
      );
    }

    if (filterSeason !== '전체') rows = rows.filter(r => r.season === filterSeason);
    if (filterCat !== '전체') rows = rows.filter(r => normCat(r.erpCategory) === filterCat);
    if (filterSubCat !== '전체') rows = rows.filter(r => r.subCategory === filterSubCat);
    if (filterBrand !== '전체') rows = rows.filter(r => r.brandText.includes(filterBrand));

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
  }, [costRows, search, filterMode, filterSeason, filterCat, filterSubCat, filterBrand, sortBy, sortDir]);

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

  // ─── 인라인 편집 핸들러 ──────────────────────────────────────────────────
  const startEdit = (bomId: string, field: EditField, currentValue: number | null) => {
    setEditingCell({ bomId, field });
    setEditValue(currentValue !== null ? String(currentValue) : '');
    setTimeout(() => inputRef.current?.select(), 30);
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!editingCell || saving) return;
    const newCost = parseInt(editValue.replace(/[^0-9]/g, ''), 10);
    if (isNaN(newCost) || newCost < 0) {
      toast.error('올바른 숫자를 입력해주세요');
      return;
    }
    setSaving(true);
    try {
      const bom = rawBoms.find((b: any) => b.id === editingCell.bomId);
      if (!bom) throw new Error('BOM을 찾을 수 없습니다');

      // 기존 memo 파싱
      let memo: Record<string, any> = {};
      if (bom.memo && typeof bom.memo === 'string' && bom.memo.trim().startsWith('{')) {
        try { memo = JSON.parse(bom.memo); } catch { memo = {}; }
      }
      memo.isSimple = true;

      if (editingCell.field === 'pre') {
        memo.preCost = newCost;
        // items 테이블 base_cost_krw 업데이트
        const { error: itemErr } = await supabase
          .from('items')
          .update({ base_cost_krw: newCost })
          .eq('style_no', bom.styleNo);
        if (itemErr) console.warn('items 업데이트 실패:', itemErr.message);

        const { error } = await supabase
          .from('boms')
          .update({ memo: JSON.stringify(memo) })
          .eq('id', editingCell.bomId);
        if (error) throw error;
      } else if (editingCell.field === 'salePrice') {
        // 확정판매가 → post_delivery_price 컬럼 직접 저장
        const { error } = await supabase
          .from('boms')
          .update({ post_delivery_price: newCost })
          .eq('id', editingCell.bomId);
        if (error) throw error;
      } else {
        memo.postCost = newCost;
        const { error } = await supabase
          .from('boms')
          .update({ memo: JSON.stringify(memo) })
          .eq('id', editingCell.bomId);
        if (error) throw error;
      }

      await queryClient.invalidateQueries({ queryKey: ['boms'] });
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      const fieldLabel = editingCell.field === 'pre' ? '사전원가' : editingCell.field === 'salePrice' ? '확정판매가' : '사후원가';
      toast.success(`${fieldLabel} 저장 완료`);
      setEditingCell(null);
    } catch (e: any) {
      toast.error(`저장 실패: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  };

  // ─── 편집 가능 원가 셀 렌더러 ─────────────────────────────────────────────
  const EditableCostCell = ({
    bomId, field, value
  }: { bomId: string; field: EditField; value: number | null }) => {
    const isEditing = editingCell?.bomId === bomId && editingCell.field === field;
    if (isEditing) {
      return (
        <div className="flex items-center gap-1 justify-end">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => { /* blur는 버튼 클릭 처리 후 동작하므로 mousedown으로 처리 */ }}
            disabled={saving}
            className="w-28 text-right text-xs font-mono px-2 py-1 rounded border border-primary bg-card focus:outline-none focus:border-primary"
            autoFocus
          />
          <button
            onMouseDown={(e) => { e.preventDefault(); saveEdit(); }}
            disabled={saving}
            className="w-6 h-6 flex items-center justify-center rounded bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50"
            title="저장 (Enter)"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
            disabled={saving}
            className="w-6 h-6 flex items-center justify-center rounded bg-[var(--fill-tertiary)] hover:bg-[var(--fill-secondary)] text-foreground disabled:opacity-50"
            title="취소 (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }
    return (
      <div
        className="flex items-center justify-end gap-1.5 group cursor-pointer rounded px-1 py-0.5 hover:bg-[var(--fill-quaternary)] transition-colors"
        onClick={() => startEdit(bomId, field, value)}
        title="클릭하여 편집"
      >
        {value !== null ? (
          <span className="text-foreground font-semibold font-mono">{fmtKrw(value)}</span>
        ) : (
          <span className="text-muted-foreground font-mono">-</span>
        )}
        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground" />
      </div>
    );
  };

  // 엑셀 다운로드
  const handleExcelDownload = async () => {
    try {
      const XLSX = await import('xlsx');
      const wsData = [
        ['스타일번호', '품목명', '시즌', '카테고리', '사전원가(KRW)', '사후원가(KRW)', '확정판매가(KRW)', '실현배수', '차이(KRW)', '차이(%)'],
        ...filtered.map(r => [
          r.styleNo,
          r.styleName,
          r.season,
          r.erpCategory,
          r.preCost ?? '',
          r.postCost ?? '',
          r.salePrice ?? '',
          r.multiplier !== null ? r.multiplier : '',
          r.diffAmt ?? '',
          r.diff !== null ? parseFloat(r.diff.toFixed(2)) : '',
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      // 컬럼 너비
      ws['!cols'] = [
        { wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 14 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 8 },
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
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-[1400px]">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">사전/사후 원가 비교</h1>
          <p className="text-sm text-muted-foreground mt-0.5">등록된 BOM의 사전원가와 사후원가를 비교합니다</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExcelDownload}
          className="gap-1.5 text-xs"
        >
          <Download className="w-3.5 h-3.5" /> 엑셀 다운로드
        </Button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: '전체 BOM', value: stats.total, color: 'text-foreground' },
          { label: '사전원가 입력', value: stats.withPre, color: 'text-[var(--system-green)]' },
          { label: '사후원가 입력', value: stats.withPost, color: 'text-primary' },
          { label: '양쪽 입력', value: stats.withBoth, color: 'text-foreground' },
          { label: '사후원가↑ (초과)', value: stats.overBudget, color: 'text-[var(--system-red)]' },
          { label: '사후원가↓ (절감)', value: stats.underBudget, color: 'text-[var(--system-green)]' },
          {
            label: '평균 차이(%)',
            value: stats.avgDiff !== null ? `${stats.avgDiff > 0 ? '+' : ''}${stats.avgDiff.toFixed(1)}%` : '-',
            color: stats.avgDiff === null ? 'text-muted-foreground' : stats.avgDiff > 0 ? 'text-[var(--system-red)]' : 'text-[var(--system-green)]',
          },
        ].map(card => (
          <div key={card.label} className="bg-card rounded-lg border border-border p-4">
            <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{card.label}</div>
          </div>
        ))}
      </div>

      {/* 검색 & 필터 */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="브랜드명 / 스타일번호 / 품목명 / 시즌 검색"
              className="pl-8 h-8 text-xs"
            />
          </div>
          <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
            className="h-8 text-xs border border-border rounded-md bg-card px-2">
            <option value="전체">전체 브랜드</option>
            {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={filterSeason} onChange={e => setFilterSeason(e.target.value)}
            className="h-8 text-xs border border-border rounded-md bg-card px-2">
            <option value="전체">전체 시즌</option>
            {seasonOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setFilterSubCat('전체'); }}
            className="h-8 text-xs border border-border rounded-md bg-card px-2">
            <option value="전체">전체 카테고리</option>
            {catOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {filterCat !== '전체' && subCatOptions.length > 0 && (
            <select value={filterSubCat} onChange={e => setFilterSubCat(e.target.value)}
              className="h-8 text-xs border border-border rounded-md bg-card px-2">
              <option value="전체">세부 전체</option>
              {subCatOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          <select
            value={filterMode}
            onChange={e => setFilterMode(e.target.value as typeof filterMode)}
            className="h-8 text-xs border border-border rounded-md bg-card px-2"
          >
            <option value="all">전체 상태</option>
            <option value="both">양쪽 입력</option>
            <option value="simple">간단 원가</option>
            <option value="nopre">사전원가 없음</option>
            <option value="nopost">사후원가 없음</option>
          </select>
          <span className="text-xs text-muted-foreground">{filtered.length}개</span>
        </div>
      </div>

      {/* 테이블 */}
      {isLoading ? (
        <div className="bg-card rounded-lg border border-border p-12 text-center text-muted-foreground text-sm">
          데이터 로딩 중...
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full min-w-[720px] text-xs">
              <thead>
                <tr className="border-b border-border text-[13px] font-semibold text-muted-foreground">
                  <th className="ctr w-8">#</th>
                  <th
                    className="px-3 py-2.5 text-left cursor-pointer hover:bg-[var(--fill-quaternary)] select-none"
                    onClick={() => toggleSort('styleNo')}
                  >
                    스타일번호 <SortIndicator col="styleNo" />
                  </th>
                  <th>품목명</th>
                  <th className="nw ctr w-20">시즌</th>
                  <th className="ctr w-20">유형</th>
                  <th
                    className="px-3 py-2.5 text-right cursor-pointer hover:bg-[var(--fill-quaternary)] select-none w-32"
                    onClick={() => toggleSort('preCost')}
                  >
                    사전원가 <SortIndicator col="preCost" />
                  </th>
                  <th
                    className="px-3 py-2.5 text-right cursor-pointer hover:bg-[var(--fill-quaternary)] select-none w-32"
                    onClick={() => toggleSort('postCost')}
                  >
                    사후원가 <SortIndicator col="postCost" />
                  </th>
                  <th className="num w-32">확정판매가</th>
                  <th className="ctr w-20">실현배수</th>
                  <th className="num w-28">차이(KRW)</th>
                  <th
                    className="px-3 py-2.5 text-center cursor-pointer hover:bg-[var(--fill-quaternary)] select-none w-24"
                    onClick={() => toggleSort('diff')}
                  >
                    차이(%) <SortIndicator col="diff" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                      조건에 맞는 데이터가 없습니다
                    </td>
                  </tr>
                ) : filtered.map((row, idx) => {
                  return (
                    <tr key={row.bomId} className="hover:bg-[var(--fill-quaternary)] transition-colors">
                      <td className="ctr text-muted-foreground w-8">{idx + 1}</td>
                      <td className="nw font-mono font-semibold text-foreground">
                        {row.styleNo}
                      </td>
                      <td className="text-foreground">
                        <span className="font-medium">{row.styleName}</span>
                        {row.erpCategory && (
                          <span className="ml-1.5 text-[11px] text-muted-foreground">{row.erpCategory}</span>
                        )}
                      </td>
                      <td className="ctr text-muted-foreground">{row.season || '-'}</td>
                      <td className="ctr">
                        {row.isSimple ? (
                          <Badge className="text-[11px] py-0 h-4 bg-primary/10 text-primary border-transparent">간단</Badge>
                        ) : row.hasDetailedBom ? (
                          <Badge className="text-[11px] py-0 h-4 bg-[var(--fill-tertiary)] text-foreground border-transparent">상세</Badge>
                        ) : (
                          <Badge className="text-[11px] py-0 h-4 bg-[var(--fill-quaternary)] text-muted-foreground border-transparent">-</Badge>
                        )}
                      </td>
                      <td className="nw num font-mono">
                        <EditableCostCell bomId={row.bomId} field="pre" value={row.preCost} />
                      </td>
                      <td className="nw num font-mono">
                        {/* 사후원가 클릭 → BOM 사후원가 탭으로 이동 */}
                        <div
                          className="flex items-center justify-end gap-1.5 group cursor-pointer rounded px-1 py-0.5 hover:bg-[var(--fill-quaternary)] transition-colors"
                          onClick={() => navigate(`/bom?style=${row.styleNo}&tab=post`)}
                          title="클릭하면 BOM 사후원가 탭으로 이동"
                        >
                          {row.postCost !== null ? (
                            <span className="text-foreground font-semibold font-mono">{fmtKrw(row.postCost)}</span>
                          ) : (
                            <span className="text-muted-foreground text-xs">+ 입력</span>
                          )}
                          <span className="opacity-0 group-hover:opacity-100 text-primary text-xs">↗</span>
                        </div>
                      </td>
                      <td className="nw num font-mono">
                        <EditableCostCell bomId={row.bomId} field="salePrice" value={row.salePrice} />
                      </td>
                      <td className="nw ctr font-mono">
                        {row.multiplier !== null ? (
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                            row.multiplier >= 2.5
                              ? 'bg-[var(--system-green)]/10 text-[var(--system-green)]'
                              : row.multiplier >= 2.0
                              ? 'bg-[var(--system-orange)]/10 text-[var(--system-orange)]'
                              : 'bg-[var(--system-red)]/10 text-[var(--system-red)]'
                          }`}>{row.multiplier.toFixed(2)}x</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>
                      <td className="nw num font-mono">
                        {row.diffAmt !== null ? (
                          <span className={`font-semibold ${row.diffAmt > 0 ? 'text-[var(--system-red)]' : row.diffAmt < 0 ? 'text-[var(--system-green)]' : 'text-muted-foreground'}`}>
                            {row.diffAmt > 0 ? '+' : ''}{fmtKrw(row.diffAmt)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="ctr">
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
            <div className="px-4 py-3 border-t border-border bg-[var(--fill-quaternary)] flex items-center gap-6 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">집계 (양쪽 입력된 건)</span>
              <span>
                사전원가 합계:{' '}
                <span className="font-semibold text-[var(--system-green)]">
                  {fmtKrw(filtered.filter(r => r.preCost !== null && r.postCost !== null).reduce((s, r) => s + (r.preCost ?? 0), 0))}
                </span>
              </span>
              <span>
                사후원가 합계:{' '}
                <span className="font-semibold text-primary">
                  {fmtKrw(filtered.filter(r => r.preCost !== null && r.postCost !== null).reduce((s, r) => s + (r.postCost ?? 0), 0))}
                </span>
              </span>
              <span>
                평균 차이:{' '}
                <span className={`font-semibold ${
                  filtered.filter(r => r.diff !== null).reduce((s, r) => s + (r.diff ?? 0), 0) /
                  (filtered.filter(r => r.diff !== null).length || 1) > 0 ? 'text-[var(--system-red)]' : 'text-[var(--system-green)]'
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
