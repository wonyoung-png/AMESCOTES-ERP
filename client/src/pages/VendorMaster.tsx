// AMESCOTES ERP — 바이어 마스터 (Phase 1 개편)
import { useState, useMemo, useRef } from 'react';
import { store, genId, type Vendor, type VendorType, type Currency, type BillingType } from '@/lib/store';
import { parseBizLicense } from '@/lib/bizLicense';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Trash2, Building2, Clock, Loader2, Paperclip } from 'lucide-react';

const VENDOR_TYPES: VendorType[] = ['바이어', '자재거래처', '공장', '해외공장', '물류업체', '기타'];
const CURRENCIES: Currency[] = ['KRW', 'USD', 'CNY'];
const COUNTRIES = ['한국', '중국', '이탈리아', '프랑스', '일본', '미국', '기타'];
const BILLING_TYPES: BillingType[] = ['월별합산', '건별즉시'];

const TYPE_COLOR: Record<VendorType, string> = {
  '바이어':    'bg-purple-50 text-purple-700 border-purple-200',
  '자재거래처': 'bg-green-50 text-green-700 border-green-200',
  '공장':      'bg-blue-50 text-blue-700 border-blue-200',
  '해외공장':  'bg-sky-50 text-sky-700 border-sky-200',
  '물류업체':  'bg-orange-50 text-orange-700 border-orange-200',
  '기타':      'bg-stone-50 text-stone-600 border-stone-200',
};

const EMPTY_VENDOR: Partial<Vendor> = {
  name: '', nameEn: '', nameCn: '', type: '자재거래처', country: '한국', currency: 'KRW',
  contactName: '', contactEmail: '', contactPhone: '',
  leadTimeDays: undefined,
  billingType: undefined, settlementCycle: '', bankInfo: '', memo: '',
  contactHistory: [],
};

export default function VendorMaster() {
  const [vendors, setVendors] = useState<Vendor[]>(() => store.getVendors());
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [editVendor, setEditVendor] = useState<Partial<Vendor>>({ ...EMPTY_VENDOR });
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => setVendors(store.getVendors());

  const filtered = useMemo(() => {
    let list = vendors;
    if (filterType !== 'all') list = list.filter(v => v.type === filterType);
    if (search) list = list.filter(v =>
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      (v.nameEn || '').toLowerCase().includes(search.toLowerCase()) ||
      (v.nameCn || '').includes(search) ||
      (v.vendorCode || '').toUpperCase().includes(search.toUpperCase()) ||
      (v.contactName || '').toLowerCase().includes(search.toLowerCase())
    );
    return list;
  }, [vendors, search, filterType]);

  const openAdd = () => { setEditVendor({ ...EMPTY_VENDOR }); setIsEdit(false); setShowModal(true); };
  const openEdit = (v: Vendor) => { setEditVendor({ ...v }); setIsEdit(true); setShowModal(true); };

  const handleSave = () => {
    if (!editVendor.name) { toast.error('브랜드명을 입력해주세요'); return; }
    if (!editVendor.type) { toast.error('거래처 유형을 선택해주세요'); return; }

    // 코드 중복 검사
    if (editVendor.code) {
      const code = editVendor.code.toUpperCase();
      const dup = store.getVendors().find(v => v.code?.toUpperCase() === code && v.id !== editVendor.id);
      if (dup) { toast.error(`코드 '${code}'는 이미 '${dup.name}'에서 사용 중입니다`); return; }
    }

    // vendorCode 코드 중복 검사 (하위 호환)
    if (editVendor.vendorCode) {
      const code = editVendor.vendorCode.toUpperCase();
      const dup = store.getVendors().find(v => v.vendorCode?.toUpperCase() === code && v.id !== editVendor.id);
      if (dup) { toast.error(`거래처코드 '${code}'는 이미 '${dup.name}'에서 사용 중입니다`); return; }
    }

    if (isEdit && editVendor.id) {
      store.updateVendor(editVendor.id, {
        ...editVendor,
        code: editVendor.code?.toUpperCase(),
        vendorCode: editVendor.vendorCode?.toUpperCase(),
      } as Partial<Vendor>);
      toast.success('거래처가 수정되었습니다');
    } else {
      store.addVendor({
        ...editVendor,
        code: editVendor.code ? editVendor.code.toUpperCase() : undefined,
        vendorCode: editVendor.vendorCode ? editVendor.vendorCode.toUpperCase() : undefined,
        id: genId(),
        contactHistory: [],
        createdAt: new Date().toISOString(),
      } as Vendor);
      toast.success('거래처가 등록되었습니다');
    }
    setShowModal(false);
    refresh();
  };

  const handleDelete = (id: string) => {
    if (!confirm('거래처를 삭제하시겠습니까?')) return;
    store.deleteVendor(id);
    refresh();
    toast.success('삭제되었습니다');
  };

  const handleBizLicenseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 파일 선택 초기화 (같은 파일 재선택 가능)
    if (fileInputRef.current) fileInputRef.current.value = '';

    setIsOcrLoading(true);
    try {
      const info = await parseBizLicense(file);
      setEditVendor(v => ({
        ...v,
        companyName: info.companyName || v.companyName,
        bizRegNo: info.bizRegNo || v.bizRegNo,
        contactName: info.representativeName || v.contactName,
        contactEmail: info.email || v.contactEmail,
        address: info.address || v.address,
      }));
      toast.success('사업자등록증 정보가 자동 입력되었습니다 ✅');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      toast.error(`OCR 실패: ${msg}`);
    } finally {
      setIsOcrLoading(false);
    }
  };

  const update = (field: keyof Vendor, value: unknown) => setEditVendor(v => ({ ...v, [field]: value }));

  const updateCode = (field: 'code' | 'vendorCode', val: string, maxLen: number) => {
    const clean = val.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, maxLen);
    setEditVendor(v => ({ ...v, [field]: clean }));
  };

  // 유형별 카운트
  const typeCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const v of vendors) map[v.type] = (map[v.type] || 0) + 1;
    return map;
  }, [vendors]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">거래처 마스터</h1>
          <p className="text-sm text-stone-500 mt-0.5">바이어 · 자재거래처 · 공장 · 물류업체</p>
        </div>
        <Button onClick={openAdd} className="bg-amber-700 hover:bg-amber-800 text-white gap-2">
          <Plus className="w-4 h-4" />거래처 등록
        </Button>
      </div>

      {/* 유형별 통계 */}
      <div className="grid grid-cols-5 gap-3">
        {VENDOR_TYPES.map(t => (
          <div key={t} className="bg-white rounded-xl border border-stone-200 p-3 text-center">
            <p className="text-xl font-bold text-stone-800">{typeCounts[t] || 0}</p>
            <p className="text-xs text-stone-500 mt-0.5">{t}</p>
          </div>
        ))}
      </div>

      {/* 유형 탭 필터 */}
      <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl w-fit">
        {(['all', ...VENDOR_TYPES] as const).map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              filterType === t
                ? 'bg-white text-stone-800 shadow-sm'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {t === 'all' ? '전체' : t}
            <span className="ml-1.5 text-[10px] opacity-60">
              {t === 'all' ? vendors.length : (typeCounts[t] || 0)}
            </span>
          </button>
        ))}
      </div>

      {/* 검색 */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="거래처명 / 코드 검색" className="pl-9 h-9" />
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">브랜드명</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">코드</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">유형</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">담당자</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">연락처</th>
              
              
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">결제조건</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-stone-400">
                <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 거래처가 없습니다</p>
              </td></tr>
            ) : filtered.map(v => (
              <tr key={v.id} className="border-b border-stone-50 hover:bg-stone-50/50">
                <td className="px-4 py-3">
                  <p className="font-medium text-stone-800">{v.name}</p>
                  {v.nameEn && <p className="text-xs text-stone-400">{v.nameEn}</p>}
                  {v.nameCn && <p className="text-xs text-stone-400">{v.nameCn}</p>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    {v.vendorCode && (
                      <span className="inline-block px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-xs font-mono font-bold w-fit">
                        {v.vendorCode}
                      </span>
                    )}
                    {v.code && (
                      <span className="inline-block px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-xs font-mono font-bold w-fit">
                        {v.code}
                      </span>
                    )}
                    {!v.vendorCode && !v.code && <span className="text-stone-300 text-xs">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${TYPE_COLOR[v.type] || 'bg-stone-50 text-stone-600 border-stone-200'}`}>
                    {v.type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <p className="text-stone-700">{v.contactName || '-'}</p>
                </td>
                <td className="px-4 py-3 text-stone-500 text-xs">
                  {v.contactEmail && <p>{v.contactEmail}</p>}
                  {v.contactPhone && <p>{v.contactPhone}</p>}
                  {!v.contactEmail && !v.contactPhone && '-'}
                </td>
                
                
                <td className="px-4 py-3 text-stone-500 text-xs">
                  {v.billingType ? <p className="text-xs">{v.billingType}</p> : <span className="text-stone-300 text-xs">—</span>}
                  {v.settlementCycle && <p>{v.settlementCycle}</p>}
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(v)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(v.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 등록/수정 모달 */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isEdit ? '거래처 수정' : '거래처 등록'}</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">

            {/* 사업자등록증 업로드 */}
            <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                className="hidden"
                onChange={handleBizLicenseUpload}
                disabled={isOcrLoading}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isOcrLoading}
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 border-amber-400 text-amber-800 hover:bg-amber-100 whitespace-nowrap"
              >
                {isOcrLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />인식 중...</>
                ) : (
                  <><Paperclip className="w-4 h-4" />사업자등록증 업로드</>
                )}
              </Button>
              <p className="text-xs text-amber-700">업로드하면 회사명·사업자번호·담당자명이 자동 입력됩니다</p>
            </div>

            {/* 코드 + 회사명 섹션 */}
            <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg">
              <p className="text-xs font-medium text-stone-600 mb-3">식별 정보</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">코드 <span className="text-stone-400 font-normal">(2자리, 중복불가)</span></Label>
                  <Input
                    value={editVendor.code || ''}
                    onChange={e => updateCode('code', e.target.value, 2)}
                    placeholder="AT"
                    maxLength={2}
                    className="w-28 font-mono uppercase text-center font-bold tracking-widest"
                  />
                  <p className="text-[11px] text-stone-400">예: 202603-LLL-001 / AT2603HB01</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">사업자 회사명 <span className="text-stone-400 font-normal">(계산서 발급용)</span></Label>
                  <Input
                    value={editVendor.companyName || ''}
                    onChange={e => update('companyName', e.target.value)}
                    placeholder="(주)아뜰리에드루멘"
                    className="text-sm"
                  />
                  <p className="text-[11px] text-stone-400">세금계산서에 표기되는 공식 회사명</p>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">사업자등록번호</Label>
                  <Input
                    value={editVendor.bizRegNo || ''}
                    onChange={e => update('bizRegNo', e.target.value)}
                    placeholder="000-00-00000"
                    className="text-sm font-mono"
                  />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">사업장 주소 <span className="text-stone-400 font-normal">(퀵/택배 발송용)</span></Label>
                  <Input
                    value={editVendor.address || ''}
                    onChange={e => update('address', e.target.value)}
                    placeholder="서울시 강남구 테헤란로 123"
                    className="text-sm"
                  />
                </div>
              </div>
            </div>

            {/* 거래처 유형 */}
            <div className="space-y-1.5">
              <Label>거래처 유형 <span className="text-red-500">*</span></Label>
              <Select value={editVendor.type || '바이어'} onValueChange={v => update('type', v as VendorType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="바이어">바이어</SelectItem>
                  <SelectItem value="자재거래처">자재거래처</SelectItem>
                  <SelectItem value="공장">공장 (국내)</SelectItem>
                  <SelectItem value="해외공장">공장 (해외)</SelectItem>
                  <SelectItem value="물류업체">물류업체</SelectItem>
                  <SelectItem value="기타">기타</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 브랜드명 */}
            <div className="space-y-1.5">
              <Label>브랜드명 <span className="text-red-500">*</span></Label>
              <Input value={editVendor.name || ''} onChange={e => update('name', e.target.value)} placeholder="아뜰리에 드 루멘" />
            </div>

            {/* 담당자 정보 */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-stone-600">담당자 정보</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>담당자명</Label>
                  <Input value={editVendor.contactName || ''} onChange={e => update('contactName', e.target.value)} placeholder="홍길동" />
                </div>
                <div className="space-y-1.5">
                  <Label>전화번호</Label>
                  <Input value={editVendor.contactPhone || ''} onChange={e => update('contactPhone', e.target.value)} placeholder="010-0000-0000" />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>담당자 이메일</Label>
                  <Input value={editVendor.contactEmail || ''} onChange={e => update('contactEmail', e.target.value)} placeholder="contact@example.com" />
                </div>
                {/* 공장일 때 리드타임 표시 */}
                {(editVendor.type === '공장' || editVendor.type === '해외공장') && (
                  <div className="space-y-1.5 col-span-2">
                    <Label>리드타임 (일) <span className="text-stone-400 text-xs">(발주→납품 소요일)</span></Label>
                    <Input type="number" value={editVendor.leadTimeDays ?? ''} onChange={e => update('leadTimeDays', e.target.value ? Number(e.target.value) : undefined)} placeholder="예: 45" />
                  </div>
                )}
              </div>
            </div>

            {/* 계산서 발행 이메일 */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
              <p className="text-xs font-medium text-blue-700">계산서 / 세금계산서 발행 정보</p>
              <div className="space-y-1.5">
                <Label className="text-xs">세금계산서 수신 이메일 <span className="text-stone-400 font-normal">(담당자 이메일과 다를 경우 별도 입력)</span></Label>
                <Input
                  value={editVendor.billingEmail || ''}
                  onChange={e => update('billingEmail', e.target.value)}
                  placeholder="billing@example.com (비우면 담당자 이메일 사용)"
                  className="bg-white text-sm"
                />
                <p className="text-[11px] text-blue-600">비워두면 담당자 이메일로 발송됩니다.</p>
              </div>
            </div>



            {/* 거래 조건 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>청구 방식</Label>
                <Select value={editVendor.billingType || 'none'} onValueChange={v => update('billingType', v === 'none' ? undefined : v as BillingType)}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">선택 안 함</SelectItem>
                    {BILLING_TYPES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>결제 조건</Label>
                <Input value={editVendor.settlementCycle || ''} onChange={e => update('settlementCycle', e.target.value)} placeholder="예: 익월 15일, T/T 30일" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>메모</Label>
              <Input value={editVendor.memo || ''} onChange={e => update('memo', e.target.value)} placeholder="비고" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
