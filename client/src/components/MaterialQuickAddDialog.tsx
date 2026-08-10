// BOM에서 자재 마스터에 없는 자재를 바로 등록하는 다이얼로그.
// 자재 마스터 등록 모달과 같은 항목·같은 채번 규칙을 쓴다 (페이지 이동 없음).
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  store, genId, MATERIAL_CATEGORIES, MATERIAL_SUB_TYPES, COMMON_BRAND,
  type Material, type MaterialCategory, type Vendor,
} from '@/lib/store';
import { fetchMaterials, fetchVendors, upsertMaterial } from '@/lib/supabaseQueries';

const UNITS = ['SF', 'YD', 'M', 'EA', 'L', '콘', 'KG', 'SET', '장', '개', 'PC', 'CM'];
const CURRENCIES = ['KRW', 'CNY', 'USD'] as const;

export function MaterialQuickAddDialog({ open, onOpenChange, defaultName, defaultUnit, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** BOM 행에 적혀 있던 자재명 — 그대로 채워두고 필요하면 고친다 */
  defaultName?: string;
  defaultUnit?: string;
  onSaved: (m: Material) => void;
}) {
  const queryClient = useQueryClient();
  const { data: materials = [] } = useQuery({ queryKey: ['materials'], queryFn: fetchMaterials });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });

  const [form, setForm] = useState<Record<string, any>>({});
  const buyers = (vendors as Vendor[]).filter(v => v.type === '바이어');
  const suppliers = (vendors as Vendor[]).filter(v => v.type === '자재거래처');
  // brand === '' 는 "브랜드 전용을 골랐지만 바이어 미선택" 상태 — 공통과 구분해야 라디오가 바뀐다
  const isCommonBrand = form.brand === undefined || form.brand === COMMON_BRAND;
  const subTypeOptions = MATERIAL_SUB_TYPES[(form.category as MaterialCategory) || '가죽'] ?? [];

  const brandCodeOf = (brandName?: string) => {
    if (!brandName || brandName === COMMON_BRAND) return undefined;
    return (vendors as Vendor[]).find(v => v.name === brandName)?.code || undefined;
  };
  const nextCode = (cat: MaterialCategory, brand?: string) =>
    store.getNextItemCode(cat, materials as Material[], brandCodeOf(brand));

  // 열릴 때마다 BOM 행 값으로 초기화
  useEffect(() => {
    if (!open) return;
    const cat: MaterialCategory = '가죽';
    setForm({
      name: defaultName || '',
      unit: defaultUnit || 'SF',
      category: cat,
      brand: COMMON_BRAND,
      priceCurrency: 'KRW',
      itemCode: nextCode(cat),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultName, defaultUnit]);

  const save = async () => {
    if (!form.name?.trim()) { toast.error('자재명을 입력하세요'); return; }
    if (!form.unit) { toast.error('단위를 선택하세요'); return; }
    if (!isCommonBrand && !buyers.some(b => b.name === form.brand)) {
      toast.error('브랜드 전용이면 바이어를 선택하세요'); return;
    }
    const mat: Record<string, any> = {
      ...form, name: form.name.trim(), id: genId(), createdAt: new Date().toISOString(),
    };
    try {
      await upsertMaterial(mat);
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      toast.success(`${mat.name} — 자재 마스터에 등록했습니다`);
      onSaved(mat as Material);
      onOpenChange(false);
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>자재 등록</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>카테고리 *</Label>
              <Select
                value={form.category || '가죽'}
                onValueChange={v => setForm(f => ({
                  ...f, category: v, subType: '',
                  itemCode: nextCode(v as MaterialCategory, f.brand),
                }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MATERIAL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {subTypeOptions.length > 0 && (
              <div className="space-y-1.5">
                <Label>세부 타입</Label>
                <Select value={form.subType || ''} onValueChange={v => setForm(f => ({ ...f, subType: v }))}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {subTypeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>브랜드</Label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer whitespace-nowrap">
                <input type="radio" checked={isCommonBrand}
                  onChange={() => setForm(f => ({ ...f, brand: COMMON_BRAND, itemCode: nextCode((f.category as MaterialCategory) || '가죽') }))}
                  className="w-4 h-4 accent-primary" />공통
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer whitespace-nowrap">
                <input type="radio" checked={!isCommonBrand}
                  onChange={() => setForm(f => ({ ...f, brand: '' }))}
                  className="w-4 h-4 accent-primary" />브랜드 전용
              </label>
              <div className="flex-1">
                <Select
                  value={isCommonBrand ? '' : (form.brand || '')}
                  disabled={isCommonBrand}
                  onValueChange={v => setForm(f => ({ ...f, brand: v, itemCode: nextCode((f.category as MaterialCategory) || '가죽', v) }))}
                >
                  <SelectTrigger className="h-9"><SelectValue placeholder="바이어 선택" /></SelectTrigger>
                  <SelectContent>
                    {buyers.map(b => (
                      <SelectItem key={b.id} value={b.name}>{b.brands?.[0] || b.nameEn || b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>품번</Label>
            <div className="flex gap-2">
              <Input value={form.itemCode || ''} readOnly className="w-40 font-mono bg-[var(--fill-tertiary)] text-muted-foreground" />
              <Button type="button" variant="outline" size="sm" className="text-xs"
                onClick={() => setForm(f => ({ ...f, itemCode: nextCode((f.category as MaterialCategory) || '가죽', f.brand) }))}>다시 생성</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>자재명 *</Label>
            <Input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="소가죽 (블랙)" />
          </div>

          <div className="space-y-1.5">
            <Label>스펙</Label>
            <Input value={form.spec || ''} onChange={e => setForm(f => ({ ...f, spec: e.target.value }))} placeholder="두께 1.2mm / 폭 54인치" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>단위 *</Label>
              <Select value={form.unit || 'SF'} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>단가</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.01" className="flex-1"
                  value={form.unitPrice ?? ''}
                  onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  placeholder="0" />
                <Select value={form.priceCurrency || 'KRW'} onValueChange={v => setForm(f => ({ ...f, priceCurrency: v }))}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>공급업체</Label>
            <Select value={form.vendorId || 'none'} onValueChange={v => setForm(f => ({ ...f, vendorId: v === 'none' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="공급업체 선택" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">미지정</SelectItem>
                {suppliers.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>메모</Label>
            <Input value={form.memo || ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={save}>등록</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
