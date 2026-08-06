// AMESCOTES ERP — 거래처 마스터 (Phase 1 개편)
import { useState, useMemo, useRef, useCallback } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { store, genId, type Vendor, type VendorType, type VendorRegion, type Currency, type BillingType } from '@/lib/store';
import { fetchVendors, upsertVendor, deleteVendor as deleteVendorSB } from '@/lib/supabaseQueries';
import { parseBizLicense } from '@/lib/bizLicense';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Trash2, Building2, Clock, Loader2, Paperclip, Upload, Sparkles, Factory, ShoppingBag, Users, AlertCircle } from 'lucide-react';

// '해외공장'은 레거시 — 신규 등록은 '공장' + region='해외'. 기존 데이터 표시용으로만 남김
const VENDOR_TYPES: VendorType[] = ['바이어', '자재거래처', '공장', '물류업체', '기타'];
const REGIONS: VendorRegion[] = ['국내', '해외'];
/** 레거시 '해외공장' 값도 해외로 취급 */
const regionOf = (v: Pick<Vendor, 'region' | 'type'>): VendorRegion =>
  v.region ?? (v.type === '해외공장' ? '해외' : '국내');
const CURRENCIES: Currency[] = ['KRW', 'USD', 'CNY'];
const COUNTRIES = ['한국', '중국', '이탈리아', '프랑스', '일본', '미국', '기타'];
const BILLING_TYPES: BillingType[] = ['월별합산', '건별즉시'];

const TYPE_COLOR: Record<VendorType, string> = {
  '바이어':    'bg-[var(--fill-tertiary)] text-foreground border-border',
  '자재거래처': 'bg-[var(--fill-tertiary)] text-foreground border-border',
  '공장':      'bg-[var(--fill-tertiary)] text-foreground border-border',
  '해외공장':  'bg-[var(--fill-tertiary)] text-foreground border-border',
  '물류업체':  'bg-[var(--fill-tertiary)] text-foreground border-border',
  '기타':      'bg-[var(--fill-quaternary)] text-muted-foreground border-border',
};

// 자재 유형 옵션
const MATERIAL_TYPE_OPTIONS: ('장식' | '원단' | '가죽' | '기타')[] = ['장식', '원단', '가죽', '기타'];

const EMPTY_VENDOR: Partial<Vendor> = {
  name: '', nameEn: '', nameCn: '', type: '바이어', region: '국내', country: '한국', currency: 'KRW',
  contactName: '', contactEmail: '', contactPhone: '',
  leadTimeDays: undefined,
  billingType: undefined, settlementCycle: '', bankInfo: undefined, memo: '',
  contactHistory: [],
  materialTypes: [],
  customType: '',
  customMaterialType: '',
};

type AiVendorDraft = {
  suggestedType?: VendorType | null;
  typeHint?: string;
  name?: string;
  nameEn?: string;
  nameCn?: string;
  companyName?: string;
  bizRegNo?: string;
  address?: string;
  country?: string;
  currency?: Currency;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  billingEmail?: string;
  wechatId?: string;
  bankInfo?: Vendor['bankInfo'];
  memo?: string;
};

const AI_TYPE_CHOICES: { type: VendorType; label: string; desc: string; icon: typeof Factory }[] = [
  { type: '공장', label: '생산공장 (국내)', desc: 'OEM · 봉제 · 국내 생산', icon: Factory },
  { type: '해외공장', label: '생산공장 (해외)', desc: '중국 등 해외 OEM', icon: Factory },
  { type: '자재거래처', label: '자재업체', desc: '원단·가죽·부자재 공급', icon: ShoppingBag },
  { type: '바이어', label: '바이어', desc: '브랜드 · 발주처', icon: Users },
];

export default function VendorMaster() {
  const queryClient = useQueryClient();
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const setVendors = (_v: Vendor[]) => {}; // no-op, replaced by useQuery
  const [search, setSearch] = usePersistedState('vendors.search', '');
  const [filterRegion, setFilterRegion] = usePersistedState<string>('vendors.filterRegion', 'all');
  const [filterType, setFilterType] = usePersistedState<string>('vendors.filterType', 'all');
  const [filterMaterialType, setFilterMaterialType] = usePersistedState<string>('vendors.filterMaterialType', 'all');
  const [showModal, setShowModal] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [editVendor, setEditVendor] = useState<Partial<Vendor>>({ ...EMPTY_VENDOR });
  // 주소는 DB에 한 줄(vendors.address)로 저장하고, 입력만 기본주소/상세주소로 나눈다
  const [addrBase, setAddrBase] = useState('');
  const [addrDetail, setAddrDetail] = useState('');
  const addrDetailRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [isBankFileLoading, setIsBankFileLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bankFileInputRef = useRef<HTMLInputElement>(null);
  // 변경사항 추적
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // AI 자동등록
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiStep, setAiStep] = useState<'upload' | 'type' | 'review'>('upload');
  const [aiFiles, setAiFiles] = useState<File[]>([]);
  const [aiNotes, setAiNotes] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState<AiVendorDraft>({});
  const [aiType, setAiType] = useState<VendorType | ''>('');
  const aiFileRef = useRef<HTMLInputElement>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vendors'] });

  const openAiRegister = () => {
    setAiStep('upload');
    setAiFiles([]);
    setAiNotes('');
    setAiDraft({});
    setAiType('');
    setAiLoading(false);
    setShowAiModal(true);
  };

  const runAiVendorOcr = async () => {
    if (aiFiles.length === 0 && !aiNotes.trim()) {
      toast.error('서류 사진 또는 텍스트(이메일·연락처)를 넣어주세요');
      return;
    }
    setAiLoading(true);
    try {
      const fd = new FormData();
      aiFiles.forEach(f => fd.append('images', f));
      if (aiNotes.trim()) fd.append('notes', aiNotes.trim());
      const res = await fetch('/api/vendor/ocr', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'OCR 실패');
      setAiDraft(data as AiVendorDraft);
      const st = (data as AiVendorDraft).suggestedType;
      if (st && VENDOR_TYPES.includes(st)) setAiType(st);
      else setAiType('');
      setAiStep('type');
      toast.success('서류 분석 완료 — 거래처 유형을 선택하세요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI 분석 실패');
    } finally {
      setAiLoading(false);
    }
  };

  const confirmAiType = () => {
    if (!aiType) { toast.error('생산공장 / 자재업체 / 바이어 중 선택해주세요'); return; }
    setAiDraft(d => ({ ...d, suggestedType: aiType }));
    setAiStep('review');
  };

  const saveAiVendor = async () => {
    if (!aiType) { toast.error('거래처 유형을 선택해주세요'); return; }
    const name = (aiDraft.name || aiDraft.companyName || '').trim();
    if (!name) { toast.error('거래처명이 없습니다. 수정 후 저장하세요'); return; }
    const dup = vendors.find((v: Vendor) => v.name.trim() === name);
    if (dup) { toast.error(`'${name}'은(는) 이미 등록된 거래처입니다`); return; }

    const country = (aiDraft.country as string) || '한국';
    const currency = (aiDraft.currency as Currency) || (country === '중국' ? 'CNY' : country === '미국' ? 'USD' : 'KRW');
    const vendorData: Vendor = {
      id: genId(),
      name,
      nameEn: aiDraft.nameEn,
      nameCn: aiDraft.nameCn,
      companyName: aiDraft.companyName || name,
      bizRegNo: aiDraft.bizRegNo,
      address: aiDraft.address,
      type: aiType,
      country,
      currency,
      contactName: aiDraft.contactName,
      contactPhone: aiDraft.contactPhone,
      contactEmail: aiDraft.contactEmail,
      billingEmail: aiDraft.billingEmail || aiDraft.contactEmail,
      wechatId: aiDraft.wechatId,
      bankInfo: aiDraft.bankInfo,
      memo: [aiDraft.memo, 'AI 서류 자동등록'].filter(Boolean).join(' · '),
      contactHistory: [],
      createdAt: new Date().toISOString(),
    };

    try {
      await upsertVendor(vendorData);
      toast.success(`"${name}" (${aiType}) 자동 등록 완료`);
      setShowAiModal(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패');
    }
  };

  const patchAiDraft = (field: keyof AiVendorDraft, value: string) => {
    setAiDraft(d => ({ ...d, [field]: value }));
  };

  const filtered = useMemo(() => {
    let list = vendors;
    if (filterRegion !== 'all') list = list.filter(v => regionOf(v) === filterRegion);
    if (filterType !== 'all') list = list.filter(v => v.type === filterType);
    // 자재유형 필터 (자재거래처만 해당)
    if (filterMaterialType !== 'all') {
      list = list.filter(v =>
        v.type === '자재거래처' && (v.materialTypes || []).includes(filterMaterialType as '장식' | '원단' | '가죽' | '기타')
      );
    }
    // 검색 대상: 거래처명·영문/중문명·코드·담당자 + 사업자 회사명 + 검색창내용(memo)
    // 회사명이 '(주)아메스코테스'여도 검색창내용에 '아뜰리에드루멘'을 적어두면 그 이름으로 찾힌다
    if (search) {
      const q = search.trim().toLowerCase();
      list = list.filter(v =>
        [v.name, v.nameEn, v.nameCn, v.companyName, v.memo, v.vendorCode, v.code, v.contactName]
          .some(f => (f || '').toLowerCase().includes(q))
      );
    }
    return list;
  }, [vendors, search, filterRegion, filterType, filterMaterialType]);

  // SWIFT는 해외 업체만 쓴다 — 국내만 보고 있으면 컬럼 자체를 숨긴다
  const showSwiftCol = useMemo(() => filtered.some(v => regionOf(v) === '해외'), [filtered]);

  const regionCounts = useMemo(() => {
    const c: Record<string, number> = { 국내: 0, 해외: 0 };
    vendors.forEach(v => { c[regionOf(v)] = (c[regionOf(v)] || 0) + 1; });
    return c;
  }, [vendors]);

  /**
   * 코드 자동생성 — 국내 'K', 해외 'F' + 36진수 1자리 (2자리 고정, 기존 코드와 중복 회피).
   * 36개를 다 쓰면 남은 2자리 조합에서 아무거나 하나 집는다.
   */
  const genVendorCode = (region: VendorRegion, selfId?: string): string => {
    const used = new Set(
      vendors.filter((v: Vendor) => v.id !== selfId).map((v: Vendor) => (v.code || '').toUpperCase()).filter(Boolean),
    );
    const prefix = region === '해외' ? 'F' : 'K';
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const c of chars) {
      const code = prefix + c;
      if (!used.has(code)) return code;
    }
    for (const a of chars) for (const b of chars) {
      const code = a + b;
      if (!used.has(code)) return code;
    }
    return '';
  };

  const openAdd = () => {
    setEditVendor({ ...EMPTY_VENDOR, code: genVendorCode('국내') });
    setAddrBase(''); setAddrDetail('');
    setIsEdit(false); setIsDirty(false); setShowModal(true);
  };
  const openEdit = (v: Vendor) => {
    // 회사명 칸이 거래처명을 겸한다 — 예전 데이터는 회사명이 비어 있으므로 거래처명으로 채워
    // 저장할 때 이름이 지워지지 않게 한다
    setEditVendor({ ...v, companyName: v.companyName || v.name });
    // DB에는 주소 한 줄로만 저장한다 — 수정 화면에서는 저장된 값을 기본주소 칸에 그대로 놓고,
    // 상세주소는 비워 둔 뒤 새로 적는 만큼만 뒤에 붙인다
    setAddrBase(v.address || ''); setAddrDetail('');
    setIsEdit(true); setIsDirty(false); setShowModal(true);
  };

  const handleModalClose = useCallback((requestClose: boolean) => {
    if (!requestClose) return;
    if (isDirty) {
      setShowUnsavedDialog(true);
    } else {
      setShowModal(false);
    }
  }, [isDirty]);

  const handleSave = () => {
    // 회사명이 곧 거래처명 — 입력칸을 하나로 합쳤으므로 저장 직전에 name에 복사한다
    const companyName = (editVendor.companyName || '').trim();
    if (!companyName) { toast.error('회사명을 입력해주세요'); return; }
    if (!editVendor.type) { toast.error('거래처 유형을 선택해주세요'); return; }

    // 거래처명 중복 검사 (신규/수정 모두)
    const dupName = vendors.find((v: Vendor) => v.name.trim() === companyName && v.id !== editVendor.id);
    if (dupName) { toast.error(`'${companyName}'은(는) 이미 등록된 거래처입니다`); return; }

    // 코드 중복 검사
    if (editVendor.code) {
      const code = editVendor.code.toUpperCase();
      const dup = vendors.find((v: Vendor) => v.code?.toUpperCase() === code && v.id !== editVendor.id);
      if (dup) { toast.error(`코드 '${code}'는 이미 '${dup.name}'에서 사용 중입니다`); return; }
    }

    // vendorCode 코드 중복 검사 (하위 호환)
    if (editVendor.vendorCode) {
      const code = editVendor.vendorCode.toUpperCase();
      const dup = vendors.find((v: Vendor) => (v as any).vendorCode?.toUpperCase() === code && v.id !== editVendor.id);
      if (dup) { toast.error(`거래처코드 '${code}'는 이미 '${dup.name}'에서 사용 중입니다`); return; }
    }

    const vendorData = isEdit && editVendor.id
      ? {
          ...editVendor,
          name: companyName,
          code: editVendor.code?.toUpperCase(),
          vendorCode: editVendor.vendorCode?.toUpperCase(),
        } as Vendor
      : {
          ...editVendor,
          name: companyName,
          code: editVendor.code ? editVendor.code.toUpperCase() : undefined,
          vendorCode: editVendor.vendorCode ? editVendor.vendorCode.toUpperCase() : undefined,
          id: genId(),
          contactHistory: [],
          createdAt: new Date().toISOString(),
        } as Vendor;

    upsertVendor(vendorData)
      .then(() => {
        toast.success(isEdit ? '거래처가 수정되었습니다' : '거래처가 등록되었습니다');
        setIsDirty(false);
        setShowModal(false);
        refresh();
      })
      .catch((e: Error) => toast.error(`저장 실패: ${e.message}`));
  };

  const handleDelete = (id: string) => {
    if (!confirm('거래처를 삭제하시겠습니까?')) return;
    deleteVendorSB(id)
      .then(() => { refresh(); toast.success('삭제되었습니다'); })
      .catch((e: Error) => toast.error(`삭제 실패: ${e.message}`));
  };

  // 체크박스 다중 선택 관련
  const isAllSelected = filtered.length > 0 && filtered.every(v => selectedIds.has(v.id));
  const isIndeterminate = filtered.some(v => selectedIds.has(v.id)) && !isAllSelected;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(v => v.id)));
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

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (confirm(`${selectedIds.size}개 항목을 삭제하시겠습니까?`)) {
      const count = selectedIds.size;
      Promise.all([...selectedIds].map(id => deleteVendorSB(id)))
        .then(() => { setSelectedIds(new Set()); refresh(); toast.success(`${count}개 항목이 삭제되었습니다`); })
        .catch((e: Error) => toast.error(`삭제 실패: ${e.message}`));
    }
  };

  // 헤더 이름을 정규화하는 헬퍼 함수
  const normalizeHeader = (h: string) => String(h).toLowerCase().trim();

  // 헤더 목록에서 키워드 중 하나와 매칭되는 컬럼 인덱스 찾기
  const findColIndex = (headers: string[], keywords: string[]): number => {
    return headers.findIndex(h => keywords.some(kw => normalizeHeader(h) === kw.toLowerCase()));
  };

  // 엑셀 파일에서 거래처 정보 파싱
  const parseVendorExcel = (file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = ev.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          // 헤더 포함 전체 데이터를 2D 배열로 읽기
          const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

          if (rows.length < 2) {
            reject(new Error('데이터가 없습니다 (헤더 + 최소 1행 필요)'));
            return;
          }

          const headers = (rows[0] as unknown[]).map(h => String(h));
          const dataRows = rows.slice(1).filter(row => (row as unknown[]).some(cell => String(cell).trim() !== ''));

          if (dataRows.length === 0) {
            reject(new Error('데이터 행이 없습니다'));
            return;
          }

          if (dataRows.length > 1) {
            toast.info(`${dataRows.length}개 거래처 데이터 발견, 첫 번째 행을 입력합니다`);
          }

          const row = dataRows[0] as unknown[];
          const get = (keywords: string[]): string => {
            const idx = findColIndex(headers, keywords);
            return idx >= 0 ? String(row[idx] ?? '').trim() : '';
          };

          const companyName = get(['회사명', '상호', 'company', 'name']);
          const bizRegNo   = get(['사업자번호', '사업자등록번호', 'bizno', 'business_number']);
          const vendorName = get(['거래처', '거래처명', 'vendor']);
          const contactName = get(['담당자', '담당자명', 'contact', 'manager']);
          const contactPhone = get(['전화', '전화번호', 'phone', 'tel']);
          const contactEmail = get(['이메일', 'email']);
          const address    = get(['주소', 'address']);
          const leadTime   = get(['리드타임', '납기', 'leadtime']);
          const code       = get(['코드', 'code']);

          setEditVendor(v => ({
            ...v,
            companyName: companyName || v.companyName,
            bizRegNo: bizRegNo || v.bizRegNo,
            name: vendorName || v.name,
            contactName: contactName || v.contactName,
            contactPhone: contactPhone || v.contactPhone,
            contactEmail: contactEmail || v.contactEmail,
            address: address || v.address,
            leadTimeDays: leadTime ? Number(leadTime) : v.leadTimeDays,
            code: code ? code.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 2) : v.code,
          }));

          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsArrayBuffer(file);
    });
  };

  const handleBizLicenseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 파일 선택 초기화 (같은 파일 재선택 가능)
    if (fileInputRef.current) fileInputRef.current.value = '';

    // 엑셀 파일인 경우 별도 처리
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (isExcel) {
      setIsOcrLoading(true);
      try {
        await parseVendorExcel(file);
        toast.success('엑셀 거래처 정보가 자동 입력되었습니다');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '알 수 없는 오류';
        toast.error(`엑셀 파싱 실패: ${msg}`);
      } finally {
        setIsOcrLoading(false);
      }
      return;
    }

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
      setIsDirty(true);
      toast.success('사업자등록증 정보가 자동 입력되었습니다');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      toast.error(`OCR 실패: ${msg}`);
    } finally {
      setIsOcrLoading(false);
    }
  };

  // 엑셀에서 계좌정보 파싱
  const parseBankInfoExcel = (file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = ev.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

          if (rows.length < 2) {
            reject(new Error('데이터가 없습니다'));
            return;
          }

          const headers = (rows[0] as unknown[]).map(h => String(h));
          const dataRows = rows.slice(1).filter(row => (row as unknown[]).some(cell => String(cell).trim() !== ''));

          if (dataRows.length === 0) {
            reject(new Error('데이터 행이 없습니다'));
            return;
          }

          const row = dataRows[0] as unknown[];
          const get = (keywords: string[]): string => {
            const idx = headers.findIndex(h =>
              keywords.some(kw => String(h).toLowerCase().trim() === kw.toLowerCase())
            );
            return idx >= 0 ? String(row[idx] ?? '').trim() : '';
          };

          const parsed: NonNullable<Vendor['bankInfo']> = {};
          parsed.beneficiary  = get(['beneficiary', '수취인', 'account name']) || undefined;
          parsed.swiftCode    = get(['swift code', 'swift', 'bic', 'swift_code']) || undefined;
          parsed.bankName     = get(['bank name', 'bank', '은행명', '은행', 'bank_name']) || undefined;
          parsed.bankAccount  = get(['bank account', 'account', 'account no', 'account number', '계좌번호', 'bank_account']) || undefined;
          parsed.bankCode     = get(['bank code', 'bank_code', '은행코드']) || undefined;
          parsed.branchCode   = get(['branch code', 'branch_code', '지점코드']) || undefined;
          parsed.bankAddress  = get(['bank address', 'bank_address', '은행주소']) || undefined;
          parsed.address      = get(['address', '주소', 'beneficiary address']) || undefined;

          const filledCount = Object.values(parsed).filter(Boolean).length;

          if (filledCount === 0) {
            reject(new Error('매칭되는 컬럼을 찾을 수 없습니다'));
            return;
          }

          setEditVendor(v => ({
            ...v,
            bankInfo: { ...(v.bankInfo || {}), ...Object.fromEntries(Object.entries(parsed).filter(([, val]) => val)) },
          }));

          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsArrayBuffer(file);
    });
  };

  // 계좌정보 파일 업로드 — 텍스트 패턴 매칭으로 필드 자동 추출
  const handleBankInfoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (bankFileInputRef.current) bankFileInputRef.current.value = '';

    // 엑셀 파일인 경우 별도 처리
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (isExcel) {
      setIsBankFileLoading(true);
      try {
        await parseBankInfoExcel(file);
        toast.success('엑셀 계좌정보가 자동 입력되었습니다');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '알 수 없는 오류';
        toast.error(`엑셀 파싱 실패: ${msg}`);
      } finally {
        setIsBankFileLoading(false);
      }
      return;
    }

    setIsBankFileLoading(true);
    try {
      let text = '';

      if (file.type === 'application/pdf') {
        // PDF: FileReader로 ArrayBuffer 읽기 후 텍스트 추출 시도
        // (간단한 텍스트 PDF만 파싱 가능)
        const buf = await file.arrayBuffer();
        const raw = new TextDecoder('latin1').decode(buf);
        // PDF 내부 BT ... ET 블록에서 텍스트 추출
        const matches = raw.match(/\(([^)]{2,})\)/g) || [];
        text = matches
          .map(m => m.slice(1, -1))
          .filter(s => /[A-Za-z0-9]/.test(s))
          .join(' ');
      } else {
        // 이미지: Canvas로 그려서 OCR 시도 (기본 Canvas API는 OCR 미지원)
        // 이미지 파일의 경우 파일명 또는 사용자 알림으로 대체
        // 실제 OCR 없이 더미 파싱 메시지 표시
        text = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            // 이미지에서는 텍스트 추출 불가 → 빈 문자열 반환
            resolve('');
          };
          reader.readAsDataURL(file);
        });
      }

      // 패턴 매칭으로 필드 추출
      const parsed: NonNullable<Vendor['bankInfo']> = {};

      const extract = (patterns: RegExp[]): string | undefined => {
        for (const pat of patterns) {
          const m = text.match(pat);
          if (m?.[1]?.trim()) return m[1].trim();
        }
        return undefined;
      };

      parsed.beneficiary = extract([
        /BENEFICIARY\s*[:\-]?\s*(.+?)(?=\n|BANK|ADDRESS|$)/i,
        /ACCOUNT\s+NAME\s*[:\-]?\s*(.+?)(?=\n|BANK|$)/i,
      ]);
      parsed.bankName = extract([
        /BANK\s+NAME\s*[:\-]?\s*(.+?)(?=\n|ACCOUNT|BRANCH|SWIFT|$)/i,
        /BENEFICIARY'?S?\s+BANK\s*[:\-]?\s*(.+?)(?=\n|ACCOUNT|$)/i,
      ]);
      parsed.bankAccount = extract([
        /BANK\s+ACCOUNT\s*(?:NO\.?)?\s*[:\-]?\s*(.+?)(?=\n|BANK|BRANCH|SWIFT|$)/i,
        /ACCOUNT\s+(?:NO\.?|NUMBER)\s*[:\-]?\s*(.+?)(?=\n|BANK|SWIFT|$)/i,
      ]);
      parsed.bankCode = extract([
        /BANK\s+CODE\s*[:\-]?\s*([0-9A-Za-z\-]+?)(?=\s|\n|BRANCH|SWIFT|$)/i,
      ]);
      parsed.branchCode = extract([
        /BRANCH\s+CODE\s*[:\-]?\s*([0-9A-Za-z\-]+?)(?=\s|\n|BANK|SWIFT|$)/i,
      ]);
      parsed.bankAddress = extract([
        /BANK\s+ADDRESS\s*[:\-]?\s*(.+?)(?=\n|SWIFT|$)/i,
      ]);
      parsed.swiftCode = extract([
        /SWIFT\s*(?:CODE)?\s*[:\-]?\s*([A-Z0-9]{8,11})(?=\s|\n|$)/i,
        /BIC\s*[:\-]?\s*([A-Z0-9]{8,11})(?=\s|\n|$)/i,
      ]);
      parsed.address = extract([
        /ADDRESS\s*[:\-]?\s*(.+?)(?=\n|BANK|SWIFT|$)/i,
      ]);

      const filledCount = Object.values(parsed).filter(Boolean).length;

      if (filledCount > 0) {
        setEditVendor(v => ({
          ...v,
          bankInfo: { ...(v.bankInfo || {}), ...parsed },
        }));
        toast.success(`계좌정보 ${filledCount}개 필드가 자동 입력되었습니다`);
      } else {
        toast.warning('자동 파싱에 실패했습니다. 직접 입력해주세요.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      toast.error(`파일 파싱 실패: ${msg}. 직접 입력해주세요.`);
    } finally {
      setIsBankFileLoading(false);
    }
  };

  const update = (field: keyof Vendor, value: unknown) => { setEditVendor(v => ({ ...v, [field]: value })); setIsDirty(true); };
  /** 모달에서 편집 중인 거래처의 국내/해외 (레거시 '해외공장'도 해외로 인식) */
  const editRegion: VendorRegion = editVendor.region ?? (editVendor.type === '해외공장' ? '해외' : '국내');

  /** 기본주소 + 상세주소를 합쳐 vendors.address 한 칸에 저장한다 (DB 컬럼 추가 없이) */
  const setAddress = (base: string, detail: string) => {
    setAddrBase(base); setAddrDetail(detail);
    update('address', [base.trim(), detail.trim()].filter(Boolean).join(' '));
  };

  /**
   * 사업장 주소 검색 — 다음(카카오) 우편번호 서비스 팝업.
   * 키 발급이 필요 없는 무료 스크립트라 npm 의존성 없이 최초 1회만 동적 로드한다.
   */
  const openAddressSearch = () => {
    const open = () => {
      const Postcode = (window as any).daum?.Postcode;
      if (!Postcode) { toast.error('주소 검색을 불러오지 못했습니다. 주소를 직접 입력해주세요'); return; }
      new Postcode({
        oncomplete: (data: { roadAddress?: string; jibunAddress?: string; zonecode?: string }) => {
          const addr = data.roadAddress || data.jibunAddress || '';
          setAddress(data.zonecode ? `(${data.zonecode}) ${addr}` : addr, addrDetail);
          setTimeout(() => addrDetailRef.current?.focus(), 100);
        },
      }).open();
    };
    if ((window as any).daum?.Postcode) { open(); return; }
    const SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    let s = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    if (!s) {
      s = document.createElement('script');
      s.src = SRC;
      document.body.appendChild(s);
    }
    s.addEventListener('load', open, { once: true });
    s.addEventListener('error', () => toast.error('주소 검색 서비스에 연결할 수 없습니다. 직접 입력해주세요'), { once: true });
  };

  // 유형별 카운트
  // 선택된 국내/해외 탭 범위 안에서 집계 — 상단 카드·유형 탭 숫자 모두 이 값을 쓴다
  const regionScoped = useMemo(
    () => (filterRegion === 'all' ? vendors : vendors.filter(v => regionOf(v) === filterRegion)),
    [vendors, filterRegion],
  );
  const typeCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const v of regionScoped) map[v.type] = (map[v.type] || 0) + 1;
    return map;
  }, [regionScoped]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">거래처 마스터</h1>
          <p className="text-sm text-muted-foreground mt-0.5">바이어 · 자재거래처 · 공장 · 물류업체</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={openAiRegister}
            className="gap-2"
          >
            <Sparkles className="w-4 h-4" />AI 자동등록
          </Button>
          <Button onClick={openAdd} className="gap-2">
            <Plus className="w-4 h-4" />거래처 등록
          </Button>
        </div>
      </div>

      {/* 유형별 통계 */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {VENDOR_TYPES.map(t => (
          <div key={t} className="bg-card rounded-lg border border-border p-3">
            <p className="text-xl font-bold text-foreground">{typeCounts[t] || 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t}</p>
          </div>
        ))}
      </div>

      {/* 국내 / 해외 탭 */}
      <div className="flex items-center gap-1 border-b border-border">
        {(['all', ...REGIONS] as const).map(r => (
          <button
            key={r}
            onClick={() => setFilterRegion(r)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              filterRegion === r
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {r === 'all' ? '전체' : r}
            <span className="ml-1.5 text-xs opacity-60">
              {r === 'all' ? vendors.length : (regionCounts[r] || 0)}
            </span>
            {filterRegion === r && (
              <span className="absolute left-0 -bottom-px h-0.5 w-full rounded-full bg-[var(--accent-mint)]" />
            )}
          </button>
        ))}
      </div>

      {/* 유형 탭 필터 */}
      <div className="flex flex-wrap items-center gap-1 bg-[var(--fill-tertiary)] p-1 rounded-lg w-fit">
        {(['all', ...VENDOR_TYPES] as const).map(t => (
          <button
            key={t}
            onClick={() => { setFilterType(t); setFilterMaterialType('all'); }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              filterType === t
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'all' ? '전체' : t}
            <span className="ml-1.5 text-[11px] opacity-60">
              {t === 'all' ? regionScoped.length : (typeCounts[t] || 0)}
            </span>
          </button>
        ))}
      </div>

      {/* 자재유형 필터 (자재거래처 탭 선택 시 표시) */}
      {filterType === '자재거래처' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">자재 유형:</span>
          <div className="flex flex-wrap items-center gap-1 bg-[var(--fill-tertiary)] p-1 rounded-lg w-fit">
            {(['all', ...MATERIAL_TYPE_OPTIONS] as const).map(t => (
              <button
                key={t}
                onClick={() => setFilterMaterialType(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  filterMaterialType === t
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'all' ? '전체' : t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 검색 */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="거래처명 / 코드 검색" className="pl-9 h-9" />
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
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-border bg-[var(--fill-quaternary)]">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                />
              </th>
              <th className="text-left px-4 py-3 text-[13px] font-semibold text-muted-foreground">거래처명</th>
              <th className="text-left px-4 py-3 text-[13px] font-semibold text-muted-foreground">코드</th>
              <th className="text-left px-4 py-3 text-[13px] font-semibold text-muted-foreground">유형</th>
              <th className="text-left px-4 py-3 text-[13px] font-semibold text-muted-foreground">자재유형</th>
              <th className="text-left px-4 py-3 text-[13px] font-semibold text-muted-foreground">담당자</th>
              <th className="text-left px-4 py-3 text-[13px] font-semibold text-muted-foreground">연락처</th>
              <th className="text-left px-4 py-3 text-[13px] font-semibold text-muted-foreground">결제조건</th>
              {/* 공장 유형 필터 시 SWIFT CODE 컬럼 표시 */}
              {showSwiftCol && (
                <th className="text-left px-4 py-3 text-[13px] font-semibold text-muted-foreground">SWIFT CODE</th>
              )}
              <th className="text-center px-4 py-3 text-[13px] font-semibold text-muted-foreground">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">
                <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 거래처가 없습니다</p>
              </td></tr>
) : filtered.map(v => {
  const isChecked = selectedIds.has(v.id);
  return (
              <tr key={v.id} className={`border-b border-border hover:bg-[var(--fill-quaternary)] ${isChecked ? 'bg-primary/5' : ''}`}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(v.id)}
                    className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-foreground">{v.name}</p>
                    {v.type === '자재거래처' && !v.contactName && !v.contactEmail && !v.contactPhone && (
                      <AlertCircle className="w-4 h-4 text-[var(--system-red)] cursor-help shrink-0" aria-label="기본 정보 미입력 — 거래처 마스터에서 연락처 정보 입력 필요" />
                    )}
                  </div>
                  {v.nameEn && <p className="text-xs text-muted-foreground">{v.nameEn}</p>}
                  {v.nameCn && <p className="text-xs text-muted-foreground">{v.nameCn}</p>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    {v.vendorCode && (
                      <span className="inline-block px-2 py-0.5 rounded bg-[var(--fill-tertiary)] border border-border text-foreground text-xs font-mono font-bold w-fit">
                        {v.vendorCode}
                      </span>
                    )}
                    {v.code && (
                      <span className="inline-block px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary text-xs font-mono font-bold w-fit">
                        {v.code}
                      </span>
                    )}
                    {!v.vendorCode && !v.code && <span className="text-muted-foreground text-xs">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${TYPE_COLOR[v.type] || 'bg-[var(--fill-quaternary)] text-muted-foreground border-border'}`}>
                    {v.type === '기타' && v.customType ? `기타 (${v.customType})` : v.type}
                  </span>
                </td>
                {/* 자재유형 (자재거래처만 표시) */}
                <td className="px-4 py-3">
                  {v.type === '자재거래처' && (v.materialTypes || []).length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {(v.materialTypes || []).map(mt => (
                        <span key={mt} className="text-xs px-1.5 py-0.5 rounded bg-[var(--fill-tertiary)] border border-border text-foreground">
                          {mt === '기타' && v.customMaterialType ? `기타 (${v.customMaterialType})` : mt}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="text-foreground">{v.contactName || '-'}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {v.contactEmail && <p>{v.contactEmail}</p>}
                  {v.contactPhone && <p>{v.contactPhone}</p>}
                  {!v.contactEmail && !v.contactPhone && (
                    <span className="flex items-center gap-1">
                      {v.type === '자재거래처' && !v.contactName && (
                        <AlertCircle className="w-4 h-4 text-[var(--system-red)] cursor-help shrink-0" aria-label="기본 정보 미입력 — 전화번호, 이메일, 연락처 없음" />
                      )}
                      <span>-</span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {v.billingType ? <p className="text-xs">{v.billingType}</p> : <span className="text-muted-foreground text-xs">—</span>}
                  {v.settlementCycle && <p>{v.settlementCycle}</p>}
                </td>
                {/* SWIFT CODE 컬럼 (공장 유형이 목록에 있을 때만 표시) */}
                {showSwiftCol && (
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {regionOf(v) === '해외' && v.bankInfo?.swiftCode ? (
                      <span className="font-mono text-foreground bg-[var(--fill-tertiary)] px-2 py-0.5 rounded text-xs border border-border">
                        {v.bankInfo.swiftCode}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                )}
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(v)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-[var(--system-red)]" onClick={() => handleDelete(v.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
  );
})}
          </tbody>
        </table>
      </div>

      {/* 변경사항 확인 다이얼로그 */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onSaveAndClose={() => { setShowUnsavedDialog(false); handleSave(); }}
        onDiscardAndClose={() => { setShowUnsavedDialog(false); setIsDirty(false); setShowModal(false); }}
        onCancel={() => setShowUnsavedDialog(false)}
      />

      {/* 등록/수정 모달 */}
      <Dialog open={showModal} onOpenChange={(open) => { if (!open) handleModalClose(true); }}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isEdit ? '거래처 수정' : '거래처 등록'}</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">

            {/* 국내 / 해외 — 이 선택이 아래 입력 항목을 가른다 (가장 먼저 고른다) */}
            <div className="space-y-1.5">
              <Label>국내 / 해외 <span className="text-[var(--system-red)]">*</span></Label>
              <div className="flex gap-2">
                {REGIONS.map(r => {
                  const active = editRegion === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        update('region', r);
                        // 국가·통화 기본값도 함께 맞춘다
                        if (r === '국내') { update('country', '한국'); update('currency', 'KRW'); }
                        else if (!editVendor.country || editVendor.country === '한국') { update('country', '중국'); update('currency', 'CNY'); }
                        // 신규 등록일 때만 코드 재발급 — 기존 거래처 코드는 전표번호에 박혀 있어 바꾸지 않는다
                        if (!isEdit) update('code', genVendorCode(r, editVendor.id));
                      }}
                      className={`flex-1 px-4 py-2.5 rounded-md text-sm font-medium border transition-colors ${
                        active
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border-border hover:border-primary/40'
                      }`}
                    >
                      {r === '국내' ? '국내 업체' : '해외 업체'}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {editRegion === '국내'
                  ? '사업자등록번호 · 세금계산서 정보를 입력합니다.'
                  : '국가 · 통화 · 해외 송금 계좌(SWIFT)를 입력합니다.'}
              </p>
            </div>

            {/* 사업자등록증 / 거래처정보 업로드 (국내 전용 — 해외는 사업자등록증이 없다) */}
            {editRegion === '국내' && (
            <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-md">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*, .pdf, .xlsx, .xls"
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
                className="gap-2 whitespace-nowrap"
              >
                {isOcrLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />인식 중...</>
                ) : (
                  <><Paperclip className="w-4 h-4" />사업자등록증 / 거래처정보 업로드</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">이미지·PDF → 사업자등록증 OCR | 엑셀(.xlsx/.xls) → 거래처 정보 자동 매핑</p>
            </div>
            )}

            {/* 코드 + 회사명 섹션 */}
            <div className="p-3 bg-[var(--fill-quaternary)] border border-border rounded-md">
              <p className="text-xs font-medium text-muted-foreground mb-3">식별 정보</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">코드 <span className="text-muted-foreground font-normal">(자동생성)</span></Label>
                  <Input
                    value={editVendor.code || ''}
                    readOnly
                    tabIndex={-1}
                    className="w-28 font-mono uppercase text-center font-bold bg-[var(--fill-tertiary)] text-muted-foreground cursor-default"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {editRegion === '국내' ? '사업자 회사명' : '영문 회사명'}
                    <span className="text-[var(--system-red)]"> *</span>
                    <span className="text-muted-foreground font-normal"> (거래처명으로 사용)</span>
                  </Label>
                  <Input
                    value={editVendor.companyName || ''}
                    onChange={e => update('companyName', e.target.value)}
                    placeholder={editRegion === '국내' ? '(주)아뜰리에드루멘' : 'HONGKONG GIOCH TRADING LIMITED'}
                    className="text-sm"
                  />
                </div>

                {/* 국내 전용 — 사업자등록번호 / 사업장 주소 */}
                {editRegion === '국내' && (
                  <>
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
                      <Label className="text-xs">사업장 주소 <span className="text-muted-foreground font-normal">(퀵/택배 발송용)</span></Label>
                      <div className="flex gap-2">
                        <Input
                          value={addrBase}
                          onChange={e => setAddress(e.target.value, addrDetail)}
                          placeholder="주소 검색을 누르거나 직접 입력"
                          className="text-sm flex-1"
                        />
                        <Button type="button" variant="outline" size="sm" onClick={openAddressSearch} className="gap-1.5 whitespace-nowrap">
                          <Search className="w-3.5 h-3.5" />주소 검색
                        </Button>
                      </div>
                      <Input
                        ref={addrDetailRef}
                        value={addrDetail}
                        onChange={e => setAddress(addrBase, e.target.value)}
                        placeholder="상세주소 (예: 3층 301호)"
                        className="text-sm"
                      />
                    </div>
                  </>
                )}

                {/* 해외 전용 — 국가 / 통화 / 위챗 / 영문·중문명 */}
                {editRegion === '해외' && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">국가</Label>
                      <Select value={editVendor.country || '중국'} onValueChange={v => update('country', v)}>
                        <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COUNTRIES.filter(c => c !== '한국').map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">통화</Label>
                      <Select value={editVendor.currency || 'CNY'} onValueChange={v => update('currency', v as Currency)}>
                        <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">영문명</Label>
                      <Input value={editVendor.nameEn || ''} onChange={e => update('nameEn', e.target.value)} placeholder="Gioch Trading" className="text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">중문명</Label>
                      <Input value={editVendor.nameCn || ''} onChange={e => update('nameCn', e.target.value)} placeholder="佳兆贸易" className="text-sm" />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs">위챗 ID <span className="text-muted-foreground font-normal">(중국 거래처 연락용)</span></Label>
                      <Input value={editVendor.wechatId || ''} onChange={e => update('wechatId', e.target.value)} placeholder="wxid_xxxxx" className="text-sm" />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 거래처 유형 */}
            <div className="space-y-1.5">
              <Label>거래처 유형 <span className="text-[var(--system-red)]">*</span></Label>
              <Select value={editVendor.type === '해외공장' ? '공장' : (editVendor.type || '바이어')} onValueChange={v => update('type', v as VendorType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="바이어">바이어</SelectItem>
                  <SelectItem value="자재거래처">자재거래처</SelectItem>
                  <SelectItem value="공장">공장</SelectItem>
                  <SelectItem value="물류업체">물류업체</SelectItem>
                  <SelectItem value="기타">기타</SelectItem>
                </SelectContent>
              </Select>
              {/* 기타 선택 시 직접 입력 */}
              {editVendor.type === '기타' && (
                <Input
                  value={editVendor.customType || ''}
                  onChange={e => update('customType', e.target.value)}
                  placeholder="유형명 직접 입력 (예: 샘플업체, 용역업체)"
                  className="mt-1.5 text-sm"
                />
              )}
            </div>

            {/* 자재 유형 (자재거래처만 표시) */}
            {editVendor.type === '자재거래처' && (
              <div className="space-y-1.5">
                <Label>자재 유형 <span className="text-muted-foreground text-xs font-normal">(복수 선택 가능)</span></Label>
                <div className="flex items-center gap-2 flex-wrap">
                  {MATERIAL_TYPE_OPTIONS.map(mt => {
                    const isSelected = (editVendor.materialTypes || []).includes(mt);
                    return (
                      <button
                        key={mt}
                        type="button"
                        onClick={() => {
                          const current = editVendor.materialTypes || [];
                          const next = isSelected
                            ? current.filter(x => x !== mt)
                            : [...current, mt];
                          update('materialTypes', next);
                        }}
                        className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card text-muted-foreground border-border hover:border-primary/40'
                        }`}
                      >
                        {mt}
                      </button>
                    );
                  })}
                </div>
                {/* "기타" 선택 시 직접 입력 필드 */}
                {(editVendor.materialTypes || []).includes('기타') && (
                  <Input
                    value={editVendor.customMaterialType || ''}
                    onChange={e => update('customMaterialType', e.target.value)}
                    placeholder="자재 유형 직접 입력 (예: 부자재, 포장재)"
                    className="mt-1.5 text-sm"
                  />
                )}
                <p className="text-[11px] text-muted-foreground">장식, 원단, 가죽, 기타 중 해당 유형을 모두 선택해주세요</p>
              </div>
            )}

            {/* 거래처명 입력칸은 없앴다 — 사업자 회사명이 곧 거래처명이라 저장 시 그대로 복사한다 */}

            {/* 브랜드명 — 회사명과 다른 이름으로 부를 때. 검색에도 걸린다 */}
            <div className="space-y-1.5">
              <Label>브랜드명 <span className="text-muted-foreground text-xs font-normal">(회사명과 다르게 부를 때)</span></Label>
              <Input value={editVendor.nameEn || ''} onChange={e => update('nameEn', e.target.value)} placeholder="Atelier de LUMEN" />
              <p className="text-[11px] text-muted-foreground">여기 적은 브랜드명으로도 거래처 목록에서 검색됩니다.</p>
            </div>

            {/* 담당자 정보 */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">담당자 정보</p>
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
              </div>
            </div>

            {/* 계산서 발행 이메일 (국내 전용 — 해외는 세금계산서 대상이 아님) */}
            {editRegion === '국내' && (
            <div className="p-3 bg-primary/5 border border-primary/20 rounded-md space-y-2">
              <p className="text-xs font-medium text-primary">계산서 / 세금계산서 발행 정보</p>
              <div className="space-y-1.5">
                <Label className="text-xs">세금계산서 수신 이메일 <span className="text-muted-foreground font-normal">(담당자 이메일과 다를 경우 별도 입력)</span></Label>
                <Input
                  value={editVendor.billingEmail || ''}
                  onChange={e => update('billingEmail', e.target.value)}
                  placeholder="billing@example.com (비우면 담당자 이메일 사용)"
                  className="bg-card text-sm"
                />
                <p className="text-[11px] text-muted-foreground">비워두면 담당자 이메일로 발송됩니다.</p>
              </div>
            </div>
            )}

            {/* 해외 송금 계좌정보 (해외 업체 전용) */}
            {editRegion === '해외' && (
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-md space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-primary">해외 송금 계좌정보 (해외 업체 전용)</p>
                  {/* 파일 업로드 버튼 */}
                  <div>
                    <input
                      ref={bankFileInputRef}
                      type="file"
                      accept="image/*, .pdf, .xlsx, .xls"
                      className="hidden"
                      onChange={handleBankInfoFileUpload}
                      disabled={isBankFileLoading}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBankFileLoading}
                      onClick={() => bankFileInputRef.current?.click()}
                      className="gap-2 text-xs"
                    >
                      {isBankFileLoading ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" />파싱 중...</>
                      ) : (
                        <><Upload className="w-3.5 h-3.5" />계좌정보 파일에서 불러오기</>
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">엑셀(.xlsx/.xls) 또는 PDF/이미지 업로드 시 BENEFICIARY, BANK NAME, SWIFT CODE 등 자동 추출을 시도합니다.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">수취인 (BENEFICIARY)</Label>
                    <Input
                      value={editVendor.bankInfo?.beneficiary || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), beneficiary: e.target.value })}
                      placeholder="HONGKONG GIOCH TRADING LIMITED"
                      className="bg-card text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">주소 (ADDRESS)</Label>
                    <Input
                      value={editVendor.bankInfo?.address || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), address: e.target.value })}
                      placeholder="161 Queen's Road Central, HK"
                      className="bg-card text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">은행명 (BANK NAME)</Label>
                    <Input
                      value={editVendor.bankInfo?.bankName || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), bankName: e.target.value })}
                      placeholder="OCBC Wing Hang Bank Limited"
                      className="bg-card text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">계좌번호 (BANK ACCOUNT)</Label>
                    <Input
                      value={editVendor.bankInfo?.bankAccount || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), bankAccount: e.target.value })}
                      placeholder="035-802-796132-831"
                      className="bg-card text-sm font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">은행 코드 (BANK CODE)</Label>
                    <Input
                      value={editVendor.bankInfo?.bankCode || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), bankCode: e.target.value })}
                      placeholder="035"
                      className="bg-card text-sm font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">지점 코드 (BRANCH CODE)</Label>
                    <Input
                      value={editVendor.bankInfo?.branchCode || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), branchCode: e.target.value })}
                      placeholder="802"
                      className="bg-card text-sm font-mono"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">은행 주소 (BANK ADDRESS)</Label>
                    <Input
                      value={editVendor.bankInfo?.bankAddress || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), bankAddress: e.target.value })}
                      placeholder="161 Queen's Road Central, HK"
                      className="bg-card text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs font-semibold text-primary">SWIFT CODE</Label>
                    <Input
                      value={editVendor.bankInfo?.swiftCode || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), swiftCode: e.target.value.toUpperCase() })}
                      placeholder="WIHBHKHHXXX"
                      className="bg-card text-sm font-mono uppercase font-bold"
                    />
                  </div>
                </div>
              </div>
            )}

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
              <Label>검색창내용 <span className="text-muted-foreground text-xs font-normal">(브랜드명 등 실제로 찾을 때 치는 이름)</span></Label>
              <Input
                value={editVendor.memo || ''}
                onChange={e => update('memo', e.target.value)}
                placeholder="예: 아뜰리에드루멘 (회사명이 (주)아메스코테스여도 이 이름으로 검색됨)"
              />
              <p className="text-[11px] text-muted-foreground">여기 적은 말로 거래처 목록에서 검색됩니다. 여러 개면 띄어쓰기로 구분하세요.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleModalClose(true)}>취소</Button>
            <Button onClick={handleSave}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI 서류 자동등록 */}
      <Dialog open={showAiModal} onOpenChange={(o) => { if (!o && !aiLoading) setShowAiModal(false); }}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              AI 거래처 자동등록
            </DialogTitle>
          </DialogHeader>

          {aiStep === 'upload' && (
            <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                사업자등록증 · 통장사본 · 명함 사진/PDF와 계산서용 이메일·연락처 텍스트를 넣으면 AI가 채웁니다.
              </p>
              <div>
                <input
                  ref={aiFileRef}
                  type="file"
                  accept="image/*,.pdf,application/pdf"
                  multiple
                  className="hidden"
                  onChange={e => {
                    const list = Array.from(e.target.files || []);
                    if (list.length) setAiFiles(prev => [...prev, ...list].slice(0, 8));
                    if (aiFileRef.current) aiFileRef.current.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-24 border border-dashed border-border flex flex-col gap-1"
                  onClick={() => aiFileRef.current?.click()}
                >
                  <Upload className="w-6 h-6" />
                  <span className="text-sm font-medium">서류 추가 (최대 8개)</span>
                  <span className="text-[11px] text-muted-foreground">jpg / png / webp / pdf</span>
                </Button>
                {aiFiles.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {aiFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center justify-between text-xs bg-[var(--fill-quaternary)] rounded px-2 py-1.5">
                        <span className="truncate text-foreground">{f.name}</span>
                        <button
                          type="button"
                          className="text-[var(--system-red)] shrink-0 ml-2"
                          onClick={() => setAiFiles(prev => prev.filter((_, j) => j !== i))}
                        >
                          삭제
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>추가 정보 (이메일 · 연락처 · 메모)</Label>
                <textarea
                  value={aiNotes}
                  onChange={e => setAiNotes(e.target.value)}
                  className="w-full min-h-[100px] text-sm border border-border rounded-md p-3 resize-y"
                  placeholder={"예)\n계산서 이메일: tax@example.com\n담당자: 김○○ / 010-1234-5678\n위챗: wechat_id"}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAiModal(false)}>취소</Button>
                <Button
                  onClick={runAiVendorOcr}
                  disabled={aiLoading}
                  className="gap-2"
                >
                  {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {aiLoading ? '분석 중…' : 'AI 분석'}
                </Button>
              </DialogFooter>
            </div>
          )}

          {aiStep === 'type' && (
            <div className="space-y-4 py-2">
              <div className="bg-primary/5 border border-primary/10 rounded-md p-3 text-sm">
                <p className="font-medium text-foreground">이 거래처는 무엇인가요?</p>
                {aiDraft.typeHint && (
                  <p className="text-xs text-primary mt-1">AI 힌트: {aiDraft.typeHint}</p>
                )}
                {aiDraft.name || aiDraft.companyName ? (
                  <p className="text-xs text-muted-foreground mt-1">추출명: {aiDraft.name || aiDraft.companyName}</p>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {AI_TYPE_CHOICES.map(c => {
                  const Icon = c.icon;
                  const selected = aiType === c.type;
                  return (
                    <button
                      key={c.type}
                      type="button"
                      onClick={() => setAiType(c.type)}
                      className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                        selected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                          : 'border-border hover:border-primary/30 hover:bg-[var(--fill-quaternary)]'
                      }`}
                    >
                      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div>
                        <p className="text-sm font-semibold text-foreground">{c.label}</p>
                        <p className="text-xs text-muted-foreground">{c.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setAiStep('upload')}>← 서류 다시</Button>
                <Button onClick={confirmAiType}>다음 · 내용 확인</Button>
              </DialogFooter>
            </div>
          )}

          {aiStep === 'review' && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                유형: <span className="font-semibold text-primary">{aiType}</span> — 틀린 값은 수정 후 등록하세요.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ['name', '거래처명*'],
                  ['companyName', '사업자 상호'],
                  ['bizRegNo', '사업자번호'],
                  ['contactName', '담당자'],
                  ['contactPhone', '연락처'],
                  ['contactEmail', '이메일'],
                  ['billingEmail', '계산서 이메일'],
                  ['address', '주소'],
                  ['country', '국가'],
                ] as Array<[keyof AiVendorDraft, string]>).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input
                      value={(aiDraft[key] as string) || ''}
                      onChange={e => patchAiDraft(key, e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">계좌 정보</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['bankName', '은행명'],
                    ['bankAccount', '계좌번호'],
                    ['beneficiary', '예금주'],
                    ['swiftCode', 'SWIFT'],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs">{label}</Label>
                      <Input
                        value={aiDraft.bankInfo?.[key] || ''}
                        onChange={e => setAiDraft(d => ({
                          ...d,
                          bankInfo: { ...(d.bankInfo || {}), [key]: e.target.value },
                        }))}
                        className="h-8 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setAiStep('type')}>← 유형 다시</Button>
                <Button onClick={saveAiVendor}>거래처 등록</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
