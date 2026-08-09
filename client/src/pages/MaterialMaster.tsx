// AMESCOTES ERP — 자재 마스터 (Supabase 전환 완료)
import { useState, useEffect, useMemo, useRef } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { store, genId, MATERIAL_CATEGORIES, MATERIAL_SUB_TYPES, PLATING_COLORS, COMMON_BRAND, type Material, type MaterialCategory, type Vendor } from '@/lib/store';
import { Link } from 'wouter';
import { fetchMaterials, upsertMaterial, deleteMaterial as deleteMaterialSB, fetchVendors, updateMaterialStatus, recordPriceChange, fetchPriceHistory, type PriceHistoryRow } from '@/lib/supabaseQueries';
import { resizeImage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { onSaveFail } from '@/lib/saveGuard';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, Search, Pencil, Trash2, Package, ChevronDown, Eye, X, History } from 'lucide-react';
import { HoverZoomImage } from '@/components/HoverZoomImage';

/** 검색 가능한 단일 선택 드롭다운 — 네이티브 datalist 대신 (Select 와 같은 외형) */
function SearchSelect({ value, options, placeholder, disabled, onChange, counts, allLabel, compact, label }: {
  value?: string; options: string[]; placeholder: string; disabled?: boolean; onChange: (v: string) => void;
  /** 항목별 건수 — 넘기면 우측에 표시하고 0건은 흐리게 */
  counts?: Record<string, number>;
  /** 넘기면 목록 맨 위에 "전체" 항목을 두고, 선택 시 '' 를 돌려준다 */
  allLabel?: string;
  /** 툴바용 — 높이를 낮추고 폭을 내용에 맞춘다 */
  compact?: boolean;
  /** 트리거 앞에 붙는 회색 라벨 (예: "카테고리") */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = options.filter(o => o.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (v: string) => { onChange(v); setOpen(false); };
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (o) setQ(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button" disabled={disabled}
          className={compact
            ? 'flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm disabled:opacity-50 whitespace-nowrap hover:bg-[var(--fill-quaternary)]'
            : 'flex h-9 w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed'}
        >
          {label && <span className="text-muted-foreground">{label}</span>}
          <span className={value ? 'text-foreground font-medium' : 'text-muted-foreground'}>{value || placeholder}</span>
          <ChevronDown size={14} className="opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={compact ? 'p-0 w-56' : 'p-0 w-[var(--radix-popover-trigger-width)]'}>
        <div className="p-2 border-b border-border">
          <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="검색" className="h-8" />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {allLabel && !q && (
            <button type="button" onClick={() => pick('')}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-[var(--fill-quaternary)] ${!value ? 'bg-[var(--fill-tertiary)] font-medium' : ''}`}>
              {allLabel}
            </button>
          )}
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">결과 없음</p>
          ) : filtered.map(o => {
            const n = counts?.[o];
            return (
              <button
                key={o} type="button" onClick={() => pick(o)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-sm hover:bg-[var(--fill-quaternary)] ${o === value ? 'bg-[var(--fill-tertiary)] font-medium' : ''} ${n === 0 ? 'opacity-40' : ''}`}
              >
                <span className="truncate">{o}</span>
                {n !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{n}</span>}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const UNITS = ['SF', 'YD', 'M', 'EA', 'L', '콘', 'KG', 'SET', '장', '개', 'PC', 'CM'];
const CHIP = 'bg-[var(--fill-tertiary)] text-foreground border-border';
type PriceCurrency = 'KRW' | 'CNY' | 'USD';
const CURRENCIES: PriceCurrency[] = ['KRW', 'CNY', 'USD'];
const CURRENCY_SIGN: Record<PriceCurrency, string> = { KRW: '₩', CNY: '¥', USD: '$' };

const emptyForm: Partial<Material> = {
  name: '', nameEn: '', category: '가죽', brand: COMMON_BRAND, spec: '', unit: 'SF',
  unitPriceCny: undefined, unitPriceKrw: undefined, vendorId: '', memo: '',
};

export default function MaterialMaster() {
  const queryClient = useQueryClient();
  const { data: materials = [], refetch: refetchMaterials, isLoading: materialsLoading, error: materialsError } = useQuery({ queryKey: ['materials'], queryFn: fetchMaterials });

  // 탭 진입 시 항상 최신 데이터 로드
  useEffect(() => {
    refetchMaterials();
  }, []);
  const { data: allVendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  // 브랜드 선택지 = 공통 + 거래처 마스터의 바이어 (LUMEN / AETALOOF …)
  const brands = useMemo(
    () => [COMMON_BRAND, ...allVendors.filter((v: Vendor) => v.type === '바이어').map((v: Vendor) => v.name)],
    [allVendors],
  );
  const buyerNames = useMemo(() => brands.slice(1), [brands]);
  const supplierNames = useMemo(
    () => allVendors.filter((v: Vendor) => v.type === '자재거래처' && v.name?.trim()).map((v: Vendor) => v.name),
    [allVendors],
  );
  const [search, setSearch] = usePersistedState('materials.search', '');
  const [filterCat, setFilterCat] = usePersistedState('materials.filterCat', 'all');
  const [filterBrand, setFilterBrand] = usePersistedState('materials.filterBrand', 'all');
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Material>>({ ...emptyForm });
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [vendorQuery, setVendorQuery] = useState('');
  const [historyOf, setHistoryOf] = useState<Material | null>(null);
  const [history, setHistory] = useState<PriceHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    let list = materials as any[];
    if (filterCat !== 'all') list = list.filter((m: any) => m.category === filterCat);
    if (filterBrand !== 'all') list = list.filter((m: any) => (m.brand || COMMON_BRAND) === filterBrand);
    if (search) list = list.filter((m: any) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.nameEn || '').toLowerCase().includes(search.toLowerCase()) ||
      (m.subType || '').toLowerCase().includes(search.toLowerCase()) ||
      (m.spec || '').toLowerCase().includes(search.toLowerCase())
    );
    return list;
  }, [materials, filterCat, filterBrand, search]);

  /** 브랜드 전용이면 거래처 코드를 앞에 붙인다 (예: LMN-H2608-01) */
  const brandCodeOf = (brandName?: string) => {
    if (!brandName || brandName === COMMON_BRAND) return undefined;
    return (allVendors.find((v: Vendor) => v.name === brandName) as Vendor | undefined)?.code || undefined;
  };
  const nextCode = (cat: MaterialCategory, brandName?: string) =>
    store.getNextItemCode(cat, materials as Material[], brandCodeOf(brandName));
  const subTypeOptions = MATERIAL_SUB_TYPES[(form.category as MaterialCategory) || '가죽'] ?? [];
  // brand === '' 는 "브랜드 전용 선택했으나 바이어 미지정" 상태 (undefined 와 구분)
  const isCommonBrand = form.brand === undefined || form.brand === COMMON_BRAND;

  const [detail, setDetail] = useState<any>(null);
  const [platingPick, setPlatingPick] = useState('');
  const addPlatingColor = () => {
    const c = platingPick.trim();
    if (!c) return;
    setForm(prev => {
      const cur = prev.platingPrices || [];
      if (cur.some(p => p.color === c)) return prev;
      // 대표 컬러(레거시 표시용)도 첫 컬러로 채워둔다
      return { ...prev, platingPrices: [...cur, { color: c }], platingColor: prev.platingColor || c };
    });
    setPlatingPick('');
  };
  const updatePlating = (idx: number, patch: Partial<{ price?: number; currency?: string }>) =>
    setForm(prev => ({
      ...prev,
      platingPrices: (prev.platingPrices || []).map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  const removePlating = (idx: number) =>
    setForm(prev => ({ ...prev, platingPrices: (prev.platingPrices || []).filter((_, i) => i !== idx) }));

  const openNew = () => {
    setForm({ ...emptyForm, itemCode: nextCode(emptyForm.category as MaterialCategory, emptyForm.brand) });
    setPreviewImage(null);
    setVendorQuery('');
    setEditId(null);
    setShowModal(true);
  };

  const openHistory = async (m: Material) => {
    setHistoryOf(m);
    setHistoryLoading(true);
    try {
      setHistory(await fetchPriceHistory('material', { refId: m.id, refName: m.name }));
    } catch (e) {
      toast.error(`이력 조회 실패: ${(e as Error).message}`);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openEdit = (m: any) => {
    setForm({ ...m });
    setPreviewImage(m.imageUrl || null);
    setVendorQuery(allVendors.find((v: Vendor) => v.id === m.vendorId)?.name || '');
    setEditId(m.id);
    setShowModal(true);
  };

  const applyImage = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('이미지 파일만 가능합니다'); return; }
    try {
      const base64 = await resizeImage(file);
      setForm(prev => ({ ...prev, imageUrl: base64 }));
      setPreviewImage(base64);
    } catch {
      toast.error('이미지 업로드 실패');
    }
  };
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => applyImage(e.target.files?.[0]);
  const [dragOver, setDragOver] = useState(false);
  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0]
      // 브라우저에서 이미지를 끌어오면 파일 대신 URL 로 올 때가 있다 → 그 경우는 URL 그대로 저장
      || null;
    if (f) { void applyImage(f); return; }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (url?.startsWith('http')) { setForm(prev => ({ ...prev, imageUrl: url })); setPreviewImage(url); }
  };

  // 단가는 통화 1개만 보유 — 선택한 통화 칸에만 값을 넣고 나머지는 비운다
  const currencyOf = (m: any): PriceCurrency =>
    m?.priceCurrency || (m?.unitPriceCny != null ? 'CNY' : m?.unitPriceUsd != null ? 'USD' : 'KRW');
  const priceOf = (m: any) => {
    const c = currencyOf(m);
    return c === 'CNY' ? m?.unitPriceCny : c === 'USD' ? m?.unitPriceUsd : m?.unitPriceKrw;
  };
  const setPrice = (value: number | undefined, cur: PriceCurrency) =>
    setForm(prev => ({
      ...prev, priceCurrency: cur,
      unitPriceKrw: cur === 'KRW' ? value : undefined,
      unitPriceCny: cur === 'CNY' ? value : undefined,
      unitPriceUsd: cur === 'USD' ? value : undefined,
    }));

  const handleSave = async () => {
    if (!form.name?.trim()) { toast.error('자재명을 입력하세요'); return; }
    if (!form.unit) { toast.error('단위를 입력하세요'); return; }
    if (!isCommonBrand && !buyerNames.includes(form.brand || '')) { toast.error('브랜드 전용이면 바이어를 선택하세요'); return; }

    const mat = {
      ...form,
      id: editId || genId(),
      createdAt: new Date().toISOString(),
    };

    try {
      await upsertMaterial(mat);
      // 단가가 바뀌었으면 이력 한 줄 — 다음 시즌 협상 때 근거가 된다
      const before = editId ? (materials as Material[]).find(m => m.id === editId) : undefined;
      const cur = currencyOf(mat);
      const newPrice = priceOf(mat);
      const oldPrice = before ? priceOf(before) : undefined;
      const oldCur = before ? currencyOf(before) : undefined;
      const sameCurrency = oldCur === cur;
      const changed = !before || !sameCurrency || Number(oldPrice ?? NaN) !== Number(newPrice);
      if (newPrice != null && changed) {
        await recordPriceChange({
          kind: 'material',
          refId: mat.id,
          refName: mat.name || '',
          vendorId: mat.vendorId || undefined,
          vendorName: vendorQuery || undefined,
          currency: cur,
          unitPrice: Number(newPrice),
          // 통화가 바뀌었으면 이전값을 넘기지 않는다 — 다른 통화끼리 빼면 숫자가 거짓말을 한다
          prevPrice: sameCurrency && oldPrice != null ? Number(oldPrice) : undefined,
          memo: sameCurrency ? undefined : `통화 변경 ${oldCur ?? '-'} → ${cur}`,
        }).catch(onSaveFail('단가 이력'));
      }
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      toast.success(editId ? '자재가 수정되었습니다' : '자재가 등록되었습니다');
      setShowModal(false);
    } catch (e: any) {
      toast.error(`저장 실패: ${e.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await deleteMaterialSB(id);
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      toast.success('삭제되었습니다');
    } catch (e: any) {
      toast.error(`삭제 실패: ${e.message}`);
    }
  };

  // 체크박스 다중 선택 관련
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isAllSelected = filtered.length > 0 && filtered.every((m: any) => selectedIds.has(m.id));
  const isIndeterminate = filtered.some((m: any) => selectedIds.has(m.id)) && !isAllSelected;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((m: any) => m.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (confirm(`${selectedIds.size}개 항목을 삭제하시겠습니까?`)) {
      const count = selectedIds.size;
      try {
        await Promise.all([...selectedIds].map(id => deleteMaterialSB(id)));
        setSelectedIds(new Set());
        queryClient.invalidateQueries({ queryKey: ['materials'] });
        toast.success(`${count}개 항목이 삭제되었습니다`);
      } catch (e: any) {
        toast.error(`삭제 실패: ${e.message}`);
      }
    }
  };

  const catCounts = useMemo(() => {
    const map: Record<string, number> = {};
    (materials as any[]).forEach((m: any) => { map[m.category] = (map[m.category] || 0) + 1; });
    return map;
  }, [materials]);

  const brandCounts = useMemo(() => {
    const map: Record<string, number> = {};
    (materials as any[]).forEach((m: any) => { const b = m.brand || COMMON_BRAND; map[b] = (map[b] || 0) + 1; });
    return map;
  }, [materials]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">자재 마스터</h1>
          <p className="text-sm text-muted-foreground mt-0.5">원자재·부자재 단가 등록 · BOM 자동 연결</p>
          {materialsLoading && <p className="text-xs text-primary">로딩 중...</p>}
          {materialsError && <p className="text-xs text-[var(--system-red)]">오류: {String(materialsError)}</p>}
          <p className="text-xs text-muted-foreground">총 {materials.length}건 (표시: {filtered.length}건)</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus size={16} />자재 등록
        </Button>
      </div>

      {/* 필터 툴바 — 검색 · 카테고리 · 브랜드를 한 줄에 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="자재명 / 스펙 검색" className="pl-9 h-9" />
        </div>
        <SearchSelect
          compact label="카테고리" allLabel="전체" placeholder="전체"
          value={filterCat === 'all' ? '' : filterCat}
          options={MATERIAL_CATEGORIES}
          counts={catCounts}
          onChange={v => setFilterCat(v || 'all')}
        />
        <SearchSelect
          compact label="브랜드" allLabel="전체" placeholder="전체"
          value={filterBrand === 'all' ? '' : filterBrand}
          options={brands}
          counts={brandCounts}
          onChange={v => setFilterBrand(v || 'all')}
        />
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {materials.length}건 중 {filtered.length}건
        </span>
      </div>

      {/* 적용된 필터 */}
      {(filterCat !== 'all' || filterBrand !== 'all' || search) && (
        <div className="flex flex-wrap items-center gap-2 -mt-2">
          {filterCat !== 'all' && (
            <button onClick={() => setFilterCat('all')} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-primary text-primary-foreground">
              {filterCat} <X size={12} className="opacity-70" />
            </button>
          )}
          {filterBrand !== 'all' && (
            <button onClick={() => setFilterBrand('all')} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-primary text-primary-foreground">
              {filterBrand} <X size={12} className="opacity-70" />
            </button>
          )}
          {search && (
            <button onClick={() => setSearch('')} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-primary text-primary-foreground">
              “{search}” <X size={12} className="opacity-70" />
            </button>
          )}
          <button
            onClick={() => { setFilterCat('all'); setFilterBrand('all'); setSearch(''); }}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            필터 초기화
          </button>
        </div>
      )}

      {/* 다중 선택 액션 바 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-card border border-border rounded-lg">
          <span className="text-sm font-medium text-foreground">{selectedIds.size}개 선택됨</span>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md text-xs font-medium transition-colors"
          >
            <Trash2 className="w-4 h-4" />선택 삭제
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="flex items-center gap-1 px-3 py-1.5 bg-[var(--fill-tertiary)] hover:bg-[var(--fill-secondary)] text-foreground rounded-md text-xs font-medium transition-colors"
          >
            선택 해제
          </button>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-card rounded-lg border border-border overflow-x-auto">
        <table className="data-table w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-[var(--fill-quaternary)]">
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                />
              </th>
              <th className="text-[13px] font-semibold text-muted-foreground w-14">이미지</th>
              <th className="nw text-[13px] font-semibold text-muted-foreground w-32 whitespace-nowrap">품번</th>
              <th className="text-[13px] font-semibold text-muted-foreground">카테고리</th>
              <th className="text-[13px] font-semibold text-muted-foreground">브랜드</th>
              <th className="text-[13px] font-semibold text-muted-foreground">자재명</th>
              <th className="text-[13px] font-semibold text-muted-foreground">스펙</th>
              <th className="num text-[13px] font-semibold text-muted-foreground">단가</th>
              <th className="nw text-[13px] font-semibold text-muted-foreground">단위</th>
              
              <th className="ctr text-[13px] font-semibold text-muted-foreground">편집</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-12 text-muted-foreground">
                  <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">등록된 자재가 없습니다</p>
                </td>
              </tr>
            ) : filtered.map((m: any) => {
              const isChecked = selectedIds.has(m.id);
              return (
                <tr key={m.id} className={`border-b border-border hover:bg-[var(--fill-quaternary)] ${isChecked ? 'bg-primary/5' : ''}`}>
                  <td>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(m.id)}
                      className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                    />
                  </td>
                  <td className="w-14">
                    {m.imageUrl ? (
                      <HoverZoomImage
                        src={m.imageUrl}
                        alt={m.name}
                        className="w-10 h-10 rounded-md border border-border overflow-hidden cursor-zoom-in"
                        imgClassName="w-10 h-10 object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-[var(--fill-tertiary)] border border-border flex items-center justify-center">
                        <Package size={16} className="text-muted-foreground" />
                      </div>
                    )}
                  </td>
                  <td className="w-32">
                    <span className="font-mono text-xs bg-[var(--fill-tertiary)] px-2 py-0.5 rounded text-muted-foreground whitespace-nowrap">{m.itemCode || '—'}</span>
                  </td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${CHIP}`}>{m.category}</span>
                    {m.subType && <p className="text-xs text-muted-foreground mt-0.5">{m.subType}</p>}
                  </td>
                  <td>
                    {(m.brand || COMMON_BRAND) === COMMON_BRAND
                      ? <span className="text-xs text-muted-foreground">{COMMON_BRAND}</span>
                      : <span className={`text-xs px-2 py-0.5 rounded-full border ${CHIP}`}>{m.brand}</span>}
                  </td>
                  <td>
                    <button type="button" onClick={() => setDetail(m)} className="text-left hover:underline">
                      <p className="font-medium text-foreground">{m.name}</p>
                      {m.nameEn && <p className="text-xs text-muted-foreground">{m.nameEn}</p>}
                    </button>
                  </td>
                  <td className="text-xs text-muted-foreground">{m.spec || '—'}</td>
                  <td className="nw num font-mono text-xs text-foreground">
                    {priceOf(m) != null
                      ? `${CURRENCY_SIGN[currencyOf(m)]}${Number(priceOf(m)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                      : '—'}
                  </td>
                  <td className="text-xs text-muted-foreground">{m.unit}</td>
                  
                  <td>
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setDetail(m)} title="상세보기" className="p-1.5 rounded hover:bg-[var(--fill-tertiary)] text-muted-foreground">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => openHistory(m)} title="단가 이력" className="p-1.5 rounded hover:bg-[var(--fill-tertiary)] text-muted-foreground">
                        <History size={14} />
                      </button>
                      <button onClick={() => openEdit(m)} title="수정" className="p-1.5 rounded hover:bg-[var(--fill-tertiary)] text-muted-foreground">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(m.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-[var(--system-red)]">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 단가 이력 — 언제 얼마였는지 (협상 근거) */}
      <Dialog open={!!historyOf} onOpenChange={o => { if (!o) setHistoryOf(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>단가 이력 — {historyOf?.name}</DialogTitle></DialogHeader>
          {historyLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : history.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">아직 기록이 없습니다</p>
              <p className="text-xs text-muted-foreground mt-1">단가를 수정하면 이때부터 한 줄씩 쌓입니다</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto border border-border rounded-md">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="nw">변경일</th>
                    <th className="num">단가</th>
                    <th className="num">변동</th>
                    <th>공급업체</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => {
                    const diff = h.prevPrice != null ? h.unitPrice - h.prevPrice : null;
                    const rate = h.prevPrice ? Math.round((diff! / h.prevPrice) * 1000) / 10 : null;
                    return (
                      <tr key={h.id}>
                        <td className="nw text-xs text-muted-foreground">{h.changedAt.slice(0, 10)}</td>
                        <td className="num font-medium">{CURRENCY_SIGN[(h.currency as PriceCurrency) || 'KRW']}{h.unitPrice.toLocaleString()}</td>
                        <td className={`num text-xs ${diff == null ? 'text-muted-foreground' : diff > 0 ? 'text-[var(--system-red)]' : 'text-[var(--system-green)]'}`}>
                          {diff == null ? '최초' : `${diff > 0 ? '+' : ''}${diff.toLocaleString()}${rate != null ? ` (${rate > 0 ? '+' : ''}${rate}%)` : ''}`}
                        </td>
                        <td className="text-xs text-muted-foreground">{h.vendorName || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOf(null)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 등록/수정 모달 */}
      {/* 자재 상세보기 */}
      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{detail?.name || '자재 상세'}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="flex gap-4">
                {detail.imageUrl ? (
                  <HoverZoomImage src={detail.imageUrl} alt={detail.name}
                    className="w-28 h-28 rounded-md border border-border overflow-hidden cursor-zoom-in shrink-0"
                    imgClassName="w-28 h-28 object-cover" />
                ) : (
                  <div className="w-28 h-28 rounded-md bg-[var(--fill-tertiary)] border border-border flex items-center justify-center shrink-0">
                    <Package size={24} className="text-muted-foreground" />
                  </div>
                )}
                <dl className="text-sm space-y-1 flex-1 min-w-0">
                  {[
                    ['품번', detail.itemCode],
                    ['카테고리', [detail.category, detail.subType].filter(Boolean).join(' · ')],
                    ['브랜드', detail.brand || COMMON_BRAND],
                    ['스펙', detail.spec],
                    ['단위', detail.unit],
                    ['단가', priceOf(detail) != null ? `${CURRENCY_SIGN[currencyOf(detail)]}${Number(priceOf(detail)).toLocaleString()}` : null],
                    ['시즌', detail.season],
                  ].filter(([, v]) => v).map(([k, v]) => (
                    <div key={String(k)} className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground text-xs pt-0.5">{k}</dt>
                      <dd className="text-foreground break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {(detail.platingPrices || []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">도금 컬러별 단가</p>
                  <div className="rounded-md border border-border divide-y divide-border">
                    {(detail.platingPrices || []).map((r: any) => (
                      <div key={r.color} className="flex items-center justify-between px-3 py-1.5 text-sm">
                        <span>{r.color}</span>
                        <span className="font-mono">
                          {r.price != null ? `${CURRENCY_SIGN[r.currency || currencyOf(detail)] || ''}${Number(r.price).toLocaleString()}` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(detail.moldCostAmount != null || detail.moldCost) && (
                <p className="text-sm">
                  <span className="text-muted-foreground text-xs mr-2">금형비</span>
                  {detail.moldCostAmount != null
                    ? `${CURRENCY_SIGN[detail.moldCostCurrency || currencyOf(detail)] || ''}${Number(detail.moldCostAmount).toLocaleString()}`
                    : detail.moldCost}
                </p>
              )}
              {detail.memo && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detail.memo}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDetail(null)}>닫기</Button>
                <Button onClick={() => { const m = detail; setDetail(null); openEdit(m); }}>수정</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? '자재 수정' : '자재 등록'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 이미지 업로드 */}
            <div className="space-y-2">
              <Label>이미지</Label>
              <div className="flex items-center gap-3">
                <div
                  className={`w-20 h-20 rounded-lg border border-dashed flex items-center justify-center cursor-pointer transition-colors overflow-hidden ${dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary'}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleImageDrop}
                >
                  {previewImage ? (
                    <img src={previewImage} alt="미리보기" className="w-full h-full object-cover" />
                  ) : (
                    <Package className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="text-xs">
                    이미지 선택
                  </Button>
                  {previewImage && (
                    <Button type="button" variant="ghost" size="sm" className="text-xs text-[var(--system-red)]" onClick={() => { setPreviewImage(null); setForm(prev => ({ ...prev, imageUrl: undefined })); }}>
                      삭제
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">끌어다 놓기도 가능 · 최대 800px, JPEG 자동 변환</p>
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </div>

            {/* 카테고리 + 세부 타입 (가죽·장식만) */}
            <div className={subTypeOptions.length > 0 ? 'grid grid-cols-2 gap-3' : 'space-y-1.5'}>
              <div className="space-y-1.5">
                <Label>카테고리 *</Label>
                <Select value={form.category || '가죽'} onValueChange={v => {
                  const cat = v as MaterialCategory;
                  // 카테고리가 바뀌면 이전 카테고리의 세부 타입은 무효 → 비운다
                  setForm(prev => ({ ...prev, category: cat, subType: '', itemCode: editId ? prev.itemCode : nextCode(cat, prev.brand) }));
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MATERIAL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {subTypeOptions.length > 0 && (
                <div className="space-y-1.5">
                  <Label>{form.category === '장식' ? '장식 분류' : '가죽 타입'}</Label>
                  <SearchSelect
                    value={form.subType || ''}
                    options={subTypeOptions}
                    placeholder={form.category === '장식' ? '버클 / 링 / 프레임 …' : '소가죽 / 양가죽 …'}
                    onChange={v => setForm(prev => ({ ...prev, subType: v }))}
                  />
                </div>
              )}
            </div>

            {/* 브랜드 — 공통 / 브랜드 전용(바이어 검색 선택) */}
            <div className="space-y-1.5">
              <Label>브랜드</Label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer whitespace-nowrap">
                  <input type="radio" checked={isCommonBrand} onChange={() => setForm(prev => ({ ...prev, brand: COMMON_BRAND, itemCode: editId ? prev.itemCode : nextCode((prev.category as MaterialCategory) || '가죽') }))} className="w-4 h-4 accent-primary" />
                  공통
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer whitespace-nowrap">
                  <input type="radio" checked={!isCommonBrand} onChange={() => setForm(prev => ({ ...prev, brand: '' }))} className="w-4 h-4 accent-primary" />
                  브랜드 전용
                </label>
                <div className="flex-1">
                  <SearchSelect
                    value={isCommonBrand ? '' : (form.brand || '')}
                    options={buyerNames}
                    placeholder="바이어 선택"
                    disabled={isCommonBrand}
                    onChange={v => setForm(prev => ({ ...prev, brand: v, itemCode: editId ? prev.itemCode : nextCode((prev.category as MaterialCategory) || '가죽', v) }))}
                  />
                </div>
              </div>
              {buyerNames.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  <Link href="/vendors" className="underline">거래처 마스터</Link>에 바이어를 먼저 등록하세요
                </p>
              )}
            </div>

            {/* 품번 — 카테고리별 자동채번 (가죽 L01 · 원단 W01 · 장식 H01 …) */}
            <div className="space-y-1.5">
              <Label>품번</Label>
              <div className="flex gap-2">
                <Input value={form.itemCode || ''} onChange={e => setForm(prev => ({ ...prev, itemCode: e.target.value }))} placeholder="L2608-01" className="w-36 font-mono" />
                <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setForm(prev => ({ ...prev, itemCode: nextCode((prev.category as MaterialCategory) || '가죽', prev.brand) }))}>다시 생성</Button>
              </div>
            </div>
            {/* 자재명 */}
            <div className="space-y-1.5">
              <Label>자재명 *</Label>
              <Input value={form.name || ''} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="소가죽 (블랙)" />
            </div>

            {/* 스펙 */}
            <div className="space-y-1.5">
              <Label>스펙</Label>
              <Input value={form.spec || ''} onChange={e => setForm(prev => ({ ...prev, spec: e.target.value }))} placeholder="두께 1.2mm / 폭 54인치" />
            </div>

            {/* 단위 + 단가 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>단위 *</Label>
                <Select value={form.unit || 'YD'} onValueChange={v => setForm(prev => ({ ...prev, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>단가</Label>
                <div className="flex gap-2">
                  <Input
                    type="number" min="0" step="0.01" className="flex-1"
                    value={priceOf(form) ?? ''}
                    onChange={e => setPrice(e.target.value === '' ? undefined : Number(e.target.value), currencyOf(form))}
                    placeholder="0"
                  />
                  <Select value={currencyOf(form)} onValueChange={v => setPrice(priceOf(form), v as PriceCurrency)}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* 장식 전용 — 도금컬러별 단가 · 금형비 · 시즌 */}
            {form.category === '장식' && (
              <>
              {/* 도금 컬러별 단가 — 자재는 하나인데 컬러마다 단가가 다르다 */}
              <div className="space-y-1.5">
                <Label>도금 컬러별 단가</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <SearchSelect
                      value={platingPick}
                      options={PLATING_COLORS.filter(c => !(form.platingPrices || []).some(p => p.color === c))}
                      placeholder="컬러 선택 후 추가"
                      onChange={setPlatingPick}
                    />
                  </div>
                  <Button type="button" variant="outline" onClick={addPlatingColor}>추가</Button>
                </div>
                {(form.platingPrices || []).length > 0 && (
                  <div className="space-y-1.5 p-2 rounded-md bg-[var(--fill-quaternary)] border border-border">
                    {(form.platingPrices || []).map((row, i) => (
                      <div key={row.color} className="flex items-center gap-2">
                        <span className="text-sm flex-1 truncate">{row.color}</span>
                        <Input
                          type="number" min="0" step="0.01" className="w-32 h-8"
                          value={row.price ?? ''}
                          placeholder="단가"
                          onChange={e => updatePlating(i, { price: e.target.value === '' ? undefined : Number(e.target.value) })}
                        />
                        <Select value={row.currency || currencyOf(form)} onValueChange={v => updatePlating(i, { currency: v })}>
                          <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <button type="button" onClick={() => removePlating(i)}
                          className="text-muted-foreground hover:text-[var(--system-red)] px-1">×</button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">컬러를 추가하면 컬러마다 단가를 따로 넣을 수 있습니다.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>금형비</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number" min="0" step="0.01" className="flex-1"
                      value={form.moldCostAmount ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, moldCostAmount: e.target.value === '' ? undefined : Number(e.target.value) }))}
                      placeholder="0"
                    />
                    <Select
                      value={form.moldCostCurrency || currencyOf(form)}
                      onValueChange={v => setForm(prev => ({ ...prev, moldCostCurrency: v }))}
                    >
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>시즌</Label>
                  <Input value={form.season || ''} onChange={e => setForm(prev => ({ ...prev, season: e.target.value }))} placeholder="27ss" />
                </div>
              </div>
              </>
            )}

            {/* 공급업체 — 거래처 마스터의 자재거래처만 */}
            <div className="space-y-1.5">
              <Label>공급업체</Label>
              <SearchSelect
                value={vendorQuery}
                options={supplierNames}
                placeholder="공급업체 선택"
                onChange={name => {
                  setVendorQuery(name);
                  const hit = allVendors.find((v: Vendor) => v.name === name);
                  setForm(prev => ({ ...prev, vendorId: hit ? hit.id : '' }));
                }}
              />
              {supplierNames.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  <Link href="/vendors" className="underline">거래처 마스터</Link>에 자재거래처를 먼저 등록하세요
                </p>
              )}
            </div>

            {/* 공장 보유 재고 — 재고를 쌓아두진 않지만 가죽·장식은 남는다.
                발주 전에 공장에 확인한 결과를 적어두면 다음 발주 때 덜 시킬 수 있다 */}
            <div className="space-y-1.5">
              <Label>공장 보유 <span className="opt">확인한 경우만</span></Label>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  type="number" step="0.001" min="0"
                  value={form.factoryStockQty ?? ''}
                  onChange={e => setForm(prev => ({
                    ...prev,
                    factoryStockQty: e.target.value === '' ? undefined : Number(e.target.value),
                    factoryStockCheckedAt: e.target.value === '' ? undefined : (prev.factoryStockCheckedAt || new Date().toISOString().split('T')[0]),
                  }))}
                  placeholder={`남은 수량 (${form.unit || ''})`}
                />
                <Input
                  type="date" className="w-40"
                  value={form.factoryStockCheckedAt || ''}
                  onChange={e => setForm(prev => ({ ...prev, factoryStockCheckedAt: e.target.value || undefined }))}
                  title="확인한 날"
                />
              </div>
              <Input
                value={form.factoryStockNote || ''}
                onChange={e => setForm(prev => ({ ...prev, factoryStockNote: e.target.value }))}
                placeholder="예: 블랙만 남음 / 다음 발주까지 보관 요청"
              />
            </div>

            {/* 메모 */}
            <div className="space-y-1.5">
              <Label>메모</Label>
              <Input value={form.memo || ''} onChange={e => setForm(prev => ({ ...prev, memo: e.target.value }))} placeholder="비고" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave}>{editId ? '수정' : '등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
