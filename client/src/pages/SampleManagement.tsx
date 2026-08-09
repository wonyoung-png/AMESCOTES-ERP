// AMESCOTES ERP — 샘플 관리 (Phase 1 전면 재작성)
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useLocation, useSearch } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  store, genId, formatKRW, formatNumber,
  type Sample, type SampleStage, type Season, type SampleBillingStatus,
  type SampleLocation, type SampleRevisionNote, type SampleMaterialCheckItem,
  type SampleMaterialRequest, type SampleDocument,
  type Item, type TradeStatement, type TradeStatementLine,
} from '@/lib/store';
import { fetchSamples, upsertSample as upsertSampleSB, deleteSample as deleteSampleSB, fetchItems, fetchVendors, upsertItem as upsertItemSB } from '@/lib/supabaseQueries';
import { generateStyleNo } from '@/lib/styleNo';
import { resizeImage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { SampleRequestDoc } from '@/components/SampleRequestDoc';
import { printDoc, copyDocAsImage, saveDocAsImage } from '@/lib/docExport';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { onSaveFail } from '@/lib/saveGuard';
import {
  Plus, Search, Trash2, Camera, FileText,
  ClipboardCheck, Eye, PackagePlus, FileSpreadsheet, File, Paperclip,
  List, CalendarDays, ChevronLeft, ChevronRight,
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
  if (fileType === 'pdf') return <File className="w-6 h-6 text-[var(--system-red)]" />;
  if (fileType === 'excel') return <FileSpreadsheet className="w-6 h-6 text-[var(--system-green)]" />;
  return <Camera className="w-6 h-6 text-muted-foreground" />;
}

const STAGES: SampleStage[] = ['1차', '2차', '3차', '4차', '최종승인', '반려'];
const BILLING_STATUSES: SampleBillingStatus[] = ['미청구', '청구완료', '수금완료'];
const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS'];
const LOCATIONS: SampleLocation[] = ['내부개발실', '중국공장'];
// SampleRound는 이제 number (제한 없음)

const STAGE_COLOR: Record<SampleStage, string> = {
  '1차':    'bg-[var(--fill-tertiary)] text-foreground border-border',
  '2차':    'bg-[var(--fill-tertiary)] text-foreground border-border',
  '3차':    'bg-[var(--fill-tertiary)] text-foreground border-border',
  '4차':    'bg-[var(--fill-tertiary)] text-foreground border-border',
  '최종승인': 'bg-[var(--fill-tertiary)] text-[var(--system-green)] border-border',
  '반려':   'bg-[var(--fill-tertiary)] text-[var(--system-red)] border-border',
};

const BILLING_COLOR: Record<SampleBillingStatus, string> = {
  '미청구':   'bg-[var(--fill-quaternary)] text-muted-foreground border-border',
  '청구완료': 'bg-[var(--fill-tertiary)] text-[var(--system-orange)] border-border',
  '수금완료': 'bg-[var(--fill-tertiary)] text-[var(--system-green)] border-border',
};

// 샘플 접수 시 품목 자동생성 — 품목마스터와 같은 스타일번호 규칙을 쓴다
// (TEMP 번호를 따로 붙였다가 승인 후 다시 등록하던 흐름을 없앴다)
function createLinkedItem(
  styleName: string,
  season: Season,
  buyerCode: string,
  existingItems: Item[],
): Item {
  const now = new Date();
  return {
    id: genId(),
    styleNo: generateStyleNo(buyerCode || 'ATL', now, '숄더백', existingItems, undefined, 'HB'),
    name: styleName,
    nameEn: '',
    season,
    category: '숄더백',
    erpCategory: 'HB',
    itemStatus: 'ACTIVE',
    materialType: '완제품',
    material: '',
    salePriceKrw: 0,
    hasBom: false,
    colors: [],
    createdAt: now.toISOString(),
  };
}

export default function SampleManagement() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  // URL 파라미터 읽기 (Dashboard에서 "샘플 관리로 이동" 클릭 시 openId 전달됨)
  const searchString = useSearch();
  const { data: samples = [] } = useQuery({ queryKey: ['samples'], queryFn: fetchSamples });
  const setSamples = (_v: Sample[]) => {}; // no-op
  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: fetchItems });
  const setItems = (_v: Item[]) => {}; // no-op
  const { data: allVendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const vendors = allVendors.filter((v: any) => v.type === '바이어');
  // 자재거래처 목록
  const materialVendors = allVendors.filter((v: any) => v.type === '자재거래처');
  const settings = store.getSettings();

  // 월별 통계 상태 + 필터
  const [statMonth, setStatMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [statFilterSalesPerson, setStatFilterSalesPerson] = usePersistedState('samples.statFilterSalesPerson', 'all');
  const [statFilterAssignee, setStatFilterAssignee] = usePersistedState('samples.statFilterAssignee', 'all');
  const [statFilterBuyer, setStatFilterBuyer] = usePersistedState('samples.statFilterBuyer', 'all');
  const [statFilterSeason, setStatFilterSeason] = usePersistedState('samples.statFilterSeason', 'all');

  const [search, setSearch] = usePersistedState('samples.search', '');
  const [filterStage, setFilterStage] = usePersistedState('samples.filterStage', '진행중');
  const [filterBilling, setFilterBilling] = usePersistedState('samples.filterBilling', 'all');
  const [filterSeason, setFilterSeason] = usePersistedState('samples.filterSeason', 'all');
  const [filterBuyer, setFilterBuyer] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  // 정렬: 의뢰일 최신순 기본값
  const [sortBy, setSortBy] = useState('requestDate_desc');
  const [billingModal, setBillingModal] = useState(false);
  const [billingTarget, setBillingTarget] = useState<typeof samples[0] | null>(null);
  const [billingMode, setBillingMode] = useState<'new' | 'link'>('new');
  const [linkStatementId, setLinkStatementId] = useState('');

  // 메인 등록/수정 모달
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Partial<Sample>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [requestDoc, setRequestDoc] = useState<Sample | null>(null);
  const reqDocRef = useRef<HTMLDivElement>(null);
  const [manualStyleNo, setManualStyleNo] = useState(false);
  /** 품목마스터와 같은 규칙으로 만든 스타일번호 미리보기 (바이어 코드 + YYMM + 타입 + 일련) */
  const previewStyleNo = useMemo(() => {
    const buyer: any = vendors.find((v: any) => v.id === form.buyerId);
    if (!buyer?.code) return '';
    return generateStyleNo(buyer.code, new Date(), '숄더백', items as Item[], undefined, 'HB');
  }, [vendors, items, form.buyerId]);
  // 변경사항 추적
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const initialFormRef = useRef<Partial<Sample>>({});

  // 상세 모달 (차수별 메모 / 자재 체크리스트)
  const [detailSample, setDetailSample] = useState<Sample | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // 이미지 업로드
  const imageFileRef = useRef<HTMLInputElement>(null);
  // 문서 업로드 (PDF, 엑셀)
  const docFileRef = useRef<HTMLInputElement>(null);
  // 자재별 이미지 업로드 ref (동적으로 관리)
  const materialImageRefs = useRef<(HTMLInputElement | null)[]>([]);

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

  // 자재 행 이미지 업로드 핸들러
  const handleMaterialImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeImage(file);
      setForm(f => {
        const reqs = [...(f.materialRequests || [])];
        reqs[idx] = { ...reqs[idx], imageUrl: resized };
        return { ...f, materialRequests: reqs };
      });
    } catch {
      toast.error('이미지 업로드 실패');
    }
    if (materialImageRefs.current[idx]) materialImageRefs.current[idx]!.value = '';
  };

  // 파일 열기/다운로드 헬퍼
  const openFile = (url: string, fileType: SampleDocument['fileType'], name: string) => {
    if (fileType === 'excel') {
      // 엑셀은 다운로드
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
    } else {
      // 이미지, PDF는 새 탭에서 열기
      window.open(url, '_blank');
    }
  };

  // 차수 메모 추가
  const [newRevNote, setNewRevNote] = useState('');
  const [newRevRound, setNewRevRound] = useState<number>(1);

  // 자재 체크리스트 항목 추가
  const [newCheckItem, setNewCheckItem] = useState('');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['samples'] });
    queryClient.invalidateQueries({ queryKey: ['items'] });
  };

  const IN_PROGRESS_STAGES: SampleStage[] = ['1차', '2차', '3차', '4차'];

  // 작업담당자 목록 추출 (store에서 동적으로)
  const assigneeList = useMemo(() => {
    const set = new Set<string>();
    samples.forEach(s => { if (s.assignee) set.add(s.assignee); });
    return Array.from(set).sort();
  }, [samples]);

  // 영업담당자 목록 추출 (store에서 동적으로)
  const salesPersonList = useMemo(() => {
    const set = new Set<string>();
    samples.forEach(s => { if (s.salesPerson) set.add(s.salesPerson); });
    return Array.from(set).sort();
  }, [samples]);

  // 단계 정렬 순서
  const STAGE_ORDER: Record<SampleStage, number> = {
    '1차': 1, '2차': 2, '3차': 3, '4차': 4, '최종승인': 5, '반려': 6,
  };

  const filtered = useMemo(() => {
    let list = samples;
    if (filterStage === '진행중') list = list.filter(s => IN_PROGRESS_STAGES.includes(s.stage));
    else if (filterStage !== 'all') list = list.filter(s => s.stage === filterStage);
    if (filterBilling !== 'all') list = list.filter(s => s.billingStatus === filterBilling);
    if (filterSeason !== 'all') list = list.filter(s => s.season === filterSeason);
    if (filterBuyer !== 'all') list = list.filter(s => s.buyerId === filterBuyer);
    if (filterAssignee !== 'all') list = list.filter(s => (s.assignee || '미지정') === filterAssignee);
    if (search) list = list.filter(s =>
      s.styleNo.toLowerCase().includes(search.toLowerCase()) ||
      s.styleName.toLowerCase().includes(search.toLowerCase())
    );
    // 정렬 적용
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case 'requestDate_desc':
          return (b.requestDate || '').localeCompare(a.requestDate || '');
        case 'requestDate_asc':
          return (a.requestDate || '').localeCompare(b.requestDate || '');
        case 'buyer_asc': {
          const nameA = buyerLabelById(a.buyerId);
          const nameB = buyerLabelById(b.buyerId);
          return nameA.localeCompare(nameB, 'ko');
        }
        case 'stage_asc':
          return (STAGE_ORDER[a.stage] || 0) - (STAGE_ORDER[b.stage] || 0);
        case 'expectedDate_asc': {
          const da = a.expectedDate || '9999-99-99';
          const db = b.expectedDate || '9999-99-99';
          return da.localeCompare(db);
        }
        case 'cost_desc': {
          const ca = a.costKrw || Math.round((a.costCny || 0) * settings.cnyKrw);
          const cb = b.costKrw || Math.round((b.costCny || 0) * settings.cnyKrw);
          return cb - ca;
        }
        case 'cost_asc': {
          const ca = a.costKrw || Math.round((a.costCny || 0) * settings.cnyKrw);
          const cb = b.costKrw || Math.round((b.costCny || 0) * settings.cnyKrw);
          return ca - cb;
        }
        case 'styleNo_asc':
          return a.styleNo.localeCompare(b.styleNo, 'ko');
        default:
          return (b.requestDate || '').localeCompare(a.requestDate || '');
      }
    });
    return list;
  }, [samples, filterStage, filterBilling, filterSeason, filterBuyer, filterAssignee, search, sortBy, vendors, settings.cnyKrw]);

  const stats = useMemo(() => {
    const unclaimed = samples.filter(s => s.billingStatus === '미청구');
    const totalUnclaimedKrw = unclaimed.reduce((s, x) => s + (x.costKrw || (x.costCny || 0) * settings.cnyKrw), 0);
    const approved = samples.filter(s => s.stage === '최종승인').length;
    const inProgress = samples.filter(s => s.stage !== '최종승인' && s.stage !== '반려').length;
    return { total: samples.length, approved, inProgress, unclaimed: unclaimed.length, totalUnclaimedKrw };
  }, [samples, settings.cnyKrw]);

  // ── 캘린더 뷰 ──
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const todayD = new Date();
  const [calYear, setCalYear] = useState(todayD.getFullYear());
  const [calMonth, setCalMonth] = useState(todayD.getMonth());
  const [calPlace, setCalPlace] = useState<'all' | '내부개발실' | '중국공장'>('all');

  /** 운영은 브랜드명 기준 — 브랜드가 있으면 브랜드명, 없으면 회사명 */
  const buyerLabel = (v?: { name?: string; brands?: string[]; nameEn?: string } | null) => {
    if (!v) return '';
    const brand = v.brands?.[0] || v.nameEn;
    return brand || v.name || '';
  };
  const buyerLabelById = (id?: string) => buyerLabel(vendors.find((x: any) => x.id === id) as any);

  /**
   * 샘플 일정 캘린더 — 의뢰일(접수)과 목표완료일을 한 달력에 얹는다.
   * 목표완료일이 지났는데 최종승인이 아니면 지연으로 표시.
   */
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const iso = (d: number) => `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const todayIso = new Date().toISOString().split('T')[0];
    const cells: { day: number; events: { id: string; label: string; kind: 'req' | 'due'; late: boolean }[] }[] = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: 0, events: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = iso(d);
      const events: { id: string; label: string; kind: 'req' | 'due'; late: boolean }[] = [];
        (filtered as Sample[]).forEach(sm => {
        if (calPlace !== 'all' && (sm.location || '내부개발실') !== calPlace) return;
        // 브랜드명 - 제품명 - 차수
        const label = [buyerLabelById(sm.buyerId), sm.styleName || sm.styleNo, sm.stage].filter(Boolean).join(' - ');
        if (sm.requestDate === ds) events.push({ id: sm.id + '-r', label, kind: 'req', late: false });
        if (sm.expectedDate === ds) {
          events.push({ id: sm.id + '-d', label, kind: 'due', late: ds < todayIso && sm.stage !== '최종승인' });
        }
      });
      cells.push({ day: d, events });
    }
    return cells;
  }, [filtered, calYear, calMonth, calPlace, vendors]);

  const openNew = () => {
    // 같은 스타일번호로 새 샘플 접수 시 기존 최대 차수 + 1로 자동 설정 (스타일 선택 시 처리)
    const initial = {
      season: '26SS' as const, stage: '1차' as const,
      billingStatus: '미청구' as const,  // 항상 미청구로 시작 (청구는 명세표 발행 시 업데이트)
      requestDate: new Date().toISOString().split('T')[0],
      location: '내부개발실' as const, round: 1,
      costCny: 0, imageUrls: [], documents: [], revisionHistory: [], materialChecklist: [], materialRequests: [],
    };
    initialFormRef.current = initial;
    skipNextDirtyRef.current = true;
    setForm(initial);
    setEditId(null);
    setCreateTempMode(false);
    setTempStyleName('');
    setIsDirty(false);
    setShowModal(true);
  };

  const openEdit = (s: Sample) => {
    initialFormRef.current = { ...s };
    skipNextDirtyRef.current = true;
    setForm({ ...s });
    setEditId(s.id);
    setCreateTempMode(false);
    setIsDirty(false);
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

    // 기존 스타일을 고르지 않았으면 새 품목을 만든다 — 스타일번호는 품목마스터와 같은 규칙
    if (!editId && !styleId) {
      const name = (form.styleName || '').trim();
      if (!name) { toast.error('품명을 입력해주세요'); return; }
      const finalStyleNo = (manualStyleNo ? (form.styleNo || '').trim() : previewStyleNo).trim();
      if (!finalStyleNo) { toast.error('바이어를 선택하거나 스타일번호를 직접 입력하세요'); return; }
      const newItem: Item = {
        ...createLinkedItem(name, form.season || '26SS', 'ATL', items as Item[]),
        styleNo: finalStyleNo,
        buyerId: form.buyerId,
      };
      upsertItemSB(newItem as any).catch((e: Error) => toast.error(`품목 생성 실패: ${e.message}`));
      styleId = newItem.id;
      styleNo = newItem.styleNo;
      styleName = newItem.name;
      toast.success(`품목 ${newItem.styleNo} 등록 — 품목 마스터에 함께 저장됐습니다`);
      queryClient.invalidateQueries({ queryKey: ['items'] });
    }

    if (!styleId && !styleNo) { toast.error('스타일번호를 입력해주세요'); return; }
    if (!form.requestDate) { toast.error('의뢰일을 입력해주세요'); return; }

    // 스타일번호 중복 체크 (신규 등록 시)
    if (!editId && form.styleNo) {
      const dupSample = (samples as Sample[]).find(s => s.styleNo === form.styleNo);
      if (dupSample) {
        const confirmed = confirm(`스타일번호 '${form.styleNo}'가 이미 샘플에 등록되어 있습니다.\n(${dupSample.styleName}, ${dupSample.stage})\n\n그래도 등록하시겠습니까?`);
        if (!confirmed) return;
      }
    }

    // 샘플 단가는 원화(sampleUnitPrice)로 입력 → costKrw로 저장
    const costKrw = form.sampleUnitPrice || (form.costCny || 0) * settings.cnyKrw;

    const sampleData = editId
      ? { ...form, id: editId, styleId: styleId || form.styleId || '', styleNo: form.styleNo || styleNo || '', styleName: form.styleName || styleName || '', costKrw } as Sample
      : {
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
          salesPerson: form.salesPerson,
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
          billingStatus: '미청구' as const,
          createdAt: new Date().toISOString(),
          memo: form.memo,
        } as Sample;

    upsertSampleSB(sampleData)
      .then(() => {
        toast.success(editId ? '수정되었습니다' : '샘플이 등록되었습니다');
        refresh();
        setIsDirty(false);
        setShowModal(false);
      })
      .catch((e: Error) => toast.error(`저장 실패: ${e.message}`));
  };

  // form 변경 감지로 isDirty 설정 (초기화 시는 무시)
  const skipNextDirtyRef = useRef(false);
  useEffect(() => {
    if (!showModal) return;
    if (skipNextDirtyRef.current) { skipNextDirtyRef.current = false; return; }
    setIsDirty(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // 모달 닫기 요청 처리 (변경사항 확인)
  const handleModalClose = useCallback((requestClose: boolean) => {
    if (!requestClose) return;
    if (isDirty) {
      setShowUnsavedDialog(true);
    } else {
      setShowModal(false);
    }
  }, [isDirty]);

  const handleDelete = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    deleteSampleSB(id)
      .then(() => { refresh(); toast.success('삭제되었습니다'); })
      .catch((e: Error) => toast.error(`삭제 실패: ${e.message}`));
  };

  // 체크박스 다중 선택 관련
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isAllSelected = filtered.length > 0 && filtered.every(s => selectedIds.has(s.id));
  const isIndeterminate = filtered.some(s => selectedIds.has(s.id)) && !isAllSelected;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(s => s.id)));
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
      Promise.all([...selectedIds].map(id => deleteSampleSB(id)))
        .then(() => { setSelectedIds(new Set()); refresh(); toast.success(`${count}개 항목이 삭제되었습니다`); })
        .catch((e: Error) => toast.error(`삭제 실패: ${e.message}`));
    }
  };

  // 리스트에서 바로 단계 변경
  const handleStageChange = (id: string, stage: SampleStage) => {
    const updates: Partial<Sample> = { stage };
    if (stage === '최종승인') {
      updates.approvedBy = '관리자';
      // ⚠️ 자동 ACTIVE 전환 제거: 승인 후 담당자가 정식 스타일번호로 품목 마스터에 직접 등록해야 함
    }
    const targetSample = (samples as Sample[]).find(s => s.id === id);
    if (targetSample) {
      upsertSampleSB({ ...targetSample, ...updates })
        .then(() => { refresh(); toast.success(`단계가 "${stage}"로 변경되었습니다`); })
        .catch((e: Error) => toast.error(`변경 실패: ${e.message}`));
    }
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

      store.addTradeStatement(statement); // 거래명세표는 store에 유지 (Supabase 테이블 없음)
      createdCount++;
    });

    // billingStatus 업데이트
    const updatePromises = unclaimed.map(s => upsertSampleSB({ ...s, billingStatus: '청구완료', billingDate: today }));
    Promise.all(updatePromises).then(() => refresh()).catch(onSaveFail('샘플'));
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
    upsertSampleSB({ ...updated }).then(() => refresh()).catch(onSaveFail('샘플'));
    setDetailSample(updated);
    setNewRevNote('');
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
    upsertSampleSB({ ...updated }).then(() => refresh()).catch(onSaveFail('샘플'));
    setDetailSample(updated);
    setNewCheckItem('');
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
    upsertSampleSB({ ...updated }).then(() => refresh()).catch(onSaveFail('샘플'));
    setDetailSample(updated);
  };

  // 샘플 승인 처리 — 품목은 접수 시 이미 정식 스타일번호로 만들어져 있다
  // 승인 후 담당자가 정확한 스타일번호로 품목 마스터에 직접 등록해야 함
  // ── 다음 차수 샘플 (수정 요청) ──
  const [nextRoundTarget, setNextRoundTarget] = useState<Sample | null>(null);
  const [nextRoundNote, setNextRoundNote] = useState('');
  const [nextRoundAssignee, setNextRoundAssignee] = useState('');
  const [nextRoundFiles, setNextRoundFiles] = useState<{ name: string; url: string }[]>([]);

  const openNextRound = (s: Sample) => {
    setNextRoundTarget(s);
    setNextRoundNote('');
    setNextRoundAssignee(s.assignee || '');
    setNextRoundFiles([]);
  };

  /** 업체에서 온 수정 요청(이미지·PDF·엑셀)을 그대로 담아 다음 차수 샘플을 만든다 */
  const createNextRound = async () => {
    const src = nextRoundTarget;
    if (!src) return;
    const today = new Date().toISOString().split('T')[0];
    const prevRound = src.round || parseInt(String(src.stage).replace(/[^0-9]/g, ''), 10) || 1;
    const nextRound = prevRound + 1;
    const note: SampleRevisionNote = { round: nextRound as any, date: today, note: nextRoundNote.trim() || '수정 요청' };

    const images = nextRoundFiles.filter(f => f.url.startsWith('data:image'));
    const docs = nextRoundFiles.filter(f => !f.url.startsWith('data:image'));

    const child: Sample = {
      ...src,
      id: genId(),
      stage: `${nextRound}차` as SampleStage,
      round: nextRound as any,
      assignee: nextRoundAssignee || src.assignee,
      requestDate: today,
      expectedDate: undefined,
      approvedDate: undefined,
      approvedBy: undefined,
      receivedDate: undefined,
      billingStatus: '미청구',
      billingDate: undefined,
      billingStatementId: undefined,
      revisionNote: note.note,
      revisionHistory: [...(src.revisionHistory || []), note],
      imageUrls: images.map(f => f.url),
      documents: docs.map(f => ({ id: genId(), name: f.name, url: f.url, uploadedAt: today })) as any,
      createdAt: new Date().toISOString(),
    };
    try {
      await upsertSampleSB(child);
      setNextRoundTarget(null);
      refresh();
      toast.success(`${nextRound}차 샘플 등록 — 담당자 ${child.assignee || '미지정'} · 수정요청 ${nextRoundFiles.length}건 첨부`);
    } catch (e) {
      toast.error(`다음 차수 생성 실패: ${(e as Error).message}`);
    }
  };

  const handleApprove = (s: Sample) => {
    upsertSampleSB({ ...s, stage: '최종승인', approvedBy: '관리자' }).then(() => refresh()).catch(onSaveFail('샘플'));
    // 승인은 샘플 단계만 "최종승인"으로 변경 (품목은 접수 때 이미 등록됨)
    refresh();
    toast.success(`${s.styleNo} 최종 승인 완료`);
  };

  // 품목 등록 (최종승인 샘플에서 품목 마스터로 이동 + prefill)
  // TEMP 스타일번호 대신 빈 스타일번호 전달 — 담당자가 정확한 번호를 직접 입력
  // 품명(styleName), 바이어(buyerId), 시즌(season)은 자동 입력
  const handleRegisterItem = (s: Sample) => {
    // localStorage + URL 파라미터 두 방식 모두 지원
    const prefillData = {
      styleNo: '',          // TEMP 번호 대신 빈값 — 담당자가 직접 입력
      buyerId: s.buyerId,
      season: s.season,
      styleName: s.styleName,
      sampleId: s.id,       // 샘플-품목 연결을 위해 샘플 ID 전달
      imageUrl: s.imageUrls?.[0] ?? undefined,
    };
    localStorage.setItem('ames_prefill_item', JSON.stringify(prefillData));
    // URL 파라미터로도 핵심 정보 전달 (styleNo는 빈값, styleName/buyerId/season 자동입력)
    const params = new URLSearchParams();
    // styleNo는 전달하지 않음 — 담당자가 정확한 번호 직접 입력
    if (s.styleName) params.set('styleName', s.styleName);
    if (s.buyerId) params.set('buyerId', s.buyerId);
    if (s.season) params.set('season', s.season);
    params.set('sampleId', s.id); // 샘플-품목 연결용
    navigate(`/items?${params.toString()}`);
    toast.info('정확한 스타일번호를 입력 후 품목을 등록해주세요', { duration: 5000 });
  };

  // 발주 생성은 품목 마스터에서 처리 (샘플 관리에서 제거)

  // 월별 담당자별 처리량 통계 (필터 적용)
  const monthlyStats = useMemo(() => {
    const [year, month] = statMonth.split('-');
    let list = samples.filter(s => {
      const d = s.createdAt.slice(0, 7);
      return d === `${year}-${month}`;
    });
    // 필터 적용
    if (statFilterSalesPerson !== 'all') list = list.filter(s => (s.salesPerson || '미지정') === statFilterSalesPerson);
    if (statFilterAssignee !== 'all') list = list.filter(s => (s.assignee || '미지정') === statFilterAssignee);
    if (statFilterBuyer !== 'all') list = list.filter(s => s.buyerId === statFilterBuyer);
    if (statFilterSeason !== 'all') list = list.filter(s => s.season === statFilterSeason);

    const map = new Map<string, { total: number; done: number; salesPerson: string }>();
    list.forEach(s => {
      const key = s.assignee || '미지정';
      const cur = map.get(key) || { total: 0, done: 0, salesPerson: s.salesPerson || '' };
      cur.total++;
      if (s.stage === '최종승인') cur.done++;
      map.set(key, cur);
    });
    return Array.from(map.entries()).map(([assignee, data]) => ({ assignee, ...data }));
  }, [samples, statMonth, statFilterSalesPerson, statFilterAssignee, statFilterBuyer, statFilterSeason]);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">샘플 관리</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5 hidden sm:block">샘플 접수 · 차수별 수정요청 · 자재 체크리스트 · 품목 자동생성</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleBillAll} className="gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-10 px-2 md:px-4">
            <FileText className="w-3.5 h-3.5 md:w-4 md:h-4" /><span className="hidden sm:inline">명세표 발행</span><span className="sm:hidden">발행</span>
          </Button>
          <Button onClick={openNew} className="gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-10 px-2 md:px-4">
            <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />샘플 접수
          </Button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 md:gap-3">
        {[
          { label: '전체',    value: stats.total,            color: 'text-foreground' },
          { label: '진행중',  value: stats.inProgress,       color: 'text-foreground' },
          { label: '최종승인', value: stats.approved,         color: 'text-[var(--system-green)]' },
          { label: '미청구',  value: stats.unclaimed,        color: 'text-[var(--system-orange)]' },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-lg border border-border p-4">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}건</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
        <div className="bg-card rounded-lg border border-border p-4">
          <p className="text-xl font-bold text-[var(--system-red)]">{formatKRW(stats.totalUnclaimedKrw)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">미청구 금액</p>
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
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-primary">이번 달 샘플 현황</span>
              <span className="text-xs text-muted-foreground">({thisMonth})</span>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div>
                <p className="font-bold text-foreground">{thisMonthReceived}건</p>
                <p className="text-xs text-muted-foreground">접수</p>
              </div>
              <div>
                <p className="font-bold text-foreground">{thisMonthInProgress}건</p>
                <p className="text-xs text-muted-foreground">진행중</p>
              </div>
              <div>
                <p className="font-bold text-[var(--system-green)]">{thisMonthApproved}건</p>
                <p className="text-xs text-muted-foreground">완료</p>
              </div>
              {thisMonthReceived > 0 && (
                <div>
                  <p className="font-bold text-primary">{Math.round(thisMonthApproved / thisMonthReceived * 100)}%</p>
                  <p className="text-xs text-muted-foreground">완료율</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 월별 담당자별 처리량 통계 */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <p className="text-sm font-semibold text-foreground mr-1">월별 담당자별 처리량</p>
          {/* 월 선택 */}
          <Input
            type="month"
            value={statMonth}
            onChange={e => setStatMonth(e.target.value)}
            className="w-36 h-8 text-sm"
          />
          {/* 영업담당자 필터 */}
          <Select value={statFilterSalesPerson} onValueChange={setStatFilterSalesPerson}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="영업담당자" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 영업</SelectItem>
              <SelectItem value="미지정">미지정</SelectItem>
              {salesPersonList.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* 작업담당자 필터 */}
          <Select value={statFilterAssignee} onValueChange={setStatFilterAssignee}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="작업담당자" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 작업</SelectItem>
              <SelectItem value="미지정">미지정</SelectItem>
              {assigneeList.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* 바이어 필터 */}
          <Select value={statFilterBuyer} onValueChange={setStatFilterBuyer}>
            <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder="바이어" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 바이어</SelectItem>
              {vendors.map(v => <SelectItem key={v.id} value={v.id}>{buyerLabel(v as any)}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* 시즌 필터 */}
          <Select value={statFilterSeason} onValueChange={setStatFilterSeason}>
            <SelectTrigger className="w-24 h-8 text-xs"><SelectValue placeholder="시즌" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 시즌</SelectItem>
              {SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* 필터 초기화 */}
          {(statFilterSalesPerson !== 'all' || statFilterAssignee !== 'all' || statFilterBuyer !== 'all' || statFilterSeason !== 'all') && (
            <button
              onClick={() => { setStatFilterSalesPerson('all'); setStatFilterAssignee('all'); setStatFilterBuyer('all'); setStatFilterSeason('all'); }}
              className="text-xs text-muted-foreground hover:text-[var(--system-red)] px-2 py-1 rounded border border-border hover:border-[var(--system-red)]"
            >
              필터 초기화
            </button>
          )}
        </div>
        {monthlyStats.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">해당 월 / 조건에 맞는 샘플 없음</p>
        ) : (
          <table className="data-table w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-[13px] font-semibold text-muted-foreground">작업담당자</th>
                <th className="ctr text-[13px] font-semibold text-muted-foreground">전체 건수</th>
                <th className="ctr text-[13px] font-semibold text-muted-foreground">최종승인</th>
                <th className="ctr text-[13px] font-semibold text-muted-foreground">승인율</th>
              </tr>
            </thead>
            <tbody>
              {monthlyStats.map(row => (
                <tr key={row.assignee} className="border-b border-border">
                  <td className="text-foreground font-medium">{row.assignee}</td>
                  <td className="ctr text-muted-foreground">{row.total}건</td>
                  <td className="ctr text-[var(--system-green)] font-medium">{row.done}건</td>
                  <td className="ctr text-xs">
                    {row.total > 0 ? (
                      <span className={row.done / row.total >= 0.5 ? 'text-[var(--system-green)]' : 'text-[var(--system-orange)]'}>
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
      <div className="flex items-center gap-1 bg-[var(--fill-tertiary)] p-1 rounded-lg w-fit flex-wrap">
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
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              filterStage === opt.value
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
            {opt.value === '진행중' && (
              <span className="ml-1 text-[11px] text-foreground font-bold">
                {samples.filter(s => ['1차','2차','3차','4차'].includes(s.stage)).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 검색 + 필터 */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
            {vendors.map(v => <SelectItem key={v.id} value={v.id}>{buyerLabel(v as any)}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* 담당자 필터 */}
        <Select value={filterAssignee} onValueChange={setFilterAssignee}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="담당자" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 담당자</SelectItem>
            <SelectItem value="미지정">미지정</SelectItem>
            {assigneeList.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterBilling} onValueChange={setFilterBilling}>
          <SelectTrigger className="w-28 h-9"><SelectValue placeholder="청구상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            {BILLING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* 정렬 드롭다운 */}
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="정렬" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="requestDate_desc">의뢰일 최신순</SelectItem>
            <SelectItem value="requestDate_asc">의뢰일 오래된순</SelectItem>
            <SelectItem value="buyer_asc">바이어순 (가나다)</SelectItem>
            <SelectItem value="stage_asc">단계순 (1차→반려)</SelectItem>
            <SelectItem value="expectedDate_asc">목표완료일 임박순</SelectItem>
            <SelectItem value="cost_desc">비용 높은순</SelectItem>
            <SelectItem value="cost_asc">비용 낮은순</SelectItem>
            <SelectItem value="styleNo_asc">스타일번호순</SelectItem>
          </SelectContent>
        </Select>
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

      {/* 리스트 / 캘린더 전환 */}
      <div className="flex items-center gap-1 bg-[var(--fill-tertiary)] p-1 rounded-lg w-fit">
        {([['list', '리스트'], ['calendar', '캘린더']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              view === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {v === 'list' ? <List size={14} /> : <CalendarDays size={14} />}{label}
          </button>
        ))}
      </div>

      {view === 'calendar' && (
        <div className="bg-card rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => { const m = calMonth - 1; if (m < 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(m); }}
                className="p-1.5 rounded-md hover:bg-[var(--fill-quaternary)] text-muted-foreground"><ChevronLeft size={16} /></button>
              <span className="text-sm font-semibold text-foreground w-32 text-center">{calYear}년 {calMonth + 1}월</span>
              <button onClick={() => { const m = calMonth + 1; if (m > 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(m); }}
                className="p-1.5 rounded-md hover:bg-[var(--fill-quaternary)] text-muted-foreground"><ChevronRight size={16} /></button>
              <button onClick={() => { const n = new Date(); setCalYear(n.getFullYear()); setCalMonth(n.getMonth()); }}
                className="ml-1 px-2 py-1 rounded-md text-xs border border-border text-muted-foreground hover:bg-[var(--fill-quaternary)]">오늘</button>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--system-green)]" />의뢰</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" />목표완료</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--system-red)]" />지연</span>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-[var(--fill-tertiary)] p-1 rounded-lg w-fit">
            {(['all', '내부개발실', '중국공장'] as const).map(pl => (
              <button
                key={pl}
                onClick={() => setCalPlace(pl)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  calPlace === pl ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {pl === 'all' ? '전체' : pl === '중국공장' ? '중국개발실' : pl}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
            {['일', '월', '화', '수', '목', '금', '토'].map(d => (
              <div key={d} className="bg-[var(--fill-quaternary)] py-1.5 text-center text-[11px] font-semibold text-muted-foreground">{d}</div>
            ))}
            {calendarDays.map((c, i) => (
              <div key={i} className="bg-card min-h-[92px] p-1.5 align-top">
                {c.day > 0 && (
                  <>
                    <p className="text-[11px] text-muted-foreground mb-1">{c.day}</p>
                    <div className="space-y-0.5">
                      {c.events.slice(0, 3).map(ev => (
                        <div key={ev.id}
                          className={`text-[10px] px-1 py-0.5 rounded truncate ${
                            ev.late ? 'bg-[var(--system-red)]/15 text-[var(--system-red)]'
                              : ev.kind === 'req' ? 'bg-[var(--system-green)]/15 text-[var(--system-green)]'
                              : 'bg-primary/10 text-primary'
                          }`}
                          title={ev.label}
                        >
                          {ev.label}
                        </div>
                      ))}
                      {c.events.length > 3 && (
                        <p className="text-[10px] text-muted-foreground">+{c.events.length - 3}건</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 테이블 (데스크탑) */}
      <div className={`${view === 'calendar' ? 'hidden' : 'hidden md:block'} bg-card rounded-lg border border-border overflow-hidden`}>
        <table className="data-table w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-[var(--fill-quaternary)]">
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                />
              </th>
              <th className="text-[13px] font-semibold text-muted-foreground w-12">이미지</th>
              <th className="text-[13px] font-semibold text-muted-foreground">바이어</th>
              <th className="text-[13px] font-semibold text-muted-foreground">스타일</th>
              <th className="text-[13px] font-semibold text-muted-foreground">장소/차수</th>
              <th className="text-[13px] font-semibold text-muted-foreground">단계</th>
              <th className="text-[13px] font-semibold text-muted-foreground">의뢰일</th>
              <th className="text-[13px] font-semibold text-muted-foreground">목표완료</th>
              <th className="text-[13px] font-semibold text-muted-foreground">비고</th>
              <th className="num text-[13px] font-semibold text-muted-foreground">비용(KRW)</th>
              <th className="text-[13px] font-semibold text-muted-foreground">청구</th>
              <th className="ctr text-[13px] font-semibold text-muted-foreground">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={12} className="text-center py-12 text-muted-foreground">
                <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 샘플이 없습니다</p>
              </td></tr>
            ) : filtered.map(s => {
              const checkCount = (s.materialChecklist || []).length;
              const readyCount = (s.materialChecklist || []).filter(c => c.isReady).length;
              const isChecked = selectedIds.has(s.id);
              return (
                <tr key={s.id} className={`border-b border-border hover:bg-[var(--fill-quaternary)] ${isChecked ? 'bg-primary/5' : ''}`}>
                  <td>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(s.id)}
                      className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                    />
                  </td>
                  <td>
                    {(s.imageUrls || []).length > 0 ? (
                      <img src={s.imageUrls[0]} alt={s.styleNo} className="w-14 h-14 object-cover rounded-md border border-border" />
                    ) : (
                      <div className="w-14 h-14 rounded-md bg-[var(--fill-tertiary)] border border-border flex items-center justify-center text-muted-foreground">
                        <Camera className="w-5 h-5" />
                      </div>
                    )}
                  </td>
                  <td>
                    {s.buyerId ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--fill-tertiary)] text-foreground border border-border">
                        {buyerLabelById(s.buyerId) || '-'}
                      </span>
                    ) : <span className="text-muted-foreground text-xs">-</span>}
                  </td>
                  <td>
                    <p className="font-medium text-foreground">{s.styleNo}</p>
                    <p className="text-xs text-muted-foreground">{s.styleName}</p>
                    <Badge variant="outline" className="text-[11px] mt-0.5">{s.season}</Badge>
                  </td>
                  <td>
                    {s.location && <p className="text-xs text-muted-foreground">{s.location}</p>}
                    {s.round && (
                      <p className="text-xs text-foreground font-medium">
                        {s.round}차{s.roundName ? ` (${s.roundName})` : ''}
                      </p>
                    )}
                    {s.assignee && <p className="text-[11px] text-muted-foreground">{s.assignee}</p>}
                  </td>
                  <td>
                    <Select value={s.stage} onValueChange={v => handleStageChange(s.id, v as SampleStage)}>
                      <SelectTrigger className={`h-7 text-xs w-28 border ${STAGE_COLOR[s.stage] || 'bg-[var(--fill-quaternary)] text-muted-foreground border-border'}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STAGES.map(st => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="text-muted-foreground text-xs">{s.requestDate}</td>
                  <td className="text-muted-foreground text-xs">{s.expectedDate || '-'}</td>
                  <td className="text-xs text-muted-foreground max-w-[120px]">
                    {s.memo && <p className="truncate">{s.memo}</p>}
                    {checkCount > 0 && (
                      <span className={`inline-flex items-center gap-1 text-xs ${readyCount === checkCount ? 'text-[var(--system-green)]' : 'text-[var(--system-orange)]'}`}>
                        <ClipboardCheck className="w-3 h-3" />{readyCount}/{checkCount}
                      </span>
                    )}
                    {!s.memo && checkCount === 0 && <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="nw num font-mono text-foreground text-xs">{formatKRW(s.costKrw || Math.round((s.costCny || 0) * settings.cnyKrw))}</td>
                  <td>
                    {s.billingStatus === '미청구' ? (
                      <button
                        onClick={() => {
                          setBillingTarget(s);
                          setBillingMode('new');
                          setLinkStatementId('');
                          setBillingModal(true);
                        }}
                        className="inline-flex text-xs px-2 py-0.5 rounded-full border bg-[var(--fill-quaternary)] text-muted-foreground border-border hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors whitespace-nowrap"
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
                                upsertSampleSB({ ...s, billingStatus: '미청구', billingDate: undefined }).then(() => refresh()).catch(onSaveFail('샘플'));
                              }
                            }}
                            className="text-[11px] text-muted-foreground hover:text-[var(--system-red)]"
                            title="미청구로 되돌리기"
                          >↩</button>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openDetail(s)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => openEdit(s)}>수정</Button>
                      {s.stage !== '최종승인' && (
                        <>
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-primary hover:text-primary"
                            onClick={() => openNextRound(s)}>다음 차수</Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-[var(--system-green)] hover:text-[var(--system-green)]"
                            onClick={() => handleApprove(s)}>승인</Button>
                        </>
                      )}
                      {s.stage === '최종승인' && (() => {
                        // 품목 등록 여부 확인:
                        // 1) TEMP 스타일번호가 아닌 정식 스타일번호로 등록된 ACTIVE 품목 찾기
                        // 2) 스타일번호가 TEMP로 시작하면 → 품목등록 버튼 표시
                        const isTempStyleNo = s.styleNo.startsWith('TEMP');
                        const registeredItem = items.find(i =>
                          i.itemStatus === 'ACTIVE' &&
                          !i.styleNo.startsWith('TEMP') &&
                          (i.id === s.styleId || (i.name === s.styleName && i.buyerId === s.buyerId))
                        );
                        const needsRegistration = isTempStyleNo || !registeredItem;
                        return needsRegistration ? (
                          /* TEMP 스타일번호 or 품목 미등록 → 품목등록 버튼 (주황색) */
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-warning hover:text-warning bg-warning/10 hover:bg-warning/20 border border-warning/30"
                            onClick={() => handleRegisterItem(s)}>
                            <PackagePlus className="w-3 h-3 mr-1" />품목등록
                          </Button>
                        ) : (
                          /* 품목 등록 완료(ACTIVE) → 버튼 없음, 텍스트만 표시 */
                          <span className="text-xs text-[var(--system-green)] font-medium px-1">✓ 품목등록완료</span>
                        );
                      })()}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-[var(--system-red)]" onClick={() => handleDelete(s.id)}>
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
          <div className="text-center py-12 text-muted-foreground bg-card rounded-lg border border-border">
            <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">등록된 샘플이 없습니다</p>
          </div>
        ) : filtered.map(s => {
          const checkCount = (s.materialChecklist || []).length;
          const readyCount = (s.materialChecklist || []).filter(c => c.isReady).length;
          const isChecked = selectedIds.has(s.id);
          return (
            <div key={s.id} className={`bg-card rounded-lg border p-4 ${isChecked ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
              <div className="flex gap-3">
                {/* 썸네일 */}
                <div className="shrink-0">
                  {(s.imageUrls || []).length > 0 ? (
                    <img src={s.imageUrls[0]} alt={s.styleNo} className="w-16 h-16 object-cover rounded-md border border-border" />
                  ) : (
                    <div className="w-16 h-16 rounded-md bg-[var(--fill-tertiary)] border border-border flex items-center justify-center text-muted-foreground">
                      <Camera className="w-5 h-5" />
                    </div>
                  )}
                </div>
                {/* 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground text-sm">{s.styleNo}</p>
                      <p className="text-xs text-muted-foreground truncate">{s.styleName}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(s.id)}
                        className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                      />
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${STAGE_COLOR[s.stage] || 'bg-[var(--fill-quaternary)] text-muted-foreground border-border'}`}>
                        {s.stage}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {s.buyerId && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--fill-tertiary)] text-foreground border border-border">
                        {buyerLabelById(s.buyerId) || '-'}
                      </span>
                    )}
                    <Badge variant="outline" className="text-[11px]">{s.season}</Badge>
                    <span className="text-[11px] text-muted-foreground">{s.requestDate}</span>
                  </div>
                  {checkCount > 0 && (
                    <span className={`inline-flex items-center gap-1 text-xs mt-1 ${readyCount === checkCount ? 'text-[var(--system-green)]' : 'text-[var(--system-orange)]'}`}>
                      <ClipboardCheck className="w-3 h-3" />{readyCount}/{checkCount}
                    </span>
                  )}
                </div>
              </div>
              {/* 하단 액션 */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                <div>
                  {s.billingStatus === '미청구' ? (
                    <button
                      onClick={() => { setBillingTarget(s); setBillingMode('new'); setLinkStatementId(''); setBillingModal(true); }}
                      className="text-xs px-2.5 py-1 rounded-full border bg-[var(--fill-quaternary)] text-muted-foreground border-border hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
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
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-[var(--system-green)]" onClick={() => handleApprove(s)}>승인</Button>
                  )}
                  {s.stage === '최종승인' && (() => {
                    // 모바일 뷰: TEMP 스타일번호 여부 + 정식 ACTIVE 품목 등록 여부 확인
                    const isTempStyleNo = s.styleNo.startsWith('TEMP');
                    const registeredItem = items.find(i =>
                      i.itemStatus === 'ACTIVE' &&
                      !i.styleNo.startsWith('TEMP') &&
                      (i.id === s.styleId || (i.name === s.styleName && i.buyerId === s.buyerId))
                    );
                    const needsRegistration = isTempStyleNo || !registeredItem;
                    return needsRegistration ? (
                      /* TEMP 스타일번호 or 품목 미등록 → 품목등록 버튼 */
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-warning bg-warning/10 border border-warning/30"
                        onClick={() => handleRegisterItem(s)}>
                        <PackagePlus className="w-3 h-3 mr-1" />품목
                      </Button>
                    ) : (
                      /* 품목 등록 완료(ACTIVE) → 텍스트만 표시, 버튼 없음 */
                      <span className="text-xs text-[var(--system-green)] font-medium px-1">✓ 완료</span>
                    );
                  })()}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-[var(--system-red)]" onClick={() => handleDelete(s.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 변경사항 확인 다이얼로그 ── */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onSaveAndClose={() => { setShowUnsavedDialog(false); handleSave(); }}
        onDiscardAndClose={() => { setShowUnsavedDialog(false); setIsDirty(false); setShowModal(false); }}
        onCancel={() => setShowUnsavedDialog(false)}
      />

      {/* ── 등록/수정 모달 ── */}
      <Dialog open={showModal} onOpenChange={(open) => { if (!open) handleModalClose(true); }}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-xl sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? '샘플 수정' : '샘플 접수'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 바이어 (맨 위) */}
              <div className="col-span-2 space-y-1.5">
                <Label>바이어</Label>
                <Select value={form.buyerId || 'none'} onValueChange={v => setForm(f => ({ ...f, buyerId: v === 'none' ? undefined : v }))}>
                  <SelectTrigger><SelectValue placeholder="바이어 선택 (선택사항)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">미지정</SelectItem>
                    {vendors.map(v => <SelectItem key={v.id} value={v.id}>{buyerLabel(v as any)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* 스타일 — 품목마스터와 같은 자동채번. 기존 스타일 연결도 여기서 */}
              <div className="col-span-2 space-y-2">
                <Label>기존 스타일 연결 <span className="text-muted-foreground font-normal text-xs">(선택 — 비우면 새 스타일번호가 자동 생성됩니다)</span></Label>
                <Select value={form.styleId || 'none'} onValueChange={v => {
                  if (v === 'none') { setForm(f => ({ ...f, styleId: undefined, styleNo: '' })); return; }
                  const item = items.find(i => i.id === v);
                  if (item) {
                    setForm(f => ({
                      ...f,
                      styleId: item.id,
                      styleNo: item.styleNo,
                      styleName: item.name,
                      buyerId: item.buyerId || f.buyerId,
                    }));
                  }
                }}>
                  <SelectTrigger className="text-xs h-8"><SelectValue placeholder="선택 안 함 (새 스타일)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">선택 안 함 (새 스타일)</SelectItem>
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
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">스타일번호 *</Label>
                      {!form.styleId && !editId && (
                        <label className="flex items-center gap-1 cursor-pointer text-[11px] text-primary">
                          <input type="checkbox" checked={manualStyleNo}
                            onChange={e => setManualStyleNo(e.target.checked)} className="w-3 h-3 accent-primary" />
                          직접 입력
                        </label>
                      )}
                    </div>
                    <Input
                      value={form.styleId ? (form.styleNo || '') : (manualStyleNo ? (form.styleNo || '') : previewStyleNo)}
                      onChange={e => setForm(f => ({ ...f, styleNo: e.target.value }))}
                      readOnly={!!form.styleId || !manualStyleNo}
                      placeholder="바이어를 선택하면 자동 생성됩니다"
                      className={`h-8 text-xs font-mono ${(!!form.styleId || !manualStyleNo) ? 'bg-[var(--fill-tertiary)] text-muted-foreground' : ''}`}
                    />
                    {!form.styleId && !manualStyleNo && !previewStyleNo && (
                      <p className="text-[11px] text-muted-foreground">바이어를 먼저 선택하세요</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">품명 *</Label>
                    <Input value={form.styleName || ''} onChange={e => setForm(f => ({ ...f, styleName: e.target.value }))} placeholder="예: 파니에 쁘띠 백" className="h-8 text-xs" />
                  </div>
                </div>
              </div>

              {/* 컬러 */}
              <div className="col-span-2 space-y-1.5">
                <Label>컬러 <span className="text-muted-foreground text-xs">(선택)</span></Label>
                <Input value={form.color || ''} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="예: 블랙, 카멜, RED" className="h-9" />
              </div>

              <div className="space-y-1.5">
                <Label>시즌</Label>
                <Select value={form.season || '26SS'} onValueChange={v => setForm(f => ({ ...f, season: v as Season }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {/* 단계 — 신규 등록은 항상 1차. 2차 이후는 목록의 '다음 차수' 버튼으로 만든다 */}
              {editId ? (
                <div className="space-y-1.5">
                  <Label>단계</Label>
                  <Select value={form.stage || '1차'} onValueChange={v => setForm(f => ({ ...f, stage: v as SampleStage }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>단계</Label>
                  <div className="h-9 flex items-center px-3 rounded-md border border-border bg-[var(--fill-tertiary)] text-sm text-muted-foreground">
                    1차 (신규는 항상 1차)
                  </div>
                </div>
              )}
              {/* 작업방식 (단계 바로 다음) */}
              <div className="space-y-1.5">
                <Label>작업방식 <span className="text-muted-foreground text-xs">(선택)</span></Label>
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
                <Label>작업담당자</Label>
                <Input value={form.assignee || ''} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))} placeholder="작업담당자명 (내부)" />
              </div>
              <div className="space-y-1.5">
                <Label>영업담당자</Label>
                <Input value={form.salesPerson || ''} onChange={e => setForm(f => ({ ...f, salesPerson: e.target.value }))} placeholder="영업담당자명 (외부/영업)" />
              </div>
              <div className="space-y-1.5">
                <Label>의뢰일 *</Label>
                <Input type="date" value={form.requestDate || ''} onChange={e => setForm(f => ({ ...f, requestDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>목표 완료일</Label>
                <Input type="date" value={form.expectedDate || ''} onChange={e => setForm(f => ({ ...f, expectedDate: e.target.value }))} />
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
                <p className="text-xs text-muted-foreground text-center py-2">자재 요청 없음 (행 추가 버튼으로 추가)</p>
              ) : (
                <div className="space-y-2">
                  {/* 헤더 */}
                  <div className="grid grid-cols-12 gap-1 text-xs text-muted-foreground px-1">
                    <span className="col-span-3">자재명</span>
                    <span className="col-span-3">업체</span>
                    <span className="col-span-2">컬러</span>
                    <span className="col-span-1 text-center">수량</span>
                    <span className="col-span-1">단위</span>
                    <span className="col-span-1 text-center">이미지</span>
                    <span className="col-span-1"></span>
                  </div>
                  {(form.materialRequests || []).map((req, idx) => {
                    // 자재거래처 이름 목록 + 직접입력 옵션
                    const materialVendorNames = materialVendors.map(v => v.name);
                    // vendor 값이 '직접입력'이거나, customVendor가 있으면 직접입력 모드
                    const isDirectInput = req.vendor === '직접입력' || (!!req.customVendor && !materialVendorNames.includes(req.vendor || ''));
                    const selectVal = isDirectInput ? '직접입력' : (req.vendor || 'none');
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
                              if (v === 'none') {
                                reqs[idx] = { ...reqs[idx], vendor: '', customVendor: '' };
                              } else if (v === '직접입력') {
                                reqs[idx] = { ...reqs[idx], vendor: '직접입력', customVendor: reqs[idx].customVendor || '' };
                              } else {
                                reqs[idx] = { ...reqs[idx], vendor: v, customVendor: '' };
                              }
                              return { ...f, materialRequests: reqs };
                            })}
                          >
                            <SelectTrigger className="col-span-3 h-8 text-xs">
                              <SelectValue placeholder="업체">
                                {selectVal === '직접입력' ? (req.customVendor || '직접입력') : (selectVal === 'none' ? '선택 안 함' : selectVal)}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">선택 안 함</SelectItem>
                              {materialVendors.map(v => (
                                <SelectItem key={v.id} value={v.name}>{v.name}</SelectItem>
                              ))}
                              <SelectItem value="직접입력">직접입력</SelectItem>
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
                            className="col-span-1 h-8 text-xs"
                            value={req.unit}
                            onChange={e => setForm(f => {
                              const reqs = [...(f.materialRequests || [])];
                              reqs[idx] = { ...reqs[idx], unit: e.target.value };
                              return { ...f, materialRequests: reqs };
                            })}
                            placeholder="장/개/m"
                          />
                          {/* 이미지 첨부 */}
                          <div className="col-span-1 flex items-center justify-center">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              ref={el => { materialImageRefs.current[idx] = el; }}
                              onChange={e => handleMaterialImageUpload(e, idx)}
                            />
                            {req.imageUrl ? (
                              <img
                                src={req.imageUrl}
                                alt="자재 이미지"
                                className="w-8 h-8 object-cover rounded border border-border cursor-pointer hover:opacity-80"
                                onClick={() => window.open(req.imageUrl, '_blank')}
                                title="클릭하면 새 탭에서 열림"
                              />
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                                onClick={() => materialImageRefs.current[idx]?.click()}
                                title="이미지 첨부"
                              >
                                <Paperclip className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                          {/* 삭제 */}
                          <Button
                            type="button" variant="ghost" size="sm" className="col-span-1 h-8 w-8 p-0 text-destructive/70 hover:text-destructive"
                            onClick={() => setForm(f => ({
                              ...f,
                              materialRequests: (f.materialRequests || []).filter((_, i) => i !== idx),
                            }))}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                        {/* 직접입력 업체명 텍스트 필드 */}
                        {isDirectInput && (
                          <Input
                            className="h-7 text-xs ml-[25%] w-[25%]"
                            value={req.customVendor || ''}
                            onChange={e => setForm(f => {
                              const reqs = [...(f.materialRequests || [])];
                              reqs[idx] = { ...reqs[idx], customVendor: e.target.value };
                              return { ...f, materialRequests: reqs };
                            })}
                            placeholder="업체명 직접입력"
                            autoFocus
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
                <Label>파일/이미지 첨부 <span className="text-xs text-muted-foreground font-normal">(이미지 최대 5장 + 문서 최대 5개)</span></Label>
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
                  <p className="text-xs text-muted-foreground mb-1">이미지 ({(form.imageUrls || []).length}/5)</p>
                  <div className="flex flex-wrap gap-2 p-2 bg-[var(--fill-quaternary)] rounded-md border border-border">
                    {(form.imageUrls || []).map((url, idx) => (
                      <div key={idx} className="relative group">
                        <img
                          src={url}
                          alt={`샘플 이미지 ${idx + 1}`}
                          className="w-16 h-16 object-cover rounded-md border border-border cursor-pointer"
                          onClick={() => window.open(url, '_blank')}
                        />
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, imageUrls: (f.imageUrls || []).filter((_, i) => i !== idx) }))}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 문서 목록 */}
              {(form.documents || []).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">첨부 문서 ({(form.documents || []).length}/5)</p>
                  <div className="space-y-1">
                    {(form.documents || []).map((doc, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-[var(--fill-quaternary)] rounded-md border border-border group">
                        <DocIcon fileType={doc.fileType} />
                        <button
                          type="button"
                          className="flex-1 text-xs text-foreground text-left hover:underline truncate"
                          onClick={() => openFile(doc.url, doc.fileType, doc.name)}
                          title={doc.fileType === 'excel' ? '클릭하면 다운로드' : '클릭하면 새 탭에서 열림'}
                        >
                          {doc.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, documents: (f.documents || []).filter((_, i) => i !== idx) }))}
                          className="text-muted-foreground hover:text-[var(--system-red)] opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(form.imageUrls || []).length === 0 && (form.documents || []).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border rounded-md">
                  파일 없음 — 위 버튼으로 이미지·PDF·엑셀을 추가하세요
                </p>
              )}
            </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleModalClose(true)}>취소</Button>
            <Button onClick={handleSave}>{editId ? '수정' : '접수'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 샘플 의뢰서 — 공장·개발실에 보내는 서류 ── */}
      <Dialog open={!!requestDoc} onOpenChange={o => { if (!o) setRequestDoc(null); }}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-[96vw] sm:max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>샘플 의뢰서 — {requestDoc?.styleNo}</DialogTitle></DialogHeader>
          {requestDoc && (
            <div ref={reqDocRef} className="border border-border rounded-md overflow-hidden">
              <SampleRequestDoc
                sample={requestDoc}
                buyer={allVendors.find((v: any) => v.id === requestDoc.buyerId) as any}
                item={(items as any[]).find(i => i.id === requestDoc.styleId || i.styleNo === requestDoc.styleNo) as any}
              />
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setRequestDoc(null)}>닫기</Button>
            <Button variant="outline" onClick={async () => {
              if (!reqDocRef.current) return;
              try { await copyDocAsImage(reqDocRef.current); toast.success('이미지 복사됨 — 카톡·위챗에 붙여넣으세요'); }
              catch (e) { toast.error((e as Error).message); }
            }}>이미지 복사</Button>
            <Button variant="outline" onClick={async () => {
              if (!reqDocRef.current) return;
              try { await saveDocAsImage(reqDocRef.current, `샘플의뢰서_${requestDoc?.styleNo}`); toast.success('이미지 저장됨'); }
              catch (e) { toast.error((e as Error).message); }
            }}>이미지 저장</Button>
            <Button onClick={() => printDoc(reqDocRef.current)}>A4 인쇄 · PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 상세 모달 (차수별 메모 + 자재 체크리스트) ── */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-lg sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
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
                    <p className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
                      자재 요청 목록
                    </p>
                    <div className="rounded-md border border-border overflow-x-auto">
                      <table className="data-table w-full min-w-[520px] text-xs">
                        <thead>
                          <tr className="bg-[var(--fill-quaternary)] border-b border-border">
                            <th className="text-[13px] font-semibold text-muted-foreground">자재명</th>
                            <th className="text-[13px] font-semibold text-muted-foreground">업체</th>
                            <th className="text-[13px] font-semibold text-muted-foreground">컬러</th>
                            <th className="num text-[13px] font-semibold text-muted-foreground">수량</th>
                            <th className="nw text-[13px] font-semibold text-muted-foreground">단위</th>
                            <th className="ctr text-[13px] font-semibold text-muted-foreground">이미지</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detailSample.materialRequests || []).map((req, i) => {
                            // 업체명: 직접입력이면 customVendor 표시
                            const vendorDisplay = req.vendor === '직접입력'
                              ? (req.customVendor || '—')
                              : (req.vendor || '—');
                            return (
                            <tr key={i} className="border-b border-border last:border-0">
                              <td className="text-foreground font-medium">{req.itemName}</td>
                              <td className="text-muted-foreground">{vendorDisplay === '—' ? <span className="text-muted-foreground">—</span> : vendorDisplay}</td>
                              <td className="text-muted-foreground">{req.color || <span className="text-muted-foreground">—</span>}</td>
                              <td className="num text-foreground">{req.qty}</td>
                              <td className="text-muted-foreground">{req.unit}</td>
                              <td className="ctr">
                                {req.imageUrl ? (
                                  <img
                                    src={req.imageUrl}
                                    alt="자재"
                                    className="w-8 h-8 object-cover rounded border border-border cursor-pointer hover:opacity-80 inline-block"
                                    onClick={() => window.open(req.imageUrl, '_blank')}
                                  />
                                ) : <span className="text-muted-foreground">—</span>}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 첨부 파일/이미지 */}
                {((detailSample.imageUrls || []).length > 0 || (detailSample.documents || []).length > 0) && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">첨부 파일</p>
                    {(detailSample.imageUrls || []).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {(detailSample.imageUrls || []).map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt={`이미지 ${idx + 1}`}
                            className="w-16 h-16 object-cover rounded-md border border-border cursor-pointer hover:opacity-80"
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
                            className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-md border border-border hover:bg-[var(--fill-quaternary)]"
                            onClick={() => openFile(doc.url, doc.fileType, doc.name)}
                            title={doc.fileType === 'excel' ? '클릭하면 다운로드' : '클릭하면 새 탭에서 열림'}
                          >
                            <DocIcon fileType={doc.fileType} />
                            <span className="text-xs text-foreground truncate">{doc.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 차수별 수정 요청 메모 */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">차수별 수정 요청 히스토리</p>
                  {(detailSample.revisionHistory || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">등록된 메모가 없습니다</p>
                  ) : (
                    <div className="space-y-2">
                      {(detailSample.revisionHistory || []).map((r, i) => (
                        <div key={i} className="flex gap-3 text-sm p-2 bg-[var(--fill-quaternary)] rounded-md border border-border">
                          <span className="text-xs font-bold text-foreground shrink-0 mt-0.5">{r.round}차</span>
                          <div className="flex-1">
                            <p className="text-foreground">{r.note}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{r.date}</p>
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
                    <Button size="sm" variant="secondary" className="h-8 px-3" onClick={handleAddRevNote}>추가</Button>
                  </div>
                </div>

                {/* 자재 준비 체크리스트 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
                      <ClipboardCheck className="w-3.5 h-3.5" />자재 준비 체크리스트
                    </p>
                    {(detailSample.materialChecklist || []).length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          const items = (detailSample.materialChecklist || []).map((c, i) =>
                            `${i + 1}. ${c.isReady ? '✅' : '⬜'} ${c.itemName}`
                          ).join('\n');
                          const text = `[${detailSample.styleNo}] ${detailSample.styleName} 자재 준비 현황\n\n${items}\n\n완료: ${(detailSample.materialChecklist||[]).filter(c=>c.isReady).length}/${(detailSample.materialChecklist||[]).length}`;
                          navigator.clipboard.writeText(text).then(() => {
                            toast.success('카카오톡 전달용 텍스트가 복사되었습니다');
                          });
                        }}
                      >
                        카톡 복사
                      </Button>
                    )}
                  </div>
                  {(detailSample.materialChecklist || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">체크리스트가 없습니다</p>
                  ) : (
                    <div className="space-y-1.5">
                      {(detailSample.materialChecklist || []).map(c => (
                        <label key={c.id} className="flex items-center gap-3 p-2 rounded-md border border-border hover:bg-[var(--fill-quaternary)] cursor-pointer">
                          <input
                            type="checkbox" checked={c.isReady}
                            onChange={() => handleToggleCheck(c.id)}
                            className="accent-primary w-4 h-4"
                          />
                          <span className={`text-sm flex-1 ${c.isReady ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                            {c.itemName}
                          </span>
                          {c.isReady && <span className="text-xs text-[var(--system-green)]">확보</span>}
                        </label>
                      ))}
                      <p className="text-xs text-right text-muted-foreground mt-1">
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
                    <Button size="sm" variant="secondary" className="h-8 px-3" onClick={handleAddCheckItem}>추가</Button>
                  </div>
                </div>
              </div>

              <DialogFooter className="flex-wrap gap-2">
                <Button variant="outline" onClick={() => setShowDetail(false)}>닫기</Button>
                <Button onClick={() => { setShowDetail(false); setRequestDoc(detailSample); }}>샘플 의뢰서</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── 다음 차수 (수정 요청) 모달 ── */}
      <Dialog open={!!nextRoundTarget} onOpenChange={o => { if (!o) setNextRoundTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              다음 차수 등록 — {nextRoundTarget?.styleNo}
            </DialogTitle>
          </DialogHeader>
          {nextRoundTarget && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                {nextRoundTarget.stage} → <span className="text-foreground font-medium">
                  {((nextRoundTarget.round || parseInt(String(nextRoundTarget.stage).replace(/[^0-9]/g, ''), 10) || 1) + 1)}차
                </span> 로 새 샘플이 만들어집니다. 스타일·바이어·시즌은 그대로 복사됩니다.
              </p>

              <div className="space-y-1.5">
                <Label>수정 요청 내용</Label>
                <Input value={nextRoundNote} onChange={e => setNextRoundNote(e.target.value)}
                  placeholder="예: 손잡이 길이 2cm 단축, 금장 → 은장" />
              </div>

              <div className="space-y-1.5">
                <Label>작업담당자 <span className="text-muted-foreground text-xs font-normal">(이 사람에게 전달됩니다)</span></Label>
                <Input value={nextRoundAssignee} onChange={e => setNextRoundAssignee(e.target.value)} placeholder="담당자명" />
              </div>

              <div className="space-y-1.5">
                <Label>업체 수정 요청 파일 <span className="text-muted-foreground text-xs font-normal">(이미지 · PDF · 엑셀)</span></Label>
                <input
                  type="file" multiple accept="image/*,.pdf,.xlsx,.xls"
                  className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-border file:bg-card file:text-xs"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    const read = (f: File) => new Promise<{ name: string; url: string }>(res => {
                      const r = new FileReader();
                      r.onload = ev => res({ name: f.name, url: String(ev.target?.result || '') });
                      r.readAsDataURL(f);
                    });
                    const loaded = await Promise.all(files.map(read));
                    setNextRoundFiles(prev => [...prev, ...loaded]);
                    e.target.value = '';
                  }}
                />
                {nextRoundFiles.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {nextRoundFiles.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-[var(--fill-quaternary)] border border-border">
                        <span className="truncate">{f.name}</span>
                        <button type="button" className="text-muted-foreground hover:text-[var(--system-red)]"
                          onClick={() => setNextRoundFiles(prev => prev.filter((_, x) => x !== i))}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNextRoundTarget(null)}>취소</Button>
            <Button onClick={createNextRound}>다음 차수 등록</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 청구하기 모달 ── */}
      {billingTarget && (
        <Dialog open={billingModal} onOpenChange={setBillingModal}>
          <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-lg sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>청구하기 — {billingTarget.styleNo}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                거래명세표를 새로 생성하거나 기존 전표에 연결하세요
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* 모드 선택 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={() => setBillingMode('new')}
                  className={`p-3 rounded-md border text-sm font-medium transition-colors ${billingMode === 'new' ? 'bg-primary/5 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:bg-[var(--fill-quaternary)]'}`}
                >
                  거래명세표 신규 생성
                </button>
                <button
                  onClick={() => setBillingMode('link')}
                  className={`p-3 rounded-md border text-sm font-medium transition-colors ${billingMode === 'link' ? 'bg-primary/5 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:bg-[var(--fill-quaternary)]'}`}
                >
                  기존 전표에 연결
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
                    <p className="text-xs text-muted-foreground">이번 달 전표 ({thisMonth}) — 바이어: {buyerLabelById(billingTarget.buyerId) || '미지정'}</p>
                    {buyerStatements.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-3 text-center">해당 조건의 전표가 없습니다. 신규 생성을 선택하세요.</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {buyerStatements.map(t => (
                          <button key={t.id}
                            onClick={() => setLinkStatementId(t.id)}
                            className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${linkStatementId === t.id ? 'bg-primary/5 border-primary/40' : 'border-border hover:bg-[var(--fill-quaternary)]'}`}
                          >
                            <span className="font-mono font-medium">{t.statementNo}</span>
                            <span className="ml-2 text-muted-foreground">{t.vendorName}</span>
                            <span className="ml-2 text-muted-foreground">{t.issueDate}</span>
                            <span className="ml-2 text-muted-foreground">{t.lines?.length || 0}건</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {billingMode === 'new' && (
                <div className="p-3 bg-primary/5 rounded-md text-xs text-muted-foreground">
                  <p className="font-medium mb-1 text-foreground">생성될 거래명세표</p>
                  <p>바이어: {buyerLabelById(billingTarget.buyerId) || '미지정'}</p>
                  <p>품목: {billingTarget.styleNo} — {billingTarget.styleName}</p>
                  <p>금액: {(billingTarget.costKrw || Math.round((billingTarget.costCny || 0) * settings.cnyKrw)).toLocaleString()}원</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBillingModal(false)}>취소</Button>
              <Button
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
                  upsertSampleSB({ ...billingTarget, billingStatus: '청구완료', billingDate: today }).then(() => refresh()).catch(onSaveFail('샘플'));
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