/**
 * 접수함 — 팀장이 보고 승인하면 그때 ERP 레코드가 만들어진다.
 *
 * AI 판정을 그대로 믿지 않는다. 무엇으로 봤는지 화면에 내놓고, 틀리면 고쳐서 승인한다.
 * 승인·반려 권한은 서버에서 다시 검사한다 (server/capture.ts) — 이 화면은 보여주기만 한다.
 */
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X, Clock, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { fetchVendors, fetchOrders } from '@/lib/supabaseQueries';
import { normalizeBrands, type Vendor } from '@/lib/store';

type Capture = {
  id: string;
  created_at: string;
  created_by_name: string | null;
  photo: string | null;
  raw_text: string;
  kind: string;
  parsed: Record<string, any>;
  confidence: number | null;
  status: string;
  reviewed_by_name?: string | null;
  reject_reason?: string | null;
};

const KINDS = [
  { v: 'sample', label: '샘플 제작', ready: true },
  { v: 'material', label: '자재 구매', ready: true },
  { v: 'delivery', label: '메인 납품', ready: true },
  { v: 'billing', label: '바이어 청구', ready: false },
] as const;

const STAGES = ['1차', '2차', '3차', '4차', '최종승인', '반려'];
const SEASONS = ['25FW', '26SS', '26FW', '27SS'];
const PAY_TYPES = ['법인카드', '계좌이체', '현금'];

/**
 * 자재 구매 승인에 딸리는 "바이어 청구" 칸.
 *
 * 산 금액과 청구할 금액은 다르다 — 마진을 붙여 청구한다 (대표). 그래서 금액을 따로 받는다.
 * 청구할 곳을 비워 두면 지출결의만 만든다. 사내용 자재는 청구할 곳이 없다.
 */
function BillingFields({
  buyerOptions, buyerId, billAmount, statementId, cost, field, label, onSet,
}: {
  buyerOptions: { id: string; label: string }[];
  buyerId: string; billAmount: string; statementId: string; cost: number;
  field: string; label: string;
  onSet: (k: string, v: any) => void;
}) {
  const { data: open = [] } = useQuery({
    queryKey: ['openStatements', buyerId],
    enabled: !!buyerId,
    queryFn: async () => {
      const { fetchOpenStatements } = await import('@/lib/tradeStatementQueries');
      return fetchOpenStatements(buyerId);
    },
  });
  const bill = Number(billAmount || 0);
  // 산 값보다 적게 청구하면 손해다. 일부러 그럴 수도 있으니 막지 않고 알려만 준다
  const underBilled = !!buyerId && bill > 0 && cost > 0 && bill < cost;

  return (
    <div className="border border-border rounded-md p-2.5 space-y-2">
      <p className="text-[11px] font-medium text-foreground">바이어 청구 (안 하면 비워 두세요)</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div>
          <label className={label}>청구할 곳</label>
          <select className={field} value={buyerId}
            onChange={e => { onSet('billBuyerId', e.target.value); onSet('billStatementId', ''); }}>
            <option value="">— 청구 안 함 —</option>
            {buyerOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
        {!!buyerId && (
          <>
            <div>
              <label className={label}>청구금액 (원)</label>
              <input className={field} type="number" inputMode="numeric"
                value={billAmount}
                placeholder={cost > 0 ? String(cost) : ''}
                onChange={e => onSet('billAmountKrw', e.target.value)} />
            </div>
            <div>
              <label className={label}>명세표</label>
              <select className={field} value={statementId}
                onChange={e => onSet('billStatementId', e.target.value)}>
                <option value="">새로 만들기</option>
                {open.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.statementNo} 에 추가 ({(o.lines || []).length}줄)
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
      {!!buyerId && !billAmount && (
        <p className="text-[11px] text-muted-foreground">비워 두면 산 값 그대로 청구합니다.</p>
      )}
      {underBilled && (
        <p className="text-[11px] text-[var(--system-orange)]">
          산 값({cost.toLocaleString()}원)보다 적게 청구합니다. 맞나요?
        </p>
      )}
    </div>
  );
}

/**
 * 메인 납품 승인에 딸리는 칸.
 *
 * 출고 기록은 발주에 걸린다 (receipt_logs.order_id). 그래서 어느 발주의 납품인지를 먼저 고른다.
 * 현장 글에 품번이나 품명이 있으면 그걸로 후보를 좁혀 둔다 — 발주가 쌓이면 목록이 길다.
 *
 * 청구 단가는 품목의 납품가를 서버가 꺼내 쓴다. 발주 단가는 공장에 주는 값이라
 * 그걸로 청구하면 원가로 파는 셈이 된다. 납품가가 품목에 없으면 여기서 넣어야 한다.
 */
function DeliveryFields({
  orderId, qty, defectQty, styleNo, styleName, buyerOptions,
  billBuyerId, noBill, unitPrice, statementId, field, label, onSet,
}: {
  orderId: string; qty: string; defectQty: string; styleNo: string; styleName: string;
  buyerOptions: { id: string; label: string }[];
  billBuyerId: string; noBill: boolean; unitPrice: string; statementId: string;
  field: string; label: string;
  onSet: (k: string, v: any) => void;
}) {
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
  const [showAll, setShowAll] = useState(false);

  const open = useMemo(() => (orders as any[])
    .filter(o => (o.shippedQty || 0) < (o.qty || 0) || o.id === orderId)
    .sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || ''))), [orders, orderId]);

  // 현장 글에서 읽은 품번·품명으로 후보를 좁힌다. 맞는 게 없으면 전체를 보여준다.
  // 이미 고른 발주는 항상 남긴다 — 품명을 고치다 목록에서 빠지면 빈 칸처럼 보이는데
  // 승인은 그 발주로 되어 버린다 (코덱스 지적)
  const hint = (styleNo || styleName || '').trim().toLowerCase();
  const narrowed = hint
    ? open.filter(o => o.id === orderId
        || `${o.styleNo} ${o.styleName}`.toLowerCase().includes(hint))
    : [];
  const list = showAll || narrowed.length === 0 ? open : narrowed;

  const picked = open.find(o => o.id === orderId);
  const { data: openStmts = [] } = useQuery({
    queryKey: ['openStatements', billBuyerId],
    enabled: !!billBuyerId && !noBill,
    queryFn: async () => {
      const { fetchOpenStatements } = await import('@/lib/tradeStatementQueries');
      return fetchOpenStatements(billBuyerId);
    },
  });

  const n = Number(qty || 0);
  const u = Number(unitPrice || 0);
  // 발주 수량보다 많이 나가는 건 일어나는 일이다. 막지 않고 알려만 준다
  const over = !!picked && n > 0 && (picked.shippedQty || 0) + n > (picked.qty || 0);

  return (
    <div className="border border-border rounded-md p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-foreground">어느 발주의 납품인가 *</p>
        {narrowed.length > 0 && !showAll && (
          <button type="button" onClick={() => setShowAll(true)}
            className="text-[11px] text-primary underline">전체 발주 보기</button>
        )}
      </div>
      <select className={field} value={orderId}
        onChange={e => {
          onSet('orderId', e.target.value);
          const o = open.find(x => x.id === e.target.value);
          // 납품은 곧 청구다. 발주의 바이어를 미리 넣어 둔다
          onSet('billBuyerId', o?.buyerId || '');
          onSet('billStatementId', '');
        }}>
        <option value="">— 고르세요 —</option>
        {list.map(o => (
          <option key={o.id} value={o.id}>
            {o.orderNo} · {o.styleNo} {o.styleName}
            {` · 발주 ${o.qty || 0}개`}{(o.shippedQty || 0) > 0 ? ` · 출고 ${o.shippedQty}개` : ''}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className={label}>납품 수량 *</label>
          <input className={field} type="number" inputMode="numeric" value={qty}
            onChange={e => onSet('qty', e.target.value)} />
        </div>
        <div>
          <label className={label}>불량 수량</label>
          <input className={field} type="number" inputMode="numeric" value={defectQty}
            onChange={e => onSet('defectQty', e.target.value)} />
        </div>
        <div>
          <label className={label}>청구할 곳</label>
          <select className={field} value={noBill ? '' : billBuyerId}
            onChange={e => {
              onSet('billBuyerId', e.target.value);
              onSet('noBill', e.target.value ? 'false' : 'true');
              onSet('billStatementId', '');
            }}>
            <option value="">— 청구 안 함 —</option>
            {buyerOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>명세표</label>
          <select className={field} disabled={!billBuyerId || noBill} value={statementId}
            onChange={e => onSet('billStatementId', e.target.value)}>
            <option value="">새로 만들기</option>
            {openStmts.map((o: any) => (
              <option key={o.id} value={o.id}>{o.statementNo} 에 추가 ({(o.lines || []).length}줄)</option>
            ))}
          </select>
        </div>
      </div>

      {!!billBuyerId && !noBill && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div>
            <label className={label}>납품 단가 (비우면 품목 납품가)</label>
            <input className={field} type="number" inputMode="numeric" value={unitPrice}
              onChange={e => onSet('billUnitPrice', e.target.value)} />
          </div>
          {u > 0 && n > 0 && (
            <p className="text-[11px] text-muted-foreground self-end pb-2">
              청구 {(u * n).toLocaleString()}원
            </p>
          )}
        </div>
      )}

      {over && (
        <p className="text-[11px] text-[var(--system-orange)]">
          발주 {picked!.qty}개인데 이번까지 {(picked!.shippedQty || 0) + n}개가 나갑니다. 맞나요?
        </p>
      )}
    </div>
  );
}

export default function CaptureInbox() {
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [edit, setEdit] = useState<Record<string, Record<string, any>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });
  const brandOptions = useMemo(() => (vendors as Vendor[])
    .filter(v => (v as any).type === '바이어')
    .flatMap(v => normalizeBrands((v as any).brands).map(b => ({
      key: `${v.id}|${b.code}`, label: b.name, buyerId: v.id, brandCode: b.code,
    }))), [vendors]);
  /** 청구할 곳 — 거래명세표는 사업자 단위로 나가므로 거래처 하나당 한 줄이다.
   *  보이는 이름은 브랜드명으로 쓴다 (대표 지시). 브랜드가 없으면 거래처명. */
  const buyerOptions = useMemo(() => (vendors as Vendor[])
    .filter(v => (v as any).type === '바이어')
    .map(v => {
      const brands = normalizeBrands((v as any).brands).map(b => b.name);
      return { id: v.id, label: brands.length ? brands.join('·') : (v.name || '(이름 없음)') };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ko')), [vendors]);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['captures', tab],
    queryFn: async () => {
      const r = await fetch(`/api/captures?status=${tab}`, { credentials: 'include' });
      if (!r.ok) throw new Error('목록을 불러오지 못했습니다');
      return r.json() as Promise<{ items: Capture[]; canApprove: boolean }>;
    },
  });
  const items = data?.items || [];
  const canApprove = !!data?.canApprove;

  /** 팀장이 고친 값이 있으면 그것, 없으면 AI 가 본 값 */
  const valOf = (c: Capture, k: string) => edit[c.id]?.[k] ?? c.parsed?.[k] ?? '';
  const setVal = (id: string, k: string, v: any) =>
    setEdit(p => ({ ...p, [id]: { ...(p[id] || {}), [k]: v } }));

  const approve = async (c: Capture) => {
    const kind = edit[c.id]?.kind ?? c.kind;
    if (kind !== 'sample' && kind !== 'material' && kind !== 'delivery') {
      toast.error('바이어 청구는 아직 전표를 만들지 않습니다');
      return;
    }
    const payload: Record<string, any> = { ...(c.parsed || {}), ...(edit[c.id] || {}), kind };
    // 메인 납품은 품명이 아니라 발주로 찾는다. 품명은 발주를 고를 때 쓰는 힌트일 뿐이다
    if (kind !== 'delivery' && !String(payload.styleName || '').trim()) {
      toast.error(kind === 'material' ? '무엇을 샀는지 적어주세요' : '품명을 넣어주세요');
      return;
    }
    if (kind === 'delivery') {
      if (!payload.orderId) { toast.error('어느 발주의 납품인지 골라주세요'); return; }
      if (!(Number(payload.qty) > 0)) { toast.error('납품 수량을 넣어주세요'); return; }
    }
    // 금액 없는 지출결의는 의미가 없다. 서버에서도 막지만 여기서 먼저 잡아준다
    if (kind === 'material' && !(Number(payload.amountKrw) > 0)) {
      toast.error('금액을 넣어주세요');
      return;
    }
    // 청구금액만 적고 청구할 곳을 안 고르면 청구가 조용히 사라진다
    if (kind === 'material' && !payload.billBuyerId && String(payload.billAmountKrw || '').trim()) {
      toast.error('청구할 곳을 골라주세요');
      return;
    }
    setBusy(c.id);
    try {
      const r = await fetch(`/api/captures/${c.id}/approve`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 모르는 사유는 서버가 보낸 원문을 그대로 보여준다. 뭉개면 왜 안 되는지 알 수가 없다
        toast.error(j.message || j.detail || j.error || '승인 실패', { duration: 10000 });
        return;
      }
      // 자재구매는 청구까지 했으면 전표가 2장이다. 몇 장이 만들어졌는지 말해준다
      const stmt = j.ref?.statementNo
        ? ` + 거래명세표 ${j.ref.statementNo}${j.ref.statementNew === false ? ' (줄 추가)' : ''}` : '';
      toast.success(
        kind === 'sample'     ? '승인 — 샘플 기록이 만들어졌습니다'
        : kind === 'delivery' ? `승인 — ${j.ref?.orderNo || ''} 출고 ${j.ref?.qty}개${stmt}`
        : `승인 — 지출결의${stmt}`);
      // 지출결의는 서버가 정본인데 앱이 시작할 때만 내려받는다 (syncFromSupabase).
      // 지금 내려받아 넣어주지 않으면 방금 만든 전표가 지출결의 화면에 안 보인다
      if (kind === 'material' || kind === 'delivery') {
        try {
          const { fetchTradeStatementsSB } = await import('@/lib/tradeStatementQueries');
          const { store } = await import('@/lib/store');
          if (kind === 'material') {
            const { fetchExpensesSB } = await import('@/lib/expenseQueries');
            store.hydrateExpenses(await fetchExpensesSB());
          } else {
            // 출고 기록과 발주 출고수량 — 둘 다 서버가 정본이라 다시 읽어 와야 화면에 보인다
            const { syncPhase1FromSupabase } = await import('@/lib/phase1');
            await syncPhase1FromSupabase();
            qc.invalidateQueries({ queryKey: ['orders'] });
          }
          store.hydrateTradeStatements(await fetchTradeStatementsSB() as any);
        } catch { /* 못 내려받아도 다음에 앱을 열면 보인다 */ }
      }
      setEdit(p => { const { [c.id]: _drop, ...rest } = p; return rest; });
      refetch();
    } catch { toast.error('승인 실패'); }
    finally { setBusy(null); }
  };

  const reject = async (c: Capture) => {
    const reason = prompt('반려 사유를 적어주세요 (올린 사람에게 그대로 보입니다)');
    if (!reason?.trim()) return;
    setBusy(c.id);
    try {
      const r = await fetch(`/api/captures/${c.id}/reject`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!r.ok) { toast.error('반려 실패'); return; }
      toast.success('반려했습니다');
      refetch();
    } catch { toast.error('반려 실패'); }
    finally { setBusy(null); }
  };

  const field = 'h-9 w-full rounded-md border border-border bg-card px-2 text-sm';
  const label = 'text-[11px] text-muted-foreground mb-1 block';

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto pb-24 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-foreground">접수함</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            현장에서 올린 것을 확인하고 승인하면 ERP 기록이 만들어집니다.
          </p>
        </div>
        <div className="flex gap-1 bg-[var(--fill-tertiary)] rounded-md p-1">
          {(['pending', 'all'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-3 h-8 text-xs rounded ${tab === t ? 'bg-card font-medium text-foreground' : 'text-muted-foreground'}`}>
              {t === 'pending' ? '승인 대기' : '전체'}
            </button>
          ))}
        </div>
      </div>

      {!canApprove && (
        <p className="text-xs text-[var(--system-orange)] border border-[var(--system-orange)]/30 bg-[var(--system-orange)]/10 rounded-md p-3">
          승인 권한이 없어 내가 올린 것만 보입니다. 승인은 대표·생산관리팀장이 합니다.
        </p>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
      {!isLoading && items.length === 0 && (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-10 text-center">
          {tab === 'pending' ? '승인 대기 중인 접수가 없습니다' : '접수 내역이 없습니다'}
        </p>
      )}

      <div className="space-y-3">
        {items.map(c => {
          const kind = edit[c.id]?.kind ?? c.kind;
          const low = (c.confidence ?? 0) < 0.6;
          const done = c.status !== 'pending';
          return (
            <div key={c.id} className="border border-border rounded-lg bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--fill-quaternary)] text-xs flex-wrap">
                {c.status === 'pending' && <Clock className="w-3.5 h-3.5 text-[var(--system-orange)]" />}
                {c.status === 'approved' && <Check className="w-3.5 h-3.5 text-[var(--system-green)]" />}
                {c.status === 'rejected' && <AlertTriangle className="w-3.5 h-3.5 text-[var(--system-red)]" />}
                <span className="font-medium">{c.created_by_name || '(누구인지 모름)'}</span>
                <span className="text-muted-foreground">{c.created_at?.slice(5, 16).replace('T', ' ')}</span>
                {low && !done && (
                  <span className="px-1.5 py-0.5 rounded bg-[var(--system-orange)]/15 text-[var(--system-orange)]">
                    판정이 불확실합니다 — 확인해주세요
                  </span>
                )}
                {done && <span className="ml-auto text-muted-foreground">{c.reviewed_by_name} 처리</span>}
              </div>

              <div className="grid md:grid-cols-[180px_1fr] gap-3 p-3">
                <div className="flex items-start justify-center">
                  {c.photo ? (
                    <img src={c.photo} alt="접수 사진" className="w-full max-h-48 object-contain rounded border border-border" />
                  ) : (
                    <div className="w-full h-28 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground">
                      <ImageIcon className="w-5 h-5" />
                    </div>
                  )}
                </div>

                <div className="space-y-2 min-w-0">
                  <p className="text-sm bg-[var(--fill-quaternary)] rounded px-2 py-1.5 break-words">{c.raw_text || '(글 없음)'}</p>

                  {done ? (
                    <p className="text-xs text-muted-foreground">
                      {c.status === 'approved' ? '승인되어 기록이 만들어졌습니다.' : `반려 — ${c.reject_reason}`}
                    </p>
                  ) : (
                    <>
                      <div className="flex gap-1 flex-wrap">
                        {KINDS.map(k => (
                          <button key={k.v} type="button" onClick={() => setVal(c.id, 'kind', k.v)}
                            className={`px-2.5 h-7 text-xs rounded-md border ${
                              kind === k.v ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground'
                            }`}>
                            {k.label}{!k.ready && ' (준비중)'}
                          </button>
                        ))}
                      </div>

                      {/* 종류에 따라 묻는 것이 다르다. 자재 구매에 샘플 단계·시즌을 묻지 않는다 */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div>
                          <label className={label}>
                            {kind === 'material' ? '품목 *' : kind === 'delivery' ? '품명' : '품명 *'}
                          </label>
                          <input className={field} value={valOf(c, 'styleName')}
                            placeholder={kind === 'material' ? '예) 양가죽 10마' : '예) 토트백'}
                            onChange={e => setVal(c.id, 'styleName', e.target.value)} />
                        </div>
                        {/* 메인 납품은 금액을 묻지 않는다. 청구액은 수량 x 납품가로 나온다 */}
                        {kind !== 'delivery' && (
                          <div>
                            <label className={label}>금액 (원){kind === 'material' ? ' *' : ''}</label>
                            <input className={field} type="number" inputMode="numeric"
                              value={valOf(c, 'amountKrw') || ''}
                              onChange={e => setVal(c.id, 'amountKrw', e.target.value)} />
                          </div>
                        )}

                        {kind === 'delivery' ? (
                          <div>
                            <label className={label}>납품일</label>
                            <input className={field} type="date" value={valOf(c, 'requestDate') || ''}
                              onChange={e => setVal(c.id, 'requestDate', e.target.value)} />
                          </div>
                        ) : kind === 'material' ? (
                          <>
                            <div>
                              <label className={label}>거래처</label>
                              <input className={field} value={valOf(c, 'vendorName')}
                                placeholder="예) 가자피혁"
                                onChange={e => setVal(c.id, 'vendorName', e.target.value)} />
                            </div>
                            <div>
                              <label className={label}>결제수단</label>
                              <select className={field} value={valOf(c, 'expenseType') || '법인카드'}
                                onChange={e => setVal(c.id, 'expenseType', e.target.value)}>
                                {PAY_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className={label}>지출일</label>
                              <input className={field} type="date" value={valOf(c, 'requestDate') || ''}
                                onChange={e => setVal(c.id, 'requestDate', e.target.value)} />
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <label className={label}>브랜드</label>
                              <select className={field}
                                value={`${valOf(c, 'buyerId')}|${valOf(c, 'brandCode')}`}
                                onChange={e => {
                                  const hit = brandOptions.find(b => b.key === e.target.value);
                                  setVal(c.id, 'buyerId', hit?.buyerId || '');
                                  setVal(c.id, 'brandCode', hit?.brandCode || '');
                                  setVal(c.id, 'brand', hit?.label || '');
                                }}>
                                <option value="|">— 고르세요 —</option>
                                {brandOptions.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className={label}>컬러</label>
                              <input className={field} value={valOf(c, 'color')}
                                onChange={e => setVal(c.id, 'color', e.target.value)} />
                            </div>
                            <div>
                              <label className={label}>단계</label>
                              <select className={field} value={valOf(c, 'stage') || '1차'}
                                onChange={e => setVal(c.id, 'stage', e.target.value)}>
                                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className={label}>시즌</label>
                              <select className={field} value={valOf(c, 'season') || ''}
                                onChange={e => setVal(c.id, 'season', e.target.value)}>
                                <option value="">—</option>
                                {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                          </>
                        )}
                      </div>

                      {kind === 'delivery' && (
                        <DeliveryFields
                          orderId={String(valOf(c, 'orderId') || '')}
                          qty={String(valOf(c, 'qty') || '')}
                          defectQty={String(valOf(c, 'defectQty') || '')}
                          styleNo={String(valOf(c, 'styleNo') || '')}
                          styleName={String(valOf(c, 'styleName') || '')}
                          buyerOptions={buyerOptions}
                          billBuyerId={String(valOf(c, 'billBuyerId') || '')}
                          noBill={String(valOf(c, 'noBill') || '') === 'true'}
                          unitPrice={String(valOf(c, 'billUnitPrice') || '')}
                          statementId={String(valOf(c, 'billStatementId') || '')}
                          field={field} label={label}
                          onSet={(k, v) => setVal(c.id, k, v)}
                        />
                      )}

                      {kind === 'material' && (
                        <BillingFields
                          buyerOptions={buyerOptions}
                          buyerId={String(valOf(c, 'billBuyerId') || '')}
                          billAmount={String(valOf(c, 'billAmountKrw') || '')}
                          statementId={String(valOf(c, 'billStatementId') || '')}
                          cost={Number(valOf(c, 'amountKrw') || 0)}
                          field={field} label={label}
                          onSet={(k, v) => setVal(c.id, k, v)}
                        />
                      )}

                      {canApprove && (
                        <div className="flex gap-2 pt-1">
                          <button type="button" disabled={busy === c.id} onClick={() => approve(c)}
                            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-40">
                            <Check className="w-4 h-4" />승인
                          </button>
                          <button type="button" disabled={busy === c.id} onClick={() => reject(c)}
                            className="h-9 px-4 rounded-md border border-border text-sm text-muted-foreground flex items-center gap-1.5 disabled:opacity-40">
                            <X className="w-4 h-4" />반려
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
