// 수주함 — 브랜드(LUMEN/AETALOOF)가 발행한 발주서를 AMESCOTES가 받는 곳.
//
// 브랜드와 OEM은 같은 회사지만 워크플로우는 서로 다른 회사처럼 돈다.
// 그래서 브랜드가 남의 발주 테이블에 직접 쓰지 않는다. 발주서를 넘기고,
// 받는 쪽이 [생산발주 등록]을 눌러 자기 흐름으로 들여온다.
//
// 발주서 번호(LUM-260810-01-A)는 그대로 PO 번호가 된다. 서버가 갈려도
// 양쪽이 같은 번호로 대화할 수 있어야 하기 때문이다.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { phase1, pullBrandOrders, type InboundPO as InboundPOType } from '@/lib/phase1';
import { store, genId, formatNumber } from '@/lib/store';
import { fetchOrders, upsertOrder } from '@/lib/supabaseQueries';
import { nextOrderNo } from '@/lib/orderNo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Inbox, ArrowRight, Building2 } from 'lucide-react';

export default function InboundPO() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState('');
  /** PO별 납기 회신 — 여기서 정한 날이 브랜드 오더관리의 확정 납기가 된다 */
  const [dely, setDely] = useState<Record<string, string>>({});
  const { data: orders = [] } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
  // 서버가 정본 — 발주서를 만든 사람과 받는 사람은 다른 브라우저다
  const { data: pulled = 0 } = useQuery({ queryKey: ['brandOrders'], queryFn: pullBrandOrders });

  const pos = useMemo(() => phase1.getInboundPOs(), [pulled, busy]);
  const items = store.getItems();

  /** 발주서 1장 → 스타일별 생산발주. 번호는 발주서 번호를 PO로 승계한다 */
  const accept = async (po: InboundPOType) => {
    const due = dely[po.poNo] || '';
    if (!due) { toast.error('납기(예상입고일)를 먼저 입력하세요'); return; }
    setBusy(po.poNo);
    try {
      const known = [...orders] as any[];
      for (const l of po.lines) {
        const item = items.find(i => i.styleNo === l.styleNo);
        const orderNo = nextOrderNo(l.styleNo, known);
        const order: any = {
          id: genId(),
          orderNo,
          workspace: 'OEM',
          poBatchNo: po.poNo,          // ← 브랜드 발주서 번호를 PO로 그대로 승계
          styleId: item?.id || l.styleNo,
          styleNo: l.styleNo,
          styleName: l.styleName,
          season: item?.season,
          qty: l.qty || l.colorQtys.reduce((s, c) => s + c.qty, 0),
          colorQtys: l.colorQtys,
          vendorId: l.factoryId || '',
          vendorName: l.factoryName || '',
          deliveryDate: due,        // ← 회신 납기. 브랜드 오더관리에 그대로 뜬다
          status: '발주생성',
          hqSupplyItems: [],
          attachments: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await upsertOrder(order);
        known.push(order);
      }
      phase1.markPOAccepted(po.poNo);
      // 브랜드 쪽 발주에도 확정 납기를 남긴다 — MD는 이 날짜를 보고 판매를 짠다
      const batch = phase1.getBrandBatches().find(b => b.projectNo === po.projectNo);
      if (batch) phase1.updateBrandBatch(batch.id, { expectedDely: due });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['brandOrders'] });
      toast.success(`${po.poNo} 수주 — 생산발주 ${po.lines.length}건 · 납기 ${due}`);
    } catch (e: any) {
      toast.error('생산발주 등록 실패: ' + (e?.message || e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">수주함</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          브랜드가 넘긴 발주서. 납기를 회신하면 발주서 번호가 그대로 PO가 되고 스타일별 생산발주가 생깁니다
        </p>
      </div>

      {pos.length === 0 ? (
        <div className="bg-card rounded-lg border p-12 text-center">
          <Inbox className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            받을 발주서가 없습니다. 브랜드 오더관리에서 「발주」를 누르면 여기로 옵니다.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pos.map(po => (
            <div key={po.poNo} className="bg-card rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-primary">{po.poNo}</span>
                    <Badge variant="outline" className="text-[10px] h-4">{po.workspace}</Badge>
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                      <Building2 className="w-3 h-3" />{po.factoryName}
                    </span>
                  </div>
                  <p className="text-sm text-foreground mt-1">{po.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {po.lines.length}개 스타일 ·{' '}
                    {formatNumber(po.lines.reduce((s, l) => s + (l.qty || l.colorQtys.reduce((a, c) => a + c.qty, 0)), 0))}개
                    {po.issuedAt ? ` · ${po.issuedAt.slice(0, 10)} 발행` : ''}
                  </p>
                </div>
                <div className="flex items-end gap-2 shrink-0">
                  <div className="space-y-1">
                    <label className="block text-[11px] text-muted-foreground">납기 · 예상입고일</label>
                    <Input type="date" className="h-8 w-36 text-sm"
                      value={dely[po.poNo] || ''}
                      onChange={e => setDely(d => ({ ...d, [po.poNo]: e.target.value }))} />
                  </div>
                  <Button size="sm" onClick={() => accept(po)} disabled={!!busy} className="gap-1.5">
                    {busy === po.poNo ? '등록 중…' : <>납기 확정 · 생산발주<ArrowRight className="w-3.5 h-3.5" /></>}
                  </Button>
                </div>
              </div>

              <div className="mt-3 border-t border-border pt-2 space-y-1">
                {po.lines.map(l => (
                  <div key={l.id} className="flex items-center gap-3 text-xs">
                    <span className="w-32 shrink-0 font-mono text-muted-foreground truncate">{l.styleNo}</span>
                    <span className="flex-1 min-w-0 truncate text-foreground">{l.styleName || '—'}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {l.colorQtys.map(c => `${c.color} ${c.qty}`).join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
