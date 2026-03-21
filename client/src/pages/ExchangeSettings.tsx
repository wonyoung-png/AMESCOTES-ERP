// AMESCOTES ERP — 환율 설정
import { useState } from 'react';
import { store, genId, type SystemSettings, type Season } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { toast } from 'sonner';
import { RefreshCw, History, TrendingUp, DollarSign, Trash2, Save } from 'lucide-react';
import { manualFetchExchangeRate } from '@/hooks/useAutoExchangeRate';

const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS'];

export default function ExchangeSettings() {
  const [settings, setSettings] = useState<SystemSettings>(() => store.getSettings());
  const [usdInput, setUsdInput] = useState(String(settings.usdKrw));
  const [cnyInput, setCnyInput] = useState(String(settings.cnyKrw));
  const [historyMemo, setHistoryMemo] = useState('');
  const [isFetching, setIsFetching] = useState(false);

  const lastAutoDate = localStorage.getItem('erp_exchange_last_date');

  const handleAutoFetch = async () => {
    setIsFetching(true);
    try {
      await manualFetchExchangeRate();
      const updated = store.getSettings();
      setSettings(updated);
      setUsdInput(String(updated.usdKrw));
      setCnyInput(String(updated.cnyKrw));
      toast.success(`환율 새로고침 완료 — USD ${updated.usdKrw.toLocaleString()} / CNY ${updated.cnyKrw.toLocaleString()}`);
    } catch {
      toast.error('환율 가져오기 실패 — 네트워크를 확인해주세요');
    } finally {
      setIsFetching(false);
    }
  };

  const handleApply = () => {
    const usd = parseFloat(usdInput);
    const cny = parseFloat(cnyInput);
    if (isNaN(usd) || isNaN(cny) || usd <= 0 || cny <= 0) {
      toast.error('유효한 환율을 입력해주세요');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const newHistory = [
      ...settings.exchangeHistory,
      { id: genId(), date: today, usdKrw: usd, cnyKrw: cny, memo: historyMemo || undefined },
    ];
    const updated: SystemSettings = { ...settings, usdKrw: usd, cnyKrw: cny, exchangeHistory: newHistory };
    store.setSettings(updated);
    setSettings(updated);
    setHistoryMemo('');
    toast.success(`환율이 적용되었습니다 — USD ${usd.toLocaleString()} / CNY ${cny.toLocaleString()}`);
  };

  const handleDeleteHistory = (id: string) => {
    const newHistory = settings.exchangeHistory.filter(h => h.id !== id);
    const updated = { ...settings, exchangeHistory: newHistory };
    store.setSettings(updated);
    setSettings(updated);
    toast.success('삭제되었습니다');
  };

  const handleSeasonChange = (season: Season) => {
    const updated = { ...settings, currentSeason: season };
    store.setSettings(updated);
    setSettings(updated);
    toast.success(`현재 시즌이 ${season}으로 변경되었습니다`);
  };

  const handleDdayAlertChange = (days: number) => {
    const updated = { ...settings, ddayAlertDays: days };
    store.setSettings(updated);
    setSettings(updated);
  };

  const handleBackup = () => {
    const data = JSON.stringify({
      items: store.getItems(),
      boms: store.getBoms(),
      samples: store.getSamples(),
      orders: store.getOrders(),
      purchaseItems: store.getPurchaseItems(),
      postCosts: store.getPostCosts(),
      vendors: store.getVendors(),
      settlements: store.getSettlements(),
      expenses: store.getExpenses(),
      salesRecords: store.getSalesRecords(),
      settings: store.getSettings(),
    });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `amescotes-erp-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('백업 파일이 다운로드됩니다');
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.items) store.setItems(data.items);
      if (data.boms) store.setBoms(data.boms);
      if (data.samples) store.setSamples(data.samples);
      if (data.orders) store.setOrders(data.orders);
      if (data.purchaseItems) store.setPurchaseItems(data.purchaseItems);
      if (data.postCosts) store.setPostCosts(data.postCosts);
      if (data.vendors) store.setVendors(data.vendors);
      if (data.settlements) store.setSettlements(data.settlements);
      if (data.expenses) store.setExpenses(data.expenses);
      if (data.salesRecords) store.setSalesRecords(data.salesRecords);
      if (data.settings) store.setSettings(data.settings);
      toast.success('데이터가 복원되었습니다. 새로고침합니다.');
      setTimeout(() => window.location.reload(), 1000);
    } catch {
      toast.error('파일 파싱 실패');
    }
  };

  const handleClearAll = () => {
    if (!confirm('모든 데이터를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
    store.clearAll();
    toast.success('데이터가 초기화되었습니다. 페이지를 새로고침해주세요.');
    setTimeout(() => window.location.reload(), 1500);
  };

  const sortedHistory = [...settings.exchangeHistory].sort((a, b) => b.date.localeCompare(a.date));
  const chartData = [...settings.exchangeHistory].sort((a, b) => a.date.localeCompare(b.date)).slice(-20);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-800">환율 설정</h1>
        <p className="text-sm text-stone-500 mt-0.5">현재 적용 환율 및 시스템 설정 관리</p>
      </div>

      {/* 현재 환율 + 시스템 설정 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />
              <span className="font-semibold text-stone-700">현재 적용 환율</span>
            </div>
            <div className="flex items-center gap-2">
              {lastAutoDate && (
                <span className="text-xs text-stone-400">마지막 업데이트: {lastAutoDate}</span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleAutoFetch}
                disabled={isFetching}
                className="h-7 text-xs gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
                {isFetching ? '가져오는 중...' : '실시간 새로고침'}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-stone-500 mb-1">USD / KRW</p>
              <p className="text-2xl font-bold text-stone-800">{settings.usdKrw.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500 mb-1">CNY / KRW</p>
              <p className="text-2xl font-bold text-stone-800">{settings.cnyKrw.toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-amber-600" />
            <span className="font-semibold text-stone-700">시스템 설정</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-stone-500 mb-1">현재 시즌</p>
              <Select value={settings.currentSeason} onValueChange={v => handleSeasonChange(v as Season)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{SEASONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-stone-500 mb-1">D-Day 알림 기준 (일)</p>
              <Input
                type="number"
                className="h-8 text-sm"
                value={settings.ddayAlertDays}
                onChange={e => handleDdayAlertChange(parseInt(e.target.value) || 7)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 환율 업데이트 */}
      <div className="bg-white rounded-xl border border-stone-200 p-5">
        <h2 className="font-semibold text-stone-700 mb-4 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-amber-600" />
          환율 업데이트
        </h2>
        <div className="grid grid-cols-4 gap-3 items-end">
          <div className="space-y-1.5">
            <Label>USD/KRW</Label>
            <Input type="number" value={usdInput} onChange={e => setUsdInput(e.target.value)} placeholder="1380" />
          </div>
          <div className="space-y-1.5">
            <Label>CNY/KRW</Label>
            <Input type="number" value={cnyInput} onChange={e => setCnyInput(e.target.value)} placeholder="191" />
          </div>
          <div className="space-y-1.5">
            <Label>메모 (선택)</Label>
            <Input value={historyMemo} onChange={e => setHistoryMemo(e.target.value)} placeholder="예: 3월 4주차 기준" />
          </div>
          <Button onClick={handleApply} className="bg-amber-700 hover:bg-amber-800 text-white">적용</Button>
        </div>
      </div>

      {/* 환율 추이 차트 */}
      {chartData.length > 1 && (
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <h2 className="font-semibold text-stone-700 mb-4">환율 추이</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="usd" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <YAxis yAxisId="cny" orientation="right" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <Tooltip />
                <Line yAxisId="usd" type="monotone" dataKey="usdKrw" stroke="#C9A96E" strokeWidth={2} name="USD/KRW" dot={{ r: 3 }} />
                <Line yAxisId="cny" type="monotone" dataKey="cnyKrw" stroke="#8B7355" strokeWidth={2} name="CNY/KRW" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 환율 이력 */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 flex items-center gap-2">
          <History className="w-4 h-4 text-stone-500" />
          <h2 className="font-semibold text-stone-700">환율 변경 이력</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="text-left px-5 py-3 text-xs font-medium text-stone-500">날짜</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-stone-500">USD/KRW</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-stone-500">CNY/KRW</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-stone-500">메모</th>
              <th className="text-center px-5 py-3 text-xs font-medium text-stone-500">작업</th>
            </tr>
          </thead>
          <tbody>
            {sortedHistory.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-stone-400 text-sm">환율 이력이 없습니다</td></tr>
            ) : sortedHistory.map((h, i) => (
              <tr key={h.id} className={`border-b border-stone-50 ${i === 0 ? 'bg-amber-50/30' : 'hover:bg-stone-50/50'}`}>
                <td className="px-5 py-3 text-stone-700">
                  {h.date}
                  {i === 0 && <span className="ml-2 text-xs text-amber-600 font-medium">현재 적용</span>}
                </td>
                <td className="px-5 py-3 text-right font-mono font-semibold text-stone-800">{h.usdKrw.toLocaleString()}</td>
                <td className="px-5 py-3 text-right font-mono font-semibold text-stone-800">{h.cnyKrw.toLocaleString()}</td>
                <td className="px-5 py-3 text-stone-500">{h.memo || '-'}</td>
                <td className="px-5 py-3 text-center">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-400 hover:text-red-500" onClick={() => handleDeleteHistory(h.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 데이터 관리 */}
      <div className="bg-white rounded-xl border border-stone-200 p-5">
        <h2 className="font-semibold text-stone-700 mb-3 flex items-center gap-2">
          <Save className="w-4 h-4 text-stone-500" />
          데이터 관리
        </h2>
        <p className="text-sm text-stone-500 mb-4">모든 데이터는 브라우저 localStorage에 저장됩니다. 정기적으로 백업하세요.</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleBackup}>
            <Save className="w-4 h-4 mr-1.5" />데이터 백업
          </Button>
          <label>
            <input type="file" accept=".json" className="hidden" onChange={handleRestore} />
            <Button variant="outline" asChild>
              <span className="cursor-pointer">
                <RefreshCw className="w-4 h-4 mr-1.5" />데이터 복원
              </span>
            </Button>
          </label>
        </div>
      </div>

      {/* 위험 구역 */}
      <div className="bg-red-50 rounded-xl border border-red-200 p-5">
        <h2 className="font-semibold text-red-700 mb-2">위험 구역</h2>
        <p className="text-sm text-red-600 mb-3">모든 ERP 데이터를 초기화합니다. 이 작업은 되돌릴 수 없습니다.</p>
        <Button variant="outline" className="border-red-300 text-red-600 hover:bg-red-100" onClick={handleClearAll}>
          전체 데이터 초기화
        </Button>
      </div>
    </div>
  );
}
