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
import { Plus, TrendingUp, ShoppingBag, BarChart3, Trash2, Package, Calendar, Users, Building2, Tag } from 'lucide-react';
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

type StatTab = 'monthly' | 'buyer' | 'factory' | 'style';

export default function SalesManagement() {
  const [records, setRecords] = useState<SalesRecord[]>(() => store.getSalesRecords());
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'list' | 'stats'>('list');
  const [statTab, setStatTab] = useState<StatTab>('monthly');

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

  // 통계: 월별 (역순)
  const monthlySales = useMemo(() => {
    const map = new Map<string, { total: number; qty: number; count: number }>();
    records.forEach(s => {
      const month = s.saleDate?.slice(0, 7) || '미상';
      const existing = map.get(month) || { total: 0, qty: 0, count: 0 };
      map.set(month, { total: existing.total + s.totalKrw, qty: existing.qty + s.qty, count: existing.count + 1 });
    });
    return Array.from(map.entries()).sort().reverse().map(([month, data]) => ({ month, ...data }));
  }, [records]);

  // 통계: 브랜드별
  const buyerSales = useMemo(() => {
    const map = new Map<string, { name: string; total: number; qty: number; count: number }>();
    records.forEach(s => {
      const key = s.buyerName || '미지정';
      const existing = map.get(key) || { name: key, total: 0, qty: 0, count: 0 };
      map.set(key, { ...existing, total: existing.total + s.totalKrw, qty: existing.qty + s.qty, count: existing.count + 1 });
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [records]);

  // 통계: 공장별 (vendorName 기준)
  const factorySales = useMemo(() => {
    const map = new Map<string, { name: string; total: number; qty: number; count: number }>();
    records.forEach(s => {
      const key = (s as any).vendorName || '미지정';
      const existing = map.get(key) || { name: key, total: 0, qty: 0, count: 0 };
      map.set(key, { ...existing, total: existing.total + s.totalKrw, qty: existing.qty + s.qty, count: existing.count + 1 });
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [records]);

  // 통계: 스타일별
  const styleSales = useMemo(() => {
    const map = new Map<string, { styleNo: string; styleName: string; total: number; qty: number; count: number }>();
    records.forEach(s => {
      const key = s.styleNo || s.styleName || '미분류';
      const existing = map.get(key) || { styleNo: s.styleNo || '', styleName: s.styleName || key, total: 0, qty: 0, count: 0 };
      map.set(key, { ...existing, total: existing.total + s.totalKrw, qty: existing.qty + s.qty, count: existing.count + 1 });
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
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
      source: 'manual',
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

  const statTabItems: { key: StatTab; label: string; icon: React.ReactNode }[] = [
    { key: 'monthly', label: '월별', icon: <Calendar className="w-3.5 h-3.5" /> },
    { key: 'buyer', label: '브랜드별', icon: <Users className="w-3.5 h-3.5" /> },
    { key: 'factory', label: '공장별', icon: <Building2 className="w-3.5 h-3.5" /> },
    { key: 'style', label: '스타일별', icon: <Tag className="w-3.5 h-3.5" /> },
  ];

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

      {/* 탭 전환 */}
      <div className="flex gap-2 border-b border-stone-200">
        <button
          onClick={() => setActiveTab('list')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'list'
              ? 'border-amber-700 text-amber-700'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          매출 내역
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'stats'
              ? 'border-amber-700 text-amber-700'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          <BarChart3 className="w-4 h-4" />통계
        </button>
      </div>

      {activeTab === 'list' && (
        <>
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
                    <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">발주번호</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">공장</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">단가</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">금액</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-12 text-stone-400 text-sm">등록된 매출이 없습니다</td></tr>
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
                        <td className="px-4 py-3 text-stone-600">
                          {r.styleNo && <span className="font-mono text-xs text-stone-500 mr-1">{r.styleNo}</span>}
                          {r.styleName || '-'}
                        </td>
                        <td className="px-4 py-3 text-stone-500 text-xs">
                          {(r as any).orderNo
                            ? <span className="bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded text-xs">{(r as any).orderNo}</span>
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-stone-500 text-xs">{(r as any).vendorName || '-'}</td>
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
        </>
      )}

      {activeTab === 'stats' && (
        <div className="space-y-4">
          {/* 통계 서브탭 */}
          <div className="bg-white rounded-xl border border-stone-200 p-1 flex gap-1">
            {statTabItems.map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  statTab === tab.key
                    ? 'bg-amber-700 text-white'
                    : 'text-stone-500 hover:bg-stone-50'
                }`}
              >
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* 월별 매출 통계 */}
          {statTab === 'monthly' && (
            <div className="bg-white rounded-xl border border-stone-200">
              <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-700" />
                <h3 className="text-sm font-semibold text-stone-700">월별 매출 현황</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">월</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">건수</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량(PCS)</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">매출액</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlySales.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-8 text-stone-400 text-sm">데이터 없음</td></tr>
                    ) : monthlySales.map(row => (
                      <tr key={row.month} className="border-b border-stone-50 hover:bg-stone-50/50">
                        <td className="px-4 py-3 font-medium text-stone-700">{row.month}</td>
                        <td className="px-4 py-3 text-right text-stone-500">{row.count}건</td>
                        <td className="px-4 py-3 text-right text-stone-600">{formatNumber(row.qty)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-stone-800">{formatKRW(row.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-stone-400">
                            {totalSales > 0 ? `${((row.total / totalSales) * 100).toFixed(1)}%` : '-'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {monthlySales.length > 0 && (
                    <tfoot>
                      <tr className="bg-amber-50 border-t border-amber-200">
                        <td className="px-4 py-3 font-semibold text-amber-800">합계</td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-800">{records.length}건</td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-800">{formatNumber(totalQty)}</td>
                        <td className="px-4 py-3 text-right font-bold text-amber-900">{formatKRW(totalSales)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-800">100%</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* 브랜드별 매출 통계 */}
          {statTab === 'buyer' && (
            <div className="bg-white rounded-xl border border-stone-200">
              <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-700" />
                <h3 className="text-sm font-semibold text-stone-700">브랜드별 매출 현황</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">바이어</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">건수</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량(PCS)</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">매출액</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyerSales.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-8 text-stone-400 text-sm">데이터 없음</td></tr>
                    ) : buyerSales.map((row, idx) => (
                      <tr key={row.name} className="border-b border-stone-50 hover:bg-stone-50/50">
                        <td className="px-4 py-3 font-medium text-stone-800">
                          <span className="text-xs text-stone-400 mr-2">#{idx + 1}</span>
                          {row.name}
                        </td>
                        <td className="px-4 py-3 text-right text-stone-500">{row.count}건</td>
                        <td className="px-4 py-3 text-right text-stone-600">{formatNumber(row.qty)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-stone-800">{formatKRW(row.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full"
                                style={{ width: totalSales > 0 ? `${(row.total / totalSales) * 100}%` : '0%' }}
                              />
                            </div>
                            <span className="text-xs text-stone-400 w-10 text-right">
                              {totalSales > 0 ? `${((row.total / totalSales) * 100).toFixed(1)}%` : '-'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 공장별 매출 통계 */}
          {statTab === 'factory' && (
            <div className="bg-white rounded-xl border border-stone-200">
              <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-700" />
                <h3 className="text-sm font-semibold text-stone-700">공장별 매출 현황</h3>
                <span className="text-xs text-stone-400">(생산발주 연동 매출 기준)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">공장</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">건수</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량(PCS)</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">매출액</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factorySales.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-8 text-stone-400 text-sm">데이터 없음</td></tr>
                    ) : factorySales.map((row, idx) => (
                      <tr key={row.name} className="border-b border-stone-50 hover:bg-stone-50/50">
                        <td className="px-4 py-3 font-medium text-stone-800">
                          <span className="text-xs text-stone-400 mr-2">#{idx + 1}</span>
                          {row.name}
                        </td>
                        <td className="px-4 py-3 text-right text-stone-500">{row.count}건</td>
                        <td className="px-4 py-3 text-right text-stone-600">{formatNumber(row.qty)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-stone-800">{formatKRW(row.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: totalSales > 0 ? `${(row.total / totalSales) * 100}%` : '0%' }}
                              />
                            </div>
                            <span className="text-xs text-stone-400 w-10 text-right">
                              {totalSales > 0 ? `${((row.total / totalSales) * 100).toFixed(1)}%` : '-'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 스타일별 매출 통계 */}
          {statTab === 'style' && (
            <div className="bg-white rounded-xl border border-stone-200">
              <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-2">
                <Tag className="w-4 h-4 text-amber-700" />
                <h3 className="text-sm font-semibold text-stone-700">스타일별 매출 현황</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">스타일번호</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-stone-500">품명</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">건수</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">수량(PCS)</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">매출액</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-stone-500">비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {styleSales.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-stone-400 text-sm">데이터 없음</td></tr>
                    ) : styleSales.map((row, idx) => (
                      <tr key={row.styleNo || row.styleName} className="border-b border-stone-50 hover:bg-stone-50/50">
                        <td className="px-4 py-3 font-mono text-xs text-stone-500">
                          <span className="text-stone-300 mr-2">#{idx + 1}</span>
                          {row.styleNo || '-'}
                        </td>
                        <td className="px-4 py-3 font-medium text-stone-800">{row.styleName}</td>
                        <td className="px-4 py-3 text-right text-stone-500">{row.count}건</td>
                        <td className="px-4 py-3 text-right text-stone-600">{formatNumber(row.qty)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-stone-800">{formatKRW(row.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-green-500 rounded-full"
                                style={{ width: totalSales > 0 ? `${(row.total / totalSales) * 100}%` : '0%' }}
                              />
                            </div>
                            <span className="text-xs text-stone-400 w-10 text-right">
                              {totalSales > 0 ? `${((row.total / totalSales) * 100).toFixed(1)}%` : '-'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

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
