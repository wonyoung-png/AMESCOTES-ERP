import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CalendarRange, TriangleAlert } from 'lucide-react';
import { phase1 } from '@/lib/phase1';
import { formatKRW, store } from '@/lib/store';
import { buildMonthlyCashPlan } from '@/lib/cashPlan';

export default function CashPlan() {
  const settlements = store.getSettlements();
  const payables = phase1.getPayables();
  const months = useMemo(() => buildMonthlyCashPlan(settlements, payables), [settlements, payables]);
  const [selected, setSelected] = useState(months[0].key);
  const current = months.find(m => m.key === selected) ?? months[0];
  const incomingRows = settlements.filter(s => s.dueDate?.startsWith(selected) && s.status !== '완납');
  const outgoingRows = payables.filter(p => p.dueDate?.startsWith(selected) && p.status !== 'paid');

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">자금계획</h1>
        <p className="text-sm text-muted-foreground">미수금·미지급 예정일을 기준으로 앞으로 12개월의 현금 유입과 유출을 봅니다.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary icon={<ArrowDownCircle />} label={`${current.label} 예상입금`} value={current.incoming} tone="text-[var(--system-green)]" />
        <Summary icon={<ArrowUpCircle />} label={`${current.label} 예상지출`} value={current.outgoing} tone="text-[var(--system-red)]" />
        <Summary icon={current.net < 0 ? <TriangleAlert /> : <CalendarRange />} label="순현금흐름" value={current.net} tone={current.net < 0 ? 'text-[var(--system-red)]' : 'text-primary'} />
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead><tr className="border-b text-muted-foreground"><th>월</th><th className="num">예상입금</th><th className="num">예상지출</th><th className="num">순현금흐름</th><th>상태</th></tr></thead>
          <tbody className="divide-y">
            {months.map(m => <tr key={m.key} onClick={() => setSelected(m.key)} className={`cursor-pointer hover:bg-muted/50 ${selected === m.key ? 'bg-primary/5' : ''}`}>
              <td className="font-medium">{m.label}</td><td className="num text-[var(--system-green)]">{formatKRW(m.incoming)}</td><td className="num text-[var(--system-red)]">{formatKRW(m.outgoing)}</td><td className={`num font-semibold ${m.net < 0 ? 'text-[var(--system-red)]' : ''}`}>{formatKRW(m.net)}</td><td>{m.net < 0 ? <span className="text-[var(--system-red)]">순유출 확인</span> : '정상'}</td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Detail title="예상입금 상세" empty="예정된 입금이 없습니다" rows={incomingRows.map(s => ({ id: s.id, name: s.buyerName, date: s.dueDate, amount: Math.max(0, s.billedAmountKrw - s.collectedAmountKrw), note: s.invoiceNo }))} />
        <Detail title="예상지출 상세" empty="예정된 지출이 없습니다" rows={outgoingRows.map(p => ({ id: p.id, name: p.vendorName, date: p.dueDate, amount: Math.max(0, p.amountKrw - p.paidAmountKrw), note: p.orderNo || p.memo }))} />
      </div>
      <p className="text-xs text-muted-foreground">예정 금액을 추가하려면 미수금 또는 미지급 화면에 예정일과 금액을 등록하세요.</p>
    </div>
  );
}

function Summary({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return <div className="rounded-lg border bg-card p-4"><div className={`flex items-center gap-2 ${tone}`}>{icon}<span className="text-xs text-muted-foreground">{label}</span></div><p className={`mt-2 text-xl font-bold tabular-nums ${tone}`}>{formatKRW(value)}</p></div>;
}

function Detail({ title, empty, rows }: { title: string; empty: string; rows: Array<{ id: string; name: string; date: string; amount: number; note?: string }> }) {
  return <section className="rounded-lg border bg-card p-4"><h2 className="font-semibold mb-3">{title}</h2><div className="divide-y">{rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p> : rows.map(r => <div key={r.id} className="flex justify-between gap-3 py-2 text-sm"><div><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.date}{r.note ? ` · ${r.note}` : ''}</p></div><p className="font-semibold tabular-nums">{formatKRW(r.amount)}</p></div>)}</div></section>;
}
