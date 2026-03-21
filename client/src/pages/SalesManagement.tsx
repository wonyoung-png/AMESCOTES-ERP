// AMESCOTES ERP — 매출 관리
// 이카운트 연동 전 간단 매출 기록 모듈
import { useState, useMemo } from 'react';
import { store, formatKRW, formatNumber, genId, type SalesRecord, type SettlementChannel } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, TrendingUp, ShoppingBag, BarChart3, Trash2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const CHANNELS: SettlementChannel[] = ['W Concept', '29CM', '자사몰', '해외T/T', 'B2B직납', '기타'];
const CHANNEL_COLORS: Record<string, string> = {
  'W Concept': '#C9A96E',
  '29CM': '#6B8CAE',
  '자사몰': '#8B7355',
  '해외T/T': '#7A9E7E',
  'B2B직납': '#A67C52',
  '기타': '#B0A090',
};

const EMPTY_FORM = {
  saleDate: new Date().toISOString().split('T')[0],
  channel: '' as SettlementChannel | '',
  buyerName: '',
  styleNo: '',
  styleName: '',
  qty: '',
  unitPriceKrw: '',
  memo: '',
};

export default function SalesManagement() {
  const [records, setRecords] = useState<SalesRecord[]>(() => store.getSalesRecords());
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [filterChannel, setFilterChannel] = useState<string>('all');

  const refresh = () => setRecords(store.getSalesRecords());

  const totalSales = useMemo(() => records.reduce((s, r) => s + r.totalKrw, 0), [records]);
  const totalQty = useMemo(() => records.reduce((s, r) => s + r.qty, 0), [records]);

  // 채널별 집계
  const channelData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of records) {
      map[r.channel] = (map[r.channel] || 0) + r.totalKrw;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [records]);

  // 월별 집계
  const monthlyData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of records) {
      const month = r.saleDate.slice(0, 7);
      map[month] = (map[month] || 0) + r.totalKrw;
    }
    return Object.entries(map).sort().map(([month, total]) => ({ month, total }));
  }, [records]);

  const filtered = useMemo(() =>
    filterChannel === 'all' ? records : records.filter(r => r.channel === filterChannel),
    [records, filterChannel]
  );

  const handleSave = () => {
    if (!form.saleDate || !form.channel || !form.buyerName || !form.qty || !form.unitPriceKrw) {
      toast.error('필수 항목을 입력해주세요');
      return;
    }
    const qty = parseInt(form.qty);
    const unitPrice = parseInt(form.unitPriceKrw.replace(/,/g, ''));
    const record: SalesRecord = {
      id: genId(),
      saleDate: form.saleDate,
      channel: form.channel as SettlementChannel,
      buyerName: form.buyerName,
      styleNo: form.styleNo || undefined,
      styleName: form.styleName || undefined,
      qty,
      unitPriceKrw: unitPrice,
      totalKrw: qty * unitPrice,
      memo: form.memo || undefined,
      createdAt: new Date().toISOString(),
    };
    store.addSalesRecord(record);
    refresh();
    setShowModal(false);
    setForm({ ...EMPTY_FORM });
    toast.success('매출이 등록되었습니다');
  };

  const handleDelete = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    store.deleteSalesRecord(id);
    refresh();
    toast.success('삭제되었습니다');
  };

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">매출 관리</h1>
          <p className="text-sm text-stone-500 mt-0.5">채널별 매출 기록 및 현황 (이카운트 연동 전 간이 버전)</p>
        </div>
        <Button onClick={() => setShowModal(true)} className="bg-amber-700 hover:bg-amber-800 text-white gap-2">
          <Plus className="w-4 h-4" />
          매출 등록
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <p className="text-xs text-stone-500">총 매출</p>
              <p className="text-xl font-bold text-stone-800">{formatKRW(totalSales)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-stone-50 flex items-center justify-center">
              <ShoppingBag className="w-5 h-5 text-stone-600" />
            </div>
            <div>
              <p className="text-xs text-stone-500">총 판매 수량</p>
              <p className="text-xl font-bold text-stone-800">{formatNumber(totalQty)} PCS</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-stone-500">거래 건수</p>
              <p className="text-xl font-bold text-stone-800">{records.length}건</p>
            </div>
          </div>
        </div>
      </div>

      {/* 차트 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 월별 매출 */}
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <h3 className="text-sm font-semibold text-stone-700 mb-4">월별 매출</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ece8" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} />
              <Tooltip formatter={(v: number) => formatKRW(v)} />
              <Bar dataKey="total" fill="#C9A96E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 채널별 비중 */}
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <h3 className="text-sm font-semibold text-stone-700 mb-4">채널별 매출 비중</h3>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={160}>
              <PieChart>
                <Pie data={channelData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value">
                  {channelData.map((entry) => (
                    <Cell key={entry.name} fill={CHANNEL_COLORS[entry.name] || '#B0A090'} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatKRW(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {channelData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CHANNEL_COLORS[d.name] || '#B0A090' }} />
                  <span className="text-stone-600">{d.name}</span>
                  <span className="font-medium text-stone-800">{formatKRW(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-stone-200">
        <div className="flex items-center justify-between p-4 border-b border-stone-100">
          <h3 className="text-sm font-semibold text-stone-700">매출 내역</h3>
          <Select value={filterChannel} onValueChange={setFilterChannel}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="채널 필터" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 채널</SelectItem>
              {CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">날짜</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">채널</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">바이어</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">스타일</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">단가</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">금액</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-stone-400 text-sm">등록된 매출이 없습니다</td></tr>
              ) : (
                filtered.sort((a, b) => b.saleDate.localeCompare(a.saleDate)).map(r => (
                  <tr key={r.id} className="border-b border-stone-50 hover:bg-stone-50/50">
                    <td className="px-4 py-3 text-stone-600">{r.saleDate}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs" style={{ borderColor: CHANNEL_COLORS[r.channel], color: CHANNEL_COLORS[r.channel] }}>
                        {r.channel}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-medium text-stone-800">{r.buyerName}</td>
                    <td className="px-4 py-3 text-stone-600">{r.styleName || r.styleNo || '-'}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{formatNumber(r.qty)} PCS</td>
                    <td className="px-4 py-3 text-right text-stone-600">{formatKRW(r.unitPriceKrw)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-stone-800">{formatKRW(r.totalKrw)}</td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDelete(r.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 등록 모달 */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>매출 등록</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>날짜 *</Label>
                <Input type="date" value={form.saleDate} onChange={e => setForm(f => ({ ...f, saleDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>채널 *</Label>
                <Select value={form.channel} onValueChange={v => setForm(f => ({ ...f, channel: v as SettlementChannel }))}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>바이어명 *</Label>
              <Input value={form.buyerName} onChange={e => setForm(f => ({ ...f, buyerName: e.target.value }))} placeholder="W Concept" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>스타일번호</Label>
                <Input value={form.styleNo} onChange={e => setForm(f => ({ ...f, styleNo: e.target.value }))} placeholder="LLL5S57TB" />
              </div>
              <div className="space-y-1.5">
                <Label>스타일명</Label>
                <Input value={form.styleName} onChange={e => setForm(f => ({ ...f, styleName: e.target.value }))} placeholder="PANIER PETIT BAG" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>수량 (PCS) *</Label>
                <Input type="number" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} placeholder="100" />
              </div>
              <div className="space-y-1.5">
                <Label>단가 (KRW) *</Label>
                <Input type="number" value={form.unitPriceKrw} onChange={e => setForm(f => ({ ...f, unitPriceKrw: e.target.value }))} placeholder="218000" />
              </div>
            </div>
            {form.qty && form.unitPriceKrw && (
              <div className="bg-amber-50 rounded-lg p-3 text-sm">
                <span className="text-stone-600">합계: </span>
                <span className="font-bold text-amber-800">{formatKRW(parseInt(form.qty || '0') * parseInt(form.unitPriceKrw || '0'))}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>메모</Label>
              <Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
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
