import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { phase1 } from '@/lib/phase1';
import { formatNumber } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { inventorySubtotal, type InventoryLocation, type InventoryRow } from '../../../shared/inventory';

const LOCATIONS: Record<InventoryLocation, string> = {
  domestic: '국내 · EZ 가용', 'ez-overseas': 'EZ 해외', hannam: '한남쇼룸', centum: '신세계센텀', china: '중국창고',
};
type Snapshot = { workspace: string; rows: InventoryRow[]; asof: string; warning: string };
const number = (value: number | null) => value == null ? '미확인' : formatNumber(value);

export default function InventoryOverview() {
  const { workspace } = useWorkspace();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, refresh] = useState(0);
  const [location, setLocation] = useState<InventoryLocation | 'all'>('all');
  const [query, setQuery] = useState('');

  useEffect(() => { setQuery(''); setLocation('all'); }, [workspace]);
  useEffect(() => {
    setSnapshot(null); setError('');
    if (workspace === 'OEM') { setBusy(false); return; }
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setBusy(true);
    const token = localStorage.getItem('erp_token');
    fetch(`/api/inventory/overview?workspace=${workspace}`, {
      credentials: 'include', signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '재고 조회 실패');
      if (data.workspace !== workspace || !Array.isArray(data.rows)) throw new Error('브랜드 재고 응답 확인 필요');
      if (active && !controller.signal.aborted) setSnapshot(data);
    }).catch(e => {
      if (!active) return;
      setError(controller.signal.aborted ? '재고 조회 시간이 초과됐습니다. 다시 조회하세요.' : e.message || '재고 조회 실패');
    }).finally(() => { clearTimeout(timeout); if (active) setBusy(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [workspace, revision]);

  const rows = useMemo(() => {
    if (workspace === 'OEM') return [];
    const china: InventoryRow[] = phase1.getChinaStockBalances(workspace).map(b => ({
      id: `china:${b.styleNo}:${b.color}`, sku: b.styleNo, name: b.styleName, color: b.color,
      location: 'china', quantity: b.onHand, pending: null, basis: 'on-hand', source: 'ERP 중국 장부 · 이 브라우저',
    }));
    return [...(snapshot?.workspace === workspace ? snapshot.rows : []), ...china];
  }, [workspace, snapshot, revision]);
  const filtered = rows.filter(row => (location === 'all' || row.location === location)
    && `${row.sku} ${row.name} ${row.color}`.toLowerCase().includes(query.trim().toLowerCase()));
  const china = rows.filter(row => row.location === 'china');
  const chinaQty = china.length ? china.reduce((sum, row) => sum + row.quantity!, 0) : null;

  if (workspace === 'OEM') return <div className="p-6 text-sm text-muted-foreground">대표님, 브랜드를 선택하시면 전체 재고를 확인할 수 있습니다.</div>;
  return <div className="p-4 md:p-6 space-y-4">
    <div className="flex flex-wrap justify-between items-start gap-3">
      <div><h1 className="text-2xl font-bold">전체 재고</h1>
        <p className="mt-1 text-sm text-muted-foreground">{workspace} · 한 화면에서 위치별 조회 · 국내 가용과 중국 보유재고는 별도</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => refresh(n => n + 1)}>새로 조회</Button>
        <Button variant="outline" size="sm" asChild><Link href="/china-warehouse">중국 입출고 관리</Link></Button>
        <Button variant="outline" size="sm" asChild><Link href={`/pms?tab=${encodeURIComponent('재고관리')}`}>원본·채널 할당</Link></Button>
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">국내 가용 · PMS 기록</p><p className="mt-1 text-2xl font-semibold">{number(inventorySubtotal(rows, 'domestic'))}</p></div>
      <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">중국 보유 · 이 브라우저 장부</p><p className="mt-1 text-2xl font-semibold">{number(chinaQty)}</p></div>
      <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">중국 → 한국 이동 중</p><p className="mt-1 text-sm">미연동 · 0개로 간주하지 않음</p></div>
    </div>
    <div className="rounded-lg border bg-card p-4 text-sm space-y-1">
      <p>중국·매장·해외·출고대기·채널 할당을 국내 가용에 더하지 않습니다.</p>
      <p className="text-muted-foreground">{snapshot?.workspace === workspace ? snapshot.warning : '원본 조회 전 · 국내 수량 미확인'} 전체 물리 재고 합계는 검증 전 미산출입니다.</p>
      <p className="text-muted-foreground">중국 장부는 아직 브라우저 저장 자료입니다. EZ 해외와 중국 장부의 동일 재고 여부·SKU/컬러 매칭은 확인이 필요합니다.</p>
    </div>
    <div role="status" aria-live="polite" className="text-sm text-muted-foreground">{busy ? '재고 원본 조회 중…' : error || `${filtered.length}행 · 빈 수량은 미확인`}</div>
    {error && <p role="alert" className="text-sm text-destructive">국내·매장 원본을 읽지 못했습니다. 중국 장부만 표시되며 전체 조회 성공이 아닙니다.</p>}
    <div className="flex flex-wrap gap-2 items-center">
      <label htmlFor="inventory-location" className="text-sm">위치</label>
      <select id="inventory-location" className="h-9 rounded-md border bg-background px-3 text-sm" value={location} onChange={e => setLocation(e.target.value as typeof location)}>
        <option value="all">전체 위치</option>{Object.entries(LOCATIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <Input aria-label="재고 SKU·품명·컬러 검색" className="max-w-sm h-9" placeholder="SKU · 품명 · 컬러 검색" value={query} onChange={e => setQuery(e.target.value)} />
    </div>
    <div className="rounded-lg border bg-card overflow-x-auto">
      <table className="data-table w-full text-sm min-w-[760px]">
        <caption className="sr-only">위치별 재고 · 출처가 다른 행은 임의 합산하지 않습니다</caption>
        <thead><tr>{['SKU / 품번', '품명', '컬러', '위치', '수량', '수량 기준', '출고대기', '출처'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{filtered.length ? filtered.map(row => <tr key={row.id}>
          <td>{row.sku}</td><td>{row.name}</td><td>{row.color || '—'}</td><td>{LOCATIONS[row.location]}</td>
          <td className="num">{number(row.quantity)}</td><td>{row.basis === 'available' ? '가용 · 물리재고 아님' : '보유'}</td>
          <td className="num">{row.location === 'domestic' ? number(row.pending) : '—'}</td><td className="text-xs text-muted-foreground">{row.source}</td>
        </tr>) : <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">{busy ? '불러오는 중…' : '해당 위치의 확인된 자료가 없습니다'}</td></tr>}</tbody>
      </table>
    </div>
    {snapshot?.workspace === workspace && snapshot.asof && <details className="text-xs text-muted-foreground"><summary>원본 수집 기준</summary><p className="mt-2">{snapshot.asof}</p></details>}
  </div>;
}
