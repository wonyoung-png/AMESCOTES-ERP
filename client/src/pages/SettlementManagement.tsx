// AMESCOTES ERP — 정산 / 미수금 관리
import { useState, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import {
  store, genId, formatKRW, formatNumber,
  type Settlement, type SettlementStatus, type SettlementChannel, type Vendor,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { toast } from 'sonner';
import { Plus, Search, Trash2, AlertTriangle, CheckCircle, Clock, Wallet } from 'lucide-react';

const CHANNELS: SettlementChannel[] = ['W Concept', '29CM', '자사몰', '해외T/T', 'B2B직납', '기타'];
const STATUSES: SettlementStatus[] = ['정상', '주의', '위험', '완납'];

const STATUS_COLOR: Record<SettlementStatus, string> = {
  '정상': 'bg-[var(--fill-quaternary)] text-primary border-border',
  '주의': 'bg-[var(--fill-quaternary)] text-[var(--system-orange)] border-border',
  '위험': 'bg-[var(--fill-quaternary)] text-[var(--system-red)] border-border',
  '완납': 'bg-[var(--fill-quaternary)] text-[var(--system-green)] border-border',
};

function calcStatus(dueDate: string, collected: number, billed: number): SettlementStatus {
  if (collected >= billed) return '완납';
  const dday = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
  if (dday < 0) return '위험';
  if (dday <= 14) return '주의';
  return '정상';
}

export default function SettlementManagement() {
  const [settlements, setSettlements] = useState<Settlement[]>(() => store.getSettlements());
  const [buyers] = useState<Vendor[]>(() => store.getVendors().filter(v => v.type === '바이어'));
  const [search, setSearch] = usePersistedState('settlement.search', '');
  const [filterStatus, setFilterStatus] = usePersistedState('settlement.filterStatus', 'all');
  const [filterChannel, setFilterChannel] = usePersistedState('settlement.filterChannel', 'all');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Partial<Settlement>>({});
  const [editId, setEditId] = useState<string | null>(null);

  const refresh = () => setSettlements(store.getSettlements());

  const filtered = useMemo(() => {
    let list = settlements;
    if (filterStatus !== 'all') list = list.filter(s => s.status === filterStatus);
    if (filterChannel !== 'all') list = list.filter(s => s.channel === filterChannel);
    if (search) list = list.filter(s =>
      s.buyerName.toLowerCase().includes(search.toLowerCase()) ||
      (s.invoiceNo || '').toLowerCase().includes(search.toLowerCase())
    );
    // 연체 먼저, 그 다음 만기일 임박 순
    return list.sort((a, b) => {
      const aElapsed = a.status !== '완납' ? calcElapsedDays(a.dueDate) : -999;
      const bElapsed = b.status !== '완납' ? calcElapsedDays(b.dueDate) : -999;
      return bElapsed - aElapsed;
    });
  }, [settlements, filterStatus, filterChannel, search]);

  // 바이어별 누적 거래금액
  const buyerStats = useMemo(() => {
    const map = new Map<string, { name: string; total: number; collected: number; count: number }>();
    settlements.forEach(s => {
      const key = s.buyerName;
      const cur = map.get(key) || { name: key, total: 0, collected: 0, count: 0 };
      cur.total += s.billedAmountKrw;
      cur.collected += s.collectedAmountKrw;
      cur.count++;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [settlements]);

  const [showBuyerStats, setShowBuyerStats] = useState(false);

  const stats = useMemo(() => {
    const unpaid = settlements.filter(s => s.status !== '완납');
    const totalBilled = unpaid.reduce((s, x) => s + x.billedAmountKrw, 0);
    const totalCollected = unpaid.reduce((s, x) => s + x.collectedAmountKrw, 0);
    const overdue = settlements.filter(s => s.status === '위험');
    const over90 = settlements.filter(s => {
      if (s.status === '완납') return false;
      const dday = Math.ceil((new Date(s.dueDate).getTime() - Date.now()) / 86400000);
      return dday < -90;
    });
    return {
      totalReceivable: totalBilled - totalCollected,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((s, x) => s + (x.billedAmountKrw - x.collectedAmountKrw), 0),
      over90Amount: over90.reduce((s, x) => s + (x.billedAmountKrw - x.collectedAmountKrw), 0),
    };
  }, [settlements]);

  const agingData = useMemo(() => {
    const buckets = [
      { name: '30일 이내', min: 0, max: 30, total: 0 },
      { name: '31-60일', min: 31, max: 60, total: 0 },
      { name: '61-90일', min: 61, max: 90, total: 0 },
      { name: '90일 초과', min: 91, max: 9999, total: 0 },
    ];
    settlements.filter(s => s.status !== '완납').forEach(s => {
      const days = Math.abs(Math.ceil((Date.now() - new Date(s.dueDate).getTime()) / 86400000));
      const bucket = buckets.find(b => days >= b.min && days <= b.max);
      if (bucket) bucket.total += s.billedAmountKrw - s.collectedAmountKrw;
    });
    return buckets;
  }, [settlements]);

  const AGING_COLORS = ['var(--chart-4)', 'var(--chart-3)', 'var(--chart-2)', 'var(--system-red)'];

  // 경과일 계산 (만기일 기준, 음수면 경과)
  const calcElapsedDays = (dueDate: string) => {
    const ms = Date.now() - new Date(dueDate).getTime();
    return Math.floor(ms / 86400000);  // 양수 = 경과일
  };

  // 경과된 미수금 목록
  const overdueList = useMemo(
    () => settlements.filter(s => s.status !== '완납' && calcElapsedDays(s.dueDate) > 0),
    [settlements]
  );

  const openNew = () => {
    setForm({ channel: 'W Concept', billedAmountKrw: 0, collectedAmountKrw: 0, status: '정상', invoiceDate: new Date().toISOString().split('T')[0] });
    setEditId(null);
    setShowModal(true);
  };

  const openEdit = (s: Settlement) => {
    setForm({ ...s });
    setEditId(s.id);
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.buyerName) { toast.error('바이어명을 입력하세요'); return; }
    if (!form.invoiceDate || !form.dueDate) { toast.error('날짜를 입력하세요'); return; }
    const status = calcStatus(form.dueDate!, form.collectedAmountKrw || 0, form.billedAmountKrw || 0);
    if (editId) {
      store.updateSettlement(editId, { ...form, status } as Partial<Settlement>);
      toast.success('수정되었습니다');
    } else {
      const s: Settlement = {
        id: genId(),
        buyerName: form.buyerName!,
        channel: form.channel || '기타',
        invoiceNo: form.invoiceNo,
        invoiceDate: form.invoiceDate!,
        dueDate: form.dueDate!,
        billedAmountKrw: form.billedAmountKrw || 0,
        collectedAmountKrw: form.collectedAmountKrw || 0,
        collectedDate: form.collectedDate,
        status,
        memo: form.memo,
        createdAt: new Date().toISOString(),
      };
      store.addSettlement(s);
      toast.success('정산 내역이 등록되었습니다');
    }
    refresh();
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    store.deleteSettlement(id);
    refresh();
    toast.success('삭제되었습니다');
  };

  const handleCollect = (s: Settlement) => {
    const today = new Date().toISOString().split('T')[0];
    store.updateSettlement(s.id, {
      collectedAmountKrw: s.billedAmountKrw,
      collectedDate: today,
      status: '완납',
    });
    // 연결된 거래명세표의 상태를 "수금완료"로 자동 변경
    if (s.invoiceNo) {
      const tradeStatements = store.getTradeStatements();
      const linked = tradeStatements.find(ts => ts.statementNo === s.invoiceNo);
      if (linked && linked.status !== '수금완료') {
        store.updateTradeStatement(linked.id, { status: '수금완료' });
      }
    }
    refresh();
    toast.success('수금 완료 처리되었습니다. 거래명세표 상태가 자동 업데이트됩니다.');
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">정산 / 미수금</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5 hidden sm:block">명세표 발행 후 입금 현황 관리 · 기한 초과 자동 알림</p>
        </div>
        <Button onClick={openNew} className="gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-10 px-2 md:px-4">
          <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />정산 등록
        </Button>
      </div>

      {/* 연체 알림 배너 */}
      {overdueList.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">
              만기 경과 미수금 {overdueList.length}건 있습니다
            </p>
            <p className="text-xs text-destructive mt-0.5">
              {overdueList.map(s => `${s.buyerName} (D+${calcElapsedDays(s.dueDate)}일)`).join(' · ')}
            </p>
          </div>
        </div>
      )}

      {/* 미수금 총액 대시보드 */}
      <div className="bg-foreground rounded-lg p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-background/60 text-xs mb-1">총 미수금</p>
          <p className="text-2xl font-bold text-background">{formatKRW(stats.totalReceivable)}</p>
          <p className="text-background/60 text-xs mt-1">미납 합계 (완납 제외)</p>
        </div>
        {stats.overdueCount > 0 && (
          <div className="text-right">
            <p className="text-[var(--system-red)] text-sm font-semibold flex items-center justify-end gap-1"><AlertTriangle className="w-4 h-4" />연체 {stats.overdueCount}건</p>
            <p className="text-[var(--system-red)] text-xl font-bold">{formatKRW(stats.overdueAmount)}</p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        {[
          { label: '연체 건수', value: `${stats.overdueCount}건`, sub: '기한 초과', color: 'text-[var(--system-red)]' },
          { label: '연체 금액', value: formatKRW(stats.overdueAmount), sub: '기한 초과 미수금', color: 'text-[var(--system-red)]' },
          { label: '90일 초과', value: formatKRW(stats.over90Amount), sub: '장기 미수금', color: 'text-[var(--system-red)]' },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-lg border border-border p-4">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            <p className="text-[11px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-[var(--system-orange)]" />
          <p className="text-sm font-semibold text-foreground">미수금 에이징 분석</p>
        </div>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agingData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${(v / 10000).toFixed(0)}만`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => formatKRW(v)} />
              <Bar dataKey="total" radius={[4, 4, 0, 0]} barSize={40}>
                {agingData.map((_, i) => <Cell key={i} fill={AGING_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 바이어별 누적 거래금액 */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-foreground">바이어별 누적 거래금액</p>
          <button
            onClick={() => setShowBuyerStats(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-[var(--fill-quaternary)] transition-colors"
          >
            {showBuyerStats ? '접기' : '펼치기'}
          </button>
        </div>
        {showBuyerStats && (
          buyerStats.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">등록된 정산 내역이 없습니다</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="data-table w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-[13px] font-semibold text-muted-foreground">바이어</th>
                  <th className="ctr text-[13px] font-semibold text-muted-foreground">거래건수</th>
                  <th className="num text-[13px] font-semibold text-muted-foreground">총 청구금액</th>
                  <th className="num text-[13px] font-semibold text-muted-foreground">수금금액</th>
                  <th className="num text-[13px] font-semibold text-muted-foreground">미수금</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {buyerStats.map(b => (
                  <tr key={b.name} className="hover:bg-[var(--fill-quaternary)]">
                    <td className="font-medium text-foreground">{b.name}</td>
                    <td className="ctr text-muted-foreground">{b.count}건</td>
                    <td className="nw num font-mono text-foreground">{formatKRW(b.total)}</td>
                    <td className="nw num font-mono text-[var(--system-green)]">{formatKRW(b.collected)}</td>
                    <td className="nw num font-mono font-semibold text-[var(--system-red)]">
                      {b.total - b.collected > 0 ? formatKRW(b.total - b.collected) : <span className="text-muted-foreground">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )
        )}
        {!showBuyerStats && buyerStats.length > 0 && (
          <p className="text-xs text-muted-foreground">{buyerStats.length}개 바이어 · 총 청구 {formatKRW(buyerStats.reduce((s, b) => s + b.total, 0))}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 max-w-xs min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="바이어명 / 명세서번호 검색" className="pl-9 h-9" />
        </div>
        <Select value={filterChannel} onValueChange={setFilterChannel}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="채널" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 채널</SelectItem>
            {CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-28 h-9"><SelectValue placeholder="상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <table className="data-table hidden md:table w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-[13px] font-semibold text-muted-foreground">바이어</th>
              <th className="text-[13px] font-semibold text-muted-foreground">채널</th>
              <th className="text-[13px] font-semibold text-muted-foreground">명세서번호</th>
              <th className="text-[13px] font-semibold text-muted-foreground">발행일</th>
              <th className="text-[13px] font-semibold text-muted-foreground">만기일</th>
              <th className="ctr text-[13px] font-semibold text-muted-foreground">경과일</th>
              <th className="num text-[13px] font-semibold text-muted-foreground">청구금액</th>
              <th className="num text-[13px] font-semibold text-muted-foreground">수금금액</th>
              <th className="num text-[13px] font-semibold text-muted-foreground">미수금</th>
              <th className="nw text-[13px] font-semibold text-muted-foreground">상태</th>
              <th className="ctr text-[13px] font-semibold text-muted-foreground">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-muted-foreground">
                <Wallet className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">등록된 정산 내역이 없습니다</p>
              </td></tr>
            ) : filtered.map(s => {
              const receivable = s.billedAmountKrw - s.collectedAmountKrw;
              const elapsed = s.status !== '완납' ? calcElapsedDays(s.dueDate) : -999;
              const isOver7 = elapsed >= 7;
              return (
                <tr key={s.id} className={`hover:bg-[var(--fill-quaternary)] ${isOver7 ? 'bg-destructive/5' : ''}`}>
                  <td className="font-medium text-foreground">{s.buyerName}</td>
                  <td className="text-muted-foreground">{s.channel}</td>
                  <td className="nw font-mono text-xs text-muted-foreground">{s.invoiceNo || '-'}</td>
                  <td className="text-muted-foreground">{s.invoiceDate}</td>
                  <td className="text-muted-foreground">{s.dueDate}</td>
                  <td className="ctr">
                    {s.status !== '완납' && elapsed > 0 ? (
                      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${isOver7 ? 'bg-destructive/10 text-destructive' : 'bg-[var(--fill-quaternary)] text-[var(--system-orange)]'}`}>
                        D+{elapsed}일
                      </span>
                    ) : s.status === '완납' ? (
                      <span className="text-xs text-muted-foreground">-</span>
                    ) : (
                      <span className="text-xs text-primary font-mono">{Math.abs(elapsed)}일 남음</span>
                    )}
                  </td>
                  <td className="nw num font-mono text-foreground">{formatNumber(s.billedAmountKrw)}</td>
                  <td className="nw num font-mono text-[var(--system-green)]">{formatNumber(s.collectedAmountKrw)}</td>
                  <td className="nw num font-mono font-semibold text-[var(--system-red)]">{receivable > 0 ? formatNumber(receivable) : '-'}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${STATUS_COLOR[s.status]}`}>
                      {s.status === '완납' ? <CheckCircle className="w-3 h-3" /> : s.status === '위험' ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                      {s.status}
                    </span>
                  </td>
                  <td className="ctr">
                    <div className="flex items-center justify-center gap-1">
                      {s.status !== '완납' && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-[var(--system-green)] px-2" onClick={() => handleCollect(s)}>
                          수금완료
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => openEdit(s)}>수정</Button>
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

        {/* 카드 리스트 (모바일) */}
        <div className="md:hidden divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Wallet className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">등록된 정산 내역이 없습니다</p>
            </div>
          ) : filtered.map(s => {
            const receivable = s.billedAmountKrw - s.collectedAmountKrw;
            const elapsed = s.status !== '완납' ? calcElapsedDays(s.dueDate) : -999;
            const isOver7 = elapsed >= 7;
            return (
              <div key={s.id} className={`p-4 ${isOver7 ? 'bg-destructive/5' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{s.buyerName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.channel} · {s.invoiceNo || '-'}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border shrink-0 ${STATUS_COLOR[s.status]}`}>
                    {s.status === '완납' ? <CheckCircle className="w-3 h-3" /> : s.status === '위험' ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                    {s.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                  <span>청구: <span className="font-mono font-medium text-foreground">{formatNumber(s.billedAmountKrw)}</span></span>
                  <span>미수: <span className={`font-mono font-semibold ${receivable > 0 ? 'text-[var(--system-red)]' : 'text-muted-foreground'}`}>{receivable > 0 ? formatNumber(receivable) : '-'}</span></span>
                  {s.status !== '완납' && elapsed > 0 && (
                    <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${isOver7 ? 'bg-destructive/10 text-destructive' : 'bg-[var(--fill-quaternary)] text-[var(--system-orange)]'}`}>D+{elapsed}일</span>
                  )}
                </div>
                <div className="flex items-center justify-end gap-1 mt-2">
                  {s.status !== '완납' && (
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-[var(--system-green)]" onClick={() => handleCollect(s)}>
                      수금완료
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => openEdit(s)}>수정</Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-[var(--system-red)]" onClick={() => handleDelete(s.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent onInteractOutside={e => e.preventDefault()} className="w-full h-full rounded-none sm:w-[95vw] sm:h-auto sm:max-w-lg sm:rounded-md sm:max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? '정산 수정' : '정산 등록'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-1 sm:col-span-2">
                <Label>바이어 *</Label>
                {buyers.length > 0 ? (
                  <Select
                    value={form.buyerId || 'manual'}
                    onValueChange={v => {
                      if (v === 'manual') {
                        setForm(f => ({ ...f, buyerId: undefined }));
                      } else {
                        const buyer = buyers.find(b => b.id === v);
                        setForm(f => ({ ...f, buyerId: v, buyerName: buyer?.name || '' }));
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="바이어 선택" /></SelectTrigger>
                    <SelectContent>
                      {buyers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      <SelectItem value="manual">직접 입력</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
                {(!form.buyerId || form.buyerId === 'manual') && (
                  <Input value={form.buyerName || ''} onChange={e => setForm(f => ({ ...f, buyerName: e.target.value }))} placeholder="바이어명 직접 입력" className="mt-1" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>채널</Label>
                <Select value={form.channel || '기타'} onValueChange={v => setForm(f => ({ ...f, channel: v as SettlementChannel }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>명세서번호</Label>
                <Input value={form.invoiceNo || ''} onChange={e => setForm(f => ({ ...f, invoiceNo: e.target.value }))} placeholder="INV-2026-001" />
              </div>
              <div className="space-y-1.5">
                <Label>발행일 *</Label>
                <Input type="date" value={form.invoiceDate || ''} onChange={e => setForm(f => ({ ...f, invoiceDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>만기일 *</Label>
                <Input type="date" value={form.dueDate || ''} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>청구금액 (KRW)</Label>
                <Input type="number" value={form.billedAmountKrw || ''} onChange={e => setForm(f => ({ ...f, billedAmountKrw: parseInt(e.target.value) || 0 }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>수금금액 (KRW)</Label>
                <Input type="number" value={form.collectedAmountKrw || ''} onChange={e => setForm(f => ({ ...f, collectedAmountKrw: parseInt(e.target.value) || 0 }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>수금일</Label>
                <Input type="date" value={form.collectedDate || ''} onChange={e => setForm(f => ({ ...f, collectedDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>메모</Label>
                <Input value={form.memo || ''} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="비고" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>취소</Button>
            <Button onClick={handleSave}>{editId ? '수정' : '등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
