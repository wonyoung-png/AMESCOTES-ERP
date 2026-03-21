// AMESCOTES ERP — 샘플 관리 (Phase 1 전면 재작성)
import { useState, useMemo, useRef, useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';
import {
  store, genId, formatKRW, formatNumber,
  type Sample, type SampleStage, type Season, type SampleBillingStatus,
  type SampleLocation, type SampleRevisionNote, type SampleMaterialCheckItem,
  type SampleMaterialRequest, type SampleDocument,
  type Item, type TradeStatement, type TradeStatementLine,
} from '@/lib/store';
import { resizeImage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Plus, Search, Trash2, Camera, FileText,
  ClipboardCheck, Eye, PackagePlus, FileSpreadsheet, File,
} from 'lucide-react';

// 자재 업체 목록은 store의 자재거래처에서 동적으로 불러옴 (하드코딩 제거)

// 파일 타입 판별
function getFileType(name: string): SampleDocument['fileType'] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel';
  return 'image';
}

// 문서 아이콘 렌더링
function DocIcon({ fileType }: { fileType: SampleDocument['fileType'] }) {
  if (fileType === 'pdf') return <File className="w-6 h-6 text-red-500" />;
  if (fileType === 'excel') return <FileSpreadsheet className="w-6 h-6 text-green-600" />;
  return <Camera className="w-6 h-6 text-stone-400" />;
}

const STAGES: SampleStage[] = ['1차', '2차', '3차', '4차', '최종승인', '반려'];
const BILLING_STATUSES: SampleBillingStatus[] = ['미청구', '청구완료', '수금완료'];
const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS'];
const LOCATIONS: SampleLocation[] = ['내부개발실', '중국공장'];
// SampleRound는 이제 number (제한 없음)

const STAGE_COLOR: Record<SampleStage, string> = {
  '1차':    'bg-blue-50 text-blue-700 border-blue-200',
  '2차':    'bg-indigo-50 text-indigo-700 border-indigo-200',
  '3차':    'bg-purple-50 text-purple-700 border-purple-200',
  '4차':    'bg-amber-50 text-amber-700 border-amber-200',
  '최종승인': 'bg-green-50 text-green-700 border-green-200',
  '반려':   'bg-red-50 text-red-600 border-red-200',
};

const BILLING_COLOR: Record<SampleBillingStatus, string> = {
  '미청구':   'bg-stone-50 text-stone-500 border-stone-200',
  '청구완료': 'bg-amber-50 text-amber-700 border-amber-200',
  '수금완료': 'bg-green-50 text-green-700 border-green-200',
};

// TEMP 품목 자동생성 헬퍼
function createTempItem(styleName: string, season: Season): Item {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
  const styleNo = `TEMP${yy}${mm}${seq}`;
  return {
    id: genId(),
    styleNo,
    name: styleName,
    nameEn: '',
    season,
    category: '숄더백',
    erpCategory: 'HB',
    itemStatus: 'TEMP',
    materialType: '완제품',
    material: '',
    salePriceKrw: 0,
    hasBom: false,
    createdAt: now.toISOString(),
  };
}

export default function SampleManagement() {
  const [, navigate] = useLocation();
  // URL 파라미터 읽기 (Dashboard에서 "샘플 관리로 이동" 클릭 시 openId 전달됨)
  const searchString = useSearch();
  const [samples, setSamples] = useState<Sample[]>(() => store.getSamples());
  const [items, setItems] = useState<Item[]>(() => store.getItems());
  const [vendors] = useState(() => store.getVendors().filter(v => v.type === '바이어'));
  // 자재거래처 목록 (store에서 동적으로 불러옴)
  const [materialVendors] = useState(() => store.getVendors().filter(v => v.type === '자재거래처'));
  const settings = store.getSettings();

  // 월별 통계 상태
  const [statMonth, setStatMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState('진행중');
  const [filterBilling, setFilterBilling] = useState('all');
  const [filterSeason, setFilterSeason] = useState('all');
  const [filterBuyer, setFilterBuyer] = useState('all');
  const [billingModal, setBillingModal] = useState(false);
  const [billingTarget, setBillingTarget] = useState<typeof samples[0] | null>(null);
  const [billingMode, setBillingMode] = useState<'new' | 'link'>('new');
  const [linkStatementId, setLinkStatementId] = useState('');

  // 메인 등록/수정 모달
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Partial<Sample>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [createTempMode, setCreateTempMode] = useState(false);
  const [tempStyleName, setTempStyleName] = useState('');

  // 상세 모달 (차수별 메모 / 자재 체크리스트)
  const [detailSample, setDetailSample] = useState<Sample | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // 이미지 업로드
  const imageFileRef = useRef<HTMLInputElement>(null);
  // 문서 업로드 (PDF, 엑셀)
  const docFileRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const current = form.imageUrls || [];
    if (current.length + files.length > 5) {
      toast.error('이미지는 최대 5장까지 업로드 가능합니다');
      return;
    }
    try {
      const resized = await Promise.all(files.slice(0, 5 - current.length).map(f => resizeImage(f)));
      setForm(f => ({ ...f, imageUrls: [...(f.imageUrls || []), ...resized] }));
    } catch {
      toast.error('이미지 업로드 실패');
    }
    if (imageFileRef.current) imageFileRef.current.value = '';
  };

  // 파일/이미지 통합 업로드 (이미지는 imageUrls, 문서는 documents)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const docFiles = files.filter(f => !f.type.startsWith('image/'));

    const currentImages = form.imageUrls || [];
    const currentDocs = form.documents || [];

    // 이미지 처리 (최대 5장)
    if (imageFiles.length > 0) {
      const available = 5 - currentImages.length;
      if (available <= 0) {
        toast.error('이미지는 최대 5장까지 업로드 가능합니다');
      } else {
        try {
          const resized = await Promise.all(imageFiles.slice(0, available).map(f => resizeImage(f)));
          setForm(f => ({ ...f, imageUrls: [...(f.imageUrls || []), ...resized] }));
        } catch {
          toast.error('이미지 업로드 실패');
        }
      }
    }

    // 문서 처리 (PDF, 엑셀, 최대 5개)
    if (docFiles.length > 0) {
      const available = 5 - currentDocs.length;
      if (available <= 0) {
        toast.error('문서는 최대 5개까지 업로드 가능합니다');
      } else {
        const toProcess = docFiles.slice(0, available);
        const newDocs: SampleDocument[] = await Promise.all(
          toProcess.map(f => new Promise<SampleDocument>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({
              name: f.name,
              url: reader.result as string,
              fileType: getFileType(f.name),
            });
            reader.onerror = reject;
            reader.readAsDataURL(f);
          }))
        );
        setForm(f => ({ ...f, documents: [...(f.documents || []), ...newDocs] }));
      }
    }

    if (docFileRef.current) docFileRef.current.value = '';
  };

  // 차수 메모 추가
  const [newRevNote, setNewRevNote] = useState('');
  const [newRevRound, setNewRevRound] = useState<number>(1);

  // 자재 체크리스트 항목 추가
  const [newCheckItem, setNewCheckItem] = useState('');

  const refresh = () => {
    setSamples(store.getSamples());
    setItems(store.getItems());
  };

  const IN_PROGRESS_STAGES: SampleStage[] = ['1차', '2차', '3차', '4차'];
  const filtered = useMemo(() => {
    let list = samples;
    if (filterStage === '진행중') list = list.filter(s => IN_PROGRESS_STAGES.includes(s.stage));
    else if (filterStage !== 'all') list = list.filter(s => s.stage === filterStage);
    if (filterBilling !== 'all') list = list.filter(s => s.billingStatus === filterBilling);
    if (filterSeason !== 'all') list = list.filter(s => s.season === filterSeason);
    if (filterBuyer !== 'all') list = list.filter(s => s.buyerId === filterBuyer);
    if (search) list = list.filter(s =>
      s.styleNo.toLowerCase().includes(search.toLowerCase()) ||
      s.styleName.toLowerCase().includes(search.toLowerCase())
    );
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [samples, filterStage, filterBilling, filterSeason, filterBuyer, search]);

  const stats = useMemo(() => {
    const unclaimed = samples.filter(s => s.billingStatus === '미청구');
    const totalUnclaimedKrw = unclaimed.reduce((s, x) => s + (x.costKrw || (x.costCny || 0) * settings.cnyKrw), 0);
    const approved = samples.filter(s => s.stage === '최종승인').length;
    const inProgress = samples.filter(s => s.stage !== '최종승인' && s.stage !== '반려').length;
    return { total: samples.length, approved, inProgress, unclaimed: unclaimed.length, totalUnclaimedKrw };
  }, [samples, settings.cnyKrw]);

  const openNew = () => {
    // 같은 스타일번호로 새 샘플 접수 시 기존 최대 차수 + 1로 자동 설정 (스타일 선택 시 처리)
    setForm({
      season: '26SS', stage: '1차',
      billingStatus: '미청구',  // 항상 미청구로 시작 (청구는 명세표 발행 시 업데이트)
      requestDate: new Date().toISOString().split('T')[0],
      location: '내부개발실', round: 1,
      costCny: 0, imageUrls: [], documents: [], revisionHistory: [], materialChecklist: [], materialRequests: [],
    });
    setEditId(null);
    setCreateTempMode(false);
    setTempStyleName('');
    setShowModal(true);
  };

  const openEdit = (s: Sample) => {
    setForm({ ...s });
    setEditId(s.id);
    setCreateTempMode(false);
    setShowModal(true);
  };

  const openDetail = (s: Sample) => {
    setDetailSample({ ...s });
    setNewRevNote('');
    setNewRevRound(1);
    setNewCheckItem('');
    setShowDetail(true);
  };

  // Dashboard에서 "샘플 관리로 이동" 클릭 시 URL 파라미터로 전달된 sampleId로 자동 모달 열기
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const openId = params.get('openId');
    if (openId) {
      const target = samples.find(s => s.id === openId);
      if (target) {
        openDetail(target);
        // URL에서 파라미터 제거 (히스토리 클린업)
        navigate('/samples', { replace: true });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchString, samples]);

  const handleStyleSelect = (styleId: string) => {
    const item = items.find(i => i.id === styleId);
    if (!item) return;
    // 품목의 바이어를 자동으로 연결
    setForm(f => ({ ...f, styleId: item.id, styleNo: item.styleNo, styleName: item.name, buyerId: item.buyerId }));
  };

  const handleSave = () => {
    let styleId = form.styleId;
    let styleNo = form.styleNo;
    let styleName = form.styleName;

    // TEMP 품목 자동생성
    if (createTempMode) {
      if (!tempStyleName.trim()) { toast.error('품명을 입력해주세요'); return; }
      const tempItem = createTempItem(tempStyleName.trim(), form.season || '26SS');
      store.addItem(tempItem);
      styleId = tempItem.id;
      styleNo = tempItem.styleNo;
      styleName = tempItem.name;
      toast.success(`TEMP 품목 ${tempItem.styleNo} 자동생성 완료`);
      setItems(store.getItems());
    }

    if (!styleId && !form.styleNo) { toast.error('스타일번호를 입력해주세요'); return; }
    if (!form.requestDate) { toast.error('의뢰일을 입력해주세요'); return; }

    // 스타일번호 중복 체크 (신규 등록 시)
    if (!editId && form.styleNo) {
      const dupSample = store.getSamples().find(s => s.styleNo === form.styleNo);
      if (dupSample) {
        const confirmed = confirm(`스타일번호 '${form.styleNo}'가 이미 샘플에 등록되어 있습니다.\n(${dupSample.styleName}, ${dupSample.stage})\n\n그래도 등록하시겠습니까?`);
        if (!confirmed) return;
      }
    }

    // 샘플 단가는 원화(sampleUnitPrice)로 입력 → costKrw로 저장
    const costKrw = form.sampleUnitPrice || (form.costCny || 0) * settings.cnyKrw;

    if (editId) {
      store.updateSample(editId, { ...form, styleId: styleId || form.styleId || '', styleNo: form.styleNo || styleNo || '', styleName: form.styleName || styleName || '', costKrw } as Partial<Sample>);
      toast.success('수정되었습니다');
    } else {
      const s: Sample = {
        id: genId(),
        styleId: form.styleId || styleId || genId(),
        styleNo: form.styleNo || styleNo || '',
        styleName: form.styleName || styleName || '',
        buyerId: form.buyerId,
        season: form.season || '26SS',
        stage: form.stage || '1차',
        location: form.location,
        round: form.round,
        roundName: form.roundName,
        color: form.color,
        assignee: form.assignee,
        requestDate: form.requestDate!,
        expectedDate: form.expectedDate,
        receivedDate: form.receivedDate,
        revisionNote: form.revisionNote,
        revisionHistory: form.revisionHistory || [],
        sampleUnitPrice: form.sampleUnitPrice,
        costCny: form.costCny || 0,
        costKrw,
        approvedBy: form.approvedBy,
        imageUrls: form.imageUrls || [],
        documents: form.documents || [],
        materialChecklist: form.materialChecklist || [],
        materialRequests: form.materialRequests || [],
        billingStatus: '미청구',  // 접수 시 항상 미청구 (청구 상태는 명세표 발행 시 자동 업데이트)
        createdAt: new Date().toISOString(),
        memo: form.memo,
      };
      store.addSample(s);
      toast.success('샘플이 등록되었습니다');
    }
    refresh();
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    store.deleteSample(id);
    refresh();
    toast.success('삭제되었습니다');
  };

  // 리스트에서 바로 단계 변경
  const handleStageChange = (id: string, stage: SampleStage) => {
    const updates: Partial<Sample> = { stage };
    if (stage === '최종승인') {
      updates.approvedBy = '관리자';
      const s = samples.find(x => x.id === id);
      if (s) {
        const item = store.getItems().find(i => i.id === s.styleId);
        if (item && item.itemStatus === 'TEMP') {
          store.updateItem(item.id, { itemStatus: 'ACTIVE' });
        }
      }
    }
    store.updateSample(id, updates);
    refresh();
    toast.success(`단계가 "${stage}"로 변경되었습니다`);
  };

  const handleBillAll = () => {
    const unclaimed = samples.filter(s => s.billingStatus === '미청구');
    if (unclaimed.length === 0) { toast.error('미청구 샘플이 없습니다'); return; }
    const today = new Date().toISOString().split('T')[0];

    // 바이어별로 그룹핑
    const byBuyer = new Map<string, typeof unclaimed>();
    unclaimed.forEach(s => {
      const buyerId = s.buyerId || 'unknown';
      if (!byBuyer.has(buyerId)) byBuyer.set(buyerId, []);
      byBuyer.get(buyerId)!.push(s);
    });

    let createdCount = 0;
    byBuyer.forEach((samplesGroup, buyerId) => {
      const vendor = vendors.find(v => v.id === buyerId);
      const buyerName = vendor?.name || buyerId;
      const vendorCode = vendor?.vendorCode || vendor?.code || 'SAMP';

      // statementNo 채번 (YYYYMM-vendorCode-순번 형식)
      const statementNo = store.getNextStatementNo(vendorCode);

      // 라인 생성
      const lines: TradeStatementLine[] = samplesGroup.map(s => ({
        id: genId(),
        description: `[${s.styleNo}] ${s.styleName || ''} ${s.stage} 샘플비`,
        qty: 1,
        unitPrice: s.costKrw || Math.round((s.costCny || 0) * settings.cnyKrw),
        taxType: '과세' as const,
        taxRate: 0.1,
        memo: s.id,
      }));

      const statement: TradeStatement = {
        id: genId(),
        statementNo,
        vendorId: buyerId,
        vendorName: buyerName,
        vendorCode,
        issueDate: today,
        lines,
        status: '미청구' as const,
        createdAt: new Date().toISOString(),
      };

      store.addTradeStatement(statement);
      createdCount++;
    });

    // billingStatus 업데이트
    unclaimed.forEach(s => store.updateSample(s.id, { billingStatus: '청구완료', billingDate: today }));
    refresh();
    toast.success(`거래명세표 ${createdCount}건이 생성되었습니다`);
  };

  // 차수 메모 추가
  const handleAddRevNote = () => {
    if (!detailSample || !newRevNote.trim()) return;
    const note: SampleRevisionNote = {
      round: newRevRound,
      date: new Date().toISOString().split('T')[0],
      note: newRevNote.trim(),
    };
    const updated: Sample = {
      ...detailSample,
      revisionHistory: [...(detailSample.revisionHistory || []), note],
    };
    store.updateSample(detailSample.id, { revisionHistory: updated.revisionHistory });
    setDetailSample(updated);
    setNewRevNote('');
    refresh();
    toast.success('메모가 추가되었습니다');
  };

  // 자재 체크리스트 항목 추가
  const handleAddCheckItem = () => {
    if (!detailSample || !newCheckItem.trim()) return;
    const item: SampleMaterialCheckItem = { id: genId(), itemName: newCheckItem.trim(), isReady: false };
    const updated: Sample = {
      ...detailSample,
      materialChecklist: [...(detailSample.materialChecklist || []), item],
    };
    store.updateSample(detailSample.id, { materialChecklist: updated.materialChecklist });
    setDetailSample(updated);
    setNewCheckItem('');
    refresh();
  };

  // 체크리스트 토글
  const handleToggleCheck = (itemId: string) => {
    if (!detailSample) return;
    const updated: Sample = {
      ...detailSample,
      materialChecklist: (detailSample.materialChecklist || []).map(c =>
        c.id === itemId ? { ...c, isReady: !c.isReady } : c
      ),
    };
    store.updateSample(detailSample.id, { materialChecklist: updated.materialChecklist });
    setDetailSample(updated);
    refresh();
  };

  // 샘플 승인 처리 (TEMP → ACTIVE)
  const handleApprove = (s: Sample) => {
    store.updateSample(s.id, { stage: '최종승인', approvedBy: '관리자' });
    // 해당 품목 상태를 ACTIVE로
    const item = items.find(i => i.id === s.styleId);
    if (item && item.itemStatus === 'TEMP') {
      store.updateItem(item.id, { itemStatus: 'ACTIVE' });
    }
    refresh();
    toast.success(`${s.styleNo} 최종 승인 — 품목이 ACTIVE 상태로 전환됩니다`);
  };

  // 품목 등록 (최종승인 샘플에서 품목 마스터로 이동 + prefill)
  const handleRegisterItem = (s: Sample) => {
    localStorage.setItem('ames_prefill_item', JSON.stringify({
      styleNo: s.styleNo,
      buyerId: s.buyerId,
      season: s.season,
      styleName: s.styleName,
      imageUrl: s.imageUrls?.[0] ?? undefined,
    }));
    navigate('/items');
    toast.success('품목 마스터로 이동합니다. 샘플 정보가 자동 입력됩니다.');
  };

  // 발주 생성 (이미 품목 등록된 최종승인 샘플에서)
  const handleCreateOrder = (s: Sample) => {
    localStorage.setItem('ames_prefill_order', JSON.stringify({
      styleId: s.styleId,
      styleNo: s.styleNo,
      styleName: s.styleName,
      season: s.season,
    }));
    navigate('/orders');
    toast.success('생산 발주 페이지로 이동합니다. 스타일이 자동 선택됩니다.');
  };

  // 월별 담당자별 처리량 통계
  const monthlyStats = useMemo(() => {
    const [year, month] = statMonth.split('-');
    const filtered = samples.filter(s => {
      const d = s.createdAt.slice(0, 7);
      return d === `${year}-${month}`;
    });
    const map = new Map<string, { total: number; done: number }>();
    filtered.forEach(s => {
      const key = s.assignee || '미지정';
      const cur = map.get(key) || { total: 0, done: 0 };
      cur.total++;
      if (s.stage === '최종승인') cur.done++;
      map.set(key, cur);
    });
    return Array.from(map.entries()).map(([assignee, data]) => ({ assignee, ...data }));
  }, [samples, statMonth]);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-stone-800">샘플 관리</h1>
          <p className="text-xs md:text-sm text-stone-500 mt-0.5 hidden sm:block">샘플 접수 · 차수별 메모 · 자재 체크리스트 · TEMP 품목 자동생성</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleBillAll} className="gap-1 md:gap-2 text-amber-700 border-amber-300 hover:bg-amber-50 text-xs md:text-sm h-8 md:h-10 px-2 md:px-4">
            <FileText className="w-3.5 h-3.5 md:w-4 md:h-4" /><span className="hidden sm:inline">명세표 발행</span><span className="sm:hidden">발행</span>
          </Button>
          <Button onClick={openNew} className="bg-amber-700 hover:bg-amber-800 text-white gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-10 px-2 md:px-4">
            <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />샘플 접수
          </Button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 md:gap-3">
        {[
          { label: '전체',    value: stats.total,            color: 'text-stone-800' },
          { label: '진행중',  value: stats.inProgress,       color: 'text-blue-700' },
          { label: '최종승인', value: stats.approved,         color: 'text-green-700' },
          { label: '미청구',  value: stats.unclaimed,        color: 'text-amber-700' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-stone-200 p-4">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}건</p>
            <p className="text-xs text-stone-500 mt-0.5">{s.label}</p>
          </div>
        ))}
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xl font-bold text-red-600">{formatKRW(stats.totalUnclaimedKrw)}</p>
          <p className="text-xs text-stone-500 mt-0.5">미청구 금액</p>
        </div>
      </div>

      {/* 이번 달 샘플 현황 요약 */}
      {(() => {
        const thisMonth = new Date().toISOString().slice(0, 7);
        const thisMonthSamples = samples.filter(s => s.createdAt.startsWith(thisMonth));
        const thisMonthInProgress = thisMonthSamples.filter(s => ['1차', '2차', '3차', '4차'].includes(s.stage)).length;
        const thisMonthApproved = thisMonthSamples.filter(s => s.stage === '최종승인').length;
        const thisMonthReceived = thisMonthSamples.length;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-amber-800">📋 이번 달 샘플 현황</span>
              <span className="text-xs text-amber-600">({thisMonth})</span>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div className="text-center">
                <p className="font-bold text-stone-800">{thisMonthReceived}건</p>
                <p className="text-xs text-stone-500">접수</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-blue-700">{thisMonthInProgress}건</p>
                <p className="text-xs text-stone-500">진행중</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-green-700">{thisMonthApproved}건</p>
                <p className="text-xs text-stone-500">완료</p>
              </div>
              {thisMonthReceived > 0 && (
                <div className="text-center">
                  <p className="font-bold text-amber-700">{Math.round(thisMonthApproved / thisMonthReceived * 100)}%</p>
                  <p className="text-xs text-stone-500">완료율</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 월별 담당자별 처리량 통계 */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex items-center gap-3 mb-3">
          <p className="text-sm font-semibold text-stone-700">월별 담당자별 처리량</p>
          <Input
            type="month"
            value={statMonth}
            onChange={e => setStatMonth(e.target.value)}
            className="w-40 h-8 text-sm"
          />
        </div>
        {monthlyStats.length === 0 ? (
          <p className="text-xs text-stone-400 text-center py-2">해당 월 샘플 없음</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100">
                <th className="text-left py-1.5 text-xs text-stone-500">담당자</th>
                <th className="text-center py-1.5 text-xs text-stone-500">전체 건수</th>
                <th className="text-center py-1.5 text-xs text-stone-500">최종승인</th>
                <th className="text-center py-1.5 text-xs text-stone-500">승인율</th>
              </tr>
            </thead>
            <tbody>
              {monthlyStats.map(row => (
                <tr key={row.assignee} className="border-b border-stone-50">
                  <td className="py-1.5 text-stone-700 font-medium">{row.assignee}</td>
                  <td className="py-1.5 text-center text-stone-600">{row.total}건</td>
                  <td className="py-1.5 text-center text-green-600 font-medium">{row.done}건</td>
                  <td className="py-1.5 text-center text-xs">
                    {row.total > 0 ? (
                      <span className={row.done / row.total >= 0.5 ? 'text-green-600' : 'text-amber-600'}>
                        {Math.round(row.done / row.total * 100)}%
                      </span>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 단계 탭 필터 */}
      <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl w-fit flex-wrap">
        {[
          { value: 'all', label: '전체' },
          { value: '진행중', label: '진행중' },
          { value: '1차', label: '1차' },
          { value: '2차', label: '2차' },
          { value: '3차', label: '3차' },
          { value: '4차', label: '4차' },
          { value: '최종승인', label: '최종승인' },
          { value: '반려', label: '반려' },
        ].map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilterStage(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              filterStage === opt.value
                ? 'bg-white text-stone-800 shadow-sm'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {opt.label}
            {opt.value === '진행중' && (
              <span className="ml-1 text-[10px] text-blue-600 font-bold">
                {samples.filter(s => ['1차','2차','3차','4차'].includes(s.stage)).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 검색 + 필터 */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="스타일번호 / 품명 검색" className="pl-9 h-9" />
        </div>
        <Select value={filterSeason} onValueChange={setFilterSeason}>
          <SelectTrigger className="w-28 h-9"><SelectValue placeholder="시즌" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 시즌</SelectItem>
            {SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterBuyer} onValueChange={setFilterBuyer}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="바이어" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 바이어</SelectItem>
            {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterBilling} onValueChange={setFilterBilling}>
          <SelectTrigger className="w-28 h-9"><SelectValue placeholder="청구상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            {BILLING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* 테이블 (데스크탑) */}
      <div className="hidden md:block bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500 w-12">이미지</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">바이어</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">스타일</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">장소/차수</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">단계</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">의뢰일</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">목표완료</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">비고</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">비용(KRW)</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">청구</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-stone-400">
                <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 샘플이 없습니다</p>
              </td></tr>
            ) : filtered.map(s => {
              const checkCount = (s.materialChecklist || []).length;
              const readyCount = (s.materialChecklist || []).filter(c => c.isReady).length;
              return (
                <tr key={s.id} className="border-b border-stone-50 hover:bg-stone-50/50">
                  <td className="px-3 py-2.5">
                    {(s.imageUrls || []).length > 0 ? (
                      <img src={s.imageUrls[0]} alt={s.styleNo} className="w-14 h-14 object-cover rounded-lg border border-stone-200" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-400">
                        <Camera className="w-5 h-5" />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {s.buyerId ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        {vendors.find(v => v.id === s.buyerId)?.name || '-'}
                      </span>
                    ) : <span className="text-stone-300 text-xs">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-stone-700">{s.styleNo}</p>
                    <p className="text-xs text-stone-400">{s.styleName}</p>
                    <Badge variant="outline" className="text-[10px] mt-0.5">{s.season}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {s.location && <p className="text-xs text-stone-600">{s.location}</p>}
                    {s.round && (
                      <p className="text-xs text-blue-600 font-medium">
                        {s.round}차{s.roundName ? ` (${s.roundName})` : ''}
                      </p>
                    )}
                    {s.assignee && <p className="text-[11px] text-stone-400">{s.assignee}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <Select value={s.stage} onValueChange={v => handleStageChange(s.id, v as SampleStage)}>
                      <SelectTrigger className={`h-7 text-xs w-28 border ${STAGE_COLOR[s.stage] || 'bg-stone-50 text-stone-600 border-stone-200'}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STAGES.map(st => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-stone-600 text-xs">{s.requestDate}</td>
                  <td className="px-4 py-3 text-stone-500 text-xs">{s.expectedDate || '-'}</td>
                  <td className="px-4 py-3 text-xs text-stone-500 max-w-[120px]">
                    {s.memo && <p className="truncate">{s.memo}</p>}
                    {checkCount > 0 && (
                      <span className={`inline-flex items-center gap-1 text-xs ${readyCount === checkCount ? 'text-green-600' : 'text-amber-600'}`}>
                        <ClipboardCheck className="w-3 h-3" />{readyCount}/{checkCount}
                      </span>
                    )}
                    {!s.memo && checkCount === 0 && <span className="text-stone-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-stone-700 text-xs">{formatKRW(s.costKrw || Math.round((s.costCny || 0) * settings.cnyKrw))}</td>
                  <td className="px-4 py-3">
                    {s.billingStatus === '미청구' ? (
                      <button
                        onClick={() => {
                          setBillingTarget(s);
                          setBillingMode('new');
                          setLinkStatementId('');
                          setBillingModal(true);
                        }}
                        className="inline-flex text-xs px-2 py-0.5 rounded-full border bg-stone-50 text-stone-500 border-stone-200 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300 transition-colors whitespace-nowrap"
                        title="거래명세표 생성 또는 기존 전표 연결"
                      >
                        청구하기
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border ${BILLING_COLOR[s.billingStatus]}`}>
                          {s.billingStatus}
                        </span>
                        {s.billingStatus === '청구완료' && (
                          <button
                            onClick={() => {
                              if (confirm('청구완료를 미청구로 되돌리겠습니까?')) {
                                store.updateSample(s.id, { billingStatus: '미청구', billingDate: undefined });
                                setSamples(store.getSamples());
                              }
                            }}
                            className="text-[10px] text-stone-400 hover:text-red-500"
                            title="미청구로 되돌리기"
                          >↩</button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openDetail(s)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => openEdit(s)}>수정</Button>
                      {s.stage !== '최종승인' && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-green-700 hover:text-green-800"
                          onClick={() => handleApprove(s)}>승인</Button>
                      )}
                      {s.stage === '최종승인' && (() => {
                        const registeredItem = items.find(i => i.id === s.styleId && i.itemStatus !== 'TEMP');
                        return (
                          <>
                            {!registeredItem && (
                              <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-blue-700 hover:text-blue-900 border border-blue-200"
                                onClick={() => handleRegisterItem(s)}>
                                <PackagePlus className="w-3 h-3 mr-1" />품목 등록
                              </Button>
                            )}
                            {registeredItem && (
                              <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-amber-700 hover:text-amber-900 border border-amber-300"
                                onClick={() => handleCreateOrder(s)}>
                                <FileText className="w-3 h-3 mr-1" />발주 생성
                              </Button>
                            )}
                          </>
                        );
                      })()}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(s.id)}>
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

      {/* 카드 리스트 (모바일) */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-stone-400 bg-white rounded-xl border border-stone-200">
            <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">등록된 샘플이 없습니다</p>
          </div>
        ) : filtered.map(s => {
          const checkCount = (s.materialChecklist || []).length;
          const readyCount = (s.materialChecklist || []).filter(c => c.isReady).length;
          return (
            <div key={s.id} className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="flex gap-3">
                {/* 썸네일 */}
                <div className="shrink-0">
                  {(s.imageUrls || []).length > 0 ? (
                    <img src={s.imageUrls[0]} alt={s.styleNo} className="w-16 h-16 object-cover rounded-lg border border-stone-200" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-400">
                      <Camera className="w-5 h-5" />
                    </div>
                  )}
                </div>
                {/* 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-stone-800 text-sm">{s.styleNo}</p>
                      <p className="text-xs text-stone-500 truncate">{s.styleName}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${STAGE_COLOR[s.stage] || 'bg-stone-50 text-stone-600 border-stone-200'}`}>
                      {s.stage}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {s.buyerId && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                        {vendors.find(v => v.id === s.buyerId)?.name || '-'}
                      </span>
                    )}
                    <Badge variant="outline" className="text-[10px]">{s.season}</Badge>
                    <span className="text-[11px] text-stone-400">{s.requestDate}</span>
                  </div>
                  {checkCount > 0 && (
                    <span className={`inline-flex items-center gap-1 text-xs mt-1 ${readyCount === checkCount ? 'text-green-600' : 'text-amber-600'}`}>
                      <ClipboardCheck className="w-3 h-3" />{readyCount}/{checkCount}
                    </span>
                  )}
                </div>
              </div>
              {/* 하단 액션 */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-100">
                <div>
                  {s.billingStatus === '미청구' ? (
                    <button
                      onClick={() => { setBillingTarget(s); setBillingMode('new'); setLinkStatementId(''); setBillingModal(true); }}
                      className="text-xs px-2.5 py-1 rounded-full border bg-stone-50 text-stone-500 border-stone-200 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300 transition-colors"
                    >
                      청구하기
                    </button>
                  ) : (
                    <span className={`text-xs px-2.5 py-1 rounded-full border ${BILLING_COLOR[s.billingStatus]}`}>{s.billingStatus}</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openDetail(s)}>
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => openEdit(s)}>수정</Button>
                  {s.stage !== '최종승인' && (
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-green-700" onClick={() => handleApprove(s)}>승인</Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(s.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 등록/수정 모달 ── */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-xl sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? '샘플 수정' : '샘플 접수'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">

            {/* TEMP 품목 자동생성 토글 */}
            {!editId && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox" checked={createTempMode}
                    onChange={e => setCreateTempMode(e.target.checked)}
                    className="accent-amber-600"
                  />
                  <span className="text-sm font-medium text-amber-800">TEMP 품목 자동생성</span>
                  <span className="text-xs text-amber-600">(아직 품목이 없는 신규 샘플)</span>
                </label>
                {createTempMode && (
                  <div className="mt-2 space-y-1.5">
                    <Label className="text-xs text-amber-700">품명 *</Label>
                    <Input
                      value={tempStyleName}
                      onChange={e => setTempStyleName(e.target.value)}
                      placeholder="예: 파니에 쁘띠 백"
                      className="bg-white"
                    />
                    <p className="text-[11px] text-amber-600">TEMP 상태로 품목 자동생성 후 샘플 연결됩니다</p>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 바이어 (맨 위) */}
              <div className="col-span-2 space-y-1.5">
                <Label>바이어</Label>
                <Select value={form.buyerId || 'none'} onValueChange={v => setForm(f => ({ ...f, buyerId: v === 'none' ? undefined : v }))}>
                  <SelectTrigger><SelectValue placeholder="바이어 선택 (선택사항)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">미지정</SelectItem>
                    {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* 스타일 선택 (TEMP 자동생성이 아닐 때) */}
              {!createTempMode && (
                <div className="col-span-2 space-y-2">
                  <Label>기존 스타일에서 이미지 불러오기 <span className="text-stone-400 font-normal text-xs">(선택사항 — 컬러 추가 등)</span></Label>
                  <Select value={form.styleId || 'none'} onValueChange={v => {
                    if (v === 'none') { setForm(f => ({ ...f, styleId: undefined })); return; }
                    const item = items.find(i => i.id === v);
                    if (item) {
                      // 컬러추가 샘플: 스타일번호 자동생성(기존번호-1,-2,...), 품명 자동입력, 이미지 불러오기
                      const existingColorSamples = store.getSamples().filter(s =>
                        s.styleNo.startsWith(item.styleNo + '-') && /^.+-\d+$/.test(s.styleNo)
                      );
                      const maxSuffix = existingColorSamples.length > 0
                        ? Math.max(...existingColorSamples.map(s => parseInt(s.styleNo.split('-').pop() || '0') || 0)) + 1
                        : 1;
                      const newStyleNo = `${item.styleNo}-${maxSuffix}`;
                      setForm(f => ({
                        ...f,
                        styleId: item.id,
                        styleNo: newStyleNo,
                        styleName: item.name,
                        buyerId: item.buyerId || f.buyerId,
                        imageUrls: item.imageUrl ? [item.imageUrl] : (f.imageUrls || []),
                      }));
                    }
                  }}>
                    <SelectTrigger className="text-xs h-8"><SelectValue placeholder="스타일 선택 → 번호/품명 자동입력 + 이미지 불러오기" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">선택 안 함</SelectItem>
                      {items
                        .filter(i => !form.buyerId || form.buyerId === 'none' || i.buyerId === form.buyerId)
                        .map(i => (
                        <SelectItem key={i.id} value={i.id} className="text-xs">
                          {i.styleNo} — {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-stone-500">새 스타일번호 *</Label>
                      <Input value={form.styleNo || ''} onChange={e => setForm(f => ({ ...f, styleNo: e.target.value }))} placeholder="예: AT2603HB01" className="h-8 text-xs" />
                      {/* 스타일번호 중복 체크 */}
                      {form.styleNo && !editId && (() => {
                        const dupSample = store.getSamples().find(s => s.styleNo === form.styleNo && s.id !== editId);
                        const dupItem = store.getItems().find(i => i.styleNo === form.styleNo);
                        if (dupSample || dupItem) {
                          return (
                            <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                              ⚠️ 중복: {dupSample ? `샘플에 이미 존재 (${dupSample.stage})` : `품목 마스터에 존재 (${dupItem?.itemStatus})`}
                            </p>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-stone-500">품명 *</Label>
                      <Input value={form.styleName || ''} onChange={e => setForm(f => ({ ...f, styleName: e.target.value }))} placeholder="품명 입력" className="h-8 text-xs" />
                    </div>
                  </div>
                </div>
              )}

              {/* 컬러 */}
              <div className="col-span-2 space-y-1.5">
                <Label>컬러 <span className="text-stone-400 text-xs">(선택)</span></Label>
                <Input value={form.color || ''} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="예: 블랙, 카멜, RED" className="h-9" />
              </div>

              <div className="space-y-1.5">
                <Label>시즌</Label>
                <Select value={form.season || '26SS'} onValueChange={v => setForm(f => ({ ...f, season: v as Season }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>단계</Label>
                <Select value={form.stage || '1차'} onValueChange={v => setForm(f => ({ ...f, stage: v as SampleStage }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {/* 작업방식 (단계 바로 다음) */}
              <div className="space-y-1.5">
                <Label>작업방식 <span className="text-stone-400 text-xs">(선택)</span></Label>
                <Input
                  value={form.roundName || ''}
                  onChange={e => setForm(f => ({ ...f, roundName: e.target.value }))}
                  placeholder="예: 가봉, 직봉, 수정 직봉"
                />
              </div>
              <div className="space-y-1.5">
                <Label>샘플 장소</Label>
                <Select value={form.location || '내부개발실'} onValueChange={v => setForm(f => ({ ...f, location: v as SampleLocation }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>담당자</Label>
                <Input value={form.assignee || ''} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))} placeholder="담당자명" />
              </div>
              <div className="space-y-1.5">
                <Label>의뢰일 *</Label>
                <Input type="date" value={form.requestDate || ''} onChange={e => setForm(f => ({ ...f, requestDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>목표 완료일</Label>
                <Input type="date" value={form.expectedDate || ''} onChange={e => setForm(f => ({ ...f, expectedDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>샘플 단가 (원)</Label>
                <Input type="number" step="100" value={form.sampleUnitPrice ?? ''} onChange={e => setForm(f => ({ ...f, sampleUnitPrice: parseFloat(e.target.value) || undefined }))} placeholder="예: 35000" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>비고</Label>
                <Input value={form.memo || ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
              </div>
            </div>

            {/* 자재 요청 목록 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>자재 요청 목록</Label>
                <Button
                  type="button" variant="outline" size="sm" className="h-7 text-xs"
                  onClick={() => setForm(f => ({
                    ...f,
                    materialRequests: [...(f.materialRequests || []), { itemName: '', vendor: '', color: '', qty: 1, unit: '개' }],
                  }))}
                >
                  <Plus className="w-3 h-3 mr-1" />행 추가
                </Button>
              </div>
              {(form.materialRequests || []).length === 0 ? (
                <p className="text-xs text-stone-400 text-center py-2">자재 요청 없음 (행 추가 버튼으로 추가)</p>
              ) : (
                <div className="space-y-2">
                  {/* 헤더 */}
                  <div className="grid grid-cols-12 gap-1 text-xs text-stone-500 px-1">
                    <span className="col-span-3">자재명</span>
                    <span className="col-span-3">업체</span>
                    <span className="col-span-2">컬러</span>
                    <span className="col-span-1 text-center">수량</span>
                    <span className="col-span-2">단위</span>
                    <span className="col-span-1"></span>
                  </div>
                  {(form.materialRequests || []).map((req, idx) => {
                    // 자재거래처 이름 목록 + 기타 옵션
                    const materialVendorNames = materialVendors.map(v => v.name);
                    const isCustomVendor = !!req.vendor && req.vendor !== '기타' && !materialVendorNames.includes(req.vendor);
                    const selectVal = isCustomVendor ? '기타' : (req.vendor || 'none');
                    return (
                      <div key={idx} className="space-y-1">
                        <div className="grid grid-cols-12 gap-1 items-center">
                          {/* 자재명 */}
                          <Input
                            className="col-span-3 h-8 text-xs"
                            value={req.itemName}
                            onChange={e => setForm(f => {
                              const reqs = [...(f.materialRequests || [])];
                              reqs[idx] = { ...reqs[idx], itemName: e.target.value };
                              return { ...f, materialRequests: reqs };
                            })}
                            placeholder="가죽 네이키드"
                          />
                          {/* 업체 선택 (자재거래처 목록에서 동적 로드) */}
                          <Select
                            value={selectVal}
                            onValueChange={v => setForm(f => {
                              const reqs = [...(f.materialRequests || [])];
                              reqs[idx] = { ...reqs[idx], vendor: v === 'none' ? '' : (v === '기타' ? '' : v) };
                              return { ...f, materialRequests: reqs };
                            })}
                          >
                            <SelectTrigger className="col-span-3 h-8 text-xs">
                              <SelectValue placeholder="업체" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">선택 안 함</SelectItem>
                              {materialVendors.map(v => (
                                <SelectItem key={v.id} value={v.name}>{v.name}</SelectItem>
                              ))}
                              <SelectItem value="기타">기타 (직접입력)</SelectItem>
                            </SelectContent>
                          </Select>
                          {/* 컬러 */}
                          <Input
                            className="col-span-2 h-8 text-xs"
                            value={req.color || ''}
                            onChange={e => setForm(f => {
                              const reqs = [...(f.materialRequests || [])];
                              reqs[idx] = { ...reqs[idx], color: e.target.value };
                              return { ...f, materialRequests: reqs };
                            })}
                            placeholder="블랙"
                          />
                          {/* 수량 */}
                          <Input
                            type="number"
                            min={1}
                            className="col-span-1 h-8 text-xs text-center"
                            value={req.qty}
                            onChange={e => setForm(f => {
                              const reqs = [...(f.materialRequests || [])];
                              reqs[idx] = { ...reqs[idx], qty: parseFloat(e.target.value) || 1 };
                              return { ...f, materialRequests: reqs };
                            })}
                          />
                          {/* 단위 */}
                          <Input
                            className="col-span-2 h-8 text-xs"
                            value={req.unit}
                            onChange={e => setForm(f => {
                              const reqs = [...(f.materialRequests || [])];
                              reqs[idx] = { ...reqs[idx], unit: e.target.value };
                              return { ...f, materialRequests: reqs };
                            })}
                            placeholder="장/개/m"
                          />
                          {/* 삭제 */}
                          <Button
                            type="button" variant="ghost" size="sm" className="col-span-1 h-8 w-8 p-0 text-red-400 hover:text-red-600"
                            onClick={() => setForm(f => ({
                              ...f,
                              materialRequests: (f.materialRequests || []).filter((_, i) => i !== idx),
                            }))}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                        {/* 기타 업체 직접입력 */}
                        {(selectVal === '기타' || isCustomVendor) && (
                          <Input
                            className="h-7 text-xs ml-[25%] w-[25%]"
                            value={req.vendor || ''}
                            onChange={e => setForm(f => {
                              const reqs = [...(f.materialRequests || [])];
                              reqs[idx] = { ...reqs[idx], vendor: e.target.value };
                              return { ...f, materialRequests: reqs };
                            })}
                            placeholder="업체명 직접입력"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
            {/* 파일/이미지 업로드 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>파일/이미지 첨부 <span className="text-xs text-stone-400 font-normal">(이미지 최대 5장 + 문서 최대 5개)</span></Label>
                <Button
                  type="button" variant="outline" size="sm" className="h-7 text-xs gap-1"
                  onClick={() => docFileRef.current?.click()}
                  disabled={(form.imageUrls || []).length >= 5 && (form.documents || []).length >= 5}
                >
                  <Camera className="w-3 h-3" />파일/이미지 추가
                </Button>
              </div>
              {/* 통합 파일 입력 (이미지 + PDF + 엑셀) */}
              <input
                ref={docFileRef}
                type="file"
                accept="image/*,.pdf,.xlsx,.xls"
                multiple
                className="hidden"
                onChange={handleFileUpload}
              />
              {/* 이미지 미리보기 */}
              {(form.imageUrls || []).length > 0 && (
                <div>
                  <p className="text-xs text-stone-500 mb-1">이미지 ({(form.imageUrls || []).length}/5)</p>
                  <div className="flex flex-wrap gap-2 p-2 bg-stone-50 rounded-lg border border-stone-100">
                    {(form.imageUrls || []).map((url, idx) => (
                      <div key={idx} className="relative group">
                        <img
                          src={url}
                          alt={`샘플 이미지 ${idx + 1}`}
                          className="w-16 h-16 object-cover rounded-lg border border-stone-200 cursor-pointer"
                          onClick={() => window.open(url, '_blank')}
                        />
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, imageUrls: (f.imageUrls || []).filter((_, i) => i !== idx) }))}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 문서 목록 */}
              {(form.documents || []).length > 0 && (
                <div>
                  <p className="text-xs text-stone-500 mb-1">첨부 문서 ({(form.documents || []).length}/5)</p>
                  <div className="space-y-1">
                    {(form.documents || []).map((doc, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-stone-50 rounded-lg border border-stone-100 group">
                        <DocIcon fileType={doc.fileType} />
                        <button
                          type="button"
                          className="flex-1 text-xs text-stone-700 text-left hover:text-blue-600 truncate"
                          onClick={() => window.open(doc.url, '_blank')}
                        >
                          {doc.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, documents: (f.documents || []).filter((_, i) => i !== idx) }))}
                          className="text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(form.imageUrls || []).length === 0 && (form.documents || []).length === 0 && (
                <p className="text-xs text-stone-400 text-center py-3 border border-dashed border-stone-200 rounded-lg">
                  파일 없음 — 위 버튼으로 이미지·PDF·엑셀을 추가하세요
                </p>
              )}
            </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">{editId ? '수정' : '접수'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 상세 모달 (차수별 메모 + 자재 체크리스트) ── */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-lg sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
          {detailSample && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {detailSample.styleNo} — {detailSample.styleName}
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full border ${STAGE_COLOR[detailSample.stage]}`}>
                    {detailSample.stage}
                  </span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-5 py-2">
                {/* 자재 요청 목록 */}
                {(detailSample.materialRequests || []).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-stone-600 uppercase tracking-wider flex items-center gap-1">
                      🧵 자재 요청 목록
                    </p>
                    <div className="rounded-lg border border-stone-200 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-stone-50 border-b border-stone-100">
                            <th className="text-left px-3 py-1.5 text-stone-500 font-medium">자재명</th>
                            <th className="text-left px-3 py-1.5 text-stone-500 font-medium">업체</th>
                            <th className="text-left px-3 py-1.5 text-stone-500 font-medium">컬러</th>
                            <th className="text-right px-3 py-1.5 text-stone-500 font-medium">수량</th>
                            <th className="text-left px-3 py-1.5 text-stone-500 font-medium">단위</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detailSample.materialRequests || []).map((req, i) => (
                            <tr key={i} className="border-b border-stone-50 last:border-0">
                              <td className="px-3 py-2 text-stone-700 font-medium">{req.itemName}</td>
                              <td className="px-3 py-2 text-stone-600">{req.vendor || <span className="text-stone-300">—</span>}</td>
                              <td className="px-3 py-2 text-stone-600">{req.color || <span className="text-stone-300">—</span>}</td>
                              <td className="px-3 py-2 text-right text-stone-700">{req.qty}</td>
                              <td className="px-3 py-2 text-stone-500">{req.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 첨부 파일/이미지 */}
                {((detailSample.imageUrls || []).length > 0 || (detailSample.documents || []).length > 0) && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-stone-600 uppercase tracking-wider">📎 첨부 파일</p>
                    {(detailSample.imageUrls || []).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {(detailSample.imageUrls || []).map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt={`이미지 ${idx + 1}`}
                            className="w-16 h-16 object-cover rounded-lg border border-stone-200 cursor-pointer hover:opacity-80"
                            onClick={() => window.open(url, '_blank')}
                          />
                        ))}
                      </div>
                    )}
                    {(detailSample.documents || []).length > 0 && (
                      <div className="space-y-1">
                        {(detailSample.documents || []).map((doc, idx) => (
                          <button
                            key={idx}
                            className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg border border-stone-100 hover:bg-stone-50"
                            onClick={() => window.open(doc.url, '_blank')}
                          >
                            <DocIcon fileType={doc.fileType} />
                            <span className="text-xs text-stone-700 truncate">{doc.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 차수별 수정 요청 메모 */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-stone-600 uppercase tracking-wider">차수별 수정 요청 히스토리</p>
                  {(detailSample.revisionHistory || []).length === 0 ? (
                    <p className="text-xs text-stone-400 py-2 text-center">등록된 메모가 없습니다</p>
                  ) : (
                    <div className="space-y-2">
                      {(detailSample.revisionHistory || []).map((r, i) => (
                        <div key={i} className="flex gap-3 text-sm p-2 bg-stone-50 rounded-lg border border-stone-100">
                          <span className="text-xs font-bold text-blue-600 shrink-0 mt-0.5">{r.round}차</span>
                          <div className="flex-1">
                            <p className="text-stone-700">{r.note}</p>
                            <p className="text-[11px] text-stone-400 mt-0.5">{r.date}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 메모 추가 */}
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={newRevRound}
                      onChange={e => setNewRevRound(parseInt(e.target.value) || 1)}
                      className="w-20 h-8 text-center text-sm"
                    />
                    <Input
                      className="h-8 text-sm flex-1"
                      placeholder="수정 요청 내용 입력"
                      value={newRevNote}
                      onChange={e => setNewRevNote(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddRevNote(); }}
                    />
                    <Button size="sm" className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white" onClick={handleAddRevNote}>추가</Button>
                  </div>
                </div>

                {/* 자재 준비 체크리스트 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-stone-600 uppercase tracking-wider flex items-center gap-1">
                      <ClipboardCheck className="w-3.5 h-3.5" />자재 준비 체크리스트
                    </p>
                    {(detailSample.materialChecklist || []).length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 border-yellow-400 text-yellow-700 hover:bg-yellow-50"
                        onClick={() => {
                          const items = (detailSample.materialChecklist || []).map((c, i) =>
                            `${i + 1}. ${c.isReady ? '✅' : '⬜'} ${c.itemName}`
                          ).join('\n');
                          const text = `[${detailSample.styleNo}] ${detailSample.styleName} 자재 준비 현황\n\n${items}\n\n완료: ${(detailSample.materialChecklist||[]).filter(c=>c.isReady).length}/${(detailSample.materialChecklist||[]).length}`;
                          navigator.clipboard.writeText(text).then(() => {
                            toast.success('카카오톡 전달용 텍스트가 복사되었습니다 📋');
                          });
                        }}
                      >
                        📋 카톡 복사
                      </Button>
                    )}
                  </div>
                  {(detailSample.materialChecklist || []).length === 0 ? (
                    <p className="text-xs text-stone-400 py-2 text-center">체크리스트가 없습니다</p>
                  ) : (
                    <div className="space-y-1.5">
                      {(detailSample.materialChecklist || []).map(c => (
                        <label key={c.id} className="flex items-center gap-3 p-2 rounded-lg border border-stone-100 hover:bg-stone-50 cursor-pointer">
                          <input
                            type="checkbox" checked={c.isReady}
                            onChange={() => handleToggleCheck(c.id)}
                            className="accent-green-600 w-4 h-4"
                          />
                          <span className={`text-sm flex-1 ${c.isReady ? 'line-through text-stone-400' : 'text-stone-700'}`}>
                            {c.itemName}
                          </span>
                          {c.isReady && <span className="text-xs text-green-600">확보</span>}
                        </label>
                      ))}
                      <p className="text-xs text-right text-stone-500 mt-1">
                        {(detailSample.materialChecklist || []).filter(c => c.isReady).length} /
                        {(detailSample.materialChecklist || []).length} 확보 완료
                      </p>
                    </div>
                  )}
                  {/* 항목 추가 */}
                  <div className="flex gap-2">
                    <Input
                      className="h-8 text-sm flex-1"
                      placeholder="자재명 입력 (예: 소가죽 블랙)"
                      value={newCheckItem}
                      onChange={e => setNewCheckItem(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddCheckItem(); }}
                    />
                    <Button size="sm" className="h-8 px-3 bg-stone-700 hover:bg-stone-800 text-white" onClick={handleAddCheckItem}>추가</Button>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDetail(false)}>닫기</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── 청구하기 모달 ── */}
      {billingTarget && (
        <Dialog open={billingModal} onOpenChange={setBillingModal}>
          <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-lg sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>청구하기 — {billingTarget.styleNo}</DialogTitle>
              <DialogDescription className="text-xs text-stone-500">
                거래명세표를 새로 생성하거나 기존 전표에 연결하세요
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* 모드 선택 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={() => setBillingMode('new')}
                  className={`p-3 rounded-lg border text-sm font-medium transition-colors ${billingMode === 'new' ? 'bg-amber-50 border-amber-400 text-amber-800' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}
                >
                  📄 거래명세표 신규 생성
                </button>
                <button
                  onClick={() => setBillingMode('link')}
                  className={`p-3 rounded-lg border text-sm font-medium transition-colors ${billingMode === 'link' ? 'bg-blue-50 border-blue-400 text-blue-800' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}
                >
                  🔗 기존 전표에 연결
                </button>
              </div>

              {billingMode === 'link' && (() => {
                const thisMonth = new Date().toISOString().slice(0,7);
                const buyerStatements = store.getTradeStatements()
                  .filter(t => {
                    const matchBuyer = !billingTarget.buyerId || t.vendorId === billingTarget.buyerId;
                    const matchMonth = t.issueDate.startsWith(thisMonth);
                    return matchBuyer && matchMonth && t.status !== '수금완료';
                  });
                return (
                  <div className="space-y-2">
                    <p className="text-xs text-stone-500">이번 달 전표 ({thisMonth}) — 바이어: {vendors.find(v => v.id === billingTarget.buyerId)?.name || '미지정'}</p>
                    {buyerStatements.length === 0 ? (
                      <p className="text-xs text-stone-400 py-3 text-center">해당 조건의 전표가 없습니다. 신규 생성을 선택하세요.</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {buyerStatements.map(t => (
                          <button key={t.id}
                            onClick={() => setLinkStatementId(t.id)}
                            className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${linkStatementId === t.id ? 'bg-blue-50 border-blue-400' : 'border-stone-200 hover:bg-stone-50'}`}
                          >
                            <span className="font-mono font-medium">{t.statementNo}</span>
                            <span className="ml-2 text-stone-500">{t.vendorName}</span>
                            <span className="ml-2 text-stone-400">{t.issueDate}</span>
                            <span className="ml-2 text-stone-400">{t.lines?.length || 0}건</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {billingMode === 'new' && (
                <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-700">
                  <p className="font-medium mb-1">생성될 거래명세표</p>
                  <p>바이어: {vendors.find(v => v.id === billingTarget.buyerId)?.name || '미지정'}</p>
                  <p>품목: {billingTarget.styleNo} — {billingTarget.styleName}</p>
                  <p>금액: {(billingTarget.costKrw || Math.round((billingTarget.costCny || 0) * settings.cnyKrw)).toLocaleString()}원</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBillingModal(false)}>취소</Button>
              <Button
                className="bg-amber-700 hover:bg-amber-800 text-white"
                disabled={billingMode === 'link' && !linkStatementId}
                onClick={() => {
                  const today = new Date().toISOString().split('T')[0];
                  const costKrw = billingTarget.costKrw || Math.round((billingTarget.costCny || 0) * settings.cnyKrw);
                  const newLine = { id: 'l-' + billingTarget.id + '-' + Date.now(), description: billingTarget.styleName || billingTarget.styleNo, qty: 1, unitPrice: costKrw, taxType: '과세' as const, taxRate: 0.1, memo: `샘플 ${billingTarget.round || ''}차` };

                  if (billingMode === 'new') {
                    const vendor = vendors.find(v => v.id === billingTarget.buyerId);
                    const vendorCode = vendor?.vendorCode || vendor?.code || 'SAMP';
                    const statementNo = store.getNextStatementNo(vendorCode);
                    store.addTradeStatement({
                      id: 'ts-' + billingTarget.id + '-' + Date.now(),
                      statementNo,
                      vendorId: billingTarget.buyerId || '',
                      vendorName: vendor?.name || '미지정',
                      vendorCode,
                      issueDate: today,
                      lines: [newLine],
                      status: '미청구',
                      createdAt: new Date().toISOString(),
                    });
                    toast.success(`거래명세표 ${statementNo} 생성 완료`);
                  } else {
                    const stmt = store.getTradeStatements().find(t => t.id === linkStatementId);
                    if (stmt) {
                      store.updateTradeStatement(linkStatementId, { lines: [...(stmt.lines || []), newLine] });
                      toast.success(`${stmt.statementNo}에 추가됐습니다`);
                    }
                  }
                  store.updateSample(billingTarget.id, { billingStatus: '청구완료', billingDate: today });
                  setSamples(store.getSamples());
                  setBillingModal(false);
                }}
              >
                {billingMode === 'new' ? '명세표 생성 + 청구완료' : '전표 연결 + 청구완료'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

    </div>
  );
}