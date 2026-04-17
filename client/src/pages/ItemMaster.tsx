// AMESCOTES ERP — 품목 마스터 (대규모 개편)
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { store, genId, formatKRW, normalizeColors, type Item, type ItemColor, type Season, type Category, type ErpCategory, type ProductionOrder, type ColorQty } from '@/lib/store';
import { fetchItems, upsertItem, deleteItem as deleteItemSB, fetchVendors, fetchBoms } from '@/lib/supabaseQueries';
import { resizeImage } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Pencil, Trash2, Package, Wand2, AlertCircle, X, Palette, BarChart2, Link, ShoppingCart, Printer, Download, Upload, FileSpreadsheet, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

// HB 전용 세부 카테고리
const HB_CATEGORIES: Category[] = ['숄더백', '토트백', '크로스백', '클러치', '백팩', '기타'];
// SLG 전용 세부 카테고리
const SLG_CATEGORIES: Category[] = ['파우치', '키링', '지갑', '기타'];

const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS'];

// 카테고리 → 제품유형코드 매핑
const CATEGORY_CODE_MAP: Record<Category, string> = {
  '숄더백': 'HB', '토트백': 'HB', '크로스백': 'HB', '클러치': 'HB', '백팩': 'BP',
  '파우치': 'SL', '키링': 'SL', '지갑': 'SL', '기타': 'ETC',
};

const ERP_CAT_COLOR: Record<ErpCategory, string> = {
  'HB':  'bg-blue-50 text-blue-700 border-blue-200',
  'SLG': 'bg-purple-50 text-purple-700 border-purple-200',
};

function generateStyleNo(
  brandCode: string,
  registDate: Date,
  category: Category,
  existingItems: Item[],
  currentItemId?: string,
  erpCategory?: ErpCategory
): string {
  const yy = String(registDate.getFullYear()).slice(2);
  const mm = String(registDate.getMonth() + 1).padStart(2, '0');
  // erpCategory가 SLG면 'SL'로 강제 적용
  let typeCode = CATEGORY_CODE_MAP[category] || 'HB';
  if (erpCategory === 'SLG') typeCode = 'SL';
  else if (erpCategory === 'HB' && typeCode === 'SL') typeCode = 'HB'; // SLG 카테고리가 HB로 변경 시 복원
  const prefix = `${brandCode.toUpperCase()}${yy}${mm}${typeCode}`;
  const existing = existingItems.filter(it => it.styleNo.startsWith(prefix) && it.id !== currentItemId);
  let maxSeq = 0;
  for (const it of existing) {
    const seq = parseInt(it.styleNo.slice(prefix.length), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(2, '0')}`;
}

const emptyItem: Partial<Item> = {
  styleNo: '', name: '', nameEn: '', season: '26SS', category: '숄더백',
  erpCategory: 'HB', materialType: '완제품',
  material: '', deliveryPrice: 0,
  colors: [], memo: '',
};

// ─── 컬럼 너비 리사이즈 기본값 ───
const ITEM_DEFAULT_COL_WIDTHS: Record<string, number> = {
  image: 60, styleNo: 130, season: 80, buyer: 120, name: 180,
  category: 80, color: 100, delivery: 90, bomCost: 100, salePrice: 110, multiple: 80, margin: 90,
  noOrder: 90, createdAt: 100, bom: 60, action: 60,
};

export default function ItemMaster() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  // URL 파라미터 (샘플 관리에서 품목등록 버튼 클릭 시 전달됨)
  const searchString = useSearch();
  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: fetchItems });
  const setItems = (_v: Item[]) => {}; // no-op
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const [search, setSearch] = useState('');
  const [filterSeason, setFilterSeason] = useState('전체');
  const [filterCategory, setFilterCategory] = useState('전체');
  const [filterErpCategory, setFilterErpCategory] = useState('전체');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<Partial<Item>>({ ...emptyItem });
  const [isEdit, setIsEdit] = useState(false);
  // 변경사항 추적
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [manualStyleNo, setManualStyleNo] = useState(false);
  const [registDate, setRegistDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [previewStyleNo, setPreviewStyleNo] = useState('');
  const [colorInput, setColorInput] = useState('');
  const [colorDetailOpen, setColorDetailOpen] = useState<number | null>(null); // 열린 컬러 세부정보 인덱스
  const [filterBuyer, setFilterBuyer] = useState('전체');
  const [filterNoBom, setFilterNoBom] = useState(false);
  const [filterStyleNo, setFilterStyleNo] = useState('');
  const [filterName, setFilterName] = useState('');
  const [sortField, setSortField] = useState<'styleNo' | 'name' | 'season' | 'createdAt' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showSeasonStats, setShowSeasonStats] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [seasonStatsTarget, setSeasonStatsTarget] = useState('전체');
  const [customCategory, setCustomCategory] = useState(''); // 세부 카테고리 직접 입력
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: () => import('@/lib/supabaseQueries').then(m => m.fetchOrders()) }); // 미발주기간 계산용
  const imageFileRef = useRef<HTMLInputElement>(null);
  const excelUploadRef = useRef<HTMLInputElement>(null);

  // ─── 컬럼 너비 리사이즈 ───
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('ames_item_col_widths');
      if (saved) return { ...ITEM_DEFAULT_COL_WIDTHS, ...JSON.parse(saved) };
    } catch {}
    return { ...ITEM_DEFAULT_COL_WIDTHS };
  });
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  const startResize = useCallback((e: React.MouseEvent, col: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidthsRef.current[col];
    const onMove = (ev: MouseEvent) => {
      setColWidths(prev => ({ ...prev, [col]: Math.max(40, startW + ev.clientX - startX) }));
    };
    const onUp = () => {
      setColWidths(prev => {
        localStorage.setItem('ames_item_col_widths', JSON.stringify(prev));
        return prev;
      });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // ─── 엑셀 일괄 등록 상태 ───
  const [excelPreviewOpen, setExcelPreviewOpen] = useState(false);
  const [excelPreviewItems, setExcelPreviewItems] = useState<Array<{
    styleNo: string; name: string; nameEn: string; season: string;
    category: string; erpCategory: string; colors: string[];
    salePriceKrw: number | null; material: string; memo: string;
    isDuplicate: boolean;
  }>>([]);

  // 양식 다운로드
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['스타일번호*', '품목명*', '품목명(영문)', '시즌', '카테고리', 'ERP카테고리', '컬러코드1', '컬러코드2', '컬러코드3', '판매가', '소재', '메모'],
      ['LLL6S82', 'SOFIA WEAVING BAG', 'SOFIA WEAVING BAG', '26SS', '숄더백', 'HB', 'OB', 'SB', '', 398000, '소프트레더', ''],
    ]);
    ws['!cols'] = [
      { wch: 14 }, { wch: 30 }, { wch: 30 }, { wch: 8 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '품목등록양식');
    XLSX.writeFile(wb, '품목등록양식.xlsx');
    toast.success('양식 다운로드 완료');
  };

  // 엑셀 파싱 (표준 양식 + atlm.kr 형식)
  const parseExcelFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

        if (rows.length < 2) { toast.error('데이터가 없습니다'); return; }

        // 헤더로 형식 감지
        const header = rows[0].map((h: any) => String(h || '').trim());
        const isStandardFormat = header[0]?.includes('스타일번호');
        const isAtlmFormat = header.length >= 15 && (header[2]?.includes('상품코드') || header[14]?.includes('제조사') || !isStandardFormat);

        const grouped: Record<string, typeof excelPreviewItems[0]> = {};
        const existingStyleNos = new Set((items as Item[]).map(i => i.styleNo));

        const dataRows = rows.slice(1).filter(r => r && r.length >= 2);

        for (const row of dataRows) {
          if (isAtlmFormat && !isStandardFormat) {
            // atlm.kr 형식: Col4=상품명, Col14=판매가, Col15=스타일번호+컬러
            const name = String(row[3] || '').trim();
            const price = row[13];
            const fullStyle = String(row[14] || '').trim();
            if (!name || !fullStyle) continue;

            const colorMatch = fullStyle.match(/([A-Z]{2,4})$/);
            const colorCode = colorMatch ? colorMatch[1] : '';
            const styleNo = colorCode ? fullStyle.slice(0, -colorCode.length) : fullStyle;
            if (!styleNo) continue;

            if (!grouped[styleNo]) {
              grouped[styleNo] = {
                styleNo, name, nameEn: '', season: '26SS', category: '숄더백',
                erpCategory: 'HB', colors: [], salePriceKrw: price ? Number(price) : null,
                material: '', memo: '', isDuplicate: existingStyleNos.has(styleNo),
              };
            }
            if (colorCode && !grouped[styleNo].colors.includes(colorCode)) {
              grouped[styleNo].colors.push(colorCode);
            }
          } else {
            // 표준 양식
            const styleNo = String(row[0] || '').trim();
            const name = String(row[1] || '').trim();
            if (!styleNo || !name) continue;

            const colors: string[] = [];
            [row[6], row[7], row[8]].forEach(c => { if (c) colors.push(String(c).trim()); });

            grouped[styleNo] = {
              styleNo,
              name,
              nameEn: String(row[2] || '').trim(),
              season: String(row[3] || '26SS').trim(),
              category: String(row[4] || '숄더백').trim(),
              erpCategory: String(row[5] || 'HB').trim(),
              colors,
              salePriceKrw: row[9] ? Number(row[9]) : null,
              material: String(row[10] || '').trim(),
              memo: String(row[11] || '').trim(),
              isDuplicate: existingStyleNos.has(styleNo),
            };
          }
        }

        const result = Object.values(grouped);
        if (result.length === 0) { toast.error('파싱된 데이터가 없습니다'); return; }
        setExcelPreviewItems(result);
        setExcelPreviewOpen(true);
      } catch (err) {
        toast.error('엑셀 파싱 실패: ' + String(err));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 엑셀 일괄 등록 실행
  const handleExcelBulkRegister = async () => {
    const toRegister = excelPreviewItems.filter(p => !p.isDuplicate);
    if (toRegister.length === 0) { toast.error('등록할 신규 품목이 없습니다'); return; }

    let success = 0;
    let fail = 0;
    for (const p of toRegister) {
      try {
        const itemData: Item = {
          id: genId(),
          styleNo: p.styleNo,
          name: p.name,
          nameEn: p.nameEn || undefined,
          season: (p.season as Season) || '26SS',
          category: (p.category as Category) || '숄더백',
          erpCategory: (p.erpCategory as ErpCategory) || 'HB',
          materialType: '완제품',
          itemStatus: 'ACTIVE',
          material: p.material || '',
          deliveryPrice: p.salePriceKrw || 0,
          colors: p.colors.map(c => ({ name: c })),
          hasBom: false,
          createdAt: new Date().toISOString(),
          memo: p.memo || '',
        };
        await upsertItem(itemData);
        success++;
      } catch {
        fail++;
      }
    }
    setExcelPreviewOpen(false);
    setExcelPreviewItems([]);
    refresh();
    toast.success(`일괄 등록 완료: ${success}개 등록, ${excelPreviewItems.filter(p => p.isDuplicate).length}개 중복 스킵${fail > 0 ? `, ${fail}개 실패` : ''}`);
    if (excelUploadRef.current) excelUploadRef.current.value = '';
  };

  const handleItemImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await resizeImage(file);
      setEditItem(prev => ({ ...prev, imageUrl: base64 }));
    } catch {
      toast.error('이미지 업로드 실패');
    }
    if (imageFileRef.current) imageFileRef.current.value = '';
  };

  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['items'] }); queryClient.invalidateQueries({ queryKey: ['boms'] }); };
  const { data: boms = [] } = useQuery({ queryKey: ['boms'], queryFn: fetchBoms });

  // 현재 선택된 erpCategory에 따른 세부 카테고리 옵션
  const subCategories = editItem.erpCategory === 'SLG' ? SLG_CATEGORIES : HB_CATEGORIES;

  /**
   * BOM 원가 기반 마진 계산
   * deliveryPrice = 납품가 (바이어에게 납품하는 금액)
   * bomCost = BOM에서 자동 조회한 총원가 (자재비 + 임가공비, KRW)
   * 마진금액 = 납품가 - BOM원가
   * 마진율 = 마진금액 / 납품가 × 100
   */
  const calcMargin = (deliveryPrice: number, bomCost: number) => {
    if (!deliveryPrice || deliveryPrice <= 0) return { rate: null, amount: null };
    const amount = deliveryPrice - bomCost;
    const rate = (amount / deliveryPrice) * 100;
    return { rate, amount };
  };

  /**
   * 마진율 색상 클래스 반환
   * 30% 이상: 초록, 15~30%: 노란색, 15% 미만: 빨간색
   */
  const marginColorClass = (rate: number): string => {
    if (rate >= 30) return 'text-green-600';
    if (rate >= 15) return 'text-amber-600';
    return 'text-red-500';
  };

  const activeFilterCount = [
    filterStyleNo !== '',
    filterName !== '',
    filterSeason !== '전체',
    filterCategory !== '전체',
    filterErpCategory !== '전체',
    filterBuyer !== '전체',
    filterNoBom,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setSearch('');
    setFilterStyleNo('');
    setFilterName('');
    setFilterSeason('전체');
    setFilterCategory('전체');
    setFilterErpCategory('전체');
    setFilterBuyer('전체');
    setFilterNoBom(false);
  };

  const handleSort = (field: 'styleNo' | 'name' | 'season' | 'createdAt') => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: string }) => (
    <span className={`ml-1 text-[10px] ${sortField === field ? 'text-amber-500' : 'text-stone-300'}`}>
      {sortField === field ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
    </span>
  );

  const filtered = useMemo(() => {
    let result = items.filter(item => {
      const buyerName = vendors.find(v => v.id === item.buyerId)?.name || '';
      const matchSearch = !search ||
        item.styleNo.toLowerCase().includes(search.toLowerCase()) ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        buyerName.toLowerCase().includes(search.toLowerCase());
      const matchStyleNo = !filterStyleNo || item.styleNo.toLowerCase().includes(filterStyleNo.toLowerCase());
      const matchName = !filterName ||
        item.name.toLowerCase().includes(filterName.toLowerCase()) ||
        (item.nameEn || '').toLowerCase().includes(filterName.toLowerCase());
      const matchSeason = filterSeason === '전체' || item.season === filterSeason;
      const matchCat = filterCategory === '전체' || item.category === filterCategory;
      const matchErpCat = filterErpCategory === '전체' || item.erpCategory === filterErpCategory;
      const matchBuyer = filterBuyer === '전체' || item.buyerId === filterBuyer;
      const matchNoBom = !filterNoBom || !item.hasBom;
      return matchSearch && matchStyleNo && matchName && matchSeason && matchCat && matchErpCat && matchBuyer && matchNoBom;
    });

    if (sortField) {
      result = [...result].sort((a, b) => {
        let aVal = '', bVal = '';
        if (sortField === 'styleNo') { aVal = a.styleNo; bVal = b.styleNo; }
        else if (sortField === 'name') { aVal = a.name; bVal = b.name; }
        else if (sortField === 'season') { aVal = a.season || ''; bVal = b.season || ''; }
        else if (sortField === 'createdAt') { aVal = a.createdAt || ''; bVal = b.createdAt || ''; }
        const cmp = aVal.localeCompare(bVal, 'ko');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [items, search, filterStyleNo, filterName, filterSeason, filterCategory, filterErpCategory, filterBuyer, filterNoBom, sortField, sortDir, vendors]);

  // 자동생성 미리보기
  useEffect(() => {
    if (manualStyleNo) return;
    const vendor = vendors.find(v => v.id === selectedVendorId);
    if (!vendor?.code || !editItem.category) { setPreviewStyleNo(''); return; }
    const date = registDate ? new Date(registDate) : new Date();
    const generated = generateStyleNo(vendor.code, date, editItem.category as Category, items as Item[], isEdit ? editItem.id : undefined, editItem.erpCategory);
    setPreviewStyleNo(generated);
    setEditItem(prev => ({ ...prev, styleNo: generated }));
  }, [selectedVendorId, registDate, editItem.category, editItem.erpCategory, manualStyleNo, isEdit, editItem.id, vendors, items]);

  const openAdd = (prefill?: { styleNo?: string; buyerId?: string; season?: string; styleName?: string; imageUrl?: string }) => {
    // 샘플에서 넘어온 prefill 확인
    const storedPrefill = localStorage.getItem('ames_prefill_item');
    const pf = prefill || (storedPrefill ? JSON.parse(storedPrefill) : null);
    if (storedPrefill) localStorage.removeItem('ames_prefill_item');

    setEditItem({
      ...emptyItem,
      colors: [],
      styleNo: pf?.styleNo || '',
      name: pf?.styleName || '',
      buyerId: pf?.buyerId || '',
      season: (pf?.season as Season) || '26SS',
      imageUrl: pf?.imageUrl || undefined,
    });
    setIsEdit(false);
    setManualStyleNo(pf?.styleNo ? true : false);
    setRegistDate(new Date().toISOString().split('T')[0]);
    setSelectedVendorId(pf?.buyerId || '');
    setPreviewStyleNo(pf?.styleNo || '');
    setColorInput('');
    setCustomCategory('');
    setIsDirty(false);
    setModalOpen(true);
  };

  // 진입 시 prefill 체크 (localStorage 또는 URL 파라미터)
  useEffect(() => {
    // 1) URL 파라미터 우선 체크 (샘플관리 → 품목등록 버튼 클릭 시)
    const urlParams = new URLSearchParams(searchString);
    const urlSampleId = urlParams.get('sampleId');
    const urlStyleNo = urlParams.get('styleNo');
    const urlStyleName = urlParams.get('styleName');
    const urlBuyerId = urlParams.get('buyerId');
    const urlSeason = urlParams.get('season');

    if (urlStyleName || urlBuyerId || urlSampleId) {
      const pf: {
        styleNo: string;
        styleName: string;
        buyerId: string;
        season: string;
        sampleId?: string;
        imageUrl?: string;
      } = {
        styleNo: urlStyleNo || '',
        styleName: urlStyleName || '',
        buyerId: urlBuyerId || '',
        season: urlSeason || '26SS',
        sampleId: urlSampleId || undefined,
      };
      const storedPrefill = localStorage.getItem('ames_prefill_item');
      if (storedPrefill) {
        try {
          const stored = JSON.parse(storedPrefill);
          if (stored.imageUrl) pf.imageUrl = stored.imageUrl;
          localStorage.removeItem('ames_prefill_item');
        } catch { /* 무시 */ }
      }
      if (pf.sampleId) sessionStorage.setItem('ames_link_sampleId', pf.sampleId);
      openAdd(pf);
      navigate('/items', { replace: true });
      return;
    }
    // 2) localStorage prefill 체크 (기존 방식 호환)
    const storedPrefill = localStorage.getItem('ames_prefill_item');
    if (storedPrefill) {
      try {
        const pf = JSON.parse(storedPrefill);
        if (pf.sampleId) sessionStorage.setItem('ames_link_sampleId', pf.sampleId);
        openAdd(pf);
      } catch {
        localStorage.removeItem('ames_prefill_item');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (item: Item) => {
    setEditItem({ ...item, colors: normalizeColors(item.colors || []) });
    setIsEdit(true); setManualStyleNo(true);
    setRegistDate(item.createdAt.split('T')[0]);
    setSelectedVendorId(''); setPreviewStyleNo(item.styleNo); setColorInput('');
    setCustomCategory(item.customCategory || '');
    setColorDetailOpen(null);
    setIsDirty(false);
    setModalOpen(true);
  };

  const handleModalClose = useCallback((requestClose: boolean) => {
    if (!requestClose) return;
    if (isDirty) {
      setShowUnsavedDialog(true);
    } else {
      setModalOpen(false);
    }
  }, [isDirty]);

  const handleSave = () => {
    if (!editItem.styleNo || !editItem.name) { toast.error('스타일번호와 품명을 입력하세요'); return; }
    if (!isEdit) {
      const dup = (items as Item[]).find(it => it.styleNo === editItem.styleNo);
      if (dup) { toast.error(`스타일번호 '${editItem.styleNo}'는 이미 등록되어 있습니다`); return; }
    }

    // 바이어 연결: selectedVendorId(자동생성 거래처)가 있으면 적용
    const buyerId = selectedVendorId || editItem.buyerId;

    // 납품가: deliveryPrice 우선, 없으면 targetSalePrice 사용
    const deliveryVal = editItem.deliveryPrice || editItem.targetSalePrice || 0;

    // BOM 원가 조회 후 마진 자동 계산
    const bomCostForSave = editItem.styleNo ? store.getBomTotalCost(editItem.styleNo) : 0;
    let marginAmountVal: number | undefined;
    let marginRateVal: number | undefined;
    if (deliveryVal > 0) {
      marginAmountVal = deliveryVal - bomCostForSave;
      marginRateVal = (marginAmountVal / deliveryVal) * 100;
    }

    const itemData = isEdit && editItem.id
      ? {
          ...editItem,
          buyerId,
          colors: normalizeColors(editItem.colors || []),
          deliveryPrice: deliveryVal,
          targetSalePrice: deliveryVal,
          marginAmount: marginAmountVal,
          marginRate: marginRateVal,
          materialType: '완제품' as const,
          customCategory: customCategory || undefined,
        } as Item
      : {
          ...editItem,
          buyerId,
          deliveryPrice: deliveryVal,
          targetSalePrice: deliveryVal,
          marginAmount: marginAmountVal,
          marginRate: marginRateVal,
          id: genId(),
          hasBom: false,
          createdAt: new Date().toISOString(),
          materialType: '완제품' as const,
          itemStatus: 'ACTIVE' as const,
          customCategory: customCategory || undefined,
        } as Item;

    upsertItem(itemData)
      .then(async () => {
        if (!isEdit) {
          // 샘플-품목 연결
          const linkedSampleId = sessionStorage.getItem('ames_link_sampleId');
          if (linkedSampleId) {
            try {
              const { upsertSample } = await import('@/lib/supabaseQueries');
              const samples = (await import('@/lib/supabaseQueries').then(m => m.fetchSamples()));
              const linkedSample = samples.find((s: any) => s.id === linkedSampleId);
              if (linkedSample) {
                await upsertSample({ ...linkedSample, styleId: itemData.id, styleNo: itemData.styleNo });
                toast.success(`품목 등록 완료 — 샘플 "${linkedSample.styleName}"에 연결되었습니다`);
              } else {
                toast.success('품목이 등록되었습니다');
              }
            } catch { toast.success('품목이 등록되었습니다'); }
            sessionStorage.removeItem('ames_link_sampleId');
          } else {
            toast.success('품목이 등록되었습니다');
          }
        } else {
          toast.success('품목이 수정되었습니다');
        }
        setIsDirty(false);
        setModalOpen(false);
        refresh();
      })
      .catch((e: Error) => toast.error(`저장 실패: ${e.message}`));
  };

  const handleDelete = (id: string) => {
    if (confirm('정말 삭제하시겠습니까?')) {
      deleteItemSB(id)
        .then(() => { toast.success('삭제되었습니다'); refresh(); })
        .catch((e: Error) => toast.error(`삭제 실패: ${e.message}`));
    }
  };

  // 체크박스 다중 선택 관련
  const displayItems = showSelectedOnly ? filtered.filter(i => selectedIds.has(i.id)) : filtered;
  const isAllSelected = filtered.length > 0 && filtered.every(item => selectedIds.has(item.id));
  const isIndeterminate = filtered.some(item => selectedIds.has(item.id)) && !isAllSelected;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(item => item.id)));
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
      Promise.all([...selectedIds].map(id => deleteItemSB(id)))
        .then(() => { setSelectedIds(new Set()); toast.success(`${count}개 항목이 삭제되었습니다`); refresh(); })
        .catch((e: Error) => toast.error(`삭제 실패: ${e.message}`));
    }
  };

  // 일괄 발주 모달 상태
  const [bulkOrderModalOpen, setBulkOrderModalOpen] = useState(false);

  const handleBulkOrder = () => {
    if (selectedIds.size === 0) return;
    setBulkOrderModalOpen(true);
  };

  const addColor = () => {
    const c = colorInput.trim();
    if (!c) return;
    const existing = normalizeColors(editItem.colors || []);
    if (existing.find(x => x.name === c)) { toast.error('이미 추가된 컬러입니다'); return; }
    setEditItem(prev => ({ ...prev, colors: [...normalizeColors(prev.colors || []), { name: c }] }));
    setColorInput('');
  };

  const removeColor = (idx: number) => {
    const colorName = normalizeColors(editItem.colors || [])[idx]?.name;
    if (!confirm(`"${colorName || '이 컬러'}"를 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) return;
    setEditItem(prev => {
      const normalized = normalizeColors(prev.colors || []);
      return { ...prev, colors: normalized.filter((_, i) => i !== idx) };
    });
    setColorDetailOpen(null);
  };

  const updateColorDetail = (idx: number, field: keyof Omit<ItemColor, 'name'>, value: string) => {
    setEditItem(prev => {
      const normalized = normalizeColors(prev.colors || []);
      normalized[idx] = { ...normalized[idx], [field]: value };
      return { ...prev, colors: normalized };
    });
  };

  // 시즌별 스타일 현황
  const seasonStats = useMemo(() => {
    const seasons = seasonStatsTarget === '전체' ? SEASONS : [seasonStatsTarget as Season];
    return seasons.map(season => {
      const seasonItems = items.filter(i => i.season === season);
      return {
        season,
        total: seasonItems.length,
        hb: seasonItems.filter(i => i.erpCategory === 'HB').length,
        slg: seasonItems.filter(i => i.erpCategory === 'SLG').length,
        hasBom: seasonItems.filter(i => i.hasBom).length,
        noBom: seasonItems.filter(i => !i.hasBom).length,
      };
    });
  }, [items, seasonStatsTarget]);

  // 바이어 거래처만
  const buyerVendors = vendors.filter(v => v.type === '바이어');
  const brandVendors = vendors.filter(v => v.code);

  // 미발주기간 계산: 마지막 발주일 기준 경과 개월 수
  const monthsSinceLastOrder = (item: Item): number | null => {
    const itemOrders = orders.filter(o => o.styleId === item.id);
    if (itemOrders.length === 0) return null;
    const latest = itemOrders.reduce((a, b) => a.createdAt > b.createdAt ? a : b);
    const diffMs = Date.now() - new Date(latest.createdAt).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30));
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">품목 마스터</h1>
          <p className="text-sm text-stone-500 mt-0.5">스타일별 품목 정보 · HB (핸드백) / SLG (소품)</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setShowSeasonStats(true)} className="gap-2 border-stone-300 text-stone-600 hover:bg-stone-50">
            <BarChart2 size={16} />시즌별 현황
          </Button>
          <Button variant="outline" onClick={downloadTemplate} className="gap-2 border-stone-300 text-stone-600 hover:bg-stone-50">
            <Download size={16} />양식 다운로드
          </Button>
          <Button variant="outline" onClick={() => excelUploadRef.current?.click()} className="gap-2 border-stone-300 text-stone-600 hover:bg-stone-50">
            <Upload size={16} />엑셀 일괄 등록
          </Button>
          <input
            ref={excelUploadRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) parseExcelFile(f); }}
          />
          <Button onClick={() => openAdd()} className="bg-[#C9A96E] hover:bg-[#B8985D] text-white gap-2">
            <Plus size={16} />품목 등록
          </Button>
        </div>
      </div>

      {/* 품목 수 통계 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-3 text-center">
          <p className="text-xl font-bold text-blue-700">{items.filter(i => i.erpCategory === 'HB').length}</p>
          <p className="text-xs text-blue-600 mt-0.5">HB (핸드백)</p>
        </div>
        <div className="bg-purple-50 rounded-xl border border-purple-200 p-3 text-center">
          <p className="text-xl font-bold text-purple-700">{items.filter(i => i.erpCategory === 'SLG').length}</p>
          <p className="text-xs text-purple-600 mt-0.5">SLG (소품)</p>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-3 text-center">
          <p className="text-xl font-bold text-stone-800">{items.length}</p>
          <p className="text-xs text-stone-500 mt-0.5">전체</p>
        </div>
      </div>

      {/* 필터 */}
      <Card className="border-stone-200">
        <CardContent className="p-3 space-y-2">
          {/* 1행: 텍스트 검색 + 바이어 + 입희화 */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[150px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input placeholder="스타일번호 검색" value={filterStyleNo} onChange={e => setFilterStyleNo(e.target.value)} className="pl-8 h-9 text-sm" />
            </div>
            <div className="relative flex-1 min-w-[150px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input placeholder="품명 검색 (한/영)" value={filterName} onChange={e => setFilterName(e.target.value)} className="pl-8 h-9 text-sm" />
            </div>
            <Select value={filterBuyer} onValueChange={setFilterBuyer}>
              <SelectTrigger className="w-36 h-9"><SelectValue placeholder="바이어" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체 바이어</SelectItem>
                {buyerVendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              onClick={resetFilters}
              className="h-9 px-3 rounded-lg border border-stone-200 text-xs font-medium text-stone-500 hover:bg-stone-50 flex items-center gap-1.5 whitespace-nowrap"
            >
              <X size={13} />필터 초기화
              {activeFilterCount > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center bg-amber-500 text-white text-[10px] font-bold rounded-full w-4 h-4">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
          {/* 2행: 드롭다운 필터 */}
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={filterErpCategory} onValueChange={setFilterErpCategory}>
              <SelectTrigger className="w-32 h-9"><SelectValue placeholder="카테고리" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체 카테고리</SelectItem>
                <SelectItem value="HB">HB (핸드백)</SelectItem>
                <SelectItem value="SLG">SLG (소품)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterSeason} onValueChange={setFilterSeason}>
              <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체 시즌</SelectItem>
                {SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">세부 카테고리</SelectItem>
                {[...HB_CATEGORIES, ...SLG_CATEGORIES.filter(c => !HB_CATEGORIES.includes(c))].map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              onClick={() => setFilterNoBom(v => !v)}
              className={`h-9 px-3 rounded-lg border text-xs font-medium transition-colors ${filterNoBom ? 'bg-red-50 border-red-300 text-red-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}
            >
              BOM 미작성 {filterNoBom && `(${items.filter(i => !i.hasBom).length}건)`}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* 다중 선택 액션 바 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-800 text-white rounded-xl">
          <span className="text-sm font-medium">{selectedIds.size}개 선택됨</span>
          <button
            onClick={handleBulkOrder}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            📦 선택 발주
          </button>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            🗑️ 선택 삭제
          </button>
          <button
            onClick={() => setShowSelectedOnly(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showSelectedOnly ? 'bg-blue-500 hover:bg-blue-600' : 'bg-stone-600 hover:bg-stone-500'} text-white`}
          >
            {showSelectedOnly ? '👁 선택만 보기 ON' : '👁 선택만 보기'}
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setShowSelectedOnly(false); }}
            className="flex items-center gap-1 px-3 py-1.5 bg-stone-600 hover:bg-stone-500 text-white rounded-lg text-xs font-medium transition-colors"
          >
            ✕ 선택 해제
          </button>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm table-fixed min-w-full">
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: colWidths.image }} />
              <col style={{ width: colWidths.styleNo }} />
              <col style={{ width: colWidths.season }} />
              <col style={{ width: colWidths.buyer }} />
              <col style={{ width: colWidths.name }} />
              <col style={{ width: colWidths.category }} />
              <col style={{ width: colWidths.color }} />
              <col style={{ width: colWidths.delivery }} />
              <col style={{ width: colWidths.bomCost }} />
              <col style={{ width: colWidths.salePrice }} />
              <col style={{ width: colWidths.multiple }} />
              <col style={{ width: colWidths.margin }} />
              <col style={{ width: colWidths.noOrder }} />
              <col style={{ width: colWidths.createdAt }} />
              <col style={{ width: colWidths.bom }} />
              <col style={{ width: colWidths.action }} />
            </colgroup>
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50">
                <th className="px-4 py-3" style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-stone-300 accent-[#C9A96E] cursor-pointer"
                  />
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  이미지
                  <div onMouseDown={(e) => startResize(e, 'image')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700 select-none relative overflow-hidden" onClick={() => handleSort('styleNo')}>
                  스타일번호<SortIcon field="styleNo" />
                  <div onMouseDown={(e) => startResize(e, 'styleNo')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700 select-none relative overflow-hidden" onClick={() => handleSort('season')}>
                  시즌<SortIcon field="season" />
                  <div onMouseDown={(e) => startResize(e, 'season')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  바이어
                  <div onMouseDown={(e) => startResize(e, 'buyer')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700 select-none relative overflow-hidden" onClick={() => handleSort('name')}>
                  품명<SortIcon field="name" />
                  <div onMouseDown={(e) => startResize(e, 'name')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  카테고리
                  <div onMouseDown={(e) => startResize(e, 'category')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  컬러
                  <div onMouseDown={(e) => startResize(e, 'color')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  납품가(KRW)
                  <div onMouseDown={(e) => startResize(e, 'delivery')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  총원가액
                  <div onMouseDown={(e) => startResize(e, 'bomCost')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  확정판매가
                  <div onMouseDown={(e) => startResize(e, 'salePrice')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  실현배수
                  <div onMouseDown={(e) => startResize(e, 'multiple')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  마진율
                  <div onMouseDown={(e) => startResize(e, 'margin')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  미발주기간
                  <div onMouseDown={(e) => startResize(e, 'noOrder')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700 select-none relative overflow-hidden" onClick={() => handleSort('createdAt')}>
                  등록일<SortIcon field="createdAt" />
                  <div onMouseDown={(e) => startResize(e, 'createdAt')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-medium text-stone-500 relative overflow-hidden">
                  BOM
                  <div onMouseDown={(e) => startResize(e, 'bom')} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-amber-400 select-none z-10" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map(item => {
                // BOM 매칭: styleId(UUID) 우선 → styleNo(문자열) 폴백
                const itemBom = (boms as any[]).find(b => b.styleId === item.id) ||
                                (boms as any[]).find(b => b.styleNo === item.styleNo);
                const delivery = itemBom?.postDeliveryPrice || item.deliveryPrice || item.targetSalePrice || 0;
                // 총원가액: 사후원가(postSubtotalKrw / postTotalCostKrw) 기준
                const bomCost = itemBom
                  ? ((itemBom as any).postSubtotalKrw || (itemBom as any).postTotalCostKrw || 0)
                  : 0;
                const confirmedSalePrice: number = (itemBom as any)?.pnl?.confirmedSalePrice || 0;
                const actualMultiple = bomCost > 0 && confirmedSalePrice > 0 ? confirmedSalePrice / bomCost : 0;
                const { rate: marginRate, amount: marginAmount } = calcMargin(delivery, bomCost);
                const months = monthsSinceLastOrder(item);
                const isChecked = selectedIds.has(item.id);
                return (
                  <tr key={item.id} className={`border-b border-stone-50 hover:bg-stone-50/50 ${isChecked ? 'bg-amber-50/60' : ''}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4 rounded border-stone-300 accent-[#C9A96E] cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="w-10 h-10 object-cover rounded-lg border border-stone-200" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center">
                          <Package size={16} className="text-stone-300" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-stone-700">{item.styleNo}</td>
                    <td className="px-4 py-3">
                      {item.season ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-medium">{item.season}</span>
                      ) : <span className="text-stone-300 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      {item.buyerId ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                          {vendors.find(v => v.id === item.buyerId)?.name || '-'}
                        </span>
                      ) : <span className="text-stone-300 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3 overflow-hidden">
                      <p className="font-medium text-stone-800 truncate" title={item.name}>{item.name}</p>
                      {item.nameEn && <p className="text-xs text-stone-400 truncate" title={item.nameEn}>{item.nameEn}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {item.erpCategory && (
                          <span className={`text-xs px-1.5 py-0.5 rounded border w-fit ${ERP_CAT_COLOR[item.erpCategory]}`}>
                            {item.erpCategory}
                          </span>
                        )}
                        <span className="text-xs text-stone-400">
                          {item.customCategory || item.category}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(item.colors || []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {normalizeColors(item.colors || []).slice(0, 3).map(c => (
                            <button
                              key={c.name}
                              onClick={() => navigate(`/bom?styleNo=${encodeURIComponent(item.id)}&color=${encodeURIComponent(c.name)}`)} // [FIX] item.id(UUID) 사용
                              className="text-xs px-1.5 py-0.5 bg-stone-100 text-stone-600 rounded hover:bg-amber-100 hover:text-amber-700 hover:border hover:border-amber-300 border border-transparent transition-colors"
                              title={`${c.name} 컬러 BOM으로 이동`}
                            >
                              {c.name}
                            </button>
                          ))}
                          {(item.colors || []).length > 3 && (
                            <span className="text-xs text-stone-400">+{(item.colors || []).length - 3}</span>
                          )}
                        </div>
                      ) : <span className="text-stone-300 text-xs">—</span>}
                    </td>
                    {/* 납품가(KRW) */}
                    <td className="px-4 py-3 text-right">
                      {delivery > 0 ? (
                        <p className="font-mono text-xs text-stone-700">{formatKRW(delivery)}</p>
                      ) : <span className="text-stone-300 text-xs">—</span>}
                    </td>
                    {/* 총원가액 */}
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {bomCost > 0 ? (
                        <span className="text-amber-700">{formatKRW(bomCost)}</span>
                      ) : itemBom ? (
                        <span className="text-stone-300">계산중</span>
                      ) : (
                        <span className="text-stone-300 text-xs">미등록</span>
                      )}
                    </td>
                    {/* 확정판매가 */}
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {confirmedSalePrice > 0 ? (
                        <span className="text-stone-700">{formatKRW(confirmedSalePrice)}</span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    {/* 실현배수 */}
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {actualMultiple > 0 ? (
                        <span className={`font-semibold ${actualMultiple >= 3.5 ? 'text-green-600' : actualMultiple >= 3.0 ? 'text-amber-600' : 'text-red-500'}`}>
                          {actualMultiple.toFixed(2)}x
                        </span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    {/* 마진율 */}
                    <td className="px-4 py-3 text-right">
                      {marginRate !== null ? (
                        <div>
                          <p className={`text-xs font-medium ${marginColorClass(marginRate)}`}>
                            {marginRate.toFixed(1)}%
                          </p>
                          {marginAmount !== null && (
                            <p className="text-[10px] text-stone-400">{formatKRW(marginAmount)}</p>
                          )}
                        </div>
                      ) : <span className="text-stone-300 text-xs">—</span>}
                    </td>
                    {/* 미발주기간 */}
                    <td className="px-4 py-3 text-center">
                      {months === null ? (
                        <span className="text-xs text-stone-400 font-medium">미발주</span>
                      ) : (
                        <span className={`text-xs font-medium ${months >= 12 ? 'text-red-500' : months >= 6 ? 'text-amber-600' : 'text-stone-500'}`}>
                          {months}개월
                        </span>
                      )}
                    </td>
                    {/* 등록일 */}
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs text-stone-500">{item.createdAt ? item.createdAt.split('T')[0] : '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => {
                          localStorage.setItem('ames_prefill_bom', item.id); // [FIX] styleNo 대신 item.id(UUID) 저장
                          navigate('/bom');
                        }}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors font-medium ${
                          item.hasBom
                            ? 'text-green-700 border-green-300 bg-green-50 hover:bg-green-100'
                            : 'text-red-600 border-red-300 bg-red-50 hover:bg-red-100'
                        }`}
                      >
                        {item.hasBom ? 'BOM ✓' : 'BOM ⚠'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 rounded hover:bg-stone-100 text-stone-500">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={17} className="text-center py-12 text-stone-400">
                  <Package size={32} className="mx-auto mb-2 opacity-30" />
                  등록된 품목이 없습니다
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 시즌별 스타일 현황 모달 */}
      <Dialog open={showSeasonStats} onOpenChange={setShowSeasonStats}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart2 size={18} />시즌별 스타일 현황
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-stone-500">시즌 선택:</Label>
              <Select value={seasonStatsTarget} onValueChange={setSeasonStatsTarget}>
                <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="전체">전체</SelectItem>
                  {SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">시즌</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-stone-500">전체</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-blue-600">HB</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-purple-600">SLG</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-blue-600">BOM완료</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-red-500">BOM미작성</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonStats.map(row => (
                    <tr key={row.season} className="border-b border-stone-50 hover:bg-stone-50">
                      <td className="px-4 py-2.5 font-semibold text-stone-700">{row.season}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-stone-800">{row.total}</td>
                      <td className="px-3 py-2.5 text-center text-blue-700">{row.hb}</td>
                      <td className="px-3 py-2.5 text-center text-purple-700">{row.slg}</td>
                      <td className="px-3 py-2.5 text-center text-blue-600">{row.hasBom}</td>
                      <td className="px-3 py-2.5 text-center">
                        {row.noBom > 0 ? (
                          <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                            <AlertCircle size={12} />{row.noBom}
                          </span>
                        ) : <span className="text-stone-300">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSeasonStats(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 변경사항 확인 다이얼로그 */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onSaveAndClose={() => { setShowUnsavedDialog(false); handleSave(); }}
        onDiscardAndClose={() => { setShowUnsavedDialog(false); setIsDirty(false); setModalOpen(false); }}
        onCancel={() => setShowUnsavedDialog(false)}
      />

      {/* 등록/수정 모달 */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) handleModalClose(true); }}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? '품목 수정' : '품목 등록'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* 스타일번호 자동생성 */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Wand2 size={15} className="text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800">스타일번호 자동생성</span>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={manualStyleNo} onChange={e => {
                    setManualStyleNo(e.target.checked);
                    if (!e.target.checked) setEditItem(prev => ({ ...prev, styleNo: previewStyleNo }));
                  }} className="w-3.5 h-3.5 accent-amber-600" />
                  <span className="text-xs text-amber-700">직접 입력</span>
                </label>
              </div>
              {!manualStyleNo ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-amber-700">거래처 (브랜드코드 보유)</Label>
                      <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
                        <SelectTrigger className="h-8 text-sm bg-white"><SelectValue placeholder="거래처 선택" /></SelectTrigger>
                        <SelectContent>
                          {brandVendors.length === 0
                            ? <div className="px-3 py-2 text-xs text-stone-400">브랜드코드 등록된 거래처 없음</div>
                            : brandVendors.map(v => (
                              <SelectItem key={v.id} value={v.id}>
                                <span className="font-mono font-bold text-amber-700 mr-2">[{v.code}]</span>{v.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-amber-700">등록일 (YYMM 기준)</Label>
                      <Input type="date" value={registDate} onChange={e => setRegistDate(e.target.value)} className="h-8 text-sm bg-white" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 bg-white border border-amber-200 rounded-lg">
                    {previewStyleNo ? (
                      <>
                        <span className="text-xs text-amber-600">예상 품번:</span>
                        <span className="font-mono font-bold text-amber-800 text-base tracking-widest">{previewStyleNo}</span>
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-amber-500">
                        <AlertCircle size={13} />거래처와 카테고리를 선택하면 자동으로 생성됩니다
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <Input
                  value={editItem.styleNo || ''}
                  onChange={e => setEditItem({ ...editItem, styleNo: e.target.value.toUpperCase() })}
                  placeholder="AT2603HB01"
                  className="font-mono uppercase bg-white"
                />
              )}
            </div>

            {/* 기본 정보 */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-stone-600">기본 정보</p>

              {/* 카테고리 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>카테고리</Label>
                  <Select
                    value={editItem.erpCategory || 'HB'}
                    onValueChange={v => {
                      const newErpCat = v as ErpCategory;
                      // erpCategory 변경 시 세부 카테고리 기본값 변경
                      const defaultCategory = newErpCat === 'SLG' ? '파우치' : '숄더백';
                      setEditItem({ ...editItem, erpCategory: newErpCat, category: defaultCategory });
                      setCustomCategory('');
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HB">HB (핸드백)</SelectItem>
                      <SelectItem value="SLG">SLG (소품)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>세부 카테고리</Label>
                  <Select
                    value={editItem.category || (editItem.erpCategory === 'SLG' ? '파우치' : '숄더백')}
                    onValueChange={v => {
                      setEditItem({ ...editItem, category: v as Category });
                      if (v !== '기타') setCustomCategory('');
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {subCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      <SelectItem value="비고(직접입력)">비고(직접입력)</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* 기타 또는 비고(직접입력) 선택 시 직접 입력 */}
                  {(editItem.category === '기타' || (editItem.category as string) === '비고(직접입력)') && (
                    <Input
                      value={customCategory}
                      onChange={e => setCustomCategory(e.target.value)}
                      placeholder="직접 입력 (예: 카드케이스, 파우치)"
                      className="mt-1.5 text-sm"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>품명 (국문) *</Label>
                  <Input value={editItem.name || ''} onChange={e => setEditItem({ ...editItem, name: e.target.value })} placeholder="파니에 쁘띠 백" />
                </div>
                <div className="space-y-1.5">
                  <Label>품명 (영문)</Label>
                  <Input value={editItem.nameEn || ''} onChange={e => setEditItem({ ...editItem, nameEn: e.target.value })} placeholder="PANIER PETIT BAG" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>시즌</Label>
                  <Select value={editItem.season || '26SS'} onValueChange={v => setEditItem({ ...editItem, season: v as Season })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>소재</Label>
                  <Input value={editItem.material || ''} onChange={e => setEditItem({ ...editItem, material: e.target.value })} placeholder="소가죽" />
                </div>
              </div>
            </div>

            {/* 가격 정보 */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-stone-600">가격 정보</p>

              {/* BOM 원가 표시 영역 */}
              {(() => {
                const styleNo = editItem.styleNo || '';
                const hasBom = isEdit ? items.find(i => i.id === editItem.id)?.hasBom : false;
                const bomCostVal = hasBom && styleNo ? store.getBomTotalCost(styleNo) : 0;
                return (
                  <div className={`p-3 rounded-lg border flex items-center justify-between ${hasBom && bomCostVal > 0 ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-200'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-stone-600">BOM 원가:</span>
                      {hasBom && bomCostVal > 0 ? (
                        <span className="text-sm font-bold text-amber-700">{formatKRW(bomCostVal)}</span>
                      ) : (
                        <span className="text-xs text-stone-400">
                          {hasBom ? '원가 계산중' : 'BOM 미등록'}
                        </span>
                      )}
                    </div>
                    {!hasBom && styleNo && (
                      <button
                        type="button"
                        onClick={() => {
                          setModalOpen(false);
                          localStorage.setItem('ames_prefill_bom', editItem.id || styleNo); // [FIX] item.id(UUID) 우선, fallback은 styleNo
                          navigate('/bom');
                        }}
                        className="flex items-center gap-1 text-xs text-[#C9A96E] hover:text-amber-700 font-medium"
                      >
                        <Link size={12} />BOM 등록하러 가기
                      </button>
                    )}
                  </div>
                );
              })()}

              <div className="space-y-1.5">
                <Label>납품가(KRW)</Label>
                <Input
                  type="number"
                  value={editItem.deliveryPrice ?? editItem.targetSalePrice ?? ''}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setEditItem(prev => ({ ...prev, deliveryPrice: val, targetSalePrice: val }));
                  }}
                  placeholder="바이어 납품가 입력 (예: 85000)"
                />
                <p className="text-[10px] text-stone-400">※ BOM이 등록된 경우 납품가 입력 시 마진이 자동 계산됩니다</p>
              </div>

              {/* 마진 자동 계산 표시 (BOM 원가 연동) */}
              {(() => {
                const styleNo = editItem.styleNo || '';
                const hasBom = isEdit ? items.find(i => i.id === editItem.id)?.hasBom : false;
                const bomCostVal = hasBom && styleNo ? store.getBomTotalCost(styleNo) : 0;
                const deliveryVal = editItem.deliveryPrice || editItem.targetSalePrice || 0;
                const { rate, amount } = calcMargin(deliveryVal, bomCostVal);
                if (rate === null) return null;
                const bgClass = rate >= 30 ? 'bg-green-50 border-green-200' : rate >= 15 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
                return (
                  <div className={`p-3 rounded-lg border ${bgClass}`}>
                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-xs text-stone-500">마진금액</p>
                        <p className={`text-sm font-bold ${marginColorClass(rate)}`}>
                          {formatKRW(amount || 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-stone-500">마진율</p>
                        <p className={`text-xl font-bold ${marginColorClass(rate)}`}>
                          {rate.toFixed(1)}%
                        </p>
                      </div>
                      <div className="ml-auto text-right">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${rate >= 30 ? 'bg-green-100 text-green-700' : rate >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {rate >= 30 ? '✅ 양호' : rate >= 15 ? '🟡 주의' : '🔴 위험'}
                        </span>
                        <p className="text-[10px] text-stone-400 mt-1">마진율 = (납품가 - BOM원가) / 납품가 × 100</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 컬러 목록 */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Palette size={14} />컬러 목록</Label>
              <div className="flex gap-2">
                <Input
                  value={colorInput}
                  onChange={e => setColorInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addColor(); } }}
                  placeholder="블랙, 베이지, 카멜..."
                  className="h-9"
                />
                <Button type="button" variant="outline" size="sm" onClick={addColor} className="h-9 px-3">추가</Button>
              </div>
              {normalizeColors(editItem.colors || []).length > 0 && (
                <div className="space-y-2 p-2 bg-stone-50 rounded-lg border border-stone-100">
                  {normalizeColors(editItem.colors || []).map((c, idx) => (
                    <div key={idx} className="bg-white border border-stone-200 rounded-lg overflow-hidden">
                      {/* 컬러 헤더 */}
                      <div className="flex items-center justify-between px-3 py-2">
                        <button
                          type="button"
                          className="flex items-center gap-2 text-sm font-medium text-stone-700 hover:text-stone-900 flex-1 text-left"
                          onClick={() => setColorDetailOpen(colorDetailOpen === idx ? null : idx)}
                        >
                          <span className="w-2 h-2 rounded-full bg-stone-400 inline-block" />
                          {c.name}
                          <span className="text-xs text-stone-400 font-normal">
                            {[c.leatherColor, c.decorColor, c.threadColor, c.girimaeColor].filter(Boolean).length > 0
                              ? `— ${[
                                  c.leatherColor ? `가죽: ${c.leatherColor}` : null,
                                  c.decorColor ? `장식: ${c.decorColor}` : null,
                                  c.threadColor ? `실: ${c.threadColor}` : null,
                                  c.girimaeColor ? `기리매: ${c.girimaeColor}` : null,
                                ].filter(Boolean).join(', ')}`
                              : '— 세부정보 없음'}
                          </span>
                          <span className="text-xs text-stone-300 ml-auto">{colorDetailOpen === idx ? '▲' : '▼'}</span>
                        </button>
                        {/* BOM 바로가기 버튼 */}
                        {editItem.styleNo && (
                          <button
                            type="button"
                            onClick={() => {
                              setModalOpen(false);
                              navigate(`/bom?styleNo=${encodeURIComponent(editItem.styleNo || '')}&color=${encodeURIComponent(c.name)}`);
                            }}
                            className="text-xs px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium ml-1 shrink-0"
                            title={`${c.name} 컬러 BOM으로 이동`}
                          >
                            BOM
                          </button>
                        )}
                        <button type="button" onClick={() => removeColor(idx)} className="text-stone-400 hover:text-red-500 ml-1">
                          <X size={14} />
                        </button>
                      </div>
                      {/* 세부 정보 */}
                      {colorDetailOpen === idx && (
                        <div className="px-3 pb-3 grid grid-cols-2 gap-2 border-t border-stone-100 pt-2">
                          <div className="space-y-1">
                            <Label className="text-xs text-stone-500">가죽/원단 컬러</Label>
                            <Input
                              value={c.leatherColor || ''}
                              onChange={e => updateColorDetail(idx, 'leatherColor', e.target.value)}
                              placeholder="블랙"
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-stone-500">장식 컬러</Label>
                            <Input
                              value={c.decorColor || ''}
                              onChange={e => updateColorDetail(idx, 'decorColor', e.target.value)}
                              placeholder="골드"
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-stone-500">실 컬러</Label>
                            <Input
                              value={c.threadColor || ''}
                              onChange={e => updateColorDetail(idx, 'threadColor', e.target.value)}
                              placeholder="블랙"
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-stone-500">기리매 컬러</Label>
                            <Input
                              value={c.girimaeColor || ''}
                              onChange={e => updateColorDetail(idx, 'girimaeColor', e.target.value)}
                              placeholder="블랙"
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>담당 디자이너</Label>
                <Input value={editItem.designer || ''} onChange={e => setEditItem({ ...editItem, designer: e.target.value })} placeholder="디자이너 이름" />
              </div>
              <div className="space-y-1.5">
                <Label>메모</Label>
                <Input value={editItem.memo || ''} onChange={e => setEditItem({ ...editItem, memo: e.target.value })} placeholder="비고" />
              </div>
            </div>

            {/* 대표 이미지 업로드 */}
            <div className="space-y-2">
              <Label>대표 이미지</Label>
              <div className="flex items-center gap-3">
                <div
                  className="w-20 h-20 rounded-xl border-2 border-dashed border-stone-200 flex items-center justify-center cursor-pointer hover:border-amber-400 transition-colors overflow-hidden"
                  onClick={() => imageFileRef.current?.click()}
                >
                  {editItem.imageUrl ? (
                    <img src={editItem.imageUrl} alt="미리보기" className="w-full h-full object-cover" />
                  ) : (
                    <Package size={28} className="text-stone-300" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => imageFileRef.current?.click()} className="text-xs">
                    이미지 선택
                  </Button>
                  {editItem.imageUrl && (
                    <Button type="button" variant="ghost" size="sm" className="text-xs text-red-500" onClick={() => setEditItem(prev => ({ ...prev, imageUrl: undefined }))}>
                      삭제
                    </Button>
                  )}
                  <p className="text-xs text-stone-400">최대 800px, JPEG 자동 변환</p>
                </div>
              </div>
              <input ref={imageFileRef} type="file" accept="image/*" className="hidden" onChange={handleItemImageUpload} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>취소</Button>
            <Button onClick={handleSave} className="bg-[#C9A96E] hover:bg-[#B8985D] text-white">{isEdit ? '수정' : '등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 일괄 발주 모달 */}
      {bulkOrderModalOpen && (
        <MultiBulkOrderModal
          open={bulkOrderModalOpen}
          onClose={() => setBulkOrderModalOpen(false)}
          selectedItems={items.filter(i => selectedIds.has(i.id))}
          onComplete={() => {
            setBulkOrderModalOpen(false);
            setSelectedIds(new Set());
            navigate('/orders');
          }}
        />
      )}

      {/* 엑셀 일괄 등록 미리보기 모달 */}
      <Dialog open={excelPreviewOpen} onOpenChange={setExcelPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet size={18} className="text-green-600" />
              엑셀 일괄 등록 미리보기
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-4 px-1 py-2 bg-stone-50 rounded-lg text-sm">
            <span className="flex items-center gap-1.5 text-green-700">
              <CheckCircle2 size={14} />
              신규 {excelPreviewItems.filter(p => !p.isDuplicate).length}개
            </span>
            <span className="flex items-center gap-1.5 text-amber-600">
              <XCircle size={14} />
              중복 스킵 {excelPreviewItems.filter(p => p.isDuplicate).length}개
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-stone-100">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">상태</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">스타일번호</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">품목명</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">시즌</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">카테</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">콜러</th>
                  <th className="px-2 py-1.5 text-left font-medium text-stone-600">판매가</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {excelPreviewItems.map((p, idx) => (
                  <tr key={idx} className={p.isDuplicate ? 'bg-amber-50 opacity-60' : 'bg-white'}>
                    <td className="px-2 py-1.5">
                      {p.isDuplicate
                        ? <span className="text-amber-600 font-medium">중복</span>
                        : <span className="text-green-600 font-medium">신규</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{p.styleNo}</td>
                    <td className="px-2 py-1.5 max-w-[200px] truncate">{p.name}</td>
                    <td className="px-2 py-1.5">{p.season}</td>
                    <td className="px-2 py-1.5">{p.erpCategory}</td>
                    <td className="px-2 py-1.5">{p.colors.join(', ')}</td>
                    <td className="px-2 py-1.5">{p.salePriceKrw ? p.salePriceKrw.toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter className="pt-3 border-t border-stone-100">
            <Button variant="outline" onClick={() => { setExcelPreviewOpen(false); if (excelUploadRef.current) excelUploadRef.current.value = ''; }}>
              취소
            </Button>
            <Button
              onClick={handleExcelBulkRegister}
              disabled={excelPreviewItems.filter(p => !p.isDuplicate).length === 0}
              className="bg-[#C9A96E] hover:bg-[#B8985D] text-white"
            >
              <FileSpreadsheet size={14} className="mr-1.5" />
              {excelPreviewItems.filter(p => !p.isDuplicate).length}개 일괄 등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 일괄 발주 모달 컴포넌트 ───────────────────────────────────────────────

interface BulkColorQty {
  color: string;
  qty: number;
  leatherColor?: string;
  decorColor?: string;
  threadColor?: string;
  girimaeColor?: string;
}

interface BulkOrderItemState {
  item: Item;
  enabled: boolean;
  // 컬러별 수량 + 세부 정보
  colorQtys: BulkColorQty[];
}

interface PostOrderState {
  orders: ProductionOrder[];
  hqMaterialSummary: Array<{ materialName: string; spec?: string; unit: string; totalQty: number; vendorName?: string; styleNos: string[] }>;
}

function MultiBulkOrderModal({
  open,
  onClose,
  selectedItems,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  selectedItems: Item[];
  onComplete: () => void;
}) {
  const vendors = store.getVendors();
  const factories = vendors.filter(v => v.type === '공장' || v.type === '해외공장');

  const [factoryId, setFactoryId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [itemStates, setItemStates] = useState<BulkOrderItemState[]>(() =>
    selectedItems.map(item => ({
      item,
      enabled: true,
      colorQtys: normalizeColors(item.colors || []).map(c => ({
        color: c.name,
        qty: 0,
        leatherColor: c.leatherColor,
        decorColor: c.decorColor,
        threadColor: c.threadColor,
        girimaeColor: c.girimaeColor,
      })),
    }))
  );
  const [postOrderState, setPostOrderState] = useState<PostOrderState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleItem = (itemId: string) => {
    setItemStates(prev => prev.map(s =>
      s.item.id === itemId ? { ...s, enabled: !s.enabled } : s
    ));
  };

  const setColorQty = (itemId: string, colorName: string, qty: number) => {
    setItemStates(prev => prev.map(s => {
      if (s.item.id !== itemId) return s;
      return {
        ...s,
        colorQtys: s.colorQtys.map(cq => cq.color === colorName ? { ...cq, qty } : cq),
      };
    }));
  };

  const updateColorDetail = (itemId: string, colorName: string, field: keyof Omit<BulkColorQty, 'color' | 'qty'>, value: string) => {
    setItemStates(prev => prev.map(s => {
      if (s.item.id !== itemId) return s;
      return {
        ...s,
        colorQtys: s.colorQtys.map(cq => cq.color === colorName ? { ...cq, [field]: value } : cq),
      };
    }));
  };

  // 컬러 상세정보 변경 후 포커스 아웃 시 품목 마스터에 즉각 저장
  const saveColorDetailToMaster = (itemId: string, colorName: string, field: keyof Omit<BulkColorQty, 'color' | 'qty'>, value: string) => {
    const currentItem = store.getItems().find(i => i.id === itemId);
    if (!currentItem) return;
    const currentColors = normalizeColors(currentItem.colors || []);
    const existingIdx = currentColors.findIndex(c => c.name === colorName);
    let updatedColors: ItemColor[];
    if (existingIdx >= 0) {
      updatedColors = currentColors.map(c =>
        c.name === colorName ? { ...c, [field]: value } : c
      );
    } else {
      updatedColors = [...currentColors, { name: colorName, [field]: value }];
    }
    upsertItem({ id: itemId, colors: updatedColors } as any).catch(() => {});
    queryClient.setQueryData(['items'], (old: any[] = []) =>
      old.map((it: any) => it.id === itemId ? { ...it, colors: updatedColors } : it)
    );
  };

  const addColorToItem = (itemId: string, colorName: string) => {
    const trimmed = colorName.trim();
    if (!trimmed) return;
    // 품목 마스터에서 기존 컬러 정보 로드
    const masterItem = items.find((i: any) => i.id === itemId);
    const masterColors = normalizeColors(masterItem?.colors || []);
    const existingMasterColor = masterColors.find(c => c.name === trimmed);
    setItemStates(prev => prev.map(s => {
      if (s.item.id !== itemId) return s;
      if (s.colorQtys.find(cq => cq.color === trimmed)) return s;
      return {
        ...s,
        colorQtys: [...s.colorQtys, {
          color: trimmed,
          qty: 0,
          leatherColor: existingMasterColor?.leatherColor || '',
          decorColor: existingMasterColor?.decorColor || '',
          threadColor: existingMasterColor?.threadColor || '',
          girimaeColor: existingMasterColor?.girimaeColor || '',
        }],
      };
    }));
  };

  const removeColorFromItem = (itemId: string, colorName: string) => {
    setItemStates(prev => prev.map(s => {
      if (s.item.id !== itemId) return s;
      return { ...s, colorQtys: s.colorQtys.filter(cq => cq.color !== colorName) };
    }));
  };

  // 본사제공 자재 합산 미리보기
  const hqMaterialPreview = useMemo(() => {
    const summary: Record<string, { materialName: string; spec?: string; unit: string; totalQty: number; vendorName?: string; styleNos: string[] }> = {};
    for (const state of itemStates) {
      if (!state.enabled) continue;
      const totalQty = state.colorQtys.reduce((sum, cq) => sum + cq.qty, 0);
      if (totalQty <= 0) continue;
      const { bom } = store.getBomForOrder(state.item.styleNo);
      if (!bom) continue;
      const lines = bom.postMaterials?.length ? bom.postMaterials : (bom.lines || []);
      for (const line of lines) {
        if (!line.isHqProvided) continue;
        const perPcs = line.netQty * (1 + (line.lossRate ?? 0));
        const reqQty = Math.round(perPcs * totalQty * 1000) / 1000;
        const key = line.itemName + '||' + line.unit;
        if (summary[key]) {
          summary[key].totalQty = Math.round((summary[key].totalQty + reqQty) * 1000) / 1000;
          if (!summary[key].styleNos.includes(state.item.styleNo)) {
            summary[key].styleNos.push(state.item.styleNo);
          }
        } else {
          summary[key] = {
            materialName: line.itemName,
            spec: line.spec,
            unit: line.unit,
            totalQty: reqQty,
            vendorName: line.vendorId ? vendors.find(v => v.id === line.vendorId)?.name : undefined,
            styleNos: [state.item.styleNo],
          };
        }
      }
    }
    return Object.values(summary);
  }, [itemStates]);

  const handleSubmit = async () => {
    if (!factoryId) { toast.error('공장을 선택해주세요'); return; }
    const factory = vendors.find(v => v.id === factoryId);
    if (!factory) return;

    const enabledStates = itemStates.filter(s => s.enabled);
    if (enabledStates.length === 0) { toast.error('발주할 품목을 하나 이상 선택해주세요'); return; }

    const hasQty = enabledStates.some(s => s.colorQtys.reduce((sum, cq) => sum + cq.qty, 0) > 0);
    if (!hasQty) { toast.error('수량을 입력해주세요'); return; }

    setSubmitting(true);
    try {
      const createdOrders: ProductionOrder[] = [];
      const allHqMaterials: Array<{ materialName: string; spec?: string; unit: string; totalQty: number; vendorName?: string; styleNos: string[] }> = [];

      for (const state of enabledStates) {
        const totalQty = state.colorQtys.reduce((sum, cq) => sum + cq.qty, 0);
        if (totalQty <= 0) continue;

        const revision = store.getNextRevision(state.item.styleNo);
        const orderNo = `${state.item.styleNo}-R${revision}`;
        const colorQtysForOrder: ColorQty[] = state.colorQtys.filter(cq => cq.qty > 0).map(cq => ({ color: cq.color, qty: cq.qty }));

        // BOM 기반 본사제공 자재 계산
        const { bom } = store.getBomForOrder(state.item.styleNo);
        const hqSupplyItems: ProductionOrder['hqSupplyItems'] = [];
        const bomMaterialsForCart: Array<{ itemName: string; spec?: string; unit: string; netQty: number; lossRate: number; vendorName?: string; isHqProvided: boolean }> = [];

        if (bom) {
          const lines = bom.postMaterials?.length ? bom.postMaterials : (bom.lines || []);
          for (const line of lines) {
            if (line.isHqProvided) {
              const perPcs = line.netQty * (1 + (line.lossRate ?? 0));
              const reqQty = Math.round(perPcs * totalQty * 1000) / 1000;
              hqSupplyItems.push({
                bomLineId: line.id,
                itemName: line.itemName,
                spec: line.spec,
                unit: line.unit,
                requiredQty: reqQty,
                purchaseStatus: '미구매',
              });
            }
            bomMaterialsForCart.push({
              itemName: line.itemName,
              spec: line.spec,
              unit: line.unit,
              netQty: line.netQty,
              lossRate: line.lossRate ?? 0,
              vendorName: line.vendorId ? vendors.find(v => v.id === line.vendorId)?.name : undefined,
              isHqProvided: !!line.isHqProvided,
            });
          }
          // 본사제공 자재 장바구니에 추가
          if (bomMaterialsForCart.filter(m => m.isHqProvided).length > 0) {
            store.addToMaterialCart(
              state.item.styleNo,
              state.item.name,
              bomMaterialsForCart.filter(m => m.isHqProvided),
              totalQty
            );
          }
        }

        const newOrder: ProductionOrder = {
          id: genId(),
          orderNo,
          styleId: state.item.id,
          styleNo: state.item.styleNo,
          styleName: state.item.name,
          season: state.item.season as Season,
          revision,
          isReorder: revision > 1,
          qty: totalQty,
          colorQtys: colorQtysForOrder,
          vendorId: factoryId,
          vendorName: factory.name,
          orderDate,
          deliveryDate: deliveryDate || undefined,
          status: '발주생성',
          hqSupplyItems,
          attachments: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        store.addOrder(newOrder);
        createdOrders.push(newOrder);

        // 새 컬러 및 세부 정보를 품목 마스터에 반영
        const existingColors = normalizeColors(state.item.colors || []);
        const existingColorNames = existingColors.map(c => c.name);
        for (const cq of state.colorQtys) {
          const itemColor: ItemColor = {
            name: cq.color,
            leatherColor: cq.leatherColor,
            decorColor: cq.decorColor,
            threadColor: cq.threadColor,
            girimaeColor: cq.girimaeColor,
          };
          if (!existingColorNames.includes(cq.color)) {
            // 새 컬러: 품목 마스터에 추가 (낙관적 업데이트)
            const newColors = [...existingColors, itemColor];
            upsertItem({ id: state.item.id, colors: newColors } as any).catch(() => {});
            queryClient.setQueryData(['items'], (old: any[] = []) =>
              old.map((it: any) => it.id === state.item.id ? { ...it, colors: newColors } : it)
            );
          } else {
            // 기존 컬러: 세부 정보가 변경된 경우 업데이트
            const existingColor = existingColors.find(c => c.name === cq.color);
            const hasDetailChange = existingColor && (
              (cq.leatherColor !== undefined && cq.leatherColor !== existingColor.leatherColor) ||
              (cq.decorColor !== undefined && cq.decorColor !== existingColor.decorColor) ||
              (cq.threadColor !== undefined && cq.threadColor !== existingColor.threadColor) ||
              (cq.girimaeColor !== undefined && cq.girimaeColor !== existingColor.girimaeColor)
            );
            if (hasDetailChange) {
              const updatedColors = existingColors.map(c =>
                c.name === cq.color ? { ...c, ...itemColor } : c
              );
              upsertItem({ id: state.item.id, colors: updatedColors } as any).catch(() => {});
              queryClient.setQueryData(['items'], (old: any[] = []) =>
                old.map((it: any) => it.id === state.item.id ? { ...it, colors: updatedColors } : it)
              );
            }
          }
        }
      }

      setPostOrderState({
        orders: createdOrders,
        hqMaterialSummary: hqMaterialPreview,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // 완료 팝업이 보이는 상태
  if (postOrderState) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              ✅ 발주 등록 완료
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
              <p className="text-sm font-medium text-green-800 mb-2">
                {postOrderState.orders.length}건 발주가 등록되었습니다
              </p>
              <ul className="space-y-1">
                {postOrderState.orders.map(o => (
                  <li key={o.id} className="text-xs text-green-700 flex items-center gap-2">
                    <span className="font-mono font-semibold">{o.orderNo}</span>
                    <span className="text-green-600">{o.styleName}</span>
                    <span className="ml-auto font-medium">{o.qty.toLocaleString()}개</span>
                  </li>
                ))}
              </ul>
            </div>
            {postOrderState.hqMaterialSummary.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
                  <ShoppingCart size={13} />본사제공 자재 장바구니 담김
                </p>
                <ul className="space-y-1">
                  {postOrderState.hqMaterialSummary.map((m, idx) => (
                    <li key={idx} className="text-xs text-amber-700 flex items-center gap-2">
                      <span className="font-medium">{m.materialName}</span>
                      {m.spec && <span className="text-amber-500">{m.spec}</span>}
                      <span className="ml-auto font-mono">{m.totalQty.toLocaleString()} {m.unit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2 sm:flex-row flex-col">
            <Button
              variant="outline"
              className="flex items-center gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => {
                onComplete();
              }}
            >
              <ShoppingCart size={14} />자재 장바구니 확인
            </Button>
            <Button
              className="bg-[#C9A96E] hover:bg-[#B8985D] text-white flex items-center gap-1.5"
              onClick={onComplete}
            >
              <Printer size={14} />발주 목록으로 이동
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent onInteractOutside={e => e.preventDefault()} className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package size={18} className="text-amber-600" />
            일괄 발주 등록
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* 공장 / 날짜 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>공장 선택 *</Label>
              <Select value={factoryId} onValueChange={setFactoryId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="공장 선택" />
                </SelectTrigger>
                <SelectContent>
                  {factories.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-stone-400">등록된 공장 없음</div>
                  ) : (
                    factories.map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>발주일</Label>
              <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label>납기일</Label>
              <Input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* 품목별 설정 */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-stone-700">품목별 컬러 · 수량 설정</Label>
            <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
              {itemStates.map(state => (
                <BulkOrderItemRow
                  key={state.item.id}
                  state={state}
                  onToggle={() => toggleItem(state.item.id)}
                  onSetColorQty={(color, qty) => setColorQty(state.item.id, color, qty)}
                  onUpdateColorDetail={(color, field, value) => updateColorDetail(state.item.id, color, field, value)}
                  onSaveColorDetail={(color, field, value) => saveColorDetailToMaster(state.item.id, color, field, value)}
                  onAddColor={(color) => addColorToItem(state.item.id, color)}
                  onRemoveColor={(color) => removeColorFromItem(state.item.id, color)}
                />
              ))}
            </div>
          </div>

          {/* 본사제공 자재 합산 */}
          {hqMaterialPreview.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-stone-700 flex items-center gap-1.5">
                <ShoppingCart size={14} className="text-amber-600" />
                본사제공 자재 통합 발주 (자동 합산)
              </Label>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5">
                {hqMaterialPreview.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className="text-amber-700 font-medium">{m.materialName}</span>
                    {m.spec && <span className="text-amber-500 text-xs">{m.spec}</span>}
                    <span className="text-xs text-stone-400 ml-1">({m.styleNos.join(' + ')})</span>
                    <span className="ml-auto font-mono font-semibold text-amber-800">
                      {m.totalQty.toLocaleString()} {m.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>취소</Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            {submitting ? '등록 중...' : '발주 등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 개별 품목 행 컴포넌트
function BulkOrderItemRow({
  state,
  onToggle,
  onSetColorQty,
  onUpdateColorDetail,
  onSaveColorDetail,
  onAddColor,
  onRemoveColor,
}: {
  state: BulkOrderItemState;
  onToggle: () => void;
  onSetColorQty: (color: string, qty: number) => void;
  onUpdateColorDetail: (color: string, field: keyof Omit<BulkColorQty, 'color' | 'qty'>, value: string) => void;
  onSaveColorDetail: (color: string, field: keyof Omit<BulkColorQty, 'color' | 'qty'>, value: string) => void;
  onAddColor: (color: string) => void;
  onRemoveColor: (color: string) => void;
}) {
  const [newColorInput, setNewColorInput] = useState('');
  const [openDetails, setOpenDetails] = useState<Set<string>>(new Set());

  const totalQty = state.colorQtys.reduce((sum, cq) => sum + cq.qty, 0);

  const toggleDetail = (colorName: string) => {
    setOpenDetails(prev => {
      const next = new Set(prev);
      if (next.has(colorName)) next.delete(colorName);
      else next.add(colorName);
      return next;
    });
  };

  const handleAddColor = () => {
    const trimmed = newColorInput.trim();
    if (!trimmed) return;
    onAddColor(trimmed);
    setNewColorInput('');
    // 새로 추가된 컬러의 세부 정보 토글 자동 펼침
    setOpenDetails(prev => new Set(prev).add(trimmed));
  };

  return (
    <div className={`p-3 transition-colors ${state.enabled ? 'bg-white' : 'bg-stone-50 opacity-60'}`}>
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-2.5">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={onToggle}
          className="w-4 h-4 rounded border-stone-300 accent-amber-500 cursor-pointer"
        />
        {state.item.imageUrl ? (
          <img src={state.item.imageUrl} alt={state.item.name} className="w-8 h-8 object-cover rounded-lg border border-stone-200" />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center">
            <Package size={12} className="text-stone-300" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-800 truncate">{state.item.name}</p>
          <p className="text-xs font-mono text-stone-500">{state.item.styleNo}</p>
        </div>
        {totalQty > 0 && (
          <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            합계 {totalQty.toLocaleString()}개
          </span>
        )}
      </div>

      {/* 컬러별 수량 */}
      {state.enabled && (
        <div className="pl-7 space-y-2">
          <div className="grid grid-cols-1 gap-2">
            {state.colorQtys.map(cq => {
              const isOpen = openDetails.has(cq.color);
              return (
                <div key={cq.color} className="border border-stone-100 rounded-lg overflow-hidden">
                  {/* 컬러 메인 행 */}
                  <div className="flex items-center gap-2 px-2 py-1.5 bg-stone-50">
                    <span className="text-xs px-2 py-1 bg-white text-stone-700 rounded border border-stone-200 font-medium w-24 truncate">{cq.color}</span>
                    <Input
                      type="number"
                      min={0}
                      value={cq.qty || ''}
                      onChange={e => onSetColorQty(cq.color, Number(e.target.value))}
                      placeholder="수량"
                      className="h-7 text-xs w-20"
                    />
                    <span className="text-xs text-stone-400">개</span>
                    <button
                      type="button"
                      onClick={() => onRemoveColor(cq.color)}
                      className="text-stone-300 hover:text-red-400 transition-colors"
                    >
                      <X size={12} />
                    </button>
                    {/* 세부 정보 토글 버튼 */}
                    <button
                      type="button"
                      onClick={() => toggleDetail(cq.color)}
                      title="세부 컬러 정보 입력"
                      className={`ml-auto flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded transition-colors ${
                        isOpen
                          ? 'bg-amber-100 text-amber-700 border border-amber-200'
                          : 'text-stone-400 hover:text-amber-600 hover:bg-amber-50 border border-transparent'
                      }`}
                    >
                      {isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                  {/* 세부 정보 패널 */}
                  {isOpen && (
                    <div className="px-2 py-2 bg-white border-t border-stone-100">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-stone-400 w-16 shrink-0">가죽/원단</span>
                          <Input
                            value={cq.leatherColor || ''}
                            onChange={e => { onUpdateColorDetail(cq.color, 'leatherColor', e.target.value); onSaveColorDetail(cq.color, 'leatherColor', e.target.value); }}
                            placeholder="가죽/원단 컬러"
                            className="h-6 text-xs flex-1"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-stone-400 w-10 shrink-0">장식</span>
                          <Input
                            value={cq.decorColor || ''}
                            onChange={e => { onUpdateColorDetail(cq.color, 'decorColor', e.target.value); onSaveColorDetail(cq.color, 'decorColor', e.target.value); }}
                            placeholder="장식 컬러"
                            className="h-6 text-xs flex-1"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-stone-400 w-16 shrink-0">실</span>
                          <Input
                            value={cq.threadColor || ''}
                            onChange={e => { onUpdateColorDetail(cq.color, 'threadColor', e.target.value); onSaveColorDetail(cq.color, 'threadColor', e.target.value); }}
                            placeholder="실 컬러"
                            className="h-6 text-xs flex-1"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-stone-400 w-10 shrink-0">기리매</span>
                          <Input
                            value={cq.girimaeColor || ''}
                            onChange={e => { onUpdateColorDetail(cq.color, 'girimaeColor', e.target.value); onSaveColorDetail(cq.color, 'girimaeColor', e.target.value); }}
                            placeholder="기리매 컬러"
                            className="h-6 text-xs flex-1"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* 컬러 추가 */}
          <div className="flex items-center gap-1.5">
            <Input
              value={newColorInput}
              onChange={e => setNewColorInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddColor();
                }
              }}
              placeholder="컬러 추가 (Enter)"
              className="h-7 text-xs flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleAddColor}
            >
              +
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
