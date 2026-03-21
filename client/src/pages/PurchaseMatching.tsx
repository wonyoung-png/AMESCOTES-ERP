// AMESCOTES ERP — 자재 구매 매칭
import { useState, useMemo } from 'react';
import {
  store, genId, formatKRW, formatNumber,
  type PurchaseItem, type Currency, type ExpenseType,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Trash2, ShoppingCart } from 'lucide-react';

const CURRENCIES: Currency[] = ['KRW', 'USD', 'CNY'];
const PAYMENT_METHODS: ExpenseType[] = ['법인카드', '계좌이체', '현금'];
const PURCHASE_STATUSES = ['미구매', '구매완료', '발송완료'] as const;

const STATUS_COLOR: Record<string, string> = {
  '미구매': 'bg-stone-50 text-stone-500 border-stone-200',
  '구매완료': 'bg-blue-50 text-blue-700 border-blue-200',
  '발송완료': 'bg-green-50 text-green-700 border-green-200',
};

export default function PurchaseMatching() {
  const [purchases, setPurchases] = useState<PurchaseItem[]>(() => store.getPurchaseItems());
  const orders = store.getOrders();
  const vendors = store.getVendors().filter(v => v.type === '자재거래처');
  const settings = store.getSettings();
  const [filterOrder, setFilterOrder] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Partial<PurchaseItem>>({});
  const [editId, setEditId] = useState<string | null>(null);

  const refresh = () => setPurchases(store.getPurchaseItems());

  const filtered = useMemo(() => {
    let list = purchases;
    if (filterOrder !== 'all') list = list.filter(p => p.orderId === filterOrder);
    if (filterStatus !== 'all') list = list.filter(p => p.purchaseStatus === filterStatus);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [purchases, filterOrder, filterStatus]);

  const stats = useMemo(() => {
    const unpurchased = purchases.filter(p => p.purchaseStatus === '미구매').length;
    const totalKrw = purchases.reduce((s, p) => s + p.amountKrw, 0);
    return { total: purchases.length, unpurchased, totalKrw };
  }, [purchases]);

  const calcAmountKrw = (qty: number, unitPriceCny: number, currency: Currency): number => {
    if (currency === 'KRW') return qty * unitPriceCny;
    if (currency === 'USD') return qty * unitPriceCny * settings.usdKrw;
    if (currency === 'CNY') return qty * unitPriceCny * settings.cnyKrw;
    return qty * unitPriceCny;
  };

  const openNew = () => {
    setForm({
      purchaseDate: new Date().toISOString().split('T')[0],
      currency: 'KRW', qty: 0, unitPriceCny: 0, amountKrw: 0,
      appliedRate: 1, purchaseStatus: '미구매', paymentMethod: '법인카드',
    });
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (p: PurchaseItem) => { setForm({ ...p }); setEditId(p.id); setShowModal(true); };

  const handleOrderSelect = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (order) setForm(f => ({ ...f, orderId: order.id, orderNo: order.orderNo }));
  };

  const updateAmount = (qty: number, unitPriceCny: number, currency: Currency) => {
    const rate = currency === 'USD' ? settings.usdKrw : currency === 'CNY' ? settings.cnyKrw : 1;
    const amountKrw = calcAmountKrw(qty, unitPriceCny, currency);
    setForm(f => ({ ...f, qty, unitPriceCny, currency, appliedRate: rate, amountKrw }));
  };

  const handleSave = () => {
    if (!form.orderId) { toast.error('발주번호를 선택해주세요'); return; }
    if (!form.itemName) { toast.error('품목명을 입력해주세요'); return; }
    if (editId) {
      store.updatePurchaseItem(editId, form as Partial<PurchaseItem>);
      toast.success('수정되었습니다');
    } else {
      const p: PurchaseItem = {
        id: genId(),
        orderId: form.orderId!,
        orderNo: form.orderNo!,
        purchaseDate: form.purchaseDate || new Date().toISOString().split('T')[0],
        itemName: form.itemName!,
        qty: form.qty || 0,
        unit: form.unit || 'EA',
        unitPriceCny: form.unitPriceCny || 0,
        currency: form.currency || 'KRW',
        appliedRate: form.appliedRate || 1,
        amountKrw: form.amountKrw || 0,
        vendorId: form.vendorId,
        vendorName: form.vendorName,
        purchaseStatus: form.purchaseStatus || '미구매',
        paymentMethod: form.paymentMethod || '법인카드',
        statementNo: form.statementNo,
        memo: form.memo,
        createdAt: new Date().toISOString(),
      };
      store.addPurchaseItem(p);
      toast.success('구매 내역이 등록되었습니다');
    }
    refresh();
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    store.deletePurchaseItem(id);
    refresh();
    toast.success('삭제되었습니다');
  };

  const handleStatusChange = (id: string, status: string) => {
    store.updatePurchaseItem(id, { purchaseStatus: status as PurchaseItem['purchaseStatus'] });
    refresh();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">자재 구매</h1>
          <p className="text-sm text-stone-500 mt-0.5">발주번호 매칭 · 본사제공 자재 구매 이력 관리</p>
        </div>
        <Button onClick={openNew} className="bg-amber-700 hover:bg-amber-800 text-white gap-2">
          <Plus className="w-4 h-4" />구매 등록
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '전체 구매건', value: `${stats.total}건`, color: 'text-stone-800' },
          { label: '미구매', value: `${stats.unpurchased}건`, color: 'text-amber-700' },
          { label: '총 구매금액', value: formatKRW(stats.totalKrw), color: 'text-stone-800' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-stone-200 p-4">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-stone-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Select value={filterOrder} onValueChange={setFilterOrder}>
          <SelectTrigger className="w-52 h-9"><SelectValue placeholder="발주번호 필터" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 발주</SelectItem>
            {orders.map(o => <SelectItem key={o.id} value={o.id}>{o.orderNo} — {o.styleName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-28 h-9"><SelectValue placeholder="상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {PURCHASE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">발주번호</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">품목명</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">공급업체</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">구매일</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">단가</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">금액(KRW)</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">결제</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">상태</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-stone-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-stone-400">
                <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 구매 내역이 없습니다</p>
              </td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="border-b border-stone-50 hover:bg-stone-50/50">
                <td className="px-4 py-3 font-mono text-xs text-stone-600">{p.orderNo}</td>
                <td className="px-4 py-3 font-medium text-stone-800">{p.itemName}</td>
                <td className="px-4 py-3 text-stone-600">{p.vendorName || '-'}</td>
                <td className="px-4 py-3 text-stone-600">{p.purchaseDate}</td>
                <td className="px-4 py-3 text-right font-mono">{formatNumber(p.qty)} {p.unit}</td>
                <td className="px-4 py-3 text-right font-mono text-stone-600">{formatNumber(p.unitPriceCny, 2)} {p.currency}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-stone-800">{formatKRW(p.amountKrw)}</td>
                <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{p.paymentMethod}</Badge></td>
                <td className="px-4 py-3">
                  <Select value={p.purchaseStatus} onValueChange={v => handleStatusChange(p.id, v)}>
                    <SelectTrigger className={`h-7 text-xs w-24 border ${STATUS_COLOR[p.purchaseStatus]}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PURCHASE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => openEdit(p)}>수정</Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(p.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? '구매 수정' : '구매 등록'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>발주번호 *</Label>
                <Select value={form.orderId || ''} onValueChange={handleOrderSelect}>
                  <SelectTrigger><SelectValue placeholder="발주 선택" /></SelectTrigger>
                  <SelectContent>
                    {orders.map(o => <SelectItem key={o.id} value={o.id}>{o.orderNo} — {o.styleName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>품목명 *</Label>
                <Input value={form.itemName || ''} onChange={e => setForm(f => ({ ...f, itemName: e.target.value }))} placeholder="예: 황동 버클 20mm" />
              </div>
              <div className="space-y-1.5">
                <Label>공급업체</Label>
                <Select value={form.vendorId || ''} onValueChange={vid => {
                  const v = vendors.find(x => x.id === vid);
                  setForm(f => ({ ...f, vendorId: v?.id, vendorName: v?.name }));
                }}>
                  <SelectTrigger><SelectValue placeholder="업체 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">직접 입력</SelectItem>
                    {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {!form.vendorId && (
                <div className="space-y-1.5">
                  <Label>업체명</Label>
                  <Input value={form.vendorName || ''} onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))} placeholder="업체명" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>구매일</Label>
                <Input type="date" value={form.purchaseDate || ''} onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>단위</Label>
                <Input value={form.unit || 'EA'} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="EA, m, kg" />
              </div>
              <div className="space-y-1.5">
                <Label>수량</Label>
                <Input type="number" value={form.qty || ''} onChange={e => updateAmount(parseInt(e.target.value) || 0, form.unitPriceCny || 0, form.currency || 'KRW')} />
              </div>
              <div className="space-y-1.5">
                <Label>통화</Label>
                <Select value={form.currency || 'KRW'} onValueChange={v => updateAmount(form.qty || 0, form.unitPriceCny || 0, v as Currency)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>단가</Label>
                <Input type="number" step="0.01" value={form.unitPriceCny || ''} onChange={e => updateAmount(form.qty || 0, parseFloat(e.target.value) || 0, form.currency || 'KRW')} />
              </div>
              <div className="space-y-1.5">
                <Label>KRW 금액 (자동)</Label>
                <div className="h-9 flex items-center px-3 bg-stone-50 rounded border border-stone-200 text-sm font-semibold text-stone-700">
                  {formatKRW(form.amountKrw || 0)}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>결제 방법</Label>
                <Select value={form.paymentMethod || '법인카드'} onValueChange={v => setForm(f => ({ ...f, paymentMethod: v as ExpenseType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>상태</Label>
                <Select value={form.purchaseStatus || '미구매'} onValueChange={v => setForm(f => ({ ...f, purchaseStatus: v as PurchaseItem['purchaseStatus'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PURCHASE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>메모</Label>
                <Input value={form.memo || ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave} className="bg-amber-700 hover:bg-amber-800 text-white">{editId ? '수정' : '등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
