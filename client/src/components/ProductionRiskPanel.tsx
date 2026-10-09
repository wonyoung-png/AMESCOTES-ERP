import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Button } from '@/components/ui/button';

interface Risk { id: string; orderNo: string; style: string; due: string; confirmed: string; remaining: number; received: number; source: string; days: number | null; label: string; priority: number }
export default function ProductionRiskPanel() {
  const { workspace } = useWorkspace();
  const { data, isError, isLoading, refetch } = useQuery({ queryKey: ['productionRisks', workspace], refetchInterval: 60000,
    queryFn: async () => {
      const r = await fetch(`/api/production/risks?workspace=${workspace}`);
      if (!r.ok) throw new Error('납기 조회 실패');
      return r.json() as Promise<{ asof: string; rows: Risk[] }>;
    } });
  const attention = data?.rows.filter(r => r.priority < 9) || [];
  return <section className="rounded-md border p-4 space-y-3" aria-label="생산 납기 위험">
    <div className="flex justify-between items-center"><h2 className="font-semibold">생산 납기 점검 · {workspace}</h2><Button variant="outline" size="sm" onClick={() => refetch()}>다시 확인</Button></div>
    <p className="text-xs text-muted-foreground">한국 날짜 기준 · 7일 내 미입고·납기 초과·공장 회신·완료 상태를 점검합니다. 입고 이력 우선, 이력이 없으면 발주 기록을 사용하며 불량 보충·바이어 납품 완료를 뜻하지 않습니다.</p>
    {isLoading && <p>납기·입고 확인 중…</p>}
    {isError ? <p role="alert">조회 실패 — 위험 판단 보류. 다시 확인해 주세요.</p> : data && <>
      <p className="text-sm">기준 {data.asof} · 확인 필요 {attention.length}건 · 그 외 진행 {data.rows.length - attention.length}건</p>
      {!!attention.length && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th>발주·품명</th><th>판단</th><th>바이어 / 공장 납기</th><th>입고 / 잔량</th></tr></thead><tbody>{attention.map(r => <tr key={r.id} className="border-b"><td className="py-2">{r.orderNo}<br/>{r.style}</td><td>{r.label}</td><td>{r.due || '미정'} / {r.confirmed || '미확인'}</td><td>{r.received.toLocaleString()} / {r.remaining.toLocaleString()}<br/><span className="text-xs text-muted-foreground">{r.source}</span></td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}
