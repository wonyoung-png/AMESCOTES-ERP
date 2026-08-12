import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { store, genId, type Vendor, type VendorRegion } from '@/lib/store';
import { fetchVendors, upsertVendor } from '@/lib/supabaseQueries';

const MATERIAL_TYPE_OPTIONS: ('장식' | '원단' | '가죽' | '기타')[] = ['장식', '원단', '가죽', '기타'];

/** 거래처 마스터와 같은 규칙으로 코드 채번 — 국내 K*, 해외 F* */
function genVendorCode(vendors: Vendor[], region: VendorRegion): string {
  const used = new Set(vendors.map(v => (v.code || '').toUpperCase()).filter(Boolean));
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const prefix = region === '해외' ? 'F' : 'K';
  for (const c of chars) {
    const code = prefix + c;
    if (!used.has(code)) return code;
  }
  for (const a of chars) for (const b of chars) {
    const code = a + b;
    if (!used.has(code)) return code;
  }
  return '';
}

/**
 * 자재업체 신규 등록 팝업 — BOM 자재명세·자재 등록 어디서든 같은 폼으로 거래처를 만든다.
 * 거래처 마스터로 이동하지 않고 여기서 등록하면 곧바로 목록에 반영된다.
 */
export function VendorQuickAddDialog({ open, initialName, onOpenChange, onCreated }: {
  open: boolean;
  initialName?: string;
  onOpenChange: (open: boolean) => void;
  onCreated?: (v: Vendor) => void;
}) {
  const queryClient = useQueryClient();
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Vendor>>({});

  useEffect(() => {
    if (!open) return;
    setForm({
      name: initialName || '',
      companyName: initialName || '',
      type: '자재거래처',
      region: '국내',
      country: '한국',
      currency: 'KRW',
      materialTypes: [],
    });
  }, [open, initialName]);

  const region = (form.region || '국내') as VendorRegion;
  const set = (k: keyof Vendor, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const setRegion = (r: VendorRegion) => setForm(f => ({
    ...f,
    region: r,
    country: r === '해외' ? (f.country === '한국' ? '중국' : f.country) : '한국',
    currency: r === '해외' ? (f.currency === 'KRW' ? 'CNY' : f.currency) : 'KRW',
  }));

  const toggleMaterialType = (mt: string) => setForm(f => {
    const cur = f.materialTypes || [];
    return { ...f, materialTypes: cur.includes(mt as any) ? cur.filter(x => x !== mt) : [...cur, mt as any] };
  });

  const save = () => {
    const name = (form.companyName || form.name || '').trim();
    if (!name) { toast.error('회사명을 입력해주세요'); return; }
    const dup = (vendors as Vendor[]).find(v => v.name.trim() === name);
    if (dup) { toast.error(`'${name}'은(는) 이미 등록된 거래처입니다`); return; }

    const vendor: Vendor = {
      ...form,
      id: genId(),
      name,
      companyName: name,
      type: '자재거래처',
      region,
      code: genVendorCode(vendors as Vendor[], region),
      contactHistory: [],
      createdAt: new Date().toISOString(),
    } as Vendor;

    setSaving(true);
    // 로컬에도 먼저 넣어 네트워크가 느려도 선택 목록에 바로 뜨게 한다
    store.addVendor(vendor);
    upsertVendor(vendor)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['vendors'] });
        toast.success(`"${name}" 거래처 등록됨`);
        onCreated?.(vendor);
        onOpenChange(false);
      })
      .catch((e: Error) => toast.error(`저장 실패: ${e.message}`))
      .finally(() => setSaving(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>자재거래처 등록</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>국내 / 해외</Label>
            <div className="flex gap-2">
              {(['국내', '해외'] as VendorRegion[]).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRegion(r)}
                  className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                    region === r ? 'bg-primary text-primary-foreground border-primary'
                                 : 'bg-card text-muted-foreground border-border hover:border-primary/40'}`}
                >{r}</button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>회사명 <span className="text-[var(--system-red)]">*</span></Label>
            <Input
              autoFocus
              value={form.companyName || ''}
              onChange={e => set('companyName', e.target.value)}
              placeholder="사업자 회사명 — 이것이 거래처명이 됩니다"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">국가</Label>
              <Input value={form.country || ''} onChange={e => set('country', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">통화</Label>
              <Select value={form.currency || 'KRW'} onValueChange={v => set('currency', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['KRW', 'CNY', 'USD'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>자재 유형 <span className="text-muted-foreground text-xs font-normal">(복수 선택)</span></Label>
            <div className="flex items-center gap-2 flex-wrap">
              {MATERIAL_TYPE_OPTIONS.map(mt => {
                const on = (form.materialTypes || []).includes(mt);
                return (
                  <button
                    key={mt}
                    type="button"
                    onClick={() => toggleMaterialType(mt)}
                    className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                      on ? 'bg-primary text-primary-foreground border-primary'
                         : 'bg-card text-muted-foreground border-border hover:border-primary/40'}`}
                  >{mt}</button>
                );
              })}
            </div>
            {(form.materialTypes || []).includes('기타' as any) && (
              <Input
                value={form.customMaterialType || ''}
                onChange={e => set('customMaterialType', e.target.value)}
                placeholder="자재 유형 직접 입력 (예: 부자재, 포장재)"
                className="mt-1.5 text-sm"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">담당자명</Label>
              <Input value={form.contactName || ''} onChange={e => set('contactName', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">전화번호</Label>
              <Input value={form.contactPhone || ''} onChange={e => set('contactPhone', e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              {region === '해외' ? '위챗 ID' : '사업자등록번호'}
            </Label>
            {region === '해외'
              ? <Input value={form.wechatId || ''} onChange={e => set('wechatId', e.target.value)} />
              : <Input value={form.bizRegNo || ''} onChange={e => set('bizRegNo', e.target.value)} placeholder="000-00-00000" />}
          </div>

          <p className="text-[11px] text-muted-foreground">
            나머지 정보(주소·계좌·세금계산서 이메일 등)는 거래처 마스터에서 이어서 채우면 됩니다.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={save} disabled={saving}>{saving ? '저장 중…' : '등록'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
