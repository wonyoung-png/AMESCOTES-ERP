// AMESCOTES ERP — 자재 마스터 (Supabase 전환 완료)
import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { genId, type Material, type MaterialCategory, type Vendor } from '@/lib/store';
import { fetchMaterials, upsertMaterial, deleteMaterial as deleteMaterialSB, fetchVendors, updateMaterialStatus } from '@/lib/supabaseQueries';
import { resizeImage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Trash2, Package } from 'lucide-react';

const MATERIAL_CATEGORIES: MaterialCategory[] = ['원자재', '지퍼', '장식', '보강재', '봉사·접착제', '포장재', '철형', '후가공'];
const UNITS = ['SF', 'YD', 'M', 'EA', 'L', '콘', 'KG', 'SET', '장', '개', 'PC', 'CM'];

const CATEGORY_ICON: Record<MaterialCategory, string> = {
  '원자재': '🧴',
  '지퍼': '🔗',
  '장식': '✨',
  '보강재': '🛡️',
  '봉사·접착제': '🧵',
  '포장재': '📦',
  '철형': '🔩',
  '후가공': '🎨',
};

const CATEGORY_COLOR: Record<MaterialCategory, string> = {
  '원자재': 'bg-amber-50 text-amber-700 border-amber-200',
  '지퍼': 'bg-blue-50 text-blue-700 border-blue-200',
  '장식': 'bg-purple-50 text-purple-700 border-purple-200',
  '보강재': 'bg-stone-50 text-stone-600 border-stone-200',
  '봉사·접착제': 'bg-green-50 text-green-700 border-green-200',
  '포장재': 'bg-orange-50 text-orange-700 border-orange-200',
  '철형': 'bg-slate-50 text-slate-700 border-slate-200',
  '후가공': 'bg-rose-50 text-rose-700 border-rose-200',
};

const emptyForm: Partial<Material> = {
  name: '', nameEn: '', category: '원자재', spec: '', unit: 'YD',
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
  const vendors = allVendors.filter((v: Vendor) => v.type === '자재거래처');
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Material>>({ ...emptyForm });
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    let list = materials as any[];
    if (filterCat !== 'all') list = list.filter((m: any) => m.category === filterCat);
    if (search) list = list.filter((m: any) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.nameEn || '').toLowerCase().includes(search.toLowerCase()) ||
      (m.spec || '').toLowerCase().includes(search.toLowerCase())
    );
    return list;
  }, [materials, filterCat, search]);

  const openNew = () => {
    setForm({ ...emptyForm });
    setPreviewImage(null);
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (m: any) => {
    setForm({ ...m });
    setPreviewImage(m.imageUrl || null);
    setEditId(m.id);
    setShowModal(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await resizeImage(file);
      setForm(prev => ({ ...prev, imageUrl: base64 }));
      setPreviewImage(base64);
    } catch {
      toast.error('이미지 업로드 실패');
    }
  };

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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">자재 마스터</h1>
          <p className="text-sm text-stone-500 mt-0.5">원자재·부자재 단가 등록 · BOM 자동 연결</p>
          {materialsLoading && <p className="text-xs text-blue-500">로딩 중...</p>}
          {materialsError && <p className="text-xs text-red-500">오류: {String(materialsError)}</p>}
          <p className="text-xs text-stone-400">총 {materials.length}건 (표시: {filtered.length}건)</p>
        </div>
        <Button onClick={openNew} className="bg-[#C9A96E] hover:bg-[#B8985D] text-white gap-2">
          <Plus size={16} />자재 등록
        </Button>
      </div>

      {/* KPI by category */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterCat('all')}
          className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${filterCat === 'all' ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'}`}
        >
          전체 ({(materials as any[]).length})
        </button>
        {MATERIAL_CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCat(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${filterCat === cat ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'}`}
          >
            {CATEGORY_ICON[cat]} {cat} ({catCounts[cat] || 0})
          </button>
        ))}
      </div>

      {/* 검색 */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="자재명 / 영문명 / 스펙 검색" className="pl-9 h-9" />
      </div>

      {/* 다중 선택 액션 바 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-800 text-white rounded-xl">
          <span className="text-sm font-medium">{selectedIds.size}개 선택됨</span>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            🗑️ 선택 삭제
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="flex items-center gap-1 px-3 py-1.5 bg-stone-600 hover:bg-stone-500 text-white rounded-lg text-xs font-medium transition-colors"
          >
            ✕ 선택 해제
          </button>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-stone-300 accent-[#C9A96E] cursor-pointer"
                />
              </th>
              <th className="text-left px-3 py-3 text-xs font-medium text-stone-500">품번</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-stone-500">카테고리</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-stone-500">자재명</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-stone-500">스펙</th>
              <th className="text-right px-3 py-3 text-xs font-medium text-stone-500">단가 (CNY)</th>
              <th className="text-right px-3 py-3 text-xs font-medium text-stone-500">단가 (KRW)</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-stone-500">단위</th>
              
              <th className="text-center px-3 py-3 text-xs font-medium text-stone-500">편집</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-12 text-stone-400">
                  <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">등록된 자재가 없습니다</p>
                </td>
              </tr>
            ) : filtered.map((m: any) => {
              const isChecked = selectedIds.has(m.id);
              return (
                <tr key={m.id} className={`border-b border-stone-50 hover:bg-stone-50/50 ${isChecked ? 'bg-amber-50/60' : ''}`}>
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(m.id)}
                      className="w-4 h-4 rounded border-stone-300 accent-[#C9A96E] cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2.5 w-16">
                    <span className="font-mono text-xs bg-stone-100 px-2 py-0.5 rounded text-stone-600">{m.itemCode || '—'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_COLOR[m.category as MaterialCategory] || 'bg-stone-50 text-stone-600 border-stone-200'}`}>
                      {m.category}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-stone-800">{m.name}</p>
                    {m.nameEn && <p className="text-xs text-stone-400">{m.nameEn}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-stone-500">{m.spec || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-stone-700">
                    {m.unitPriceCny != null ? `¥${Number(m.unitPriceCny).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-stone-700">
                    {m.unitPriceKrw != null ? `₩${Number(m.unitPriceKrw).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-stone-600">{m.unit}</td>
                  
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEdit(m)} className="p-1.5 rounded hover:bg-stone-100 text-stone-500">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(m.id)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500">
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
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? '자재 수정' : '자재 등록'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 이미지 업로드 */}
            <div className="space-y-2">
              <Label>이미지</Label>
              <div className="flex items-center gap-3">
                <div
                  className="w-20 h-20 rounded-xl border-2 border-dashed border-stone-200 flex items-center justify-center cursor-pointer hover:border-amber-400 transition-colors overflow-hidden"
                  onClick={() => fileRef.current?.click()}
                >
                  {previewImage ? (
                    <img src={previewImage} alt="미리보기" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl">{CATEGORY_ICON[form.category as MaterialCategory || '원자재']}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="text-xs">
                    이미지 선택
                  </Button>
                  {previewImage && (
                    <Button type="button" variant="ghost" size="sm" className="text-xs text-red-500" onClick={() => { setPreviewImage(null); setForm(prev => ({ ...prev, imageUrl: undefined })); }}>
                      삭제
                    </Button>
                  )}
                  <p className="text-xs text-stone-400">최대 800px, JPEG 자동 변환</p>
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </div>

            {/* 카테고리 */}
            <div className="space-y-1.5">
              <Label>카테고리 *</Label>
              <Select value={form.category || '원자재'} onValueChange={v => {
                const newCode = !editId ? store.getNextItemCode(v as MaterialCategory) : form.itemCode;
                setForm(prev => ({ ...prev, category: v as MaterialCategory, itemCode: newCode || prev.itemCode }));
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MATERIAL_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_ICON[c]} {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 품번 */}
            <div className="space-y-1.5">
              <Label>품번</Label>
              <div className="flex gap-2">
                <Input value={form.itemCode || ''} onChange={e => setForm(prev => ({ ...prev, itemCode: e.target.value }))} placeholder="M01" className="w-24 font-mono" />
                <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setForm(prev => ({ ...prev, itemCode: store.getNextItemCode(prev.category as any || '원자재') }))}>자동생성</Button>
                <span className="text-xs text-stone-400 self-center">카테고리별 자동: M01, Z01, H01...</span>
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
              <div className="space-y-1.5">
                <Label>단가 (CNY)</Label>
                <Input type="number" step="0.01" value={form.unitPriceCny ?? ''} onChange={e => setForm(prev => ({ ...prev, unitPriceCny: e.target.value === '' ? undefined : Number(e.target.value) }))} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>단가 (KRW)</Label>
                <Input type="number" value={form.unitPriceKrw ?? ''} onChange={e => setForm(prev => ({ ...prev, unitPriceKrw: e.target.value === '' ? undefined : Number(e.target.value) }))} placeholder="0" />
              </div>
            </div>

            {/* 공급업체 */}
            <div className="space-y-1.5">
              <Label>주 공급업체</Label>
              <Select value={form.vendorId || 'none'} onValueChange={v => setForm(prev => ({ ...prev, vendorId: v === 'none' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="공급업체 선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">선택 없음</SelectItem>
                  {vendors.filter((v: any) => v.id && v.id.trim() !== '').map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {vendors.length === 0 && (
                <p className="text-xs text-stone-400">자재거래처 타입의 거래처를 먼저 등록하세요</p>
              )}
            </div>

            {/* 메모 */}
            <div className="space-y-1.5">
              <Label>메모</Label>
              <Input value={form.memo || ''} onChange={e => setForm(prev => ({ ...prev, memo: e.target.value }))} placeholder="비고" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave} className="bg-[#C9A96E] hover:bg-[#B8985D] text-white">{editId ? '수정' : '등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
