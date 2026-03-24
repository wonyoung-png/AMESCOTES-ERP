// AMESCOTES ERP — 생산 발주 관리 (BOM 연동)
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchOrders, upsertOrder, deleteOrder as deleteOrderSB, fetchBoms, fetchVendors, fetchItems, fetchMaterials, upsertMaterial } from '@/lib/supabaseQueries';
import {
  store, genId, calcDDay, dDayLabel, dDayColor, formatNumber, formatKRW, normalizeColors,
  getBomForOrderFromList,
  type ProductionOrder, type OrderStatus, type Season, type Item, type Bom,
  type HqSupplyItem, type ColorQty, type CartItem,
  type TradeStatement, type TradeStatementLine,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Search, Eye, Trash2, Package, FileText, AlertTriangle, CheckCircle2, Factory, ShoppingCart, Printer, X, Pencil, Download, Mail } from 'lucide-react';

const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS'];
const ORDER_STATUSES: OrderStatus[] = ['발주생성', '샘플승인', '생산중', '선적중', '통관중', '입고완료', '지연'];

const STATUS_COLOR: Record<OrderStatus, string> = {
  '발주생성': 'bg-stone-50 text-stone-600 border-stone-200',
  '샘플승인': 'bg-blue-50 text-blue-700 border-blue-200',
  '생산중': 'bg-amber-50 text-amber-700 border-amber-200',
  '선적중': 'bg-purple-50 text-purple-700 border-purple-200',
  '통관중': 'bg-orange-50 text-orange-700 border-orange-200',
  '입고완료': 'bg-green-50 text-green-700 border-green-200',
  '지연': 'bg-red-50 text-red-600 border-red-200',
};

// BOM 연동 계산 결과 타입
interface BomCalcResult {
  bomType: 'post' | 'pre' | 'manual' | null;
  bomLoaded: boolean;
  hasBomWarning: boolean;
  factoryUnitPriceCny: number;
  factoryUnitPriceKrw: number;
  totalFactoryAmountKrw: number;
  hqProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; imageUrl?: string; category?: string }>;
  factoryProvided: Array<{ bomLineId: string; itemName: string; spec?: string; unit: string; reqQty: number; vendorName?: string; imageUrl?: string; category?: string }>;
  manufacturingCountry?: string;
}

export default function ProductionOrders() {
  const queryClient = useQueryClient();
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
  const setOrders = (_v: ProductionOrder[]) => {}; // no-op
  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: fetchItems });
  const { data: boms = [] } = useQuery({ queryKey: ['boms'], queryFn: fetchBoms });
  const { data: allVendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const buyers = allVendors.filter((v: any) => v.type === '바이어');
  const factories = allVendors.filter((v: any) => v.type === '공장' || v.type === '해외공장');
  const [search, setSearch] = useState('');
  const [filterBuyer, setFilterBuyer] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSeason, setFilterSeason] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState<ProductionOrder | null>(null);
  const [form, setForm] = useState<Partial<ProductionOrder>>({});
  const [hqItems, setHqItems] = useState<HqSupplyItem[]>([]);
  const [colorQtys, setColorQtys] = useState<ColorQty[]>([]);

  // BOM 연동 상태
  const [bomCalc, setBomCalc] = useState<BomCalcResult>({
    bomType: null, bomLoaded: false, hasBomWarning: false,
    factoryUnitPriceCny: 0, factoryUnitPriceKrw: 0, totalFactoryAmountKrw: 0,
    hqProvided: [], factoryProvided: [],
  });
  // 공장단가 수동 입력 모드
  const [manualFactoryPrice, setManualFactoryPrice] = useState(false);
  const [manualPriceCny, setManualPriceCny] = useState<number>(0);
  // 공장단가 통화 선택
  const [factoryCurrency, setFactoryCurrency] = useState<'CNY' | 'USD' | 'KRW'>('CNY');

  // 컬러 드롭다운 상태
  const [showColorDropdown, setShowColorDropdown] = useState(false);
  const [customColorInput, setCustomColorInput] = useState('');
  const [showCustomColorInput, setShowCustomColorInput] = useState(false);

  // 리오더 네고 상태
  const [negoRequestedPrice, setNegoRequestedPrice] = useState<number>(0);
  const [negoCurrency, setNegoCurrency] = useState<'CNY' | 'USD' | 'KRW'>('CNY');
  const [negoMemo, setNegoMemo] = useState('');
  // 네고 단가 발주 적용 상태
  const [negoApplied, setNegoApplied] = useState(false);
  const [originalFactoryPriceKrw, setOriginalFactoryPriceKrw] = useState<number>(0);

  // 입고 처리 팝업 상태
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [receiveOrderId, setReceiveOrderId] = useState<string>('');
  const [receiveForm, setReceiveForm] = useState<{ receivedQty: number; defectQty: number; defectNote: string; receivedDate: string }>({
    receivedQty: 0, defectQty: 0, defectNote: '', receivedDate: new Date().toISOString().split('T')[0],
  });

  // 명세표 발행 모달 상태
  const [billingModal, setBillingModal] = useState(false);
  const [billingTarget, setBillingTarget] = useState<ProductionOrder | null>(null);
  const [billingMode, setBillingMode] = useState<'new' | 'link'>('new');
  const [linkStatementId, setLinkStatementId] = useState('');

  // 작업지시서 모달 상태
  const [workOrderModal, setWorkOrderModal] = useState(false);
  const [workOrderTarget, setWorkOrderTarget] = useState<ProductionOrder | null>(null);
  const [workOrderNote, setWorkOrderNote] = useState('');
  const [workOrderWithBom, setWorkOrderWithBom] = useState(false);
  // 작업지시서 본사제공 자재 수령 체크란
  const [hqReceive, setHqReceive] = useState<{ received: string; checked: boolean }[]>([]);

  // 발주 완료 후 액션 팝업 상태
  const [postOrderModal, setPostOrderModal] = useState(false);
  const [postOrderInfo, setPostOrderInfo] = useState<{ order: ProductionOrder; bomMaterials: Array<any> } | null>(null);
  const [materialImagePreview, setMaterialImagePreview] = useState<string | null>(null);

  // 자재 장바구니 모달 상태
  const [cartModal, setCartModal] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>(() => store.getMaterialCart());

  // 공장구매/본사제공 자재 카테고리 접기/펼치기 상태
  const CATEGORY_ORDER = ['원자재', '장식', '지퍼', '보강재', '봉사·접착제', '포장재', '철형', '후가공', '기타'];
  const [factoryCategoryOpen, setFactoryCategoryOpen] = useState<Record<string, boolean>>({ '원자재': true });
  const [hqCategoryOpen, setHqCategoryOpen] = useState<Record<string, boolean>>({ '원자재': true });

  // 거래처별 발주서 모달 상태
  const [vendorOrderModal, setVendorOrderModal] = useState(false);

  // 이메일 입력 모달 상태
  const [emailInputModal, setEmailInputModal] = useState(false);
  const [emailInputValue, setEmailInputValue] = useState('');
  const [pendingEmailVendor, setPendingEmailVendor] = useState<string>('');
  const [pendingEmailItems, setPendingEmailItems] = useState<Array<CartItem & { orderQty: number }>>([]);

  const refreshCart = () => setCartItems(store.getMaterialCart());
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['orders'] });

  // 거래처 이메일 발주서 발송 (gog Gmail API 사용)
  const sendVendorEmail = async (vendor: string, email: string, items: Array<CartItem & { orderQty: number }>) => {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const subject = `[AMESCOTES] 자재 발주서 - ${vendor} ${today}`;
    const bodyLines = [
      `안녕하세요, ${vendor} 담당자님.`,
      ``,
      `아래와 같이 자재 발주 드립니다. 확인 및 납기 일정 회신 부탁드립니다.`,
      ``,
      `[발주 일자] ${today}`,
      `[거래처] ${vendor}`,
      ``,
      `─────────────────────────────`,
      `No. | 자재명 | 규격 | 단위 | 발주수량`,
      `─────────────────────────────`,
      ...items.map((item, i) =>
        `${i + 1}. ${item.materialName}${item.spec ? ` (${item.spec})` : ''} | ${item.unit} | ${item.orderQty % 1 === 0 ? item.orderQty.toLocaleString() : item.orderQty.toFixed(3)}`
      ),
      `─────────────────────────────`,
      `총 ${items.length}종`,
      ``,
      `담긴 발주: ${[...new Set(items.flatMap(item => item.orders.map(o => o.styleNo)))].join(', ')}`,
      ``,
      `문의사항은 회신 주시기 바랍니다.`,
      ``,
      `감사합니다.`,
      `AMESCOTES Co., Ltd`,
    ];
    const body = bodyLines.join('\n');
    // fetch 방식으로 서버 API 호출 시도
    try {
      const resp = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email, subject, body, account: 'info@atlm.kr' }),
      });
      if (resp.ok) {
        toast.success(`📧 ${vendor} 발주서를 ${email}로 발송했습니다`);
        return;
      }
    } catch {
      // API 없음 - 아래로 fall-through
    }
    // gog CLI 명령어 생성하여 클립보드에 복사
    const gogCmd = `gog gmail send --to "${email}" --subject "${subject}" --body "${body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}" --account info@atlm.kr`;
    try {
      await navigator.clipboard.writeText(gogCmd);
      toast.success(`📋 ${vendor} 발주서 이메일 명령어가 클립보드에 복사됐습니다!\n수신: ${email}\n터미널에 붙여넣기해서 실행하세요`);
    } catch {
      toast.info(`📧 ${vendor} 발주서\n수신: ${email}\n수동으로 gog 명령어를 실행해주세요`);
    }
  };

  const filtered = useMemo(() => {
    let list = orders;
    if (filterStatus !== 'all') list = list.filter(o => o.status === filterStatus);
    if (filterSeason !== 'all') list = list.filter(o => o.season === filterSeason);
    if (filterBuyer !== 'all') {
      const buyerStyleIds = items.filter(i => i.buyerId === filterBuyer).map(i => i.id);
      list = list.filter(o => buyerStyleIds.includes(o.styleId));
    }
    if (search) list = list.filter(o =>
      o.orderNo.toLowerCase().includes(search.toLowerCase()) ||
      o.styleNo.toLowerCase().includes(search.toLowerCase()) ||
      o.styleName.toLowerCase().includes(search.toLowerCase())
    );
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [orders, filterStatus, filterSeason, filterBuyer, items, search]);

  const openNew = (prefillStyleId?: string) => {
    const prefillRaw = localStorage.getItem('ames_prefill_order');
    let prefillStyleIdToUse = prefillStyleId;
    if (prefillRaw && !prefillStyleId) {
      try {
        const prefill = JSON.parse(prefillRaw) as { styleId: string; styleNo: string; styleName: string; season: string };
        prefillStyleIdToUse = prefill.styleId;
        localStorage.removeItem('ames_prefill_order');
      } catch { /* ignore */ }
    }

    setIsEditMode(false);
    setEditOrderId(null);
    setForm({ season: '26SS', status: '발주생성', qty: 0, orderDate: new Date().toISOString().split('T')[0], hqSupplyItems: [], attachments: [] });
    setHqItems([]);
    setColorQtys([]);
    setBomCalc({ bomType: null, bomLoaded: false, hasBomWarning: false, factoryUnitPriceCny: 0, factoryUnitPriceKrw: 0, totalFactoryAmountKrw: 0, hqProvided: [], factoryProvided: [] });
    setManualFactoryPrice(false);
    setManualPriceCny(0);
    setFactoryCurrency('CNY');
    setShowColorDropdown(false);
    setShowCustomColorInput(false);
    setCustomColorInput('');
    setNegoRequestedPrice(0);
    setNegoCurrency('CNY');
    setNegoMemo('');
    setNegoApplied(false);
    setOriginalFactoryPriceKrw(0);
    setShowModal(true);

    if (prefillStyleIdToUse) {
      setTimeout(() => handleStyleSelect(prefillStyleIdToUse!), 0);
    }
  };

  const openEdit = (order: ProductionOrder) => {
    setIsEditMode(true);
    setEditOrderId(order.id);
    setForm({ ...order });
    setHqItems(order.hqSupplyItems || []);
    setColorQtys(order.colorQtys || []);
    setBomCalc({ bomType: order.bomType as 'post' | 'pre' | 'manual' | null, bomLoaded: true, hasBomWarning: false, factoryUnitPriceCny: order.factoryUnitPriceCny || 0, factoryUnitPriceKrw: order.factoryUnitPriceKrw || 0, totalFactoryAmountKrw: (order.factoryUnitPriceKrw || 0) * order.qty, hqProvided: [], factoryProvided: [] });
    setManualFactoryPrice(order.bomType === 'manual');
    setManualPriceCny(order.factoryUnitPriceCny || 0);
    setFactoryCurrency((order.factoryCurrency as 'CNY' | 'USD' | 'KRW') || 'CNY');
    setShowColorDropdown(false);
    setShowCustomColorInput(false);
    setCustomColorInput('');
    setNegoRequestedPrice(0);
    setNegoCurrency('CNY');
    setNegoMemo('');
    setNegoApplied(false);
    setOriginalFactoryPriceKrw(order.factoryUnitPriceKrw || 0);
    setShowModal(true);
  };

  useEffect(() => {
    const prefillRaw = localStorage.getItem('ames_prefill_order');
    if (prefillRaw) { openNew(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BOM 기반 계산 (스타일+수량 변경 시 호출)
  const recalcBom = (styleNo: string, qty: number) => {
    if (!styleNo || qty <= 0) return;
    // 최신 BOM 항상 Supabase에서 동기화 후 계산
    store.fetchAndCacheBom(styleNo).then(() => {
      _doRecalcBom(styleNo, qty);
    });
  };
  const _doRecalcBom = (styleNo: string, qty: number) => {
    if (!styleNo || qty <= 0) return;
    const settings = store.getSettings();
    const cnyKrw = settings.cnyKrw || 191;
    const result = store.calcMaterialRequirements(styleNo, qty, colorQtys.length > 0 ? colorQtys : undefined);

    if (result.bomType === null) {
      // BOM 없음
      setBomCalc(prev => ({
        ...prev, bomLoaded: false, hasBomWarning: true,
        factoryUnitPriceCny: 0, factoryUnitPriceKrw: 0, totalFactoryAmountKrw: 0,
        hqProvided: [], factoryProvided: [],
      }));
      return;
    }

    const factoryUnitPriceCny = result.factoryUnitPriceCny;
    const factoryUnitPriceKrw = Math.round(factoryUnitPriceCny * cnyKrw);
    const totalFactoryAmountKrw = factoryUnitPriceKrw * qty;

    setBomCalc({
      bomType: result.bomType,
      bomLoaded: true,
      hasBomWarning: false,
      factoryUnitPriceCny,
      factoryUnitPriceKrw,
      totalFactoryAmountKrw,
      hqProvided: result.hqProvided,
      factoryProvided: result.factoryProvided,
      manufacturingCountry: result.manufacturingCountry,
    });

    // 공장단가 폼에 자동 설정
    setForm(f => ({
      ...f,
      factoryUnitPriceCny,
      factoryUnitPriceKrw,
      bomType: result.bomType as 'post' | 'pre',
    }));
  };

  const handleStyleSelect = (styleId: string) => {
    const item = items.find(i => i.id === styleId);
    if (!item) return;
    const revision = store.getNextRevision(item.styleNo);
    const orderNo = `${item.styleNo}-R${revision}`;
    const bomList = boms.filter(b => b.styleId === styleId);
    const bom = bomList.sort((a, b) => b.version - a.version)[0];

    // HQ 제공 자재 추출 (BOM에서)
    const { bom: bomForOrder } = getBomForOrderFromList(boms as Bom[], item.styleNo);
    const usedLines = bomForOrder
      ? ((bomForOrder.postMaterials && bomForOrder.postMaterials.length > 0)
          ? bomForOrder.postMaterials
          : bomForOrder.lines)
      : [];
    const hqFromBom: HqSupplyItem[] = (usedLines || [])
      .filter(l => l.isHqProvided)
      .map(l => ({
        bomLineId: l.id,
        itemName: l.itemName,
        spec: l.spec,
        unit: l.unit,
        requiredQty: 0,
        currency: 'CNY' as const,
        purchaseStatus: '미구매' as const,
        vendorId: undefined,
        memo: l.vendorName ? `구매처: ${l.vendorName}` : undefined,
      }));
    setHqItems(hqFromBom);

    // BOM currency → factoryCurrency / negoCurrency 기본값 설정
    if (bomForOrder?.currency) {
      setFactoryCurrency(bomForOrder.currency);
      setNegoCurrency(bomForOrder.currency as 'CNY' | 'USD' | 'KRW');
    }

    setForm(f => ({
      ...f,
      styleId: item.id,
      styleNo: item.styleNo,
      styleName: item.name,
      orderNo,
      revision,
      bomId: bom?.id,
    }));

    // 수량이 이미 있으면 BOM 재계산
    const currentQty = form.qty || 0;
    if (currentQty > 0) {
      recalcBom(item.styleNo, currentQty);
    } else {
      // 수량 없어도 BOM 존재 여부 확인
      const { bom: b } = getBomForOrderFromList(boms as Bom[], item.styleNo);
      setBomCalc(prev => ({
        ...prev,
        bomLoaded: !!b,
        hasBomWarning: !b,
        bomType: b ? ((b as any).postColorBoms?.length > 0 || (b.postMaterials && b.postMaterials.length > 0) ? 'post' : 'pre') : null,
      }));
    }
  };

  const handleQtyChange = (newQty: number) => {
    setForm(f => ({ ...f, qty: newQty }));
    if (form.styleNo && newQty > 0) {
      recalcBom(form.styleNo, newQty);
      // HQ items 수량도 재계산
      if (bomCalc.hqProvided.length > 0) {
        const result = store.calcMaterialRequirements(form.styleNo!, newQty, colorQtys.length > 0 ? colorQtys : undefined);
        setHqItems(prev => prev.map(item => {
          const found = result.hqProvided.find(h => h.bomLineId === item.bomLineId);
          return found ? { ...item, requiredQty: found.reqQty } : item;
        }));
      }
    }
  };

  const handleSave = () => {
    if (!form.styleId) { toast.error('스타일을 선택해주세요'); return; }
    if (!form.vendorId) { toast.error('발주처(공장)를 선택해주세요'); return; }

    const totalQty = colorQtys.length > 0
      ? colorQtys.reduce((s, c) => s + c.qty, 0)
      : (form.qty || 0);

    // 공장단가: 네고 적용 시 form에 저장된 값 사용, 수동입력 모드면 manualPriceCny, 아니면 BOM 계산값
    const settings = store.getSettings();
    const cnyKrw = settings.cnyKrw || 191;
    const usdKrw = settings.usdKrw || 1380;
    let finalFactoryUnitPriceCny: number;
    let finalFactoryUnitPriceKrw: number;

    if (negoApplied && form.factoryUnitPriceKrw) {
      // 네고 단가 적용: form에 저장된 KRW 값 사용
      finalFactoryUnitPriceKrw = form.factoryUnitPriceKrw;
      // CNY 역산
      if (factoryCurrency === 'KRW') {
        finalFactoryUnitPriceCny = form.factoryUnitPriceKrw;
      } else if (factoryCurrency === 'USD') {
        finalFactoryUnitPriceCny = usdKrw > 0 ? form.factoryUnitPriceKrw / usdKrw : 0;
      } else {
        finalFactoryUnitPriceCny = cnyKrw > 0 ? form.factoryUnitPriceKrw / cnyKrw : 0;
      }
    } else {
      finalFactoryUnitPriceCny = manualFactoryPrice ? manualPriceCny : bomCalc.factoryUnitPriceCny;
      if (factoryCurrency === 'KRW') {
        finalFactoryUnitPriceKrw = Math.round(finalFactoryUnitPriceCny);
      } else if (factoryCurrency === 'USD') {
        finalFactoryUnitPriceKrw = Math.round(finalFactoryUnitPriceCny * usdKrw);
      } else {
        finalFactoryUnitPriceKrw = Math.round(finalFactoryUnitPriceCny * cnyKrw);
      }
    }

    // 네고 적용 후 저장 시 negoHistory에 자동 이력 추가
    let finalNegoHistory = (form as any).negoHistory || [];
    if (negoApplied && negoRequestedPrice > 0) {
      const negoReqKrwForHistory = (() => {
        if (negoCurrency === 'KRW') return negoRequestedPrice;
        if (negoCurrency === 'USD') return Math.round(negoRequestedPrice * usdKrwDisplay);
        return Math.round(negoRequestedPrice * cnyKrw);
      })();
      const savedPerPcsForHistory = originalFactoryPriceKrw > 0 ? originalFactoryPriceKrw - negoReqKrwForHistory : 0;
      const savedTotalForHistory = savedPerPcsForHistory * totalQty;
      const savedRateForHistory = originalFactoryPriceKrw > 0 && savedPerPcsForHistory > 0
        ? Math.round((savedPerPcsForHistory / originalFactoryPriceKrw) * 1000) / 10
        : 0;
      // 이미 동일한 이력이 없으면 추가
      const isDuplicate = finalNegoHistory.some(
        (n: any) => n.requestedPrice === negoRequestedPrice && n.currency === negoCurrency
      );
      if (!isDuplicate) {
        finalNegoHistory = [
          ...finalNegoHistory,
          {
            requestedPrice: negoRequestedPrice,
            currency: negoCurrency,
            savedAmount: savedTotalForHistory,
            savedRate: savedRateForHistory,
            memo: negoMemo || '발주 적용 시 자동 저장',
            date: new Date().toISOString().split('T')[0],
          },
        ];
      }
    }

    if (isEditMode && editOrderId) {
      // 편집 모드: 기존 발주 업데이트
      const updates: Partial<ProductionOrder> = {
        qty: totalQty,
        colorQtys: colorQtys.length > 0 ? colorQtys : undefined,
        vendorId: form.vendorId || '',
        vendorName: form.vendorName || '',
        orderDate: form.orderDate || new Date().toISOString().split('T')[0],
        deliveryDate: form.deliveryDate,
        status: form.status || '발주생성',
        hqSupplyItems: hqItems,
        factoryUnitPriceCny: finalFactoryUnitPriceCny,
        factoryUnitPriceKrw: finalFactoryUnitPriceKrw,
        factoryCurrency,
        bomType: negoApplied ? 'manual' : (manualFactoryPrice ? 'manual' : (bomCalc.bomType ?? undefined)),
        negoHistory: finalNegoHistory,
        memo: form.memo,
        updatedAt: new Date().toISOString(),
      };
      const existingOrder = (orders as ProductionOrder[]).find(o => o.id === editOrderId);
      const fullUpdated = { ...(existingOrder || {}), ...updates, id: editOrderId } as ProductionOrder;
      upsertOrder(fullUpdated)
        .then(() => { toast.success('발주가 수정되었습니다'); refresh(); setShowModal(false); setIsEditMode(false); setEditOrderId(null); })
        .catch((e: Error) => toast.error(`저장 실패: ${e.message}`));
      return;
    }

    const order: ProductionOrder = {
      id: genId(),
      orderNo: form.orderNo || '',
      styleId: form.styleId || '',
      styleNo: form.styleNo || '',
      styleName: form.styleName || '',
      season: form.season || '26SS',
      revision: form.revision || 1,
      isReorder: (form.revision || 1) > 1,
      qty: totalQty,
      colorQtys: colorQtys.length > 0 ? colorQtys : undefined,
      vendorId: form.vendorId || '',
      vendorName: form.vendorName || '',
      orderDate: form.orderDate || new Date().toISOString().split('T')[0],
      status: form.status || '발주생성',
      bomId: form.bomId,
      hqSupplyItems: hqItems,
      attachments: [],
      factoryUnitPriceCny: finalFactoryUnitPriceCny,
      factoryUnitPriceKrw: finalFactoryUnitPriceKrw,
      factoryCurrency,
      bomType: negoApplied ? 'manual' : (manualFactoryPrice ? 'manual' : (bomCalc.bomType ?? undefined)),
      deliveryDate: form.deliveryDate,
      negoHistory: finalNegoHistory,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      memo: form.memo,
    };
    upsertOrder(order).then(() => refresh()).catch((e: Error) => toast.error(`발주 저장 실패: ${e.message}`));

    // 새 컬러 → 품목 마스터 자동 추가 (낙관적 업데이트)
    if (colorQtys.length > 0 && form.styleId) {
      const currentItem = (items as Item[]).find((i: any) => i.id === form.styleId);
      const existingColorNames = normalizeColors(currentItem?.colors || []).map(c => c.name);
      const newColors = colorQtys
        .map(cq => cq.color.trim())
        .filter(c => c && !existingColorNames.includes(c))
        .map(c => ({ name: c }));
      if (newColors.length > 0 && currentItem) {
        const updatedColors = [...normalizeColors(currentItem.colors || []), ...newColors];
        import('@/lib/supabaseQueries').then(m => m.upsertItem({ ...currentItem, colors: updatedColors } as any)).catch(() => {});
        queryClient.setQueryData(['items'], (old: any[] = []) =>
          old.map((it: any) => it.id === form.styleId ? { ...it, colors: updatedColors } : it)
        );
      }
    }

    refresh();
    setShowModal(false);

    // 발주 완료 후 액션 팝업: BOM 자재 목록 계산
    const bomMaterials: Array<any> = [];
    if (form.styleNo) {
      const { bom } = getBomForOrderFromList(boms as Bom[], form.styleNo);
      if (bom) {
        // postColorBoms 우선 → 선택된 컬러만 → postMaterials → lines 순서로 확인
        const postColorBoms = (bom as any).postColorBoms || [];
        // 선택된 컬러 목록 - 저장된 order의 colorQtys 사용 (폼 초기화 후에도 유지)
        const orderColorQtys = order.colorQtys || [];
        const selectedColors = orderColorQtys.filter(cq => cq.qty > 0).map(cq => cq.color.trim());
        let allLines: any[] = [];
        if (postColorBoms.length > 0) {
          if (selectedColors.length > 0) {
            // 선택된 컬러에 해당하는 BOM lines만 가져옴
            allLines = postColorBoms
              .filter((cb: any) => selectedColors.includes(cb.color?.trim()))
              .flatMap((cb: any) => cb.lines || []);
            // 선택된 컬러 BOM 없으면 첫 번째 컬러로 폴백
            if (allLines.length === 0) {
              allLines = (postColorBoms[0]?.lines || []);
            }
          } else {
            allLines = postColorBoms[0]?.lines || [];
          }
        } else if (bom.postMaterials && bom.postMaterials.length > 0) {
          allLines = bom.postMaterials;
        } else {
          allLines = bom.lines || [];
        }
        // 중복 제거 (같은 itemName)
        const seen = new Set<string>();
        for (const l of allLines) {
          if (l.isHqProvided && !seen.has(l.itemName)) {
            seen.add(l.itemName);
            bomMaterials.push({
              itemName: l.itemName,
              spec: l.spec,
              unit: l.unit,
              netQty: l.netQty,
              lossRate: l.lossRate,
              vendorName: l.vendorName,
              isHqProvided: true,
              imageUrl: l.imageUrl,
            });
          }
        }
      }
    }

    setPostOrderInfo({ order, bomMaterials });
    setPostOrderModal(true);

    if (newColorCount > 0) {
      toast.success(`발주 등록 완료 · 새 컬러 ${newColorCount}개가 품목 마스터에 추가됨`);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm('발주를 삭제하시겠습니까?')) return;
    deleteOrderSB(id)
      .then(() => { refresh(); toast.success('삭제되었습니다'); })
      .catch((e: Error) => toast.error(`삭제 실패: ${e.message}`));
  };

  const handleStatusChange = (id: string, status: OrderStatus) => {
    if (status === '입고완료') {
      const order = orders.find(o => o.id === id);
      setReceiveOrderId(id);
      setReceiveForm({
        receivedQty: order?.qty || 0,
        defectQty: 0,
        defectNote: '',
        receivedDate: new Date().toISOString().split('T')[0],
      });
      setShowReceiveModal(true);
      return;
    }
    const existing = (orders as ProductionOrder[]).find(o => o.id === id);
    if (existing) {
      upsertOrder({ ...existing, status, updatedAt: new Date().toISOString() }).then(() => refresh()).catch(() => {});
    }
  };

  const handleReceiveConfirm = () => {
    const existing = (orders as ProductionOrder[]).find(o => o.id === receiveOrderId);
    if (existing) {
      upsertOrder({
        ...existing,
        status: '입고완료',
        receivedQty: receiveForm.receivedQty,
        defectQty: receiveForm.defectQty,
        defectNote: receiveForm.defectNote,
        receivedDate: receiveForm.receivedDate,
        updatedAt: new Date().toISOString(),
      }).then(() => { setShowReceiveModal(false); refresh(); toast.success('입고 처리 완료'); })
        .catch((e: Error) => toast.error(`처리 실패: ${e.message}`));
    }
  };

  const openBillingModal = (order: ProductionOrder) => {
    setBillingTarget(order);
    setBillingMode('new');
    setLinkStatementId('');
    setBillingModal(true);
  };

  const handleConfirmBilling = () => {
    if (!billingTarget) return;
    const order = billingTarget;
    const item = items.find(i => i.id === order.styleId);
    if (!item) { toast.error('품목 정보를 찾을 수 없습니다'); return; }

    const buyer = buyers.find(b => b.id === item.buyerId);
    if (!buyer) { toast.error('바이어 정보가 없습니다. 품목의 바이어를 먼저 설정해주세요'); return; }

    const today = new Date().toISOString().split('T')[0];
    const colorQtyList = order.colorQtys && order.colorQtys.length > 0 ? order.colorQtys : [{ color: '기본', qty: order.qty }];
    const unitPrice = item.deliveryPrice || item.targetSalePrice || order.factoryUnitPriceKrw || 0;

    if (billingMode === 'new') {
      const vendorCode = buyer.vendorCode || buyer.code || 'XXX';
      const statementNo = store.getNextStatementNo(vendorCode);

      const lines: TradeStatementLine[] = colorQtyList.map(cq => ({
        id: genId(),
        description: `[${order.styleNo}] ${order.styleName}${cq.color !== '기본' ? ` (${cq.color})` : ''}`,
        qty: cq.qty,
        unitPrice,
        taxType: '과세' as const,
        taxRate: 0.1,
        memo: `발주번호 ${order.orderNo}`,
      }));

      const newStatement: TradeStatement = {
        id: genId(),
        statementNo,
        vendorId: buyer.id,
        vendorName: buyer.name,
        vendorCode,
        issueDate: today,
        lines,
        status: '미청구',
        createdAt: new Date().toISOString(),
        memo: `발주번호 ${order.orderNo}에서 자동 생성`,
      };

      store.addTradeStatement(newStatement); // 거래명세표 store에 유지
      const existingOrder1 = (orders as ProductionOrder[]).find(o => o.id === order.id);
      if (existingOrder1) {
        upsertOrder({ ...existingOrder1, tradeStatementId: newStatement.id, updatedAt: new Date().toISOString() })
          .then(() => refresh()).catch(() => {});
      }
      setBillingModal(false);
      toast.success(`거래명세표 ${statementNo} 생성 완료 → 거래명세표 탭에서 확인하세요`);
    } else {
      if (!linkStatementId) { toast.error('연결할 전표를 선택해주세요'); return; }
      const stmt = store.getTradeStatements().find(t => t.id === linkStatementId);
      if (!stmt) { toast.error('선택한 전표를 찾을 수 없습니다'); return; }

      const newLines: TradeStatementLine[] = colorQtyList.map(cq => ({
        id: genId(),
        description: `[${order.styleNo}] ${order.styleName}${cq.color !== '기본' ? ` (${cq.color})` : ''}`,
        qty: cq.qty,
        unitPrice,
        taxType: '과세' as const,
        taxRate: 0.1,
        memo: `발주번호 ${order.orderNo}`,
      }));

      store.updateTradeStatement(linkStatementId, { lines: [...(stmt.lines || []), ...newLines] });
      const existingOrder2 = (orders as ProductionOrder[]).find(o => o.id === order.id);
      if (existingOrder2) {
        upsertOrder({ ...existingOrder2, tradeStatementId: linkStatementId, updatedAt: new Date().toISOString() })
          .then(() => refresh()).catch(() => {});
      }
      setBillingModal(false);
      toast.success(`${stmt.statementNo}에 발주 항목이 추가됐습니다`);
    }
  };

  const openWorkOrderModal = (order: ProductionOrder, withBom = false) => {
    setWorkOrderTarget(order);
    setWorkOrderNote('');
    setWorkOrderWithBom(withBom);
    // 본사제공 자재 수령 체크란 초기화
    const { bom } = getBomForOrderFromList(boms as Bom[], order.styleNo);
    const bomLines = bom ? ((bom.postMaterials && bom.postMaterials.length > 0) ? bom.postMaterials : (bom.lines || [])) : [];
    const hqMats = bomLines.filter((l: any) => l.isHqProvided);
    setHqReceive(hqMats.map(() => ({ received: '', checked: false })));
    setWorkOrderModal(true);
  };

  const handlePrintWorkOrder = () => {
    window.print();
  };

  const [showFactoryView, setShowFactoryView] = useState(false);

  const stats = useMemo(() => ({
    total: orders.length,
    inProgress: orders.filter(o => ['샘플승인', '생산중'].includes(o.status)).length,
    reorders: orders.filter(o => o.isReorder).length,
    urgent: orders.filter(o => o.deliveryDate && calcDDay(o.deliveryDate) <= 7 && o.status !== '입고완료').length,
  }), [orders]);

  const factoryStats = useMemo(() => {
    const map = new Map<string, { name: string; total: number; inProgress: number; totalQty: number; totalAmountKrw: number }>();
    orders.forEach(o => {
      const key = o.vendorName || '미지정';
      const cur = map.get(key) || { name: key, total: 0, inProgress: 0, totalQty: 0, totalAmountKrw: 0 };
      cur.total++;
      cur.totalQty += o.qty;
      cur.totalAmountKrw += (o.factoryUnitPriceKrw || 0) * o.qty;
      if (!['입고완료'].includes(o.status)) cur.inProgress++;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [orders]);

  // 공장 목록: BOM 제조국이 중국이면 해외공장 우선
  const sortedFactories = useMemo(() => {
    if (bomCalc.manufacturingCountry === '중국') {
      return [
        ...factories.filter(f => f.type === '해외공장'),
        ...factories.filter(f => f.type === '공장'),
      ];
    }
    return factories;
  }, [factories, bomCalc.manufacturingCountry]);

  // 현재 발주 수량 (컬러별 합계 또는 직접 입력)
  const currentQty = colorQtys.length > 0
    ? colorQtys.reduce((s, c) => s + c.qty, 0)
    : (form.qty || 0);

  // 공장단가 (수동/BOM)
  const displayFactoryPriceCny = manualFactoryPrice ? manualPriceCny : bomCalc.factoryUnitPriceCny;
  const _appSettings = store.getSettings();
  const cnyKrwDisplay = _appSettings.cnyKrw || 191;
  const usdKrwDisplay = _appSettings.usdKrw || 1380;
  let displayFactoryPriceKrw: number;
  if (factoryCurrency === 'KRW') {
    displayFactoryPriceKrw = Math.round(displayFactoryPriceCny);
  } else if (factoryCurrency === 'USD') {
    displayFactoryPriceKrw = Math.round(displayFactoryPriceCny * usdKrwDisplay);
  } else {
    displayFactoryPriceKrw = Math.round(displayFactoryPriceCny * cnyKrwDisplay);
  }
  const displayTotalAmountKrw = displayFactoryPriceKrw * currentQty;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-stone-800">생산 발주</h1>
          <p className="text-xs md:text-sm text-stone-500 mt-0.5 hidden sm:block">BOM 자동 연동 · 공장/자재 발주 분리 · 소요량 자동 계산</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFactoryView(v => !v)}
            className={`hidden sm:block px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${showFactoryView ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}
          >
            공장별 현황
          </button>
          {/* 자재 장바구니 버튼 */}
          <button
            onClick={() => { refreshCart(); setCartModal(true); }}
            className="relative px-3 py-2 rounded-lg border border-blue-300 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors flex items-center gap-1.5"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            자재 장바구니
            {cartItems.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                {cartItems.length}
              </span>
            )}
          </button>
          <Button onClick={() => openNew()} className="bg-amber-700 hover:bg-amber-800 text-white gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-10 px-2 md:px-4">
            <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />발주 등록
          </Button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: '전체 발주', value: stats.total, color: 'text-stone-800' },
          { label: '진행중', value: stats.inProgress, color: 'text-amber-700' },
          { label: '리오더', value: stats.reorders, color: 'text-blue-700' },
          { label: '긴급 (D-7 이내)', value: stats.urgent, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-stone-200 p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-stone-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 공장별 발주 현황 */}
      {showFactoryView && (
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-sm font-semibold text-stone-700 mb-3">공장별 발주 현황</p>
          {factoryStats.length === 0 ? (
            <p className="text-xs text-stone-400 text-center py-4">등록된 발주가 없습니다</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50">
                  <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">공장명</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">전체 발주</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">진행중</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">총 수량</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">총 발주금액</th>
                </tr>
              </thead>
              <tbody>
                {factoryStats.map(f => (
                  <tr key={f.name} className="border-b border-stone-50">
                    <td className="px-3 py-2 font-medium text-stone-700">{f.name}</td>
                    <td className="px-3 py-2 text-center text-stone-600">{f.total}건</td>
                    <td className="px-3 py-2 text-center">
                      <span className={f.inProgress > 0 ? 'text-amber-700 font-medium' : 'text-stone-400'}>{f.inProgress}건</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-stone-700">{f.totalQty.toLocaleString()} PCS</td>
                    <td className="px-3 py-2 text-right font-mono text-stone-700">
                      {f.totalAmountKrw > 0 ? formatKRW(f.totalAmountKrw) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 검색/필터 */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="발주번호 / 스타일 검색" className="pl-9 h-9" />
        </div>
        <Select value={filterSeason} onValueChange={setFilterSeason}>
          <SelectTrigger className="w-28 h-9"><SelectValue placeholder="시즌" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 시즌</SelectItem>
            {SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterBuyer} onValueChange={setFilterBuyer}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="바이어" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 바이어</SelectItem>
            {buyers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* 테이블 (데스크탑) */}
      <div className="hidden md:block bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">발주번호</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">스타일</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">시즌</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">공장 / 공장단가</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">총 발주금액</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">발주일</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">납기일</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">상태</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-stone-400">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 발주가 없습니다</p>
              </td></tr>
            ) : filtered.map(o => {
              const totalAmtKrw = (o.factoryUnitPriceKrw || 0) * o.qty;
              // BOM 실제 존재 여부 확인 (items.hasBom 또는 BOM 레코드 존재)
              const itemForOrder = items.find(i => i.styleNo === o.styleNo || i.id === o.styleId);
              const hasBom = !!o.bomId || o.bomType === 'post' || o.bomType === 'pre' || !!(itemForOrder as any)?.hasBom;
              return (
                <tr key={o.id} className="border-b border-stone-50 hover:bg-stone-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-stone-800">{o.orderNo}</span>
                      {o.isReorder && <Badge variant="outline" className="text-[10px] h-4 text-blue-600 border-blue-200">리오더</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-stone-700">{o.styleNo}</p>
                    <p className="text-xs text-stone-400">{o.styleName}</p>
                    {!hasBom && o.bomType !== 'manual' && (
                      <span className="text-[10px] text-amber-600 flex items-center gap-0.5 mt-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" />BOM 미등록
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{o.season}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <p className="font-mono text-stone-700">{formatNumber(o.qty)}</p>
                    {(o.colorQtys || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-end mt-1">
                        {(o.colorQtys || []).map((cq, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 bg-stone-100 text-stone-600 rounded">
                            {cq.color} {cq.qty}
                          </span>
                        ))}
                      </div>
                    )}
                    {o.receivedQty !== undefined && (
                      <p className="text-[10px] text-green-600 mt-0.5">입고 {formatNumber(o.receivedQty)}{o.defectQty ? ` / 불량 ${o.defectQty}` : ''}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-stone-700 font-medium">{o.vendorName}</p>
                    {o.factoryUnitPriceKrw && o.factoryUnitPriceKrw > 0 ? (
                      <p className="text-xs text-stone-500 font-mono">{formatKRW(o.factoryUnitPriceKrw)}/PCS
                        {o.bomType === 'manual' && <span className="text-amber-600 ml-1">(수동)</span>}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600">{hasBom ? "공장단가 재계산 필요" : "공장단가 수동 입력 필요"}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {totalAmtKrw > 0
                      ? <span className="font-mono text-stone-800 font-medium">{formatKRW(totalAmtKrw)}</span>
                      : <span className="text-stone-300">-</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {o.orderDate ? (
                      <span className="font-mono text-stone-600">{o.orderDate}</span>
                    ) : <span className="text-stone-300">-</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {o.deliveryDate ? (
                      <div>
                        <span className={`font-mono ${calcDDay(o.deliveryDate) < 0 ? 'text-red-600 font-bold' : calcDDay(o.deliveryDate) <= 14 ? 'text-amber-600' : 'text-stone-600'}`}>
                          {o.deliveryDate}
                        </span>
                        <span className={`ml-1 text-[10px] px-1 py-0.5 rounded font-mono ${dDayColor(calcDDay(o.deliveryDate))}`}>{dDayLabel(calcDDay(o.deliveryDate))}</span>
                      </div>
                    ) : <span className="text-stone-300">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Select value={o.status} onValueChange={v => handleStatusChange(o.id, v as OrderStatus)}>
                      <SelectTrigger className={`h-7 text-xs w-28 border ${STATUS_COLOR[o.status]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      {o.tradeStatementId ? (
                        <Badge variant="outline" className="text-[10px] h-6 px-2 text-amber-700 border-amber-300 bg-amber-50 cursor-pointer" title={`연결된 전표: ${store.getTradeStatements().find(t => t.id === o.tradeStatementId)?.statementNo || ''}`}>
                          <FileText className="w-3 h-3 mr-1" />명세표 발행됨
                        </Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
                          onClick={() => openBillingModal(o)}
                        >
                          <FileText className="w-3 h-3 mr-1" />명세표 발행
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs text-stone-600 border-stone-300 hover:bg-stone-50"
                        onClick={() => openWorkOrderModal(o)}
                        title="작업지시서 출력"
                      >
                        <Package className="w-3 h-3 mr-1" />작업지시서
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowDetail(o)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-500 hover:text-blue-600" onClick={() => openEdit(o)} title="발주 수정">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(o.id)}>
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
            <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">등록된 발주가 없습니다</p>
          </div>
        ) : filtered.map(o => {
          const totalAmtKrw = (o.factoryUnitPriceKrw || 0) * o.qty;
          return (
            <div key={o.id} className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-stone-800 text-sm">{o.orderNo}</span>
                    {o.isReorder && <Badge variant="outline" className="text-[10px] h-4 text-blue-600 border-blue-200">리오더</Badge>}
                  </div>
                  <p className="font-medium text-stone-700 text-sm mt-0.5">{o.styleNo}</p>
                  <p className="text-xs text-stone-400">{o.styleName}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${STATUS_COLOR[o.status]}`}>{o.status}</span>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-stone-600">
                <span>🏭 {o.vendorName || '-'}</span>
                <span>📦 {formatNumber(o.qty)} PCS</span>
                {o.factoryUnitPriceKrw && o.factoryUnitPriceKrw > 0 && (
                  <span className="font-mono">단가 {formatKRW(o.factoryUnitPriceKrw)}</span>
                )}
                {o.deliveryDate && (
                  <span className={`font-mono font-semibold ${calcDDay(o.deliveryDate) < 0 ? 'text-red-600' : calcDDay(o.deliveryDate) <= 14 ? 'text-amber-600' : 'text-stone-600'}`}>
                    {o.deliveryDate}
                  </span>
                )}
              </div>
              {totalAmtKrw > 0 && (
                <p className="text-xs text-stone-700 font-mono mt-1">총 발주금액: <span className="font-bold">{formatKRW(totalAmtKrw)}</span></p>
              )}
              <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-stone-100">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setShowDetail(o)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-stone-500 hover:text-blue-600" onClick={() => openEdit(o)} title="발주 수정">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(o.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── 발주 등록 모달 (BOM 연동) ─── */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-3xl sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isEditMode ? '발주 수정' : '발주 등록 — BOM 연동'}</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">

            {/* Step 1: 스타일 선택 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-amber-700 text-white text-xs flex items-center justify-center font-bold">1</span>
                <Label className="text-sm font-semibold">스타일 선택</Label>
              </div>
              <Select value={form.styleId || ''} onValueChange={handleStyleSelect} disabled={isEditMode}>
                <SelectTrigger className={isEditMode ? 'bg-stone-50 text-stone-500' : ''}><SelectValue placeholder="품목 마스터에서 선택" /></SelectTrigger>
                <SelectContent>
                  {items.map(i => <SelectItem key={i.id} value={i.id}>{i.styleNo} — {i.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {isEditMode && <p className="text-xs text-stone-400">※ 수정 모드에서는 스타일 변경 불가 (납기일, 수량, 공장단가, 메모 수정 가능)</p>}
              {form.orderNo && (
                <div className={`p-3 rounded-lg border ${bomCalc.hasBomWarning ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-stone-700">
                      발주번호: <span className="font-mono font-bold">{form.orderNo}</span>
                      {(form.revision || 1) > 1 && <span className="ml-2 text-blue-600">(리오더 #{form.revision})</span>}
                    </p>
                    {bomCalc.bomLoaded && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bomCalc.bomType === 'post' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {bomCalc.bomType === 'post' ? '✅ 사후원가 BOM' : '📋 사전원가 BOM'}
                      </span>
                    )}
                    {bomCalc.hasBomWarning && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />BOM 미등록
                      </span>
                    )}
                  </div>
                  {bomCalc.hasBomWarning && (
                    <p className="text-xs text-amber-700 mt-1">⚠️ BOM 미등록 — 공장단가 수동 입력 필요</p>
                  )}
                  {bomCalc.manufacturingCountry && (
                    <p className="text-xs text-stone-500 mt-1">🌍 제조국: {bomCalc.manufacturingCountry}
                      {bomCalc.manufacturingCountry === '중국' && <span className="text-blue-600 ml-1">(해외공장 목록 우선 표시)</span>}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: 발주 수량 + 시즌 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-amber-700 text-white text-xs flex items-center justify-center font-bold">2</span>
                <Label className="text-sm font-semibold">발주 수량 입력</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>수량 (PCS)</Label>
                  <Input
                    type="number"
                    value={colorQtys.length > 0 ? colorQtys.reduce((s, c) => s + c.qty, 0) : (form.qty || '')}
                    onChange={e => { if (colorQtys.length === 0) handleQtyChange(parseInt(e.target.value) || 0); }}
                    placeholder="0"
                    readOnly={colorQtys.length > 0}
                    className={colorQtys.length > 0 ? 'bg-stone-50 text-stone-500' : ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>시즌</Label>
                  <Select value={form.season || '26SS'} onValueChange={v => setForm(f => ({ ...f, season: v as Season }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {/* 컬러별 수량 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-stone-500">컬러별 수량 (선택)</Label>
                  <div className="relative">
                    <Button
                      type="button" variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => {
                        setShowColorDropdown(v => !v);
                        setShowCustomColorInput(false);
                        setCustomColorInput('');
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" />컬러 추가
                    </Button>
                    {showColorDropdown && (() => {
                      const selectedItem = items.find(i => i.id === form.styleId);
                      const registeredColors = normalizeColors(selectedItem?.colors || []).map(c => c.name);
                      const usedColors = colorQtys.map(c => c.color);
                      const availableColors = registeredColors.filter(c => !usedColors.includes(c));
                      return (
                        <div className="absolute right-0 top-8 z-50 w-48 bg-white border border-stone-200 rounded-lg shadow-lg py-1">
                          {availableColors.length === 0 && !showCustomColorInput && (
                            <p className="text-xs text-stone-400 px-3 py-2">등록된 컬러 없음</p>
                          )}
                          {availableColors.map(color => (
                            <button
                              key={color}
                              type="button"
                              className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-blue-50 flex items-center gap-2"
                              onClick={() => {
                                setColorQtys(prev => [...prev, { color, qty: 0 }]);
                                setShowColorDropdown(false);
                              }}
                            >
                              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">{color}</span>
                            </button>
                          ))}
                          {availableColors.length > 0 && <div className="border-t border-stone-100 my-1" />}
                          {!showCustomColorInput ? (
                            <button
                              type="button"
                              className="w-full text-left px-3 py-1.5 text-xs text-green-700 hover:bg-green-50 font-medium"
                              onClick={() => setShowCustomColorInput(true)}
                            >
                              ✏️ 직접 입력 (새 컬러)
                            </button>
                          ) : (
                            <div className="px-2 py-1.5 space-y-1">
                              <Input
                                autoFocus
                                className="h-7 text-xs"
                                placeholder="컬러명 입력"
                                value={customColorInput}
                                onChange={e => setCustomColorInput(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && customColorInput.trim()) {
                                    setColorQtys(prev => [...prev, { color: customColorInput.trim(), qty: 0 }]);
                                    setCustomColorInput('');
                                    setShowCustomColorInput(false);
                                    setShowColorDropdown(false);
                                  }
                                  if (e.key === 'Escape') {
                                    setShowCustomColorInput(false);
                                    setCustomColorInput('');
                                  }
                                }}
                              />
                              <Button
                                type="button" size="sm"
                                className="w-full h-6 text-[10px] bg-green-600 hover:bg-green-700 text-white"
                                onClick={() => {
                                  if (customColorInput.trim()) {
                                    setColorQtys(prev => [...prev, { color: customColorInput.trim(), qty: 0 }]);
                                    setCustomColorInput('');
                                    setShowCustomColorInput(false);
                                    setShowColorDropdown(false);
                                  }
                                }}
                              >추가</Button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                {colorQtys.length > 0 && (() => {
                  const selectedItem = items.find(i => i.id === form.styleId);
                  const registeredColors = normalizeColors(selectedItem?.colors || []).map(c => c.name);
                  return (
                    <div className="space-y-1.5">
                      {colorQtys.map((cq, idx) => {
                        const isNew = !registeredColors.includes(cq.color);
                        // 품목 마스터에서 컬러 상세 정보 조회
                        const masterItem2 = items.find(i => i.styleNo === form.styleNo || i.id === form.styleId);
                        const masterColors2 = normalizeColors(masterItem2?.colors || []);
                        const masterColor2 = masterColors2.find(c => c.name === cq.color);
                        return (
                          <div key={idx} className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                            <div className="flex-1 flex items-center gap-1.5">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${isNew ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                {cq.color || '?'}
                              </span>
                              <Input
                                className="flex-1 h-8 text-sm"
                                placeholder="컬러명"
                                value={cq.color}
                                onChange={e => setColorQtys(prev => prev.map((c, i) => i === idx ? { ...c, color: e.target.value } : c))}
                              />
                              {isNew && cq.color && (
                                <span className="text-[10px] text-green-600 shrink-0 whitespace-nowrap">(신규 — 자동 추가됨)</span>
                              )}
                            </div>
                            <Input
                              type="number" min={0}
                              className="w-24 h-8 text-sm text-center"
                              placeholder="수량"
                              value={cq.qty || ''}
                              onChange={e => {
                                const updated = colorQtys.map((c, i) => i === idx ? { ...c, qty: parseInt(e.target.value) || 0 } : c);
                                setColorQtys(updated);
                                const newTotal = updated.reduce((s, c) => s + c.qty, 0);
                                if (form.styleNo && newTotal > 0) recalcBom(form.styleNo, newTotal);
                              }}
                            />
                            <Button
                              type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-400 hover:text-red-600"
                              onClick={() => setColorQtys(prev => prev.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                          {/* 컬러 상세정보 (품목 마스터 연동) */}
                          {masterColor2 && (masterColor2.leatherColor || masterColor2.decorColor || masterColor2.threadColor || masterColor2.girimaeColor) && (
                            <div className="ml-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-stone-500 bg-stone-50 rounded px-2 py-1">
                              {masterColor2.leatherColor && <span>🪶 가죽: <span className="text-stone-700 font-medium">{masterColor2.leatherColor}</span></span>}
                              {masterColor2.decorColor && <span>✨ 장식: <span className="text-stone-700 font-medium">{masterColor2.decorColor}</span></span>}
                              {masterColor2.threadColor && <span>🧵 실: <span className="text-stone-700 font-medium">{masterColor2.threadColor}</span></span>}
                              {masterColor2.girimaeColor && <span>🎀 기리매: <span className="text-stone-700 font-medium">{masterColor2.girimaeColor}</span></span>}
                            </div>
                          )}
                          </div>
                        );
                      })}
                      {colorQtys.some(cq => !registeredColors.includes(cq.color) && cq.color) && (
                        <p className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded px-2 py-1">
                          💡 초록색 배지 컬러는 품목 마스터에 없는 새 컬러입니다. 발주 저장 시 자동으로 추가됩니다.
                        </p>
                      )}
                      <p className="text-xs text-stone-500 text-right">
                        합계: <span className="font-mono font-bold">{colorQtys.reduce((s, c) => s + c.qty, 0).toLocaleString()} PCS</span>
                      </p>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* BOM 자동 계산 결과 패널 */}
            {form.styleId && currentQty > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-amber-700 text-white text-xs flex items-center justify-center font-bold">3</span>
                  <Label className="text-sm font-semibold">자동 계산 결과</Label>
                </div>

                {/* ── 공장 발주 섹션 ── */}
                <div className="rounded-lg border border-stone-200 overflow-hidden">
                  <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2">
                    <Factory className="w-4 h-4 text-amber-700" />
                    <span className="text-sm font-semibold text-amber-800">공장 발주</span>
                    <span className="text-xs text-amber-600">(임가공비 + 본사미제공 자재)</span>
                  </div>
                  <div className="p-4 space-y-3">
                    {/* 공장 선택 */}
                    <div className="space-y-1.5">
                      <Label>발주처 (공장) *</Label>
                      <Select value={form.vendorId || ''} onValueChange={v => {
                        const vendor = allVendors.find(x => x.id === v);
                        if (vendor?.leadTimeDays && vendor.leadTimeDays > 0 && !form.deliveryDate) {
                          const suggestedDate = new Date();
                          suggestedDate.setDate(suggestedDate.getDate() + vendor.leadTimeDays);
                          const dateStr = suggestedDate.toISOString().split('T')[0];
                          setForm(f => ({ ...f, vendorId: v, vendorName: vendor?.name || '', deliveryDate: dateStr }));
                          toast.info(`📅 예상 납기일 자동 설정: ${dateStr} (리드타임 ${vendor.leadTimeDays}일)`);
                          return;
                        }
                        setForm(f => ({ ...f, vendorId: v, vendorName: vendor?.name || '' }));
                      }}>
                        <SelectTrigger><SelectValue placeholder="공장 선택" /></SelectTrigger>
                        <SelectContent>
                          {bomCalc.manufacturingCountry === '중국' && (
                            <>
                              <div className="px-2 py-1 text-[10px] text-stone-400 font-medium">해외공장 (중국 제조국)</div>
                              {sortedFactories.filter(f => f.type === '해외공장').map(v => (
                                <SelectItem key={v.id} value={v.id}>
                                  🌏 {v.name}{v.leadTimeDays ? <span className="text-stone-400 ml-1">({v.leadTimeDays}일)</span> : null}
                                </SelectItem>
                              ))}
                              <div className="px-2 py-1 text-[10px] text-stone-400 font-medium">국내 공장</div>
                            </>
                          )}
                          {sortedFactories
                            .filter(f => bomCalc.manufacturingCountry === '중국' ? f.type === '공장' : true)
                            .map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.name}{v.leadTimeDays ? <span className="text-stone-400 ml-1">({v.leadTimeDays}일)</span> : null}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* 공장단가 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Label>공장단가 ({factoryCurrency}/PCS)</Label>
                            <Select value={factoryCurrency} onValueChange={(v) => setFactoryCurrency(v as 'CNY' | 'USD' | 'KRW')}>
                              <SelectTrigger className="h-5 w-16 text-[10px] px-1.5 border-stone-300">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="CNY">CNY</SelectItem>
                                <SelectItem value="USD">USD</SelectItem>
                                <SelectItem value="KRW">KRW</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setManualFactoryPrice(!manualFactoryPrice);
                              if (!manualFactoryPrice) setManualPriceCny(bomCalc.factoryUnitPriceCny);
                            }}
                            className="text-[10px] text-blue-600 underline"
                          >
                            {manualFactoryPrice ? 'BOM 자동' : '수동 입력'}
                          </button>
                        </div>
                        {manualFactoryPrice ? (
                          <Input
                            type="number"
                            value={manualPriceCny || ''}
                            onChange={e => setManualPriceCny(parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            step="0.01"
                          />
                        ) : (
                          <div className={`h-9 px-3 py-2 border rounded-md text-sm font-mono flex items-center ${bomCalc.bomLoaded ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                            {bomCalc.bomLoaded
                              ? factoryCurrency === 'CNY'
                                ? `¥${bomCalc.factoryUnitPriceCny.toFixed(2)}`
                                : factoryCurrency === 'USD'
                                ? `$${bomCalc.factoryUnitPriceCny.toFixed(2)}`
                                : `₩${Math.round(bomCalc.factoryUnitPriceCny).toLocaleString()}`
                              : '—'}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <Label>공장단가 (KRW 환산)</Label>
                          {negoApplied && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 border border-green-300 rounded-full font-medium">네고 적용</span>
                          )}
                        </div>
                        <div className={`h-9 px-3 py-2 border rounded-md text-sm font-mono flex items-center ${negoApplied ? 'bg-green-50 border-green-300 text-green-800 font-bold' : 'bg-stone-50 border-stone-200 text-stone-600'}`}>
                          {displayFactoryPriceKrw > 0 ? formatKRW(displayFactoryPriceKrw) : '—'}
                        </div>
                        {negoApplied && originalFactoryPriceKrw > 0 && (
                          <p className="text-[10px] text-green-600 font-medium">
                            원래 단가: {formatKRW(originalFactoryPriceKrw)} → 네고 단가: {formatKRW(displayFactoryPriceKrw)}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* 총 발주금액 */}
                    {displayTotalAmountKrw > 0 && (
                      <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-amber-800">총 공장 발주금액</span>
                          <span className="text-lg font-bold text-amber-900 font-mono">{formatKRW(displayTotalAmountKrw)}</span>
                        </div>
                        <p className="text-xs text-amber-600 mt-0.5">{formatKRW(displayFactoryPriceKrw)} × {currentQty.toLocaleString()} PCS</p>
                      </div>
                    )}
                    {bomCalc.hasBomWarning && (
                      <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-amber-800">BOM 미등록 — 공장단가 수동 입력 필요</p>
                          <p className="text-xs text-amber-600 mt-0.5">위 "수동 입력" 버튼으로 공장단가를 직접 입력해주세요.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── 리오더 네고 패널 ── */}
                {(() => {
                  // 이전 발주 이력에서 같은 스타일의 최저 공장단가(KRW) 계산
                  const prevOrders = orders.filter(o => o.styleNo === form.styleNo && o.id !== form.id);
                  const prevPrices = prevOrders
                    .map(o => o.factoryUnitPriceKrw)
                    .filter((p): p is number => !!p && p > 0);
                  const prevLowestKrw = prevPrices.length > 0 ? Math.min(...prevPrices) : null;

                  // 현재 공장 제시단가 KRW
                  const currentPriceKrw = displayFactoryPriceKrw;

                  // 공장 제시단가를 원본 통화 기준으로 역산
                  const currentPriceInFactoryCurrency = (() => {
                    if (factoryCurrency === 'KRW') return currentPriceKrw;
                    if (factoryCurrency === 'USD') return usdKrwDisplay > 0 ? currentPriceKrw / usdKrwDisplay : 0;
                    return cnyKrwDisplay > 0 ? currentPriceKrw / cnyKrwDisplay : 0;
                  })();

                  // 공장 제시단가 통화별 환산
                  const factoryPriceUsd = usdKrwDisplay > 0 ? currentPriceKrw / usdKrwDisplay : 0;
                  const factoryPriceCny = cnyKrwDisplay > 0 ? currentPriceKrw / cnyKrwDisplay : 0;
                  const factoryPriceKrw = currentPriceKrw;

                  // 네고 최종단가 → KRW 환산
                  const negoReqKrw = (() => {
                    if (!negoRequestedPrice || negoRequestedPrice <= 0) return 0;
                    if (negoCurrency === 'KRW') return negoRequestedPrice;
                    if (negoCurrency === 'USD') return Math.round(negoRequestedPrice * usdKrwDisplay);
                    return Math.round(negoRequestedPrice * cnyKrwDisplay);
                  })();

                  // 네고 최종단가 통화별 환산
                  const negoPriceUsd = negoReqKrw > 0 && usdKrwDisplay > 0 ? negoReqKrw / usdKrwDisplay : 0;
                  const negoPriceCny = negoReqKrw > 0 && cnyKrwDisplay > 0 ? negoReqKrw / cnyKrwDisplay : 0;

                  const savedPerPcs = currentPriceKrw > 0 && negoReqKrw > 0 ? currentPriceKrw - negoReqKrw : 0;
                  const savedTotal = savedPerPcs * currentQty;
                  const savedRate = currentPriceKrw > 0 && savedPerPcs > 0
                    ? Math.round((savedPerPcs / currentPriceKrw) * 1000) / 10
                    : 0;
                  const isBelowPrevLowest = prevLowestKrw !== null && negoReqKrw > 0 && negoReqKrw < prevLowestKrw;

                  const handleApplyNegoToOrder = () => {
                    if (!negoRequestedPrice || negoRequestedPrice <= 0) {
                      toast.error('네고 후 최종단가를 먼저 입력해주세요');
                      return;
                    }
                    // 원래 공장단가 기록
                    if (!negoApplied) {
                      setOriginalFactoryPriceKrw(currentPriceKrw);
                    }
                    // factoryUnitPrice를 네고 단가의 KRW 환산값으로 업데이트
                    setForm(f => ({
                      ...f,
                      factoryUnitPriceKrw: negoReqKrw,
                      factoryUnitPriceCny: negoCurrency === 'CNY' ? negoRequestedPrice : (negoCurrency === 'USD' ? negoRequestedPrice * usdKrwDisplay / cnyKrwDisplay : negoReqKrw / cnyKrwDisplay),
                    }));
                    setFactoryCurrency(negoCurrency);
                    setManualFactoryPrice(true);
                    setManualPriceCny(negoRequestedPrice);
                    setNegoApplied(true);
                    toast.success(`✅ 네고 단가가 공장단가에 적용됐습니다 — ${formatKRW(negoReqKrw)}/PCS`);
                  };

                  const handleSaveNego = () => {
                    if (!form.styleId) { toast.error('스타일을 먼저 선택해주세요'); return; }
                    if (!negoRequestedPrice || negoRequestedPrice <= 0) { toast.error('네고 후 최종단가를 입력해주세요'); return; }
                    // 현재 폼에 임시 저장 (발주 등록 시 함께 저장됨)
                    setForm(f => ({
                      ...f,
                      negoHistory: [
                        ...((f as any).negoHistory || []),
                        {
                          requestedPrice: negoRequestedPrice,
                          currency: negoCurrency,
                          savedAmount: savedTotal,
                          savedRate,
                          memo: negoMemo,
                          date: new Date().toISOString().split('T')[0],
                        },
                      ],
                    }));
                    toast.success(`네고 내역이 저장됐습니다 — 절감 ${formatKRW(savedTotal)} (${savedRate}%)`);
                    setNegoRequestedPrice(0);
                    setNegoMemo('');
                  };

                  // 통화 심볼
                  const currencySymbol = (cur: string) => cur === 'KRW' ? '₩' : cur === 'USD' ? '$' : '¥';

                  // 가격 포맷 (소수점)
                  const fmtFx = (val: number, cur: string) => {
                    if (cur === 'KRW') return `₩${Math.round(val).toLocaleString()}`;
                    if (cur === 'USD') return `$${val.toFixed(2)}`;
                    return `¥${val.toFixed(2)}`;
                  };

                  return (
                    <div className="rounded-lg border border-emerald-200 overflow-hidden">
                      <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2 flex items-center gap-2">
                        <span className="text-sm">📊</span>
                        <span className="text-sm font-semibold text-emerald-800">리오더 네고</span>
                        <span className="text-xs text-emerald-600">단가 협상 내역 기록</span>
                      </div>
                      <div className="p-4 space-y-3">
                        {/* 공장 제시단가 / 이전 최저단가 */}
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="p-2.5 bg-stone-50 rounded border border-stone-200">
                            <p className="text-stone-500 mb-1">공장 제시단가</p>
                            {currentPriceKrw > 0 ? (
                              <div className="space-y-0.5">
                                <p className="font-mono font-semibold text-stone-800">{fmtFx(currentPriceInFactoryCurrency, factoryCurrency)}</p>
                                {factoryCurrency !== 'USD' && <p className="font-mono text-stone-500">{fmtFx(factoryPriceUsd, 'USD')}</p>}
                                {factoryCurrency !== 'CNY' && <p className="font-mono text-stone-500">{fmtFx(factoryPriceCny, 'CNY')}</p>}
                                {factoryCurrency !== 'KRW' && <p className="font-mono text-stone-500">{fmtFx(factoryPriceKrw, 'KRW')}</p>}
                              </div>
                            ) : <p className="font-mono font-semibold text-stone-400">—</p>}
                          </div>
                          <div className={`p-2.5 rounded border ${prevLowestKrw ? 'bg-blue-50 border-blue-200' : 'bg-stone-50 border-stone-200'}`}>
                            <p className="text-stone-500 mb-1">이전 최저단가</p>
                            <p className={`font-mono font-semibold ${prevLowestKrw ? 'text-blue-700' : 'text-stone-400'}`}>
                              {prevLowestKrw ? formatKRW(prevLowestKrw) : '이력 없음'}
                            </p>
                          </div>
                        </div>

                        {/* 네고 후 최종단가 입력 */}
                        <div className="space-y-1.5">
                          <Label className="text-xs">네고 후 최종단가 (PCS)</Label>
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              value={negoRequestedPrice || ''}
                              onChange={e => setNegoRequestedPrice(parseFloat(e.target.value) || 0)}
                              placeholder={`0.00 ${negoCurrency}`}
                              step="0.01"
                              className="h-9 flex-1"
                            />
                            <Select
                              value={negoCurrency}
                              onValueChange={v => setNegoCurrency(v as 'CNY' | 'USD' | 'KRW')}
                            >
                              <SelectTrigger className="h-9 w-24">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="CNY">CNY (¥)</SelectItem>
                                <SelectItem value="USD">USD ($)</SelectItem>
                                <SelectItem value="KRW">KRW (₩)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {/* 네고 최종단가 통화별 환산 표시 */}
                          {negoReqKrw > 0 && (
                            <div className="text-[11px] text-stone-500 font-mono flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                              {negoCurrency !== 'KRW' && <span>₩{Math.round(negoReqKrw).toLocaleString()} KRW</span>}
                              {negoCurrency !== 'USD' && <span>${negoPriceUsd.toFixed(2)} USD</span>}
                              {negoCurrency !== 'CNY' && <span>¥{negoPriceCny.toFixed(2)} CNY</span>}
                            </div>
                          )}
                          {isBelowPrevLowest && (
                            <p className="text-[10px] text-green-600 font-medium">
                              🎯 이전 최저단가보다 낮음 — 신규 최저가 달성!
                            </p>
                          )}
                        </div>

                        {/* 절감 계산 결과 */}
                        {savedTotal !== 0 && (
                          <div className={`p-3 rounded-lg border ${savedTotal > 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <p className="text-stone-500">절감 금액 (총)</p>
                                <p className={`font-mono font-bold text-sm ${savedTotal > 0 ? 'text-green-700' : 'text-red-600'}`}>
                                  {savedTotal > 0 ? '+' : ''}{formatKRW(savedTotal)}
                                </p>
                                <p className="text-stone-400 mt-0.5">
                                  {formatKRW(savedPerPcs)}/PCS × {currentQty.toLocaleString()} PCS
                                </p>
                              </div>
                              <div>
                                <p className="text-stone-500">절감률</p>
                                <p className={`font-mono font-bold text-sm ${savedTotal > 0 ? 'text-green-700' : 'text-red-600'}`}>
                                  {savedTotal > 0 ? '+' : ''}{savedRate}%
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* 네고 메모 */}
                        <div className="space-y-1.5">
                          <Label className="text-xs">네고 메모</Label>
                          <Input
                            value={negoMemo}
                            onChange={e => setNegoMemo(e.target.value)}
                            placeholder="예: 수량 증가로 단가 인하 요청"
                            className="h-9 text-sm"
                          />
                        </div>

                        {/* "이 단가로 발주 적용" 버튼 */}
                        {negoApplied && negoReqKrw > 0 ? (
                          <button
                            type="button"
                            className="w-full h-9 rounded-md border border-green-400 bg-green-50 text-green-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-default"
                            disabled
                          >
                            ✅ 적용됨 ({formatKRW(negoReqKrw)})
                          </button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            className={`w-full h-9 text-xs font-semibold ${negoRequestedPrice > 0 ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-stone-100 text-stone-400 cursor-not-allowed'}`}
                            disabled={!negoRequestedPrice || negoRequestedPrice <= 0}
                            onClick={handleApplyNegoToOrder}
                          >
                            이 단가로 발주 적용
                          </Button>
                        )}

                        {/* 저장 버튼 */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full h-9 text-emerald-700 border-emerald-300 hover:bg-emerald-50 text-xs font-medium"
                          onClick={handleSaveNego}
                        >
                          네고 내역만 저장 (발주 적용 제외)
                        </Button>

                        {/* 이미 저장된 네고 이력 표시 */}
                        {((form as any).negoHistory || []).length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-stone-500">저장된 네고 이력</p>
                            {((form as any).negoHistory || []).map((n: any, i: number) => (
                              <div key={i} className="text-[10px] bg-stone-50 border border-stone-200 rounded px-2 py-1.5 flex items-center justify-between">
                                <span className="text-stone-600">{n.date} — 최종 {n.requestedPrice} {n.currency}</span>
                                <span className={`font-mono font-medium ${n.savedAmount > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {n.savedAmount > 0 ? '+' : ''}{formatKRW(n.savedAmount)} ({n.savedRate}%)
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* ── 자재 발주 섹션 (본사제공) ── */}
                {(bomCalc.hqProvided.length > 0 || hqItems.length > 0) && (
                  <div className="rounded-lg border border-stone-200 overflow-hidden">
                    <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4 text-blue-700" />
                      <span className="text-sm font-semibold text-blue-800">자재 발주 (본사제공)</span>
                      <span className="text-xs text-blue-600">(각 자재거래처에 별도 발주)</span>
                    </div>
                    <div className="p-0">
                      {/* 이미지 미리보기 모달 */}
                      {materialImagePreview && (
                        <Dialog open onOpenChange={() => setMaterialImagePreview(null)}>
                          <DialogContent className="max-w-2xl p-0 overflow-hidden">
                            <div className="relative">
                              <button
                                onClick={() => setMaterialImagePreview(null)}
                                className="absolute top-3 right-3 z-10 bg-black/50 text-white rounded-full p-1.5 hover:bg-black/70 transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                              <img src={materialImagePreview} alt="자재 이미지" className="w-full max-h-[80vh] object-contain" />
                              <div className="absolute bottom-3 right-3">
                                <a
                                  href={materialImagePreview}
                                  download="material-image.jpg"
                                  className="bg-white/80 hover:bg-white text-stone-800 text-xs px-3 py-1.5 rounded-lg border border-stone-200 flex items-center gap-1 shadow-sm"
                                >
                                  <Download className="w-3.5 h-3.5" /> 다운로드
                                </a>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                      {/* hqItems 카테고리별 드롭다운 */}
                      {(() => {
                        // hqItems를 calcItem의 category 기준으로 그룹화
                        const grouped: Record<string, Array<{ item: typeof hqItems[0]; idx: number }>> = {};
                        hqItems.forEach((item, idx) => {
                          const calcItem = bomCalc.hqProvided.find(h => h.bomLineId === item.bomLineId);
                          const cat = calcItem?.category || '기타';
                          if (!grouped[cat]) grouped[cat] = [];
                          grouped[cat].push({ item, idx });
                        });
                        const sortedCats = CATEGORY_ORDER.filter(c => grouped[c]);
                        return (
                          <div className="divide-y divide-stone-100">
                            {sortedCats.map(cat => {
                              const entries = grouped[cat];
                              const isOpen = hqCategoryOpen[cat] ?? false;
                              return (
                                <div key={cat}>
                                  <button
                                    type="button"
                                    className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 transition-colors text-left bg-stone-50"
                                    onClick={() => setHqCategoryOpen(prev => ({ ...prev, [cat]: !isOpen }))}
                                  >
                                    <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                                      <span className="text-blue-400">{isOpen ? '▼' : '▶'}</span>
                                      {cat}
                                      <span className="bg-blue-100 text-blue-600 text-xs px-1.5 py-0.5 rounded-full font-normal">{entries.length}종</span>
                                    </span>
                                  </button>
                                  {isOpen && (
                                    <table className="w-full text-xs">
                                      <thead className="bg-stone-50 border-b border-stone-100">
                                        <tr>
                                          <th className="text-left px-3 py-1.5 font-medium text-stone-500">자재명</th>
                                          <th className="text-right px-3 py-1.5 font-medium text-stone-500">소요량</th>
                                          <th className="text-center px-3 py-1.5 font-medium text-stone-500">단위</th>
                                          <th className="text-left px-3 py-1.5 font-medium text-stone-500">구매업체</th>
                                          <th className="text-left px-3 py-1.5 font-medium text-stone-500">구매상태</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {entries.map(({ item, idx }) => {
                                          const calcItem = bomCalc.hqProvided.find(h => h.bomLineId === item.bomLineId);
                                          return (
                                            <tr key={item.bomLineId} className="border-t border-stone-100 hover:bg-stone-50">
                                              <td className="px-3 py-2 font-medium text-stone-700">
                                                <div className="flex items-center gap-2">
                                                  {calcItem?.imageUrl ? (
                                                    <img
                                                      src={calcItem.imageUrl}
                                                      alt={item.itemName}
                                                      className="w-6 h-6 object-cover rounded cursor-pointer border border-stone-200 shrink-0"
                                                      onClick={() => setMaterialImagePreview(calcItem.imageUrl!)}
                                                      title="클릭하여 확대"
                                                    />
                                                  ) : null}
                                                  <span>
                                                    {item.itemName}
                                                    {item.spec && <span className="text-stone-400 ml-1">({item.spec})</span>}
                                                  </span>
                                                </div>
                                              </td>
                                              <td className="px-3 py-2 text-right">
                                                {calcItem ? (
                                                  <span className="font-mono font-semibold text-blue-700">
                                                    {calcItem.reqQty % 1 === 0 ? calcItem.reqQty.toLocaleString() : calcItem.reqQty.toFixed(2)}
                                                  </span>
                                                ) : (
                                                  <Input
                                                    type="number" value={item.requiredQty || ''}
                                                    onChange={e => {
                                                      const updated = [...hqItems];
                                                      updated[idx] = { ...updated[idx], requiredQty: parseFloat(e.target.value) || 0 };
                                                      setHqItems(updated);
                                                    }}
                                                    className="h-6 text-xs w-20 ml-auto"
                                                  />
                                                )}
                                              </td>
                                              <td className="px-3 py-2 text-center text-stone-500">{item.unit}</td>
                                              <td className="px-3 py-2 text-stone-600">
                                                {calcItem?.vendorName || item.memo?.replace('구매처: ', '') || <span className="text-stone-300">미지정</span>}
                                              </td>
                                              <td className="px-3 py-2">
                                                <Select value={item.purchaseStatus} onValueChange={v => {
                                                  const updated = [...hqItems];
                                                  updated[idx] = { ...updated[idx], purchaseStatus: v as HqSupplyItem['purchaseStatus'] };
                                                  setHqItems(updated);
                                                }}>
                                                  <SelectTrigger className="h-6 text-xs w-24"><SelectValue /></SelectTrigger>
                                                  <SelectContent>
                                                    <SelectItem value="미구매">미구매</SelectItem>
                                                    <SelectItem value="구매완료">구매완료</SelectItem>
                                                    <SelectItem value="발송완료">발송완료</SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* 본사미제공(공장발주) 자재 목록 — 카테고리별 드롭다운 */}
                {bomCalc.factoryProvided.length > 0 && (() => {
                  const grouped: Record<string, typeof bomCalc.factoryProvided> = {};
                  for (const m of bomCalc.factoryProvided) {
                    const cat = m.category || '기타';
                    if (!grouped[cat]) grouped[cat] = [];
                    grouped[cat].push(m);
                  }
                  const sortedCats = CATEGORY_ORDER.filter(c => grouped[c]);
                  return (
                    <div className="rounded-lg border border-stone-200 bg-stone-50 overflow-hidden">
                      <p className="text-xs font-medium text-stone-600 px-3 py-2 flex items-center gap-1 border-b border-stone-200 bg-stone-100">
                        <CheckCircle2 className="w-3.5 h-3.5 text-stone-400" />
                        📦 공장 구매 자재 ({bomCalc.factoryProvided.length}종) — 공장이 직접 구매
                      </p>
                      <div className="divide-y divide-stone-100">
                        {sortedCats.map(cat => {
                          const items = grouped[cat];
                          const isOpen = factoryCategoryOpen[cat] ?? false;
                          return (
                            <div key={cat}>
                              <button
                                type="button"
                                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-stone-100 transition-colors text-left"
                                onClick={() => setFactoryCategoryOpen(prev => ({ ...prev, [cat]: !isOpen }))}
                              >
                                <span className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                                  <span className="text-stone-400">{isOpen ? '▼' : '▶'}</span>
                                  {cat}
                                  <span className="bg-stone-200 text-stone-600 text-xs px-1.5 py-0.5 rounded-full font-normal">{items.length}종</span>
                                </span>
                              </button>
                              {isOpen && (
                                <div className="bg-white px-3 pb-1">
                                  {items.map(m => (
                                    <div key={m.bomLineId} className="flex items-center justify-between text-xs text-stone-500 py-1 border-t border-stone-50 first:border-t-0">
                                      <div className="flex items-center gap-2">
                                        {m.imageUrl ? (
                                          <img
                                            src={m.imageUrl}
                                            alt={m.itemName}
                                            className="w-5 h-5 object-cover rounded cursor-pointer border border-stone-200 shrink-0"
                                            onClick={() => setMaterialImagePreview(m.imageUrl!)}
                                            title="클릭하여 확대"
                                          />
                                        ) : null}
                                        <span className="text-stone-700">{m.itemName}{m.spec ? <span className="text-stone-400 ml-1">({m.spec})</span> : null}</span>
                                      </div>
                                      <span className="font-mono text-stone-600 shrink-0 ml-2">
                                        {m.reqQty % 1 === 0 ? m.reqQty.toLocaleString() : m.reqQty.toFixed(2)} {m.unit}
                                        {m.vendorName && <span className="ml-1 text-stone-400">({m.vendorName})</span>}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* BOM 없거나 수량 미입력 시 공장 선택만 표시 */}
            {form.styleId && currentQty === 0 && (
              <div className="space-y-1.5">
                <Label>발주처 (공장) *</Label>
                <Select value={form.vendorId || ''} onValueChange={v => {
                  const vendor = allVendors.find(x => x.id === v);
                  setForm(f => ({ ...f, vendorId: v, vendorName: vendor?.name || '' }));
                }}>
                  <SelectTrigger><SelectValue placeholder="공장 선택" /></SelectTrigger>
                  <SelectContent>
                    {sortedFactories.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Step 4: 발주일 / 납기일 / 메모 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-amber-700 text-white text-xs flex items-center justify-center font-bold">4</span>
                <Label className="text-sm font-semibold">발주일 & 납기일</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>발주일</Label>
                  <Input
                    type="date"
                    value={form.orderDate || new Date().toISOString().split('T')[0]}
                    onChange={e => setForm(f => ({ ...f, orderDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>납기일 (바이어)</Label>
                  <Input
                    type="date"
                    value={form.deliveryDate || ''}
                    onChange={e => setForm(f => ({ ...f, deliveryDate: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>메모</Label>
                <Input value={form.memo || ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">{isEditMode ? '발주 수정' : '발주 등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 입고 처리 팝업 */}
      <Dialog open={showReceiveModal} onOpenChange={setShowReceiveModal}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-md sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>입고 처리</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-stone-600">입고 수량과 불량 수량을 입력해주세요.</p>
            <div className="space-y-1.5">
              <Label>입고일</Label>
              <Input type="date" value={receiveForm.receivedDate} onChange={e => setReceiveForm(f => ({ ...f, receivedDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>실제 입고 수량</Label>
              <Input type="number" min={0} value={receiveForm.receivedQty} onChange={e => setReceiveForm(f => ({ ...f, receivedQty: parseInt(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1.5">
              <Label>불량 수량</Label>
              <Input type="number" min={0} value={receiveForm.defectQty} onChange={e => setReceiveForm(f => ({ ...f, defectQty: parseInt(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1.5">
              <Label>불량 비고</Label>
              <Input placeholder="예: 박음질 불량, 변색 등" value={receiveForm.defectNote} onChange={e => setReceiveForm(f => ({ ...f, defectNote: e.target.value }))} />
            </div>
            {receiveForm.defectQty > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                양품: {receiveForm.receivedQty - receiveForm.defectQty}개 / 불량: {receiveForm.defectQty}개
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReceiveModal(false)}>취소</Button>
            <Button onClick={handleReceiveConfirm} className="bg-green-700 hover:bg-green-800 text-white">입고 완료</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 발주 상세 모달 */}
      {showDetail && (
        <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
          <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-2xl sm:rounded-lg sm:max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono">{showDetail.orderNo}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLOR[showDetail.status]}`}>{showDetail.status}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><p className="text-xs text-stone-400">스타일</p><p className="font-medium">{showDetail.styleNo}</p></div>
                <div><p className="text-xs text-stone-400">시즌</p><p className="font-medium">{showDetail.season}</p></div>
                <div><p className="text-xs text-stone-400">수량</p><p className="font-mono font-medium">{formatNumber(showDetail.qty)} PCS</p></div>
                <div><p className="text-xs text-stone-400">발주처</p><p className="font-medium">{showDetail.vendorName}</p></div>
                <div>
                  <p className="text-xs text-stone-400">공장단가</p>
                  <p className="font-mono font-medium">
                    {showDetail.factoryUnitPriceKrw ? formatKRW(showDetail.factoryUnitPriceKrw) : '-'}
                    {showDetail.bomType === 'manual' && <span className="text-xs text-amber-600 ml-1">(수동)</span>}
                    {showDetail.bomType === 'post' && <span className="text-xs text-green-600 ml-1">(사후원가)</span>}
                    {showDetail.bomType === 'pre' && <span className="text-xs text-blue-600 ml-1">(사전원가)</span>}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-400">총 발주금액</p>
                  <p className="font-mono font-bold text-amber-700">
                    {showDetail.factoryUnitPriceKrw
                      ? formatKRW(showDetail.factoryUnitPriceKrw * showDetail.qty)
                      : '-'}
                  </p>
                </div>
                <div><p className="text-xs text-stone-400">리오더</p><p className="font-medium">{showDetail.isReorder ? `${showDetail.revision}차` : '신규'}</p></div>
                {showDetail.orderDate && (
                  <div><p className="text-xs text-stone-400">발주일</p><p className="font-mono">{showDetail.orderDate}</p></div>
                )}
                {showDetail.deliveryDate && (
                  <div>
                    <p className="text-xs text-stone-400">납기일</p>
                    <p className="font-mono">{showDetail.deliveryDate}
                      <span className={`ml-1 text-[10px] px-1 py-0.5 rounded font-mono ${dDayColor(calcDDay(showDetail.deliveryDate))}`}>{dDayLabel(calcDDay(showDetail.deliveryDate))}</span>
                    </p>
                  </div>
                )}
              </div>
              {/* 컬러별 수량 */}
              {(showDetail.colorQtys || []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-stone-500 mb-2">컬러별 수량</p>
                  <div className="flex flex-wrap gap-2">
                    {(showDetail.colorQtys || []).map((cq, i) => (
                      <span key={i} className="px-2 py-1 bg-stone-100 text-stone-700 text-xs rounded">{cq.color}: {cq.qty.toLocaleString()} PCS</span>
                    ))}
                  </div>
                </div>
              )}
              {showDetail.hqSupplyItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-stone-500 mb-2">본사제공 자재</p>
                  <div className="space-y-1">
                    {showDetail.hqSupplyItems.map((item, idx) => (
                      <div key={idx} className={`flex items-center justify-between p-2 rounded text-xs ${item.purchaseStatus === '발송완료' ? 'bg-green-50 text-green-700' : item.purchaseStatus === '구매완료' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                        <span>{item.itemName} {item.spec && `(${item.spec})`}</span>
                        <span className="font-mono">{item.requiredQty} {item.unit} — {item.purchaseStatus}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 네고 이력 */}
              {((showDetail as any).negoHistory || []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-stone-500 mb-2">📊 리오더 네고 이력</p>
                  <div className="space-y-1.5">
                    {((showDetail as any).negoHistory as Array<{
                      requestedPrice: number; currency: string; savedAmount: number;
                      savedRate: number; memo: string; date: string;
                    }>).map((n, i) => (
                      <div key={i} className={`p-2.5 rounded-lg border text-xs ${n.savedAmount > 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-stone-600 font-medium">{n.date}</span>
                          <span className={`font-mono font-bold ${n.savedAmount > 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {n.savedAmount > 0 ? '+' : ''}{formatKRW(n.savedAmount)} ({n.savedRate}%)
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-stone-500">
                          <span>요청단가: <span className="font-mono font-medium text-stone-700">{n.requestedPrice} {n.currency}</span></span>
                          {n.memo && <span className="text-stone-400">{n.memo}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setShowDetail(null); openWorkOrderModal(showDetail!); }}
                className="text-stone-700"
              >
                <Package className="w-3.5 h-3.5 mr-1.5" />작업지시서 출력
              </Button>
              <Button variant="outline" onClick={() => setShowDetail(null)}>닫기</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 명세표 발행 모달 ── */}
      {billingTarget && (
        <Dialog open={billingModal} onOpenChange={setBillingModal}>
          <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-lg sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>명세표 발행 — {billingTarget.orderNo}</DialogTitle>
              <div className="text-xs text-stone-500 mt-1">
                거래명세표를 새로 생성하거나 기존 전표에 연결하세요
              </div>
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
                const item = items.find(i => i.id === billingTarget.styleId);
                const buyer = buyers.find(b => b.id === item?.buyerId);
                const buyerStatements = store.getTradeStatements()
                  .filter(t => {
                    const matchBuyer = !buyer || t.vendorId === buyer.id;
                    const matchMonth = t.issueDate.startsWith(thisMonth);
                    return matchBuyer && matchMonth && t.status !== '수금완료';
                  });
                return (
                  <div className="space-y-2">
                    <p className="text-xs text-stone-500">이번 달 전표 ({thisMonth}) — 바이어: {buyer?.name || '미지정'}</p>
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

              {billingMode === 'new' && (() => {
                const item = items.find(i => i.id === billingTarget.styleId);
                const buyer = buyers.find(b => b.id === item?.buyerId);
                const unitPrice = item?.deliveryPrice || item?.targetSalePrice || billingTarget.factoryUnitPriceKrw || 0;
                const colorQtyList = billingTarget.colorQtys && billingTarget.colorQtys.length > 0
                  ? billingTarget.colorQtys
                  : [{ color: '기본', qty: billingTarget.qty }];
                const totalAmt = colorQtyList.reduce((sum, cq) => sum + cq.qty * unitPrice, 0);
                return (
                  <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-700 space-y-1">
                    <p className="font-medium mb-1">생성될 거래명세표</p>
                    <p>발주번호: {billingTarget.orderNo}</p>
                    <p>스타일: {billingTarget.styleNo} — {billingTarget.styleName}</p>
                    <p>바이어: {buyer?.name || '미지정'}</p>
                    <p>수량: {billingTarget.qty.toLocaleString()} PCS</p>
                    {unitPrice > 0 && <p>단가: {formatKRW(unitPrice)} / 합계: {formatKRW(totalAmt)}</p>}
                    {billingTarget.deliveryDate && <p>납기일: {billingTarget.deliveryDate}</p>}
                  </div>
                );
              })()}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBillingModal(false)}>취소</Button>
              <Button
                className="bg-amber-700 hover:bg-amber-800 text-white"
                disabled={billingMode === 'link' && !linkStatementId}
                onClick={handleConfirmBilling}
              >
                {billingMode === 'new' ? '명세표 신규 생성' : '전표 연결 완료'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 작업지시서 모달 (가로 A4 실제 양식) ── */}
      {workOrderTarget && (
        <Dialog open={workOrderModal} onOpenChange={setWorkOrderModal}>
          <DialogContent className="w-full h-full rounded-none sm:w-[98vw] sm:h-auto sm:max-w-6xl sm:rounded-lg sm:max-h-[95vh] overflow-y-auto p-4">
            {/* 인쇄 전용 스타일 */}
            <style>{`
              @media print {
                @page { size: A4 landscape; margin: 8mm; }
                body * { visibility: hidden; }
                #work-order-print-area, #work-order-print-area * { visibility: visible; }
                #work-order-print-area { position: fixed; top: 0; left: 0; width: 100%; }
                .no-print { display: none !important; }
                textarea { border: none !important; resize: none; background: transparent; }
                input[type="text"], input[type="number"] { border: none !important; background: transparent; }
                input[type="checkbox"] { display: inline-block !important; }
              }
            `}</style>

            {/* 상단 버튼 영역 (인쇄 시 숨김) */}
            <div className="no-print flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-stone-800 flex items-center gap-2">
                <Package className="w-4 h-4" />
                작업지시서 — {workOrderTarget.orderNo}
              </h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setWorkOrderModal(false)}>닫기</Button>
                <Button variant="outline" size="sm" className="h-8 text-xs text-blue-700 border-blue-300" onClick={() => window.print()}>
                  <FileText className="w-3.5 h-3.5 mr-1" />PDF 저장
                </Button>
                <Button size="sm" className="h-8 text-xs bg-stone-800 hover:bg-stone-900 text-white" onClick={() => window.print()}>
                  <Printer className="w-3.5 h-3.5 mr-1" />인쇄
                </Button>
              </div>
            </div>

            {/* 작업지시서 본문 — 가로 A4 양식 */}
            <div id="work-order-print-area">
              {(() => {
                const order = workOrderTarget;
                const item = items.find(i => i.id === order.styleId);
                const { bom } = getBomForOrderFromList(boms as Bom[], order.styleNo);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                // 컬러별 BOM에서 첫 번째 컬러 사용, 없으면 기존 방식
                const getColorBomLines = (b: any) => {
                  if (!b) return [];
                  // 사후원가 컬러 BOM 우선
                  if (b.postColorBoms && b.postColorBoms.length > 0) return b.postColorBoms[0].lines || [];
                  if (b.postMaterials && b.postMaterials.length > 0) return b.postMaterials;
                  // 사전원가 컬러 BOM
                  if (b.colorBoms && b.colorBoms.length > 0) return b.colorBoms[0].lines || [];
                  return b.lines || [];
                };
                const bomLines: any[] = getColorBomLines(bom);

                // 원자재 (바디/안감)
                const rawMaterials = bomLines.filter((l: any) => l.category === '원자재');
                // 바디 자재: subPart=바디 or 첫 번째 원자재 (안감 제외)
                const bodyMat = rawMaterials.find((l: any) => l.subPart === '바디') || rawMaterials.find((l: any) => l.subPart !== '안감') || rawMaterials[0];
                // 안감 자재
                const liningMat = rawMaterials.find((l: any) => l.subPart === '안감');
                // 지퍼
                const zipperMat = bomLines.find((l: any) => l.category === '지퍼' || (l.itemName && l.itemName.includes('지퍼')));
                // 불박 로고
                const logoMat = bomLines.find((l: any) => l.itemName && (l.itemName.includes('불박') || l.itemName.includes('로고')));
                // 기리매
                const girimaeMat = bomLines.find((l: any) => l.itemName && l.itemName.includes('기리매'));
                // 실
                const threadMat = bomLines.find((l: any) => l.category === '부자재' && l.itemName && l.itemName.includes('실'));

                // 본사제공 자재 목록 (isHqProvided=true)
                const hqMaterials = bomLines.filter((l: any) => l.isHqProvided);

                // 컬러 정보 (품목 마스터)
                const itemColors = normalizeColors(item?.colors || []);

                // 컬러별 발주수량
                const colorQtyList = (order.colorQtys || []).length > 0
                  ? (order.colorQtys as { color: string; qty: number }[])
                  : [{ color: '기본', qty: order.qty }];

                // 샘플 이미지 가져오기
                const samples = store.getSamples().filter(s => s.styleId === order.styleId);
                const sampleImages = samples.flatMap(s => s.imageUrls || []).slice(0, 3);
                const itemImage = item?.imageUrl;
                const allImages: string[] = sampleImages.length > 0 ? sampleImages.slice(0, 3) : (itemImage ? [itemImage] : []);

                // 기본 작업 지시사항
                const defaultWorkNote = `1. 가죽 재단 후 기스 및 불량 확인
2. 봉제, 기리매 기본 철저히 준수
3. 주의사항 및 변경 사항 확인 필수
4. 애매한 것은 담당자에게 확인하여 빠르게 해결하기
5. 시아기 본드자국 및 실 끝처리 확인 철저
6. 원부자재 빠르게 공급하기

7. 제품 생산 완료 후 내부 검수필수 (실, 바늘, 물 등등)
8. 재단물, 장식 전달 후 수량 파악 필수`;

                return (
                  <div style={{ fontFamily: "'Nanum Gothic', '나눔고딕', 'Malgun Gothic', sans-serif", fontSize: '12px', background: 'white' }}>

                    {/* ── 타이틀 ── */}
                    <div style={{ textAlign: 'center', padding: '8px 0 6px', borderBottom: '2px solid #333' }}>
                      <h1 style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.4em', margin: 0 }}>작  업  지  시  서</h1>
                    </div>

                    {/* ── 상단 헤더 테이블 (발주일자 / 납기일 / 스타일넘버 / 작업장) ── */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', borderBottom: '1px solid #555' }}>
                      <tbody>
                        <tr>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', background: '#f5f5f5', fontWeight: 'bold', width: '12%', whiteSpace: 'nowrap' }}>발주일자</td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', width: '22%' }}>
                            {order.orderDate ? `${order.orderDate.slice(0,4)}년 ${parseInt(order.orderDate.slice(5,7))}월 ${parseInt(order.orderDate.slice(8,10))}일` : '—'}
                          </td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', background: '#f5f5f5', fontWeight: 'bold', width: '10%', whiteSpace: 'nowrap' }}>납기일</td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', width: '56%', color: '#cc0000', fontWeight: 'bold', fontSize: '13px' }}>
                            {order.deliveryDate || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', background: '#f5f5f5', fontWeight: 'bold', whiteSpace: 'nowrap' }}>스타일넘버(품명)</td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', fontWeight: 'bold', fontSize: '13px' }}>
                            {order.styleNo} / {order.styleName}
                          </td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', background: '#f5f5f5', fontWeight: 'bold', whiteSpace: 'nowrap' }}>작업장</td>
                          <td style={{ border: '1px solid #999', padding: '4px 8px', fontWeight: 'bold', fontSize: '13px' }}>
                            {order.vendorName || '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* ── 원단/가죽 소요량 행 ── */}
                    <div style={{ background: '#fafafa', border: '1px solid #ccc', borderTop: 'none', padding: '5px 10px', display: 'flex', gap: '24px', fontSize: '12px' }}>
                      <span>
                        <strong>원단/가죽 소요량: </strong>
                        {bodyMat
                          ? `${(bodyMat.netQty * (1 + bodyMat.lossRate)).toFixed(3)} ${bodyMat.unit}`
                          : '—'}
                      </span>
                      <span style={{ color: '#888' }}>|</span>
                      <span>
                        <strong>안감 소요량: </strong>
                        {liningMat
                          ? `${(liningMat.netQty * (1 + liningMat.lossRate)).toFixed(3)} ${liningMat.unit}`
                          : '—'}
                      </span>
                    </div>

                    {/* ── 컬러별 자재 정보 테이블 ── */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px', fontSize: '11px' }}>
                      <thead>
                        <tr style={{ background: '#e8e8e8' }}>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '22%', textAlign: 'center' }}>메인자재<br/><span style={{ fontWeight: 'normal', fontSize: '10px' }}>(발주수량)</span></th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '10%', textAlign: 'center' }}>우라<br/><span style={{ fontWeight: 'normal', fontSize: '10px' }}>(안감)</span></th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '10%', textAlign: 'center' }}>장식</th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '12%', textAlign: 'center' }}>불박로고</th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '10%', textAlign: 'center' }}>기리매</th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '10%', textAlign: 'center' }}>실번버</th>
                          <th style={{ border: '1px solid #aaa', padding: '4px 6px', width: '12%', textAlign: 'center' }}>지퍼번버</th>
                        </tr>
                      </thead>
                      <tbody>
                        {colorQtyList.map((cq, i) => {
                          // 이 컬러에 해당하는 품목 컬러 정보
                          const colorInfo = itemColors.find(c => c.name === cq.color) || itemColors[0];
                          return (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', verticalAlign: 'top' }}>
                                <div style={{ fontWeight: 'bold', lineHeight: 1.4 }}>
                                  {colorInfo?.leatherColor || cq.color}
                                </div>
                                <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
                                  {bodyMat?.spec && <span>{bodyMat.spec}</span>}
                                </div>
                                <div style={{ fontWeight: 'bold', marginTop: '3px', fontSize: '12px' }}>
                                  {cq.qty.toLocaleString()} PCS
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {liningMat ? (liningMat.spec || liningMat.itemName || '—') : '—'}
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {colorInfo?.decorColor || '—'}
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {logoMat ? (logoMat.spec || logoMat.itemName) : '—'}
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {colorInfo?.girimaeColor || (girimaeMat ? (girimaeMat.spec || girimaeMat.itemName) : '—')}
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {colorInfo?.threadColor || (threadMat ? (threadMat.spec || threadMat.itemName) : '—')}
                                </div>
                              </td>
                              <td style={{ border: '1px solid #ccc', padding: '5px 6px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ fontSize: '11px' }}>
                                  {zipperMat ? (zipperMat.spec || zipperMat.itemName) : '—'}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {/* 합계 행 */}
                        <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                          <td style={{ border: '1px solid #ccc', padding: '4px 6px' }}>
                            합계: {colorQtyList.reduce((s, c) => s + c.qty, 0).toLocaleString()} PCS
                          </td>
                          <td colSpan={6} style={{ border: '1px solid #ccc', padding: '4px 6px', fontSize: '10px', color: '#888' }}>
                            {colorQtyList.map(cq => `${cq.color} ${cq.qty.toLocaleString()}PCS`).join(' / ')}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* ── 제품 이미지 영역 ── */}
                    <div style={{ border: '1px solid #ccc', borderTop: 'none', padding: '8px', display: 'flex', gap: '8px', minHeight: '90px', alignItems: 'center' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '11px', color: '#555', minWidth: '60px', writingMode: 'vertical-rl', textAlign: 'center' }}>제품사진</div>
                      {allImages.length > 0 ? (
                        allImages.map((img, i) => (
                          <div key={i} style={{ width: '80px', height: '80px', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
                            <img src={img} alt={`제품이미지${i+1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                        ))
                      ) : (
                        Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} style={{ width: '80px', height: '80px', border: '1px dashed #bbb', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#bbb', fontSize: '10px' }}>
                            사진 {i+1}
                          </div>
                        ))
                      )}
                      <div style={{ flex: 1 }} />
                      {/* 이미지 없으면 메모란 */}
                      {allImages.length === 0 && (
                        <div style={{ flex: 1, fontSize: '10px', color: '#aaa', border: '1px dashed #ddd', padding: '6px', borderRadius: '4px', minHeight: '60px' }}>
                          품목 마스터 또는 샘플에 이미지를 등록하면 자동으로 표시됩니다
                        </div>
                      )}
                    </div>

                    {/* ── 하단 2열 레이아웃: 작업 기본사항 | 본사제공 자재 체크란 ── */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', border: '1px solid #ccc', borderTop: 'none' }}>

                      {/* 왼쪽: 6대 작업 기본사항 */}
                      <div style={{ borderRight: '1px solid #ccc', padding: '8px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '6px', borderBottom: '1px solid #ddd', paddingBottom: '4px' }}>
                          6대 작업 기본사항
                        </div>
                        <textarea
                          className="no-print"
                          style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: '3px', padding: '6px', fontSize: '11px', lineHeight: 1.7, resize: 'vertical', minHeight: '120px', fontFamily: 'inherit', background: '#fafffe' }}
                          value={workOrderNote || defaultWorkNote}
                          onChange={e => setWorkOrderNote(e.target.value)}
                        />
                        {/* 인쇄용 (화면에선 숨김) */}
                        <div style={{ display: 'none', fontSize: '11px', lineHeight: 1.7, whiteSpace: 'pre-wrap' }} className="print-only">
                          {workOrderNote || defaultWorkNote}
                        </div>
                        <style>{`.print-only { display: none; } @media print { .print-only { display: block !important; } .no-print { display: none !important; } }`}</style>
                        <div style={{ marginTop: '8px', fontWeight: 'bold', color: '#cc0000', fontSize: '12px', textAlign: 'center' }}>
                          ⚠️ 수정사항 꼭 확인해주세요
                        </div>
                      </div>

                      {/* 오른쪽: 본사제공 자재 수령 체크란 */}
                      <div style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '6px', borderBottom: '1px solid #ddd', paddingBottom: '4px' }}>
                          본사제공 자재 수령 체크란
                        </div>
                        {hqMaterials.length > 0 ? (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                            <thead>
                              <tr style={{ background: '#f0f0f0' }}>
                                <th style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center', width: '30%' }}>품명</th>
                                <th style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center', width: '22%' }}>필요수량</th>
                                <th style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center', width: '28%' }}>수령수량</th>
                                <th style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center', width: '10%' }}>✓</th>
                              </tr>
                            </thead>
                            <tbody>
                              {hqMaterials.map((mat: any, idx: number) => {
                                const reqQty = (mat.netQty * (1 + mat.lossRate) * order.qty);
                                return (
                                  <tr key={idx}>
                                    <td style={{ border: '1px solid #ccc', padding: '3px 5px' }}>
                                      {mat.itemName}
                                      {mat.spec && <span style={{ color: '#888', fontSize: '10px' }}><br/>{mat.spec}</span>}
                                    </td>
                                    <td style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center', fontFamily: 'monospace' }}>
                                      {reqQty % 1 === 0 ? reqQty.toLocaleString() : reqQty.toFixed(2)} {mat.unit}
                                    </td>
                                    <td style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center' }}>
                                      <input
                                        type="text"
                                        className="no-print"
                                        placeholder="수령량"
                                        value={hqReceive[idx]?.received || ''}
                                        onChange={e => {
                                          const updated = [...hqReceive];
                                          updated[idx] = { ...updated[idx], received: e.target.value };
                                          setHqReceive(updated);
                                        }}
                                        style={{ width: '70px', border: '1px solid #ccc', borderRadius: '2px', padding: '2px 4px', fontSize: '11px', textAlign: 'center' }}
                                      />
                                      <span className="print-only" style={{ display: 'none', fontFamily: 'monospace' }}>
                                        {hqReceive[idx]?.received || '___'} {mat.unit}
                                      </span>
                                    </td>
                                    <td style={{ border: '1px solid #ccc', padding: '3px 5px', textAlign: 'center' }}>
                                      <input
                                        type="checkbox"
                                        checked={hqReceive[idx]?.checked || false}
                                        onChange={e => {
                                          const updated = [...hqReceive];
                                          updated[idx] = { ...updated[idx], checked: e.target.checked };
                                          setHqReceive(updated);
                                        }}
                                        style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        ) : (
                          <div style={{ padding: '16px', textAlign: 'center', color: '#bbb', fontSize: '11px', border: '1px dashed #ddd', borderRadius: '4px' }}>
                            본사제공 자재 없음<br/>
                            <span style={{ fontSize: '10px' }}>(BOM에서 isHqProvided=true 항목이 없습니다)</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── 하단 서명란 ── */}
                    <div style={{ border: '1px solid #ccc', borderTop: 'none', padding: '6px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '11px', color: '#555' }}>
                      <div>작성: _______________</div>
                      <div>확인: _______________</div>
                      <div>수령: _______________</div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 하단 버튼 (인쇄 시 숨김) */}
            <div className="no-print flex justify-end gap-2 mt-3 pt-3 border-t border-stone-200">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setWorkOrderModal(false)}>닫기</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs text-blue-700 border-blue-300" onClick={() => window.print()}>
                <FileText className="w-3.5 h-3.5 mr-1" />PDF 저장
              </Button>
              <Button size="sm" className="h-8 text-xs bg-stone-800 hover:bg-stone-900 text-white" onClick={() => window.print()}>
                <Printer className="w-3.5 h-3.5 mr-1" />인쇄
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 발주 완료 후 액션 팝업 ── */}
      {postOrderInfo && (
        <Dialog open={postOrderModal} onOpenChange={setPostOrderModal}>
          <DialogContent className="w-full rounded-none sm:w-[95vw] sm:max-w-md sm:rounded-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-5 h-5" />
                발주 등록 완료!
              </DialogTitle>
            </DialogHeader>
            <div className="py-3 space-y-3">
              {/* 발주 정보 요약 */}
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span className="font-mono font-bold text-stone-800">{postOrderInfo.order.styleNo}</span>
                  <span className="text-stone-600">{postOrderInfo.order.styleName}</span>
                  <span className="font-mono text-green-700 font-semibold">{postOrderInfo.order.qty.toLocaleString()} PCS</span>
                </div>
                <p className="text-xs text-stone-500 mt-1">발주번호: {postOrderInfo.order.orderNo} · 공장: {postOrderInfo.order.vendorName}</p>
              </div>
              <p className="text-sm text-stone-600 font-medium">이어서 진행하시겠습니까?</p>
              <div className="space-y-2">
                {/* 작업지시서 출력 */}
                <button
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-stone-200 hover:bg-stone-50 text-left transition-colors"
                  onClick={() => {
                    setPostOrderModal(false);
                    openWorkOrderModal(postOrderInfo.order);
                  }}
                >
                  <span className="text-xl">📄</span>
                  <div>
                    <p className="text-sm font-semibold text-stone-800">작업지시서 출력</p>
                    <p className="text-xs text-stone-500">작업지시서 모달 바로 오픈</p>
                  </div>
                </button>
                {/* 자재 장바구니 담기 */}
                {postOrderInfo.bomMaterials.length > 0 ? (
                  <button
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-blue-200 hover:bg-blue-50 text-left transition-colors"
                    onClick={() => {
                      store.addToMaterialCart(
                        postOrderInfo.order.styleNo,
                        postOrderInfo.order.styleName,
                        postOrderInfo.bomMaterials,
                        postOrderInfo.order.qty
                      );
                      refreshCart();
                      setPostOrderModal(false);
                      toast.success(`🛒 본사제공 자재 ${postOrderInfo.bomMaterials.length}종을 장바구니에 담았습니다`);
                      setCartModal(true);
                    }}
                  >
                    <span className="text-xl">📦</span>
                    <div>
                      <p className="text-sm font-semibold text-blue-800">자재 장바구니 담기</p>
                      <p className="text-xs text-blue-600">본사제공 자재 {postOrderInfo.bomMaterials.length}종을 장바구니에 추가</p>
                    </div>
                  </button>
                ) : (
                  <div className="w-full flex items-center gap-3 p-3 rounded-lg border border-stone-100 bg-stone-50 text-left opacity-60">
                    <span className="text-xl">📦</span>
                    <div>
                      <p className="text-sm font-semibold text-stone-500">자재 장바구니 담기</p>
                      <p className="text-xs text-stone-400">본사제공 자재 없음 (BOM 미등록 또는 전량 공장구매)</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPostOrderModal(false)}>닫기</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 자재 통합 발주 장바구니 모달 ── */}
      <Dialog open={cartModal} onOpenChange={setCartModal}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-4xl sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-blue-700" />
              자재 통합 발주 장바구니
              {cartItems.length > 0 && (
                <span className="ml-1 text-sm font-normal text-stone-500">({cartItems.length}종)</span>
              )}
            </DialogTitle>
          </DialogHeader>
          {cartItems.length === 0 ? (
            <div className="py-12 text-center text-stone-400">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">장바구니가 비어 있습니다</p>
              <p className="text-xs mt-1">발주 등록 완료 후 "자재 장바구니 담기"를 클릭하세요</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50">
                      <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">자재명</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">규격</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">단위</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">소요수량</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">보유재고</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">발주수량</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">담긴 발주</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">구매처</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cartItems.map((item, idx) => {
                      const stockQty = item.stockQty ?? 0;
                      const orderQty = Math.max(0, item.qty - stockQty);
                      const isSufficient = orderQty === 0;
                      return (
                      <tr key={idx} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="px-3 py-2 font-medium text-stone-800">{item.materialName}</td>
                        <td className="px-3 py-2 text-stone-500 text-xs">{item.spec || '-'}</td>
                        <td className="px-3 py-2 text-center text-stone-600">{item.unit}</td>
                        <td className="px-3 py-2 text-right font-mono text-stone-600 text-sm">
                          {item.qty % 1 === 0 ? item.qty.toLocaleString() : item.qty.toFixed(3)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            value={stockQty === 0 ? '' : stockQty}
                            placeholder="0"
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              store.updateCartItemStock(item.materialName, item.unit, val);
                              refreshCart();
                            }}
                            className="w-20 h-7 text-right font-mono text-sm border border-stone-200 rounded px-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            value={orderQty}
                            onChange={e => {
                              const newQty = parseFloat(e.target.value) || 0;
                              // 발주수량 수동 조정 시 stockQty를 역산하여 저장
                              const newStock = Math.max(0, item.qty - newQty);
                              store.updateCartItemStock(item.materialName, item.unit, newStock);
                              refreshCart();
                            }}
                            className={`w-24 h-7 text-right font-mono text-sm border rounded px-2 focus:outline-none focus:ring-1 ${
                              isSufficient
                                ? 'border-green-300 text-green-700 bg-green-50 focus:ring-green-300'
                                : 'border-amber-300 text-amber-700 bg-amber-50 focus:ring-amber-300'
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-500">
                          {item.orders.map((o, i) => (
                            <span key={i}>
                              {i > 0 && <span className="mx-1 text-stone-300">+</span>}
                              <span className="text-stone-600 font-medium">{o.styleNo}</span>
                              <span className="text-stone-400">({o.qty % 1 === 0 ? o.qty.toLocaleString() : o.qty.toFixed(3)})</span>
                            </span>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-500">{item.vendorName || <span className="text-stone-300">-</span>}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            className="text-stone-300 hover:text-red-500 transition-colors"
                            onClick={() => {
                              store.removeCartItem(item.materialName, item.unit);
                              refreshCart();
                            }}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-stone-400">💡 보유재고 입력 시 발주수량이 자동으로 차감됩니다. 발주수량도 직접 조정 가능합니다.</p>
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap">
            {cartItems.length > 0 && (
              <>
                <Button
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => {
                    if (confirm('장바구니를 전체 비우시겠습니까?')) {
                      store.clearMaterialCart();
                      refreshCart();
                    }
                  }}
                >
                  전체 비우기
                </Button>
                <Button
                  className="bg-blue-700 hover:bg-blue-800 text-white"
                  onClick={() => { setCartModal(false); setVendorOrderModal(true); }}
                >
                  <Printer className="w-4 h-4 mr-1.5" />
                  거래처별 발주서 출력
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setCartModal(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 거래처별 발주서 출력 모달 ── */}
      <Dialog open={vendorOrderModal} onOpenChange={setVendorOrderModal}>
        <DialogContent className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-3xl sm:rounded-lg sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="w-4 h-4" />
              거래처별 발주서
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            {/* 거래처별 분류 */}
            {(() => {
              // cartItems를 vendorName 기준으로 그룹핑 (발주수량 0 항목 제외)
              const grouped = new Map<string, Array<CartItem & { orderQty: number }>>();
              for (const item of cartItems) {
                const stockQty = item.stockQty ?? 0;
                const orderQty = Math.max(0, item.qty - stockQty);
                if (orderQty === 0) continue; // 발주수량 0 항목 제외
                const vendor = item.vendorName || '미지정';
                if (!grouped.has(vendor)) grouped.set(vendor, []);
                grouped.get(vendor)!.push({ ...item, orderQty });
              }
              const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
              if (grouped.size === 0) {
                return <p className="text-center text-stone-400 py-8">발주가 필요한 자재가 없습니다 (보유재고로 충당 가능)</p>;
              }
              return Array.from(grouped.entries()).map(([vendor, items]) => (
                <div key={vendor} className="border border-stone-200 rounded-lg overflow-hidden">
                  {/* 업체 헤더 */}
                  <div className="bg-stone-800 text-white px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-base">{vendor === '미지정' ? '구매처 미지정' : vendor}</p>
                      <p className="text-xs text-stone-300 mt-0.5">발주일: {today} · {items.length}종</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-stone-800 border-stone-200 bg-white hover:bg-stone-100"
                      onClick={() => window.print()}
                    >
                      <Printer className="w-3 h-3 mr-1" />인쇄
                    </Button>
                  </div>
                  {/* 발주 품목 테이블 */}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-stone-50 border-b border-stone-200">
                        <th className="text-center px-3 py-2 text-xs font-medium text-stone-500 w-8">No.</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-stone-500 w-10">이미지</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">자재명</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">규격</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-stone-500">단위</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">소요수량</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">보유재고</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-stone-500">발주수량</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-stone-500">비고 (담긴 발주)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, i) => (
                        <tr key={i} className="border-b border-stone-100">
                          <td className="px-3 py-2 text-center text-stone-400 text-xs">{i + 1}</td>
                          <td className="px-2 py-1 text-center">
                            {(item as any).imageUrl ? (
                              <img src={(item as any).imageUrl} alt={item.materialName} className="w-14 h-14 object-cover rounded cursor-pointer border border-stone-200 hover:scale-110 transition-transform" onClick={() => window.open((item as any).imageUrl, '_blank')} />
                            ) : (
                              <span className="text-stone-300 text-base">📷</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-medium text-stone-800">{item.materialName}</td>
                          <td className="px-3 py-2 text-stone-500 text-xs">{item.spec || '-'}</td>
                          <td className="px-3 py-2 text-center text-stone-600">{item.unit}</td>
                          <td className="px-3 py-2 text-right font-mono text-stone-500 text-xs">
                            {item.qty % 1 === 0 ? item.qty.toLocaleString() : item.qty.toFixed(3)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-stone-500 text-xs">
                            {(item.stockQty ?? 0) % 1 === 0 ? (item.stockQty ?? 0).toLocaleString() : (item.stockQty ?? 0).toFixed(3)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700">
                            {item.orderQty % 1 === 0 ? item.orderQty.toLocaleString() : item.orderQty.toFixed(3)}
                          </td>
                          <td className="px-3 py-2 text-xs text-stone-400">
                            {item.orders.map((o, j) => (
                              <span key={j}>
                                {j > 0 && ' + '}
                                {o.styleNo}({o.qty % 1 === 0 ? o.qty.toLocaleString() : o.qty.toFixed(3)})
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-stone-50 border-t border-stone-200">
                        <td colSpan={6} className="px-3 py-2 text-xs font-medium text-stone-600 text-right">합계 {items.length}종</td>
                        <td className="px-3 py-2 text-right text-xs font-bold text-stone-700">{items.length}종 발주</td>
                        <td className="px-3 py-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                  {/* 서명란 */}
                  <div className="px-4 py-3 border-t border-stone-100 grid grid-cols-3 gap-4 text-xs text-stone-500">
                    <div>발주담당: ___________</div>
                    <div>확인: ___________</div>
                    <div>수령: ___________</div>
                  </div>
                </div>
              ));
            })()}
            {cartItems.length === 0 && (
              <p className="text-center text-stone-400 py-8">장바구니에 담긴 자재가 없습니다</p>
            )}
          </div>
          <DialogFooter className="flex flex-wrap gap-2 justify-between">
            <Button variant="outline" onClick={() => { setVendorOrderModal(false); setCartModal(true); }}>
              뒤로
            </Button>
            <div className="flex gap-2 flex-wrap">
              {/* 이메일 발송 버튼 (거래처별 발주서 전체에 대한 안내) */}
              {(() => {
                const grouped = new Map<string, Array<CartItem & { orderQty: number }>>();
                for (const item of cartItems) {
                  const stockQty = item.stockQty ?? 0;
                  const orderQty = Math.max(0, item.qty - stockQty);
                  if (orderQty === 0) continue;
                  const vendor = item.vendorName || '미지정';
                  if (!grouped.has(vendor)) grouped.set(vendor, []);
                  grouped.get(vendor)!.push({ ...item, orderQty });
                }
                return Array.from(grouped.entries()).map(([vendor, items]) => {
                  const handleSendEmail = async () => {
                    // 거래처 이메일 자동 조회
                    const vendorRecord = allVendors.find(v => v.name === vendor && v.type === '자재거래처');
                    const vendorEmail = vendorRecord?.contactEmail || '';
                    if (!vendorEmail) {
                      setPendingEmailVendor(vendor);
                      setPendingEmailItems(items);
                      setEmailInputValue('');
                      setEmailInputModal(true);
                      return;
                    }
                    await sendVendorEmail(vendor, vendorEmail, items);
                  };
                  return (
                    <Button
                      key={`email-${vendor}`}
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs text-blue-700 border-blue-300 hover:bg-blue-50"
                      onClick={handleSendEmail}
                    >
                      <Mail className="w-3.5 h-3.5 mr-1" />📧 {vendor} 이메일
                    </Button>
                  );
                });
              })()}
              {/* 발주 확정 버튼 */}
              <Button
                className="h-8 text-xs bg-green-700 hover:bg-green-800 text-white"
                onClick={async () => {
                  const existingMaterials = await fetchMaterials();
                  let savedCount = 0;
                  const today = new Date().toISOString().split('T')[0];

                  for (const item of cartItems) {
                    const stockQty = item.stockQty ?? 0;
                    const orderQty = Math.max(0, item.qty - stockQty);
                    if (orderQty === 0) continue;
                    const vendor = item.vendorName || '미지정';

                    const existing = existingMaterials.find((m: any) =>
                      m.name === item.materialName && m.unit === item.unit
                    );
                    await upsertMaterial({
                      id: existing?.id || genId(),
                      name: item.materialName,
                      spec: item.spec || '',
                      unit: item.unit,
                      category: '원자재',
                      orderStatus: '발주중',
                      orderDate: today,
                      orderQty: orderQty,
                      orderVendorName: vendor,
                      vendorId: allVendors.find((v: any) => v.name === vendor && v.type === '자재거래처')?.id,
                      createdAt: (existing as any)?.createdAt || new Date().toISOString(),
                    });
                    savedCount++;
                  }

                  queryClient.invalidateQueries({ queryKey: ['materials'] });
                  // PurchaseMatching 탭에도 저장 (자재 구매 이력)
                  const settings = store.getSettings();
                  for (const item of cartItems) {
                    const stockQty = item.stockQty ?? 0;
                    const orderQty = Math.max(0, item.qty - stockQty);
                    if (orderQty === 0) continue;
                    store.addPurchaseItem({
                      id: genId(),
                      orderId: postOrderInfo?.order?.id || '',
                      orderNo: postOrderInfo?.order?.orderNo || '',
                      purchaseDate: today,
                      itemName: item.materialName,
                      qty: orderQty,
                      unit: item.unit,
                      unitPriceCny: 0,
                      currency: 'CNY',
                      appliedRate: settings.cnyKrw || 191,
                      amountKrw: 0,
                      vendorName: item.vendorName || '미지정',
                      paymentMethod: '기타',
                      purchaseStatus: '미구매',
                      createdAt: new Date().toISOString(),
                    });
                  }
                  store.clearMaterialCart();  // 장바구니 비우기
                  refreshCart();
                  toast.success(`✅ ${savedCount}종 자재가 자재구매 탭에 저장되었습니다`);
                  setVendorOrderModal(false);
                }}
              >
                ✅ 발주 확정
              </Button>
              <Button variant="outline" onClick={() => setVendorOrderModal(false)}>닫기</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 이메일 입력 모달 ── */}
      <Dialog open={emailInputModal} onOpenChange={setEmailInputModal}>
        <DialogContent className="w-full rounded-none sm:w-[95vw] sm:max-w-sm sm:rounded-lg">
          <DialogHeader>
            <DialogTitle>이메일 주소 입력</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-stone-600">
              <span className="font-semibold">{pendingEmailVendor}</span> 거래처의 이메일 주소가 등록되어 있지 않습니다.
            </p>
            <div className="space-y-1.5">
              <Label>이메일 주소</Label>
              <Input
                type="email"
                placeholder="example@company.com"
                value={emailInputValue}
                onChange={e => setEmailInputValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && emailInputValue.trim()) {
                    setEmailInputModal(false);
                    sendVendorEmail(pendingEmailVendor, emailInputValue.trim(), pendingEmailItems);
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailInputModal(false)}>취소</Button>
            <Button
              className="bg-blue-700 hover:bg-blue-800 text-white"
              disabled={!emailInputValue.trim()}
              onClick={() => {
                setEmailInputModal(false);
                sendVendorEmail(pendingEmailVendor, emailInputValue.trim(), pendingEmailItems);
              }}
            >
              <Mail className="w-4 h-4 mr-1" />발송
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

