import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CalendarRange, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { phase1 } from '@/lib/phase1';
import { formatKRW, store } from '@/lib/store';
import { buildMonthlyCashPlan, confirmPlannedExpenseMemo, encodePlannedExpense, expectedStatementDate, parsePlannedExpense, statementTotal, type PlannedExpenseWorkspace } from '@/lib/cashPlan';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function CashPlan() {
  const [, tick] = useState(0);
  const settlements = store.getSettlements();
  const payables = phase1.getPayables();
  const statements = store.getTradeStatements();
  const vendors = store.getVendors();
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState({ workspace: 'LUMEN' as PlannedExpenseWorkspace, category: '인테리어', description: '', vendorId: '', vendorName: '', projectNo: '', installments: [{ label: '계약금', amountKrw: 0, dueDate: '' }] });
  const months = useMemo(() => buildMonthlyCashPlan(settlements, payables, statements), [settlements, payables, statements]);
  const [selected, setSelected] = useState(months[0].key);
  const current = months.find(m => m.key === selected) ?? months[0];
  const incomingRows = [
    ...settlements.filter(s => s.dueDate?.startsWith(selected) && s.status !== '완납').map(s => ({ id: s.id, name: s.buyerName, date: s.dueDate, amount: Math.max(0, s.billedAmountKrw - s.collectedAmountKrw), note: `확정 · ${s.invoiceNo || ''}` })),
    ...statements.filter(s => s.status === '미청구' && expectedStatementDate(s).startsWith(selected)).map(s => ({ id: s.id, name: s.vendorName, date: expectedStatementDate(s), amount: statementTotal(s), note: `예상 · ${s.statementNo}` })),
  ];
  const outgoingRows = payables.filter(p => p.dueDate?.startsWith(selected) && p.status !== 'paid').map(p => {
    const confirmed = p.sourceType === 'processing' ? payables.filter(x => x.sourceType === 'order_receipt' && x.orderId === p.orderId).reduce((sum, x) => sum + x.amountKrw, 0) : 0;
    const planned = parsePlannedExpense(p.memo);
    const stage = p.sourceType === 'processing' ? '예상' : planned?.stage || '확정';
    return { id: p.id, name: p.vendorName, date: p.dueDate, amount: Math.max(0, p.amountKrw - p.paidAmountKrw - confirmed), note: `${stage} · ${planned ? `${planned.workspace} · ${planned.category}${planned.installment ? ` · ${planned.installment}` : ''} · ${planned.description}` : p.orderNo || p.memo || ''}`, action: planned?.stage === '예상' ? () => { phase1.updatePayable(p.id, { memo: confirmPlannedExpenseMemo(p.memo) }); tick(n => n + 1); toast.success('계획지출을 확정했습니다'); } : undefined };
  }).filter(r => r.amount > 0);

  const addPlan = () => {
    if (!plan.description.trim() || !plan.vendorName.trim() || plan.installments.some(x => !x.label.trim() || x.amountKrw <= 0 || !x.dueDate)) return toast.error('내용·지급처와 모든 지급회차의 명칭·금액·예정일을 입력하세요');
    const groupId = crypto.randomUUID();
    plan.installments.forEach(x => phase1.addPayable({ vendorId: plan.vendorId || undefined, vendorName: plan.vendorName.trim(), projectNo: plan.projectNo || undefined, sourceType: 'manual', amountKrw: x.amountKrw, dueDate: x.dueDate, memo: encodePlannedExpense(plan.workspace, plan.category, '예상', plan.description, groupId, x.label.trim()) }));
    setPlanOpen(false); tick(n => n + 1); toast.success(`${plan.installments.length}개 지급회차가 자금계획에 반영됐습니다`);
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-foreground">자금계획</h1><p className="text-sm text-muted-foreground">미수금·미지급 예정일을 기준으로 앞으로 12개월의 현금 유입과 유출을 봅니다.</p></div>
        <Button onClick={() => setPlanOpen(true)}><Plus className="w-4 h-4 mr-1" />비정기 계획지출</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary icon={<ArrowDownCircle />} label={`${current.label} 예상입금`} value={current.incoming} sub={`확정 ${formatKRW(current.confirmedIncoming)} · 예상 ${formatKRW(current.expectedIncoming)}`} tone="text-[var(--system-green)]" />
        <Summary icon={<ArrowUpCircle />} label={`${current.label} 예상지출`} value={current.outgoing} sub={`확정 ${formatKRW(current.confirmedOutgoing)} · 예상 ${formatKRW(current.expectedOutgoing)}`} tone="text-[var(--system-red)]" />
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
        <Detail title="예상입금 상세" empty="예정된 입금이 없습니다" rows={incomingRows} />
        <Detail title="예상지출 상세" empty="예정된 지출이 없습니다" rows={outgoingRows} />
      </div>
      <p className="text-xs text-muted-foreground">예정 금액을 추가하려면 미수금 또는 미지급 화면에 예정일과 금액을 등록하세요.</p>

      <Dialog open={planOpen} onOpenChange={setPlanOpen}><DialogContent><DialogHeader><DialogTitle>비정기 계획지출 등록</DialogTitle></DialogHeader><div className="grid gap-3 sm:grid-cols-2">
        <div><Label>사업</Label><select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={plan.workspace} onChange={e => setPlan(p => ({ ...p, workspace: e.target.value as PlannedExpenseWorkspace }))}><option>OEM</option><option>LUMEN</option><option>AETALOOP</option></select></div>
        <div><Label>비용항목</Label><select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={plan.category} onChange={e => setPlan(p => ({ ...p, category: e.target.value }))}>{['인테리어','집기','보증금','촬영','마케팅','팝업','기타'].map(x => <option key={x}>{x}</option>)}</select></div>
        <div className="sm:col-span-2"><Label>내용</Label><Input value={plan.description} onChange={e => setPlan(p => ({ ...p, description: e.target.value }))} placeholder="예: 성수점 인테리어 계약금" /></div>
        <div><Label>지급처</Label><Input list="cash-plan-vendors" value={plan.vendorName} onChange={e => { const vendor = vendors.find(v => v.name === e.target.value); setPlan(p => ({ ...p, vendorName: e.target.value, vendorId: vendor?.id || '' })); }} /><datalist id="cash-plan-vendors">{vendors.map(v => <option key={v.id} value={v.name} />)}</datalist></div>
        <div><Label>프로젝트명</Label><Input value={plan.projectNo} onChange={e => setPlan(p => ({ ...p, projectNo: e.target.value }))} placeholder="예: LUMEN 성수점" /></div>
        <div className="sm:col-span-2 space-y-2"><div className="flex items-center justify-between"><Label>분할지급</Label><Button type="button" size="sm" variant="outline" onClick={() => setPlan(p => ({ ...p, installments: [...p.installments, { label: p.installments.length === 1 ? '중도금' : '잔금', amountKrw: 0, dueDate: '' }] }))}><Plus className="w-3.5 h-3.5 mr-1" />회차 추가</Button></div>
          {plan.installments.map((item, index) => <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"><Input value={item.label} onChange={e => setPlan(p => ({ ...p, installments: p.installments.map((x, i) => i === index ? { ...x, label: e.target.value } : x) }))} placeholder="계약금" /><Input type="number" min="0" value={item.amountKrw || ''} onChange={e => setPlan(p => ({ ...p, installments: p.installments.map((x, i) => i === index ? { ...x, amountKrw: Number(e.target.value) } : x) }))} placeholder="금액" /><Input type="date" value={item.dueDate} onChange={e => setPlan(p => ({ ...p, installments: p.installments.map((x, i) => i === index ? { ...x, dueDate: e.target.value } : x) }))} />{plan.installments.length > 1 && <Button type="button" size="icon" variant="ghost" aria-label={`${item.label || index + 1} 회차 삭제`} onClick={() => setPlan(p => ({ ...p, installments: p.installments.filter((_, i) => i !== index) }))}><Trash2 className="w-4 h-4" /></Button>}</div>)}
          <p className="text-xs text-muted-foreground text-right">총 {formatKRW(plan.installments.reduce((sum, x) => sum + x.amountKrw, 0))}</p>
        </div>
      </div><DialogFooter><Button variant="outline" onClick={() => setPlanOpen(false)}>취소</Button><Button onClick={addPlan}>예상지출 등록</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function Summary({ icon, label, value, tone, sub }: { icon: ReactNode; label: string; value: number; tone: string; sub?: string }) {
  return <div className="rounded-lg border bg-card p-4"><div className={`flex items-center gap-2 ${tone}`}>{icon}<span className="text-xs text-muted-foreground">{label}</span></div><p className={`mt-2 text-xl font-bold tabular-nums ${tone}`}>{formatKRW(value)}</p>{sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}</div>;
}

function Detail({ title, empty, rows }: { title: string; empty: string; rows: Array<{ id: string; name: string; date: string; amount: number; note?: string; action?: () => void }> }) {
  return <section className="rounded-lg border bg-card p-4"><h2 className="font-semibold mb-3">{title}</h2><div className="divide-y">{rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p> : rows.map(r => <div key={r.id} className="flex justify-between gap-3 py-2 text-sm"><div><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.date}{r.note ? ` · ${r.note}` : ''}</p></div><div className="text-right"><p className="font-semibold tabular-nums">{formatKRW(r.amount)}</p>{r.action && <Button size="sm" variant="outline" className="mt-1 h-6 text-xs" onClick={r.action}>확정</Button>}</div></div>)}</div></section>;
}
