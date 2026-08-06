// AMESCOTES ERP — 자재 마스터 (Supabase 전환 완료)
import { useState, useEffect, useMemo, useRef } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { store, genId, MATERIAL_CATEGORIES, COMMON_BRAND, type Material, type MaterialCategory, type Vendor } from '@/lib/store';
import { Link } from 'wouter';
import { fetchMaterials, upsertMaterial, deleteMaterial as deleteMaterialSB, fetchVendors, updateMaterialStatus } from '@/lib/supabaseQueries';
import { resizeImage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Trash2, Package } from 'lucide-react';

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
  const [search, setSearch] = usePersistedState('materials.search', '');
  const [filterCat, setFilterCat] = usePersistedState('materials.filterCat', 'all');
  const [filterBrand, setFilterBrand] = usePersistedState('materials.filterBrand', 'all');
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Material>>({ ...emptyForm });
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [vendorQuery, setVendorQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    let list = materials as any[];
    if (filterCat !== 'all') list = list.filter((m: any) => m.category === filterCat);
    if (filterBrand !== 'all') list = list.filter((m: any) => (m.brand || COMMON_BRAND) === filterBrand);
    if (search) list = list.filter((m: any) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.nameEn || '').toLowerCase().includes(search.toLowerCase()) ||
      (m.spec || '').toLowerCase().includes(search.toLowerCase())
    );
    return list;
  }, [materials, filterCat, filterBrand, search]);

  const nextCode = (cat: MaterialCategory) => store.getNextItemCode(cat, materials as Material[]);

  const openNew = () => {
    setForm({ ...emptyForm, itemCode: nextCode(emptyForm.category as MaterialCategory) });
    setPreviewImage(null);
    setVendorQuery('');
    setEditId(null);
    setShowModal(true);
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

    const mat = {
      ...form,
      id: editId || genId(),
      createdAt: new Date().toISOString(),
    };

    try {
      await upsertMaterial(mat);
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

      {/* KPI by category */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterCat('all')}
          className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${filterCat === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-[var(--fill-quaternary)]'}`}
        >
          전체 ({(materials as any[]).length})
        </button>
        {MATERIAL_CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCat(cat)}
            className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${filterCat === cat ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-[var(--fill-quaternary)]'}`}
          >
            {cat} ({catCounts[cat] || 0})
          </button>
        ))}
      </div>

      {/* 브랜드 필터 — 공통 + 거래처 마스터의 바이어 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">브랜드</span>
        {['all', ...brands].map(b => (
          <button
            key={b}
            onClick={() => setFilterBrand(b)}
            className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${filterBrand === b ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-[var(--fill-quaternary)]'}`}
          >
            {b === 'all' ? '전체' : b} ({b === 'all' ? (materials as any[]).length : brandCounts[b] || 0})
          </button>
        ))}
        <Link href="/vendors" className="px-3 py-1.5 rounded-md text-xs border border-dashed border-border text-muted-foreground hover:bg-[var(--fill-quaternary)]">
          + 거래처 마스터에서 추가
        </Link>
      </div>

      {/* 검색 */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="자재명 / 영문명 / 스펙 검색" className="pl-9 h-9" />
      </div>

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
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-[var(--fill-quaternary)]">
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                />
              </th>
              <th className="text-left px-3 py-3 text-[13px] font-semibold text-muted-foreground">품번</th>
              <th className="text-left px-3 py-3 text-[13px] font-semibold text-muted-foreground">카테고리</th>
              <th className="text-left px-3 py-3 text-[13px] font-semibold text-muted-foreground">브랜드</th>
              <th className="text-left px-3 py-3 text-[13px] font-semibold text-muted-foreground">자재명</th>
              <th className="text-left px-3 py-3 text-[13px] font-semibold text-muted-foreground">스펙</th>
              <th className="text-right px-3 py-3 text-[13px] font-semibold text-muted-foreground">단가</th>
              <th className="text-left px-3 py-3 text-[13px] font-semibold text-muted-foreground">단위</th>
              
              <th className="text-center px-3 py-3 text-[13px] font-semibold text-muted-foreground">편집</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-12 text-muted-foreground">
                  <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">등록된 자재가 없습니다</p>
                </td>
              </tr>
            ) : filtered.map((m: any) => {
              const isChecked = selectedIds.has(m.id);
              return (
                <tr key={m.id} className={`border-b border-border hover:bg-[var(--fill-quaternary)] ${isChecked ? 'bg-primary/5' : ''}`}>
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(m.id)}
                      className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2.5 w-16">
                    <span className="font-mono text-xs bg-[var(--fill-tertiary)] px-2 py-0.5 rounded text-muted-foreground">{m.itemCode || '—'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${CHIP}`}>{m.category}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {(m.brand || COMMON_BRAND) === COMMON_BRAND
                      ? <span className="text-xs text-muted-foreground">{COMMON_BRAND}</span>
                      : <span className={`text-xs px-2 py-0.5 rounded-full border ${CHIP}`}>{m.brand}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-foreground">{m.name}</p>
                    {m.nameEn && <p className="text-xs text-muted-foreground">{m.nameEn}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{m.spec || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-foreground">
                    {priceOf(m) != null
                      ? `${CURRENCY_SIGN[currencyOf(m)]}${Number(priceOf(m)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{m.unit}</td>
                  
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEdit(m)} className="p-1.5 rounded hover:bg-[var(--fill-tertiary)] text-muted-foreground">
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

      {/* 등록/수정 모달 */}
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

            {/* 카테고리 + 브랜드 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>카테고리 *</Label>
                <Select value={form.category || '가죽'} onValueChange={v => {
                  const cat = v as MaterialCategory;
                  setForm(prev => ({ ...prev, category: cat, itemCode: editId ? prev.itemCode : nextCode(cat) }));
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MATERIAL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>브랜드</Label>
                <Select value={form.brand || COMMON_BRAND} onValueChange={v => setForm(prev => ({ ...prev, brand: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  브랜드 전용 자재만 지정 · 목록 추가는 <Link href="/vendors" className="underline">거래처 마스터</Link>
                </p>
              </div>
            </div>

            {/* 품번 — 카테고리별 자동채번 (가죽 L01 · 원단 W01 · 장식 H01 …) */}
            <div className="space-y-1.5">
              <Label>품번</Label>
              <div className="flex gap-2">
                <Input value={form.itemCode || ''} onChange={e => setForm(prev => ({ ...prev, itemCode: e.target.value }))} placeholder="L01" className="w-28 font-mono" />
                <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setForm(prev => ({ ...prev, itemCode: nextCode((prev.category as MaterialCategory) || '가죽') }))}>다시 생성</Button>
                <span className="text-xs text-muted-foreground self-center">가죽 L · 원단 W · 장식 H · 지퍼 Z · 보강재 R · 봉사 T · 포장재 P · 철형 I · 후가공 F</span>
              </div>
            </div>
            {/* 자재명 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>자재명 *</Label>
                <Input value={form.name || ''} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="소가죽 (블랙)" />
              </div>
              <div className="space-y-1.5">
                <Label>영문명</Label>
                <Input value={form.nameEn || ''} onChange={e => setForm(prev => ({ ...prev, nameEn: e.target.value }))} placeholder="Cow Leather Black" />
              </div>
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
                    type="number" step="0.01" className="flex-1"
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

            {/* 공급업체 — 거래처 마스터 전체에서 검색 선택 */}
            <div className="space-y-1.5">
              <Label>공급업체</Label>
              <Input
                list="material-vendor-options"
                value={vendorQuery}
                onChange={e => {
                  const text = e.target.value;
                  setVendorQuery(text);
                  const hit = allVendors.find((v: Vendor) => v.name === text);
                  setForm(prev => ({ ...prev, vendorId: hit ? hit.id : '' }));
                }}
                placeholder="거래처명 검색 (예: 홍콩원단)"
              />
              <datalist id="material-vendor-options">
                {allVendors.filter((v: Vendor) => v.id?.trim()).map((v: Vendor) => (
                  <option key={v.id} value={v.name}>{v.type}</option>
                ))}
              </datalist>
              {vendorQuery && !form.vendorId && (
                <p className="text-xs text-[var(--system-red)]">목록에 없는 거래처입니다 — 거래처 마스터에 먼저 등록하세요</p>
              )}
              {allVendors.length === 0 && <p className="text-xs text-muted-foreground">등록된 거래처가 없습니다</p>}
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
