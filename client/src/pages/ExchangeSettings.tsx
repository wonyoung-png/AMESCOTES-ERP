// AMESCOTES ERP — 환율 설정
import { useState } from 'react';
import { store, genId, type SystemSettings, type Season } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { toast } from 'sonner';
import { RefreshCw, History, TrendingUp, DollarSign, Trash2, Save, Database } from 'lucide-react';
import { manualFetchExchangeRate } from '@/hooks/useAutoExchangeRate';
import { seedDemoIntegrationData, DEMO, DEMO_SEED_FLAG } from '@/lib/seedDemoData';
import { seedLumenPackingData, getPackKits } from '@/lib/seedLumenPacking';
import { applyColorTestData } from '@/lib/fillItemColorsForTest';
import { seedLumen27ssRrp, getLumen27ssProductCount, LUMEN_27SS_SEED_FLAG } from '@/lib/seedLumen27ssRrp';

const SEASONS: Season[] = ['25FW', '26SS', '26FW', '27SS'];

export default function ExchangeSettings() {
  const [settings, setSettings] = useState<SystemSettings>(() => store.getSettings());
  const [usdInput, setUsdInput] = useState(String(settings.usdKrw));
  const [cnyInput, setCnyInput] = useState(String(settings.cnyKrw));
  const [historyMemo, setHistoryMemo] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isPackSeeding, setIsPackSeeding] = useState(false);
  const [isColorApplying, setIsColorApplying] = useState(false);
  const [isLumen27Seeding, setIsLumen27Seeding] = useState(false);
  const [packKits, setPackKits] = useState(() => getPackKits());

  const lastAutoDate = localStorage.getItem('erp_exchange_last_date');
  const lastDemoSeed = localStorage.getItem(DEMO_SEED_FLAG);
  const lastLumen27 = localStorage.getItem(LUMEN_27SS_SEED_FLAG);

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
    if (!confirm('환율 이력을 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.')) return;
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

  const handleSeedDemo = async () => {
    if (!confirm('전 탭 연동 확인용 데모 데이터를 생성합니다.\n기존 demo-* 데이터는 덮어씁니다. 계속할까요?')) return;
    setIsSeeding(true);
    try {
      const result = await seedDemoIntegrationData();
      if (result.errors.length) {
        toast.warning(`데모 생성 완료 (Supabase 일부 실패 ${result.errors.length}건)`);
        console.warn('[seedDemo]', result.errors);
      } else {
        toast.success('데모 데이터 생성 + Supabase 동기화 완료');
      }
      setPackKits(getPackKits());
      toast.info(`핵심 연동: ${DEMO.orderNoOem} → ${DEMO.projectOem}`, { duration: 6000 });
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      toast.error('데모 생성 실패');
      console.error(e);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleSeedPacking = async () => {
    if (!confirm('LUMEN·AETALOOP PACKAGE SS~XL 키트를 생성합니다.\n소모품은 자재 마스터(포장재)에 넣고, PACKAGE 품목 BOM으로 연결합니다.\n기존 LPKG-* 소모품 품목은 목록에서 제거됩니다. 계속할까요?')) return;
    setIsPackSeeding(true);
    try {
      const result = await seedLumenPackingData();
      setPackKits(result.kits);
      if (result.errors.length) {
        toast.warning(`PACKAGE ${result.itemCount}건 (일부 동기화 실패)`);
      } else {
        toast.success(`PACKAGE ${result.itemCount}건 · 포장재 ${result.materialCount}건`);
      }
      result.kits.forEach(k => toast.message(`${k.styleNo}: ₩${k.totalCostKrw.toLocaleString('ko-KR')}`));
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast.error('패킹 데이터 생성 실패');
      console.error(e);
    } finally {
      setIsPackSeeding(false);
    }
  };

  const handleApplyColors = () => {
    if (!confirm('품목 컬러 + 발주 colorQtys + 기본/미지정 입고를 실제 컬러로 재적용합니다. 계속할까요?')) return;
    setIsColorApplying(true);
    try {
      const r = applyColorTestData();
      toast.success(`컬러 재적용 · 품목 ${r.itemsUpdated} · 발주 ${r.ordersUpdated} · 입고 ${r.receiptsRemapped}`);
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast.error('컬러 재적용 실패');
      console.error(e);
    } finally {
      setIsColorApplying(false);
    }
  };

  const handleSeedLumen27 = async () => {
    if (!confirm(`LUMEN 바이어 + 27SS RRP 품목 ${getLumen27ssProductCount()}건을 등록합니다.\n(컬러 합산 · KMSRP=확정판매가 · 원가 미입력)\n계속할까요?`)) return;
    setIsLumen27Seeding(true);
    try {
      localStorage.removeItem(LUMEN_27SS_SEED_FLAG);
      const r = await seedLumen27ssRrp(true);
      if (r.errors.length) {
        toast.warning(`LUMEN 27SS: 신규 ${r.created} · 갱신 ${r.updated} (오류 ${r.errors.length})`);
      } else {
        toast.success(`LUMEN 27SS 등록 완료 · 신규 ${r.created} · 갱신 ${r.updated} / ${r.total}`);
      }
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      toast.error('LUMEN 27SS 등록 실패');
      console.error(e);
    } finally {
      setIsLumen27Seeding(false);
    }
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
        <div className="flex flex-wrap gap-3">
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
          <Button onClick={handleSeedDemo} disabled={isSeeding} className="bg-[#C9A96E] hover:bg-[#b8985f] text-white">
            <Database className={`w-4 h-4 mr-1.5 ${isSeeding ? 'animate-pulse' : ''}`} />
            {isSeeding ? '생성 중...' : '연동 데모 데이터 생성'}
          </Button>
          <Button onClick={handleSeedPacking} disabled={isPackSeeding} variant="outline" className="border-amber-300 text-amber-800 hover:bg-amber-50">
            <Database className={`w-4 h-4 mr-1.5 ${isPackSeeding ? 'animate-pulse' : ''}`} />
            {isPackSeeding ? '생성 중...' : 'PACKAGE 키트 생성 (자재 BOM)'}
          </Button>
          <Button onClick={handleApplyColors} disabled={isColorApplying} variant="outline" className="border-violet-300 text-violet-800 hover:bg-violet-50">
            <Database className={`w-4 h-4 mr-1.5 ${isColorApplying ? 'animate-pulse' : ''}`} />
            {isColorApplying ? '적용 중...' : '컬러 테스트 데이터 재적용'}
          </Button>
          <Button onClick={handleSeedLumen27} disabled={isLumen27Seeding} variant="outline" className="border-rose-300 text-rose-800 hover:bg-rose-50">
            <Database className={`w-4 h-4 mr-1.5 ${isLumen27Seeding ? 'animate-pulse' : ''}`} />
            {isLumen27Seeding ? '등록 중...' : `LUMEN 27SS RRP 품목등록 (${getLumen27ssProductCount()})`}
          </Button>
        </div>
        {lastDemoSeed && (
          <p className="text-xs text-stone-400 mt-3">
            마지막 데모 생성: {new Date(lastDemoSeed).toLocaleString('ko-KR')} · 발주 {DEMO.orderNoOem} / 프로젝트 {DEMO.projectOem}
          </p>
        )}
        {lastLumen27 && (
          <p className="text-xs text-stone-400 mt-1">
            마지막 LUMEN 27SS 등록: {new Date(lastLumen27).toLocaleString('ko-KR')}
          </p>
        )}
        {packKits.length > 0 && (
          <div className="mt-4 border border-amber-200 rounded-lg overflow-hidden">
            <div className="bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">PACKAGE 키트 원가 (자재마스터 BOM 합산)</div>
            <table className="w-full text-sm">
              <thead className="bg-white text-xs text-stone-500">
                <tr>
                  <th className="text-left px-3 py-2">스타일</th>
                  <th className="text-left px-3 py-2">구성</th>
                  <th className="text-right px-3 py-2">키트원가</th>
                </tr>
              </thead>
              <tbody>
                {packKits.map(k => (
                  <tr key={k.id} className="border-t border-amber-100">
                    <td className="px-3 py-2 font-mono font-semibold text-amber-800">{k.styleNo || k.packingSize}</td>
                    <td className="px-3 py-2 text-xs text-stone-500">{k.lines.length}개 자재</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">₩{k.totalCostKrw.toLocaleString('ko-KR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
