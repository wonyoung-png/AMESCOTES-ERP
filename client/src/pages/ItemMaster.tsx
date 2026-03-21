// AMESCOTES ERP — 품목 마스터 (Phase 1 개편)
import { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation, useSearch } from 'wouter';
import { store, genId, formatKRW, type Item, type Season, type Category, type ErpCategory, type ItemStatus, type ProductionOrder } from '@/lib/store';
import { resizeImage } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Pencil, Trash2, Package, Wand2, AlertCircle, X, Palette, Database, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';

const CATEGORIES: Category[] = ['숄더백', '토트백', '크로스백', '클러치', '백팩', '기타'];
const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS'];
const ERP_CATEGORIES: ErpCategory[] = ['HB', 'SLG'];
// 상태 영문→한글 매핑
const ITEM_STATUS_LABEL: Record<ItemStatus, string> = { 'TEMP': '임시', 'ACTIVE': '활성', 'INACTIVE': '비활성' };

// 카테고리 → 제품유형코드 매핑
const CATEGORY_CODE_MAP: Record<Category, string> = {
  '숄더백': 'HB', '토트백': 'HB', '크로스백': 'HB', '클러치': 'SL', '백팩': 'BP', '기타': 'ETC',
};

const STATUS_COLOR: Record<ItemStatus, string> = {
  'TEMP':     'bg-amber-50 text-amber-700 border-amber-200',
  'ACTIVE':   'bg-green-50 text-green-700 border-green-200',
  'INACTIVE': 'bg-stone-50 text-stone-500 border-stone-200',
};

const ERP_CAT_COLOR: Record<ErpCategory, string> = {
  'HB':  'bg-blue-50 text-blue-700 border-blue-200',
  'SLG': 'bg-purple-50 text-purple-700 border-purple-200',
};

function generateStyleNo(brandCode: string, registDate: Date, category: Category, existingItems: Item[], currentItemId?: string, erpCategory?: ErpCategory): string {
  const yy = String(registDate.getFullYear()).slice(2);
  const mm = String(registDate.getMonth() + 1).padStart(2, '0');
  // erpCategory가 SLG면 'SL'로 강제 적용
  let typeCode = CATEGORY_CODE_MAP[category] || 'HB';
  if (erpCategory === 'SLG') typeCode = 'SL';
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
  erpCategory: 'HB', itemStatus: 'ACTIVE', materialType: '완제품',
  material: '', salePriceKrw: 0, targetSalePrice: 0,
  colors: [], memo: '',
};

export default function ItemMaster() {
  const [, navigate] = useLocation();
  // URL 파라미터 (샘플 관리에서 품목등록 버튼 클릭 시 전달됨)
  const searchString = useSearch();
  const [items, setItems] = useState(store.getItems());
  const [vendors] = useState(store.getVendors());
  const [search, setSearch] = useState('');
  const [filterSeason, setFilterSeason] = useState('전체');
  const [filterCategory, setFilterCategory] = useState('전체');
  const [filterStatus, setFilterStatus] = useState('전체');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<Partial<Item>>({ ...emptyItem });
  const [isEdit, setIsEdit] = useState(false);
  const [manualStyleNo, setManualStyleNo] = useState(false);
  const [registDate, setRegistDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [previewStyleNo, setPreviewStyleNo] = useState('');
  const [colorInput, setColorInput] = useState('');
  const [filterBuyer, setFilterBuyer] = useState('전체');
  const [filterNoBom, setFilterNoBom] = useState(false);
  const [showSeasonStats, setShowSeasonStats] = useState(false);
  const [seasonStatsTarget, setSeasonStatsTarget] = useState('전체');
  const [customCategory, setCustomCategory] = useState(''); // 세부 카테고리 직접 입력
  const [orders] = useState<ProductionOrder[]>(() => store.getOrders()); // 미발주기간 계산용
  const imageFileRef = useRef<HTMLInputElement>(null);

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

  const refresh = () => setItems(store.getItems());

  const filtered = useMemo(() => {
    return items.filter(item => {
      // 바이어 이름 검색 포함
      const buyerName = vendors.find(v => v.id === item.buyerId)?.name || '';
      const matchSearch = !search ||
        item.styleNo.toLowerCase().includes(search.toLowerCase()) ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        buyerName.toLowerCase().includes(search.toLowerCase());
      const matchSeason = filterSeason === '전체' || item.season === filterSeason;
      const matchCat = filterCategory === '전체' || item.category === filterCategory;
      const matchStatus = filterStatus === '전체' || item.itemStatus === filterStatus;
      const matchBuyer = filterBuyer === '전체' || item.buyerId === filterBuyer;
      const matchNoBom = !filterNoBom || (!item.hasBom && (item.itemStatus || 'ACTIVE') === 'ACTIVE');
      return matchSearch && matchSeason && matchCat && matchStatus && matchBuyer && matchNoBom;
    });
  }, [items, search, filterSeason, filterCategory, filterStatus, filterBuyer, filterNoBom]);

  // 자동생성 미리보기
  useEffect(() => {
    if (manualStyleNo) return;
    const vendor = vendors.find(v => v.id === selectedVendorId);
    if (!vendor?.code || !editItem.category) { setPreviewStyleNo(''); return; }
    const date = registDate ? new Date(registDate) : new Date();
    const generated = generateStyleNo(vendor.code, date, editItem.category as Category, store.getItems(), isEdit ? editItem.id : undefined, editItem.erpCategory);
    setPreviewStyleNo(generated);
    setEditItem(prev => ({ ...prev, styleNo: generated }));
  }, [selectedVendorId, registDate, editItem.category, editItem.erpCategory, manualStyleNo, isEdit, editItem.id, vendors]);

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
    setModalOpen(true);
  };

  // 진입 시 prefill 체크 (localStorage 또는 URL 파라미터)
  useEffect(() => {
    // 1) URL 파라미터 우선 체크 (샘플관리 → 품목등록 버튼 클릭 시)
    const urlParams = new URLSearchParams(searchString);
    const urlSampleId = urlParams.get('sampleId'); // 샘플-품목 연결용 sampleId
    const urlStyleNo = urlParams.get('styleNo');
    const urlStyleName = urlParams.get('styleName');
    const urlBuyerId = urlParams.get('buyerId');
    const urlSeason = urlParams.get('season');

    if (urlStyleName || urlBuyerId || urlSampleId) {
      // 샘플 관리에서 넘어온 경우 (styleNo는 빈값 — 담당자가 직접 입력)
      const pf: {
        styleNo: string;
        styleName: string;
        buyerId: string;
        season: string;
        sampleId?: string;
        imageUrl?: string;
      } = {
        styleNo: urlStyleNo || '',   // TEMP 번호 대신 빈값 — 담당자가 정확한 번호 직접 입력
        styleName: urlStyleName || '',
        buyerId: urlBuyerId || '',
        season: urlSeason || '26SS',
        sampleId: urlSampleId || undefined,
      };
      // localStorage prefill에서 imageUrl 병합
      const storedPrefill = localStorage.getItem('ames_prefill_item');
      if (storedPrefill) {
        try {
          const stored = JSON.parse(storedPrefill);
          if (stored.imageUrl) pf.imageUrl = stored.imageUrl;
          localStorage.removeItem('ames_prefill_item');
        } catch { /* 무시 */ }
      }
      // sampleId를 sessionStorage에 보관 (handleSave에서 샘플-품목 연결에 사용)
      if (pf.sampleId) sessionStorage.setItem('ames_link_sampleId', pf.sampleId);
      openAdd(pf);
      // URL 파라미터 클린업 (히스토리 정리)
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
    // 최초 진입 시만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (item: Item) => {
    setEditItem({ ...item });
    setIsEdit(true); setManualStyleNo(true);
    setRegistDate(item.createdAt.split('T')[0]);
    setSelectedVendorId(''); setPreviewStyleNo(item.styleNo); setColorInput('');
    setCustomCategory(item.customCategory || '');
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!editItem.styleNo || !editItem.name) { toast.error('스타일번호와 품명을 입력하세요'); return; }
    if (!isEdit) {
      const dup = store.getItems().find(it => it.styleNo === editItem.styleNo);
      if (dup) { toast.error(`스타일번호 '${editItem.styleNo}'는 이미 등록되어 있습니다`); return; }
    }

    // 바이어 연결: selectedVendorId(자동생성 거래처)가 있으면 적용
    const buyerId = selectedVendorId || editItem.buyerId;

    if (isEdit && editItem.id) {
      // 수정 시: materialType 완제품 강제, customCategory 저장
      store.updateItem(editItem.id, { ...editItem, buyerId, materialType: '완제품', customCategory: customCategory || undefined } as Partial<Item>);
      toast.success('품목이 수정되었습니다');
    } else {
      // 신규 등록: materialType 완제품, itemStatus ACTIVE 강제
      const newId = genId();
      store.addItem({ ...editItem, buyerId, id: newId, hasBom: false, createdAt: new Date().toISOString(), materialType: '완제품', itemStatus: 'ACTIVE', customCategory: customCategory || undefined } as Item);

      // 샘플-품목 연결: 샘플 관리에서 넘어온 경우 해당 샘플의 styleId를 새 품목 ID로 업데이트
      const linkedSampleId = sessionStorage.getItem('ames_link_sampleId');
      if (linkedSampleId) {
        try {
          const samples = store.getSamples();
          const linkedSample = samples.find(s => s.id === linkedSampleId);
          if (linkedSample) {
            store.updateSample(linkedSampleId, {
              styleId: newId,
              styleNo: editItem.styleNo || '',   // 정식 스타일번호로 업데이트
            });
            toast.success(`품목 등록 완료 — 샘플 "${linkedSample.styleName}"에 연결되었습니다`);
          } else {
            toast.success('품목이 등록되었습니다');
          }
        } catch {
          toast.success('품목이 등록되었습니다');
        }
        sessionStorage.removeItem('ames_link_sampleId');
      } else {
        toast.success('품목이 등록되었습니다');
      }
    }
    setModalOpen(false);
    refresh();
  };

  const handleDelete = (id: string) => {
    if (confirm('정말 삭제하시겠습니까?')) { store.deleteItem(id); toast.success('삭제되었습니다'); refresh(); }
  };

  const addColor = () => {
    const c = colorInput.trim();
    if (!c) return;
    if ((editItem.colors || []).includes(c)) { toast.error('이미 추가된 컬러입니다'); return; }
    setEditItem(prev => ({ ...prev, colors: [...(prev.colors || []), c] }));
    setColorInput('');
  };

  const removeColor = (color: string) => {
    setEditItem(prev => ({ ...prev, colors: (prev.colors || []).filter(c => c !== color) }));
  };

  // 시즌별 스타일 현황
  const seasonStats = useMemo(() => {
    const seasons = seasonStatsTarget === '전체' ? SEASONS : [seasonStatsTarget as Season];
    return seasons.map(season => {
      const seasonItems = items.filter(i => i.season === season);
      return {
        season,
        total: seasonItems.length,
        temp: seasonItems.filter(i => i.itemStatus === 'TEMP').length,
        active: seasonItems.filter(i => i.itemStatus === 'ACTIVE').length,
        inactive: seasonItems.filter(i => i.itemStatus === 'INACTIVE').length,
        hasBom: seasonItems.filter(i => i.hasBom).length,
        noBom: seasonItems.filter(i => !i.hasBom && i.itemStatus === 'ACTIVE').length,
      };
    });
  }, [items, seasonStatsTarget]);

  // 바이어 거래처만
  const buyerVendors = vendors.filter(v => v.type === '바이어');
  const brandVendors = vendors.filter(v => v.code);

  // 마진율 계산
  const marginRate = (item: Item) => {
    if (!item.targetSalePrice || !item.baseCostKrw) return null;
    return ((item.targetSalePrice - item.baseCostKrw) / item.targetSalePrice * 100);
  };

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
          <p className="text-sm text-stone-500 mt-0.5">스타일별 품목 정보 · HB / SLG · TEMP → ACTIVE 전환</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowSeasonStats(true)} className="gap-2 border-stone-300 text-stone-600 hover:bg-stone-50">
            <BarChart2 size={16} />시즌별 현황
          </Button>
          <Button onClick={() => openAdd()} className="bg-[#C9A96E] hover:bg-[#B8985D] text-white gap-2">
            <Plus size={16} />품목 등록
          </Button>
        </div>
      </div>

      {/* 상태별 통계 */}
      <div className="grid grid-cols-4 gap-3">
        {(['TEMP', 'ACTIVE', 'INACTIVE'] as ItemStatus[]).map(s => {
          const count = items.filter(i => (i.itemStatus || 'ACTIVE') === s).length;
          return (
            <div key={s} className={`rounded-xl border p-3 text-center ${STATUS_COLOR[s]}`}>
              <p className="text-xl font-bold">{count}</p>
              <p className="text-xs mt-0.5">{ITEM_STATUS_LABEL[s]}</p>
            </div>
          );
        })}
        <div className="bg-white rounded-xl border border-stone-200 p-3 text-center">
          <p className="text-xl font-bold text-stone-800">{items.length}</p>
          <p className="text-xs text-stone-500 mt-0.5">전체</p>
        </div>
      </div>

      {/* 필터 */}
      <Card className="border-stone-200">
        <CardContent className="p-3 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="스타일번호 / 품명 / 바이어 검색" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-28 h-9"><SelectValue placeholder="상태" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="전체">전체 상태</SelectItem>
              <SelectItem value="TEMP">임시</SelectItem>
              <SelectItem value="ACTIVE">활성</SelectItem>
              <SelectItem value="INACTIVE">비활성</SelectItem>
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
            <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="전체">전체 카테고리</SelectItem>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterBuyer} onValueChange={setFilterBuyer}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="바이어" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="전체">전체 바이어</SelectItem>
              {buyerVendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <button
            onClick={() => setFilterNoBom(v => !v)}
            className={`h-9 px-3 rounded-lg border text-xs font-medium transition-colors ${filterNoBom ? 'bg-red-50 border-red-300 text-red-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}
          >
            BOM 미작성 {filterNoBom && `(${items.filter(i => !i.hasBom && (i.itemStatus || 'ACTIVE') === 'ACTIVE').length}건)`}
          </button>
        </CardContent>
      </Card>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500 w-12">이미지</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">스타일번호</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">바이어</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">품명</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">구분</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">상태</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">컬러</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">납품가</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">판매가</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">미발주</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">BOM</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const margin = marginRate(item);
                return (
                  <tr key={item.id} className={`border-b border-stone-50 hover:bg-stone-50/50 ${item.itemStatus === 'INACTIVE' ? 'opacity-50' : ''}`}>
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
                      {item.buyerId ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                          {vendors.find(v => v.id === item.buyerId)?.name || '-'}
                        </span>
                      ) : <span className="text-stone-300 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-stone-800">{item.name}</p>
                      {item.nameEn && <p className="text-xs text-stone-400">{item.nameEn}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {item.erpCategory && (
                          <span className={`text-xs px-1.5 py-0.5 rounded border w-fit ${ERP_CAT_COLOR[item.erpCategory]}`}>
                            {item.erpCategory}
                          </span>
                        )}
                        <span className="text-xs text-stone-400">{item.category}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLOR[item.itemStatus || 'ACTIVE']}`}>
                        {item.itemStatus === 'TEMP' ? '임시' : item.itemStatus === 'INACTIVE' ? '비활성' : '활성'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(item.colors || []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {(item.colors || []).slice(0, 3).map(c => (
                            <span key={c} className="text-xs px-1.5 py-0.5 bg-stone-100 text-stone-600 rounded">{c}</span>
                          ))}
                          {(item.colors || []).length > 3 && (
                            <span className="text-xs text-stone-400">+{(item.colors || []).length - 3}</span>
                          )}
                        </div>
                      ) : <span className="text-stone-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.targetSalePrice ? (
                        <div>
                          <p className="font-mono text-xs text-stone-700">{formatKRW(item.targetSalePrice)}</p>
                          {margin !== null && (
                            <p className={`text-[11px] ${margin >= 30 ? 'text-green-600' : margin >= 20 ? 'text-amber-600' : 'text-red-500'}`}>
                              마진 {margin.toFixed(1)}%
                            </p>
                          )}
                        </div>
                      ) : <span className="text-stone-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-stone-600">
                      {formatKRW(item.salePriceKrw)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(() => {
                        const months = monthsSinceLastOrder(item);
                        if (months === null) return <span className="text-stone-300 text-xs">-</span>;
                        return (
                          <span className={`text-xs font-medium ${months >= 12 ? 'text-red-500' : months >= 6 ? 'text-amber-600' : 'text-stone-500'}`}>
                            {months}개월
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => {
                          localStorage.setItem('ames_prefill_bom', item.styleNo);
                          navigate('/bom');
                        }}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors font-medium ${
                          item.hasBom
                            ? 'text-green-700 border-green-300 bg-green-50 hover:bg-green-100'
                            : item.itemStatus === 'ACTIVE'
                              ? 'text-red-600 border-red-300 bg-red-50 hover:bg-red-100'
                              : 'text-stone-400 border-stone-200 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        {item.hasBom ? 'BOM ✓' : item.itemStatus === 'ACTIVE' ? 'BOM ⚠' : 'BOM'}
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
                <tr><td colSpan={12} className="text-center py-12 text-stone-400">
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
        <DialogContent className="max-w-xl">
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
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-amber-600">TEMP</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-green-600">ACTIVE</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-stone-400">INACTIVE</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-blue-600">BOM완료</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-red-500">BOM미작성</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonStats.map(row => (
                    <tr key={row.season} className="border-b border-stone-50 hover:bg-stone-50">
                      <td className="px-4 py-2.5 font-semibold text-stone-700">{row.season}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-stone-800">{row.total}</td>
                      <td className="px-3 py-2.5 text-center text-amber-700">{row.temp}</td>
                      <td className="px-3 py-2.5 text-center text-green-700">{row.active}</td>
                      <td className="px-3 py-2.5 text-center text-stone-400">{row.inactive}</td>
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

      {/* 등록/수정 모달 */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>카테고리</Label>
                  <Select value={editItem.erpCategory || 'HB'} onValueChange={v => setEditItem({ ...editItem, erpCategory: v as ErpCategory })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HB">HB (핸드백)</SelectItem>
                      <SelectItem value="SLG">SLG (소가죽소품)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>세부 카테고리</Label>
                  <Select value={editItem.category || '숄더백'} onValueChange={v => {
                    setEditItem({ ...editItem, category: v as Category });
                    if (v !== '기타') setCustomCategory('');
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  {/* 기타 선택 시 직접 입력 */}
                  {editItem.category === '기타' && (
                    <Input
                      value={customCategory}
                      onChange={e => setCustomCategory(e.target.value)}
                      placeholder="직접 입력 (예: 지갑, 파우치, 카드케이스)"
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>납품가 (KRW)</Label>
                  <Input type="number" value={editItem.targetSalePrice || ''} onChange={e => setEditItem({ ...editItem, targetSalePrice: Number(e.target.value) })} placeholder="납품가" />
                </div>
                <div className="space-y-1.5">
                  <Label>판매가 (KRW)</Label>
                  <Input type="number" value={editItem.salePriceKrw || ''} onChange={e => setEditItem({ ...editItem, salePriceKrw: Number(e.target.value) })} placeholder="218000" />
                </div>
              </div>
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
              {(editItem.colors || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 bg-stone-50 rounded-lg border border-stone-100">
                  {(editItem.colors || []).map(c => (
                    <span key={c} className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-white border border-stone-200 rounded-full text-stone-700">
                      {c}
                      <button type="button" onClick={() => removeColor(c)} className="text-stone-400 hover:text-red-500">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>메모</Label>
              <Input value={editItem.memo || ''} onChange={e => setEditItem({ ...editItem, memo: e.target.value })} placeholder="비고" />
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
    </div>
  );
}
