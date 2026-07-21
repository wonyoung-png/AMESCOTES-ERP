// 중국창고 — 이지어드민/3PL과 분리된 ERP 장부 (품목·컬러)
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { store, formatNumber } from '@/lib/store';
import { phase1, type ChinaStockMoveType } from '@/lib/phase1';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { PackageMinus, PackagePlus, Warehouse } from 'lucide-react';

const MOVE_LABEL: Record<ChinaStockMoveType, string> = {
  inbound: '입고',
  outbound: '출고',
  adjust: '조정',
};

export default function ChinaWarehouse() {
  const { workspace } = useWorkspace();
  const ws = workspace === 'AETALOOP' ? 'AETALOOP' : 'LUMEN';
  const [, tick] = useState(0);
  const refresh = () => tick(n => n + 1);

  const items = store.getItems();
  const balances = useMemo(() => phase1.getChinaStockBalances(ws), [ws, tick]);
  const moves = useMemo(() => phase1.getChinaStockMoves(ws), [ws, tick]);

  const [search, setSearch] = useState('');
  const [outOpen, setOutOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [form, setForm] = useState({
    styleNo: '', styleName: '', color: '', qty: 0,
    moveDate: new Date().toISOString().slice(0, 10), memo: '',
  });

  const filteredBalances = balances.filter(b => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return b.styleNo.toLowerCase().includes(q) || b.styleName.toLowerCase().includes(q) || b.color.toLowerCase().includes(q);
  });

  const totalOnHand = balances.reduce((s, b) => s + b.onHand, 0);
  const skuCount = balances.filter(b => b.onHand > 0).length;

  const openOutbound = (styleNo?: string, color?: string, styleName?: string) => {
    setForm({
      styleNo: styleNo || '',
      styleName: styleName || '',
      color: color || '',
      qty: 1,
      moveDate: new Date().toISOString().slice(0, 10),
      memo: '',
    });
    setOutOpen(true);
  };

  const openAdjust = () => {
    setForm({
      styleNo: '', styleName: '', color: '', qty: 0,
      moveDate: new Date().toISOString().slice(0, 10), memo: '',
    });
    setAdjOpen(true);
  };

  const submitOutbound = () => {
    if (!form.styleNo.trim() || !form.color.trim()) {
      toast.error('품목·컬러를 입력하세요');
      return;
    }
    if (form.qty <= 0) { toast.error('수량을 입력하세요'); return; }
    const item = items.find(i => i.styleNo === form.styleNo.trim());
    const move = phase1.addChinaStockMove({
      workspace: ws,
      styleNo: form.styleNo.trim(),
      styleName: form.styleName || item?.name,
      color: form.color.trim(),
      qty: form.qty,
      moveType: 'outbound',
      moveDate: form.moveDate,
      memo: form.memo || '홀세일/직납 출고',
    });
    if (!move) {
      toast.error('출고 실패 — 재고 부족 또는 입력 오류');
      return;
    }
    toast.success(`중국창고 출고 ${form.qty}개`);
    setOutOpen(false);
    refresh();
  };

  const submitAdjust = () => {
    if (!form.styleNo.trim() || !form.color.trim()) {
      toast.error('품목·컬러를 입력하세요');
      return;
    }
    if (!form.qty) { toast.error('조정 수량(+/-)을 입력하세요'); return; }
    const item = items.find(i => i.styleNo === form.styleNo.trim());
    const move = phase1.addChinaStockMove({
      workspace: ws,
      styleNo: form.styleNo.trim(),
      styleName: form.styleName || item?.name,
      color: form.color.trim(),
      qty: form.qty,
      moveType: 'adjust',
      moveDate: form.moveDate,
      memo: form.memo || '수기 조정',
    });
    if (!move) {
      toast.error('조정 실패');
      return;
    }
    toast.success(`재고 조정 ${form.qty > 0 ? '+' : ''}${form.qty}`);
    setAdjOpen(false);
    refresh();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
            <Warehouse className="w-6 h-6 text-amber-700" />
            중국창고
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            {ws} — 품목·컬러 장부 (한국 3PL/이지어드민과 별도)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/brand-orders">
            <Button variant="outline" size="sm">리오더 · 오더관리</Button>
          </Link>
          <Button size="sm" variant="outline" onClick={openAdjust}>
            <PackagePlus className="w-3.5 h-3.5 mr-1" />수기 조정
          </Button>
          <Button size="sm" onClick={() => openOutbound()}>
            <PackageMinus className="w-3.5 h-3.5 mr-1" />출고 등록
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-stone-500">현재고 합계</p>
          <p className="text-2xl font-bold text-stone-800">{formatNumber(totalOnHand)}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-stone-500">SKU·컬러 (재고 보유)</p>
          <p className="text-2xl font-bold text-stone-800">{skuCount}</p>
        </div>
        <div className="bg-white rounded-xl border p-4 col-span-2 md:col-span-1">
          <p className="text-xs text-stone-500">입고 경로</p>
          <p className="text-sm text-stone-700 mt-1">오더관리 → <strong>중국입고</strong> 시 자동 반영</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          className="max-w-sm h-9"
          placeholder="스타일번호 · 품명 · 컬러 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">현재고 (품목 · 컬러)</div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-xs text-stone-500">
            <tr>
              <th className="text-left px-4 py-2">스타일</th>
              <th className="text-left px-4 py-2">품명</th>
              <th className="text-left px-4 py-2">컬러</th>
              <th className="text-right px-4 py-2">입고누계</th>
              <th className="text-right px-4 py-2">출고누계</th>
              <th className="text-right px-4 py-2">현재고</th>
              <th className="px-4 py-2">액션</th>
            </tr>
          </thead>
          <tbody>
            {filteredBalances.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-stone-400 text-sm">
                  중국창고 재고가 없습니다. 리오더 · 오더관리에서 중국입고를 등록하세요.
                </td>
              </tr>
            ) : filteredBalances.map(b => (
              <tr key={`${b.styleNo}-${b.color}`} className="border-t border-stone-100">
                <td className="px-4 py-3 font-mono text-xs text-amber-700">{b.styleNo}</td>
                <td className="px-4 py-3">{b.styleName}</td>
                <td className="px-4 py-3"><Badge variant="outline" className="text-[10px]">{b.color}</Badge></td>
                <td className="px-4 py-3 text-right text-sky-700">{formatNumber(b.inboundQty)}</td>
                <td className="px-4 py-3 text-right text-stone-500">{formatNumber(b.outboundQty)}</td>
                <td className={`px-4 py-3 text-right font-bold ${b.onHand < 0 ? 'text-red-600' : ''}`}>
                  {formatNumber(b.onHand)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" className="h-7 text-[10px]"
                    disabled={b.onHand <= 0}
                    onClick={() => openOutbound(b.styleNo, b.color, b.styleName)}>
                    출고
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">입출고 이력</div>
        <div className="divide-y max-h-[420px] overflow-y-auto">
          {moves.length === 0 ? (
            <p className="p-6 text-sm text-stone-400 text-center">이력 없음</p>
          ) : moves.map(m => (
            <div key={m.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border mr-2 ${
                  m.moveType === 'inbound' ? 'bg-sky-50 border-sky-200 text-sky-800' :
                  m.moveType === 'outbound' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                  'bg-stone-50 border-stone-200 text-stone-600'
                }`}>{MOVE_LABEL[m.moveType]}</span>
                <span className="font-mono text-xs text-amber-700">{m.styleNo}</span>
                <span className="mx-1.5 text-stone-300">·</span>
                <span>{m.color}</span>
                {m.orderNo && <span className="ml-2 text-xs text-stone-400">{m.orderNo}</span>}
                {m.memo && <span className="ml-2 text-xs text-stone-500">{m.memo}</span>}
              </div>
              <div className="text-right shrink-0">
                <span className={`font-semibold ${m.moveType === 'outbound' ? 'text-amber-800' : m.moveType === 'adjust' && m.qty < 0 ? 'text-red-600' : 'text-sky-800'}`}>
                  {m.moveType === 'outbound' ? '−' : m.moveType === 'adjust' && m.qty > 0 ? '+' : m.qty < 0 ? '' : '+'}
                  {formatNumber(Math.abs(m.qty))}
                </span>
                <span className="text-xs text-stone-400 ml-2">{m.moveDate}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 출고 */}
      <Dialog open={outOpen} onOpenChange={setOutOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>중국창고 출고</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>스타일번호</Label>
              <select
                className="w-full border rounded-md h-9 px-2 text-sm"
                value={form.styleNo}
                onChange={e => {
                  const styleNo = e.target.value;
                  const item = items.find(i => i.styleNo === styleNo);
                  setForm(f => ({ ...f, styleNo, styleName: item?.name || f.styleName }));
                }}
              >
                <option value="">선택 또는 아래 직접입력</option>
                {[...new Set(balances.map(b => b.styleNo))].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <Input className="mt-1" placeholder="직접 입력" value={form.styleNo}
                onChange={e => setForm(f => ({ ...f, styleNo: e.target.value }))} />
            </div>
            <div>
              <Label>컬러</Label>
              <Input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="필수" />
            </div>
            <div>
              <Label>수량</Label>
              <Input type="number" value={form.qty || ''} onChange={e => setForm(f => ({ ...f, qty: +e.target.value }))} />
            </div>
            <div>
              <Label>출고일</Label>
              <Input type="date" value={form.moveDate} onChange={e => setForm(f => ({ ...f, moveDate: e.target.value }))} />
            </div>
            <div>
              <Label>메모</Label>
              <Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="홀세일 / 직납 등" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutOpen(false)}>취소</Button>
            <Button onClick={submitOutbound}>출고 확정</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 수기 조정 */}
      <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>수기 재고 조정</DialogTitle></DialogHeader>
          <p className="text-xs text-stone-500 -mt-2">증가는 +, 감소는 − 수량으로 입력</p>
          <div className="space-y-3">
            <div>
              <Label>스타일번호</Label>
              <Input value={form.styleNo} onChange={e => setForm(f => ({ ...f, styleNo: e.target.value }))} list="cn-styles" />
              <datalist id="cn-styles">
                {items.map(i => <option key={i.id} value={i.styleNo}>{i.name}</option>)}
              </datalist>
            </div>
            <div>
              <Label>컬러</Label>
              <Input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
            </div>
            <div>
              <Label>조정 수량 (+/−)</Label>
              <Input type="number" value={form.qty || ''} onChange={e => setForm(f => ({ ...f, qty: +e.target.value }))} />
            </div>
            <div>
              <Label>일자</Label>
              <Input type="date" value={form.moveDate} onChange={e => setForm(f => ({ ...f, moveDate: e.target.value }))} />
            </div>
            <div>
              <Label>사유</Label>
              <Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjOpen(false)}>취소</Button>
            <Button onClick={submitAdjust}>조정 반영</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
