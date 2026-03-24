// AMESCOTES ERP — 거래처 마스터 (Phase 1 개편)
import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { store, genId, type Vendor, type VendorType, type Currency, type BillingType } from '@/lib/store';
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
import { Plus, Search, Pencil, Trash2, Building2, Clock, Loader2, Paperclip, Upload } from 'lucide-react';

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

// 자재 유형 옵션
const MATERIAL_TYPE_OPTIONS: ('장식' | '원단' | '가죽' | '기타')[] = ['장식', '원단', '가죽', '기타'];

const EMPTY_VENDOR: Partial<Vendor> = {
  name: '', nameEn: '', nameCn: '', type: '바이어', country: '한국', currency: 'KRW',
  contactName: '', contactEmail: '', contactPhone: '',
  leadTimeDays: undefined,
  billingType: undefined, settlementCycle: '', bankInfo: undefined, memo: '',
  contactHistory: [],
  materialTypes: [],
  customType: '',
  customMaterialType: '',
};

export default function VendorMaster() {
  const queryClient = useQueryClient();
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const setVendors = (_v: Vendor[]) => {}; // no-op, replaced by useQuery
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterMaterialType, setFilterMaterialType] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [editVendor, setEditVendor] = useState<Partial<Vendor>>({ ...EMPTY_VENDOR });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [isBankFileLoading, setIsBankFileLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bankFileInputRef = useRef<HTMLInputElement>(null);
  // 변경사항 추적
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vendors'] });

  const filtered = useMemo(() => {
    let list = vendors;
    if (filterType !== 'all') list = list.filter(v => v.type === filterType);
    // 자재유형 필터 (자재거래처만 해당)
    if (filterMaterialType !== 'all') {
      list = list.filter(v =>
        v.type === '자재거래처' && (v.materialTypes || []).includes(filterMaterialType as '장식' | '원단' | '가죽' | '기타')
      );
    }
    if (search) list = list.filter(v =>
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      (v.nameEn || '').toLowerCase().includes(search.toLowerCase()) ||
      (v.nameCn || '').includes(search) ||
      (v.vendorCode || '').toUpperCase().includes(search.toUpperCase()) ||
      (v.contactName || '').toLowerCase().includes(search.toLowerCase())
    );
    return list;
  }, [vendors, search, filterType, filterMaterialType]);

  const openAdd = () => { setEditVendor({ ...EMPTY_VENDOR }); setIsEdit(false); setIsDirty(false); setShowModal(true); };
  const openEdit = (v: Vendor) => { setEditVendor({ ...v }); setIsEdit(true); setIsDirty(false); setShowModal(true); };

  const handleModalClose = useCallback((requestClose: boolean) => {
    if (!requestClose) return;
    if (isDirty) {
      setShowUnsavedDialog(true);
    } else {
      setShowModal(false);
    }
  }, [isDirty]);

  const handleSave = () => {
    if (!editVendor.name) { toast.error('거래처명을 입력해주세요'); return; }
    if (!editVendor.type) { toast.error('거래처 유형을 선택해주세요'); return; }

    // 거래처명 중복 검사 (신규 등록 시)
    if (!isEdit || !editVendor.id) {
      const dupName = vendors.find((v: Vendor) => v.name === editVendor.name);
      if (dupName) { toast.error(`'${editVendor.name}'은(는) 이미 등록된 거래처입니다`); return; }
    }

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
          code: editVendor.code?.toUpperCase(),
          vendorCode: editVendor.vendorCode?.toUpperCase(),
        } as Vendor
      : {
          ...editVendor,
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
        toast.success('엑셀 거래처 정보가 자동 입력되었습니다 ✅');
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
      toast.success('사업자등록증 정보가 자동 입력되었습니다 ✅');
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
        toast.success('엑셀 계좌정보가 자동 입력되었습니다 ✅');
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
        toast.success(`계좌정보 ${filledCount}개 필드가 자동 입력되었습니다 ✅`);
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

  const updateCode = (field: 'code' | 'vendorCode', val: string, maxLen: number) => {
    const clean = val.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, maxLen);
    setEditVendor(v => ({ ...v, [field]: clean }));
    setIsDirty(true);
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
      <div className="grid grid-cols-6 gap-3">
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
            onClick={() => { setFilterType(t); setFilterMaterialType('all'); }}
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

      {/* 자재유형 필터 (자재거래처 탭 선택 시 표시) */}
      {filterType === '자재거래처' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-500">자재 유형:</span>
          <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl w-fit">
            {(['all', ...MATERIAL_TYPE_OPTIONS] as const).map(t => (
              <button
                key={t}
                onClick={() => setFilterMaterialType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  filterMaterialType === t
                    ? 'bg-white text-stone-800 shadow-sm'
                    : 'text-stone-500 hover:text-stone-700'
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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="거래처명 / 코드 검색" className="pl-9 h-9" />
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
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-stone-300 accent-amber-700 cursor-pointer"
                />
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">거래처명</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">코드</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">유형</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">자재유형</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">담당자</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">연락처</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">결제조건</th>
              {/* 공장 유형 필터 시 SWIFT CODE 컬럼 표시 */}
              {(filterType === '공장' || filterType === '해외공장' || filtered.some(v => v.type === '공장' || v.type === '해외공장')) && (
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">SWIFT CODE</th>
              )}
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-stone-400">
                <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 거래처가 없습니다</p>
              </td></tr>
) : filtered.map(v => {
  const isChecked = selectedIds.has(v.id);
  return (
              <tr key={v.id} className={`border-b border-stone-50 hover:bg-stone-50/50 ${isChecked ? 'bg-amber-50/60' : ''}`}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(v.id)}
                    className="w-4 h-4 rounded border-stone-300 accent-amber-700 cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-stone-800">{v.name}</p>
                    {v.type === '자재거래처' && !v.contactName && !v.contactEmail && !v.contactPhone && (
                      <span title="기본 정보 미입력 — 거래처 마스터에서 연락처 정보 입력 필요" className="text-red-500 text-sm leading-none cursor-help">🔴</span>
                    )}
                  </div>
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
                    {v.type === '기타' && v.customType ? `기타 (${v.customType})` : v.type}
                  </span>
                </td>
                {/* 자재유형 (자재거래처만 표시) */}
                <td className="px-4 py-3">
                  {v.type === '자재거래처' && (v.materialTypes || []).length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {(v.materialTypes || []).map(mt => (
                        <span key={mt} className="text-xs px-1.5 py-0.5 rounded bg-green-50 border border-green-200 text-green-700">
                          {mt === '기타' && v.customMaterialType ? `기타 (${v.customMaterialType})` : mt}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-stone-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="text-stone-700">{v.contactName || '-'}</p>
                </td>
                <td className="px-4 py-3 text-stone-500 text-xs">
                  {v.contactEmail && <p>{v.contactEmail}</p>}
                  {v.contactPhone && <p>{v.contactPhone}</p>}
                  {!v.contactEmail && !v.contactPhone && (
                    <span className="flex items-center gap-1">
                      {v.type === '자재거래처' && !v.contactName && (
                        <span title="기본 정보 미입력 — 전화번호, 이메일, 연락처 없음" className="text-red-500 text-sm cursor-help">🔴</span>
                      )}
                      <span>-</span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-stone-500 text-xs">
                  {v.billingType ? <p className="text-xs">{v.billingType}</p> : <span className="text-stone-300 text-xs">—</span>}
                  {v.settlementCycle && <p>{v.settlementCycle}</p>}
                </td>
                {/* SWIFT CODE 컬럼 (공장 유형이 목록에 있을 때만 표시) */}
                {(filterType === '공장' || filterType === '해외공장' || filtered.some(vv => vv.type === '공장' || vv.type === '해외공장')) && (
                  <td className="px-4 py-3 text-stone-500 text-xs">
                    {(v.type === '공장' || v.type === '해외공장') && v.bankInfo?.swiftCode ? (
                      <span className="font-mono text-sky-700 bg-sky-50 px-2 py-0.5 rounded text-xs border border-sky-200">
                        {v.bankInfo.swiftCode}
                      </span>
                    ) : <span className="text-stone-300">—</span>}
                  </td>
                )}
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
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isEdit ? '거래처 수정' : '거래처 등록'}</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">

            {/* 사업자등록증 / 거래처정보 업로드 */}
            <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
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
                className="gap-2 border-amber-400 text-amber-800 hover:bg-amber-100 whitespace-nowrap"
              >
                {isOcrLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />인식 중...</>
                ) : (
                  <><Paperclip className="w-4 h-4" />사업자등록증 / 거래처정보 업로드</>
                )}
              </Button>
              <p className="text-xs text-amber-700">이미지·PDF → 사업자등록증 OCR | 엑셀(.xlsx/.xls) → 거래처 정보 자동 매핑</p>
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
                <Label>자재 유형 <span className="text-stone-400 text-xs font-normal">(복수 선택 가능)</span></Label>
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
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          isSelected
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-white text-stone-600 border-stone-300 hover:border-green-400'
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
                <p className="text-[11px] text-stone-400">장식, 원단, 가죽, 기타 중 해당 유형을 모두 선택해주세요</p>
              </div>
            )}

            {/* 거래처명 */}
            <div className="space-y-1.5">
              <Label>거래처명 <span className="text-red-500">*</span></Label>
              <Input value={editVendor.name || ''} onChange={e => update('name', e.target.value)} placeholder="아뜰리에 드 루멘" />
            </div>

            {/* 브랜딩 (바이어만 표시) */}
            {editVendor.type === '바이어' && (
              <div className="space-y-1.5">
                <Label>브랜드명 <span className="text-stone-400 text-xs font-normal">(브랜딩 표기용, 바이어 전용)</span></Label>
                <Input value={editVendor.nameEn || ''} onChange={e => update('nameEn', e.target.value)} placeholder="Atelier de LUMEN" />
              </div>
            )}

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



            {/* 해외공장 계좌정보 섹션 (해외공장 유형일 때만 표시) */}
            {editVendor.type === '해외공장' && (
              <div className="p-4 bg-sky-50 border border-sky-200 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-sky-700">🏦 해외 송금 계좌정보 (해외공장 전용)</p>
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
                      className="gap-2 border-sky-400 text-sky-700 hover:bg-sky-100 text-xs"
                    >
                      {isBankFileLoading ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" />파싱 중...</>
                      ) : (
                        <><Upload className="w-3.5 h-3.5" />계좌정보 파일에서 불러오기</>
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-sky-600">엑셀(.xlsx/.xls) 또는 PDF/이미지 업로드 시 BENEFICIARY, BANK NAME, SWIFT CODE 등 자동 추출을 시도합니다.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">수취인 (BENEFICIARY)</Label>
                    <Input
                      value={editVendor.bankInfo?.beneficiary || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), beneficiary: e.target.value })}
                      placeholder="HONGKONG GIOCH TRADING LIMITED"
                      className="bg-white text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">주소 (ADDRESS)</Label>
                    <Input
                      value={editVendor.bankInfo?.address || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), address: e.target.value })}
                      placeholder="161 Queen's Road Central, HK"
                      className="bg-white text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">은행명 (BANK NAME)</Label>
                    <Input
                      value={editVendor.bankInfo?.bankName || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), bankName: e.target.value })}
                      placeholder="OCBC Wing Hang Bank Limited"
                      className="bg-white text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">계좌번호 (BANK ACCOUNT)</Label>
                    <Input
                      value={editVendor.bankInfo?.bankAccount || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), bankAccount: e.target.value })}
                      placeholder="035-802-796132-831"
                      className="bg-white text-sm font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">은행 코드 (BANK CODE)</Label>
                    <Input
                      value={editVendor.bankInfo?.bankCode || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), bankCode: e.target.value })}
                      placeholder="035"
                      className="bg-white text-sm font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">지점 코드 (BRANCH CODE)</Label>
                    <Input
                      value={editVendor.bankInfo?.branchCode || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), branchCode: e.target.value })}
                      placeholder="802"
                      className="bg-white text-sm font-mono"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">은행 주소 (BANK ADDRESS)</Label>
                    <Input
                      value={editVendor.bankInfo?.bankAddress || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), bankAddress: e.target.value })}
                      placeholder="161 Queen's Road Central, HK"
                      className="bg-white text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs font-semibold text-sky-800">SWIFT CODE</Label>
                    <Input
                      value={editVendor.bankInfo?.swiftCode || ''}
                      onChange={e => update('bankInfo', { ...(editVendor.bankInfo || {}), swiftCode: e.target.value.toUpperCase() })}
                      placeholder="WIHBHKHHXXX"
                      className="bg-white text-sm font-mono uppercase font-bold tracking-widest"
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
              <Label>메모</Label>
              <Input value={editVendor.memo || ''} onChange={e => update('memo', e.target.value)} placeholder="비고" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleModalClose(true)}>취소</Button>
            <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
