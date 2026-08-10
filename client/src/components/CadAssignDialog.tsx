// CAD 소요량표를 올리면 조각별 자재를 가죽/원단/안감/보강으로 배정하고
// 폭·로스율을 넣어 소요량을 자동 계산한 뒤, BOM 자재 줄에 바로 적용한다.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  ASSIGN_LABEL, ASSIGN_MATERIAL, calcLeatherSF, calcFabricYD, calcRollM, withLoss, bodyPartOf,
  type Assign, type CadLine,
} from '@/lib/cadYardage';
import { store, genId, COMMON_BRAND, type Material, type MaterialCategory, type YardRow } from '@/lib/store';
import { fetchMaterials, upsertMaterial } from '@/lib/supabaseQueries';

/** 계산 단위가 있는 버킷 — '제외'는 빠진다 */
const BUCKETS: Assign[] = ['leather', 'outer', 'lining', 'interlining'];
// 보강재는 자재 마스터에 M 로 등록하므로 계산도 미터로 뽑는다 (면적/폭)
const UNIT: Record<string, string> = { leather: 'SF', outer: 'YD', lining: 'YD', interlining: 'M' };
const NEEDS_WIDTH = (b: Assign) => b !== 'leather';

export type CadTarget = { id: string; label: string };

/** 배정 → 소요량 표의 종류. 안감은 원단으로 넣고 부위를 '안감' 으로 잡는다 */
const KIND_OF: Record<Exclude<Assign, 'skip'>, '가죽' | '원단' | '보강재'> = {
  leather: '가죽', outer: '원단', lining: '원단', interlining: '보강재',
};

export function CadAssignDialog({
  open, onOpenChange, styleNo, lines, targets, scopeLabel, onApply, onFill,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  styleNo?: string;
  lines: CadLine[];
  /** 적용 대상 후보 — 현재 고른 원가구분·컬러의 자재 줄 */
  targets: CadTarget[];
  scopeLabel: string;
  /** netQty 는 로스 제외한 순소요량, lossPct 는 % */
  onApply: (targetId: string, netQty: number, lossPct: number, unit: string) => void;
  /** 배정 결과를 소요량 표에 그대로 옮긴다 */
  onFill: (rows: Array<Omit<YardRow, 'id'>>) => void;
}) {
  const [assign, setAssign] = useState<Record<string, Assign>>({});
  const [width, setWidth] = useState<Record<string, number>>({ outer: 150, lining: 150, interlining: 100 });
  const [loss, setLoss] = useState<Record<string, number>>({ leather: 15, outer: 10, lining: 10, interlining: 10 });
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Assign | null>(null);
  const queryClient = useQueryClient();
  const { data: materials = [] } = useQuery({ queryKey: ['materials'], queryFn: fetchMaterials });

  // 파일을 새로 올릴 때마다 파서가 추정한 값으로 초기화
  useEffect(() => {
    if (!open) return;
    setAssign(Object.fromEntries(lines.map(l => [l.id, l.assign])));
  }, [open, lines]);

  const groups = useMemo(() => {
    const g: Record<string, CadLine[]> = {};
    for (const l of lines) {
      const a = assign[l.id] ?? l.assign;
      if (a === 'skip') continue;
      (g[a] ||= []).push(l);
    }
    return g;
  }, [lines, assign]);

  const skipCount = lines.filter(l => (assign[l.id] ?? l.assign) === 'skip').length;

  const valueOf = (b: Assign) => {
    const ls = groups[b] || [];
    if (!ls.length) return 0;
    if (b === 'leather') return calcLeatherSF(ls);
    if (b === 'interlining') return calcRollM(ls, width[b] || 0);   // M
    return calcFabricYD(ls, width[b] || 0);                          // YD
  };

  // 자재 마스터에 없는 자재명을 그대로 등록한다 — 카테고리·단위는 배정에서 나온다
  // (예: 0.4 VXP → 보강재 / 공통 / 단위 M)
  const registerMissing = async (b: Assign) => {
    if (b === 'skip') return;
    const spec = ASSIGN_MATERIAL[b];
    const have = new Set((materials as Material[]).map(m => m.name?.trim().toLowerCase()));
    const names = Array.from(new Set((groups[b] || []).map(l => l.material.trim())))
      .filter(n => n && !have.has(n.toLowerCase()));
    if (!names.length) { toast.info(`${ASSIGN_LABEL[b]} — 새로 등록할 자재가 없습니다`); return; }

    setBusy(b);
    try {
      const list = [...(materials as Material[])];
      for (const name of names) {
        const m: Material = {
          id: genId(),
          itemCode: store.getNextItemCode(spec.category as MaterialCategory, list),
          name,
          category: spec.category as MaterialCategory,
          subType: spec.subType,
          brand: COMMON_BRAND,
          unit: spec.unit,
          createdAt: new Date().toISOString(),
        } as Material;
        await upsertMaterial(m);
        list.push(m);
      }
      await queryClient.invalidateQueries({ queryKey: ['materials'] });
      toast.success(`${ASSIGN_LABEL[b]} ${names.length}건 등록 — ${spec.category} / ${COMMON_BRAND} / 단위 ${spec.unit}`);
    } catch (err) {
      toast.error(`자재 등록 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  // 배정 결과를 소요량 표 행으로 옮긴다 — 트림이 있으면 트림1/트림2 부위가 그대로 따라간다
  const fillTable = () => {
    const rows = lines
      .map(l => ({ l, a: assign[l.id] ?? l.assign }))
      .filter(x => x.a !== 'skip')
      .map(({ l, a }) => {
        const kind = KIND_OF[a as Exclude<Assign, 'skip'>];
        const part = kind === '보강재' ? '' : (bodyPartOf(a, l.group, l.raw) || '바디');
        return { kind, part, 가로: l.w, 세로: l.h, 폭: kind === '가죽' ? 0 : (width[a] || 150), 로스: loss[a] || 0, 수량: l.count };
      });
    if (!rows.length) { toast.error('표에 넣을 줄이 없습니다'); return; }
    onFill(rows);
  };

  const applyOne = (b: Assign) => {
    const t = target[b];
    if (!t) { toast.error(`${ASSIGN_LABEL[b]} 를 적용할 자재 줄을 고르세요`); return; }
    const net = valueOf(b);
    if (!net) { toast.error(`${ASSIGN_LABEL[b]} 계산값이 0입니다`); return; }
    onApply(t, Math.ceil(net * 1000) / 1000, loss[b] || 0, UNIT[b]);
    toast.success(`${ASSIGN_LABEL[b]} ${withLoss(net, loss[b] || 0).toFixed(3)} ${UNIT[b]} 적용`);
  };

  const th = 'text-[11px] text-muted-foreground font-semibold py-2 px-2 whitespace-nowrap';
  const inp = 'w-20 border border-border rounded px-2 py-1 text-sm text-right bg-card focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            CAD 소요량 분석 {styleNo ? <span className="text-muted-foreground font-normal">· {styleNo}</span> : null}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            조각 이름에 섞여 있던 자재를 한 줄씩 분해했습니다. 분류가 틀린 줄만 고치고, 폭·로스율을 넣으면 자동 계산됩니다.
            적용 대상은 <b>{scopeLabel}</b> 입니다.
            {skipCount > 0 && <> 기본패턴(기본형·닺지형·닷지형) <b>{skipCount}줄</b>은 소요량에서 제외했습니다.</>}
          </p>
        </DialogHeader>

        {/* 버킷별 계산 — 폭·로스·적용 대상 */}
        <div className="grid gap-2 sm:grid-cols-2 shrink-0">
          {BUCKETS.map(b => {
            const n = (groups[b] || []).length;
            const net = valueOf(b);
            return (
              <div key={b} className={`rounded-lg border p-3 space-y-2 ${n ? 'border-border bg-card' : 'border-dashed border-border opacity-50'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{ASSIGN_LABEL[b]}</span>
                  <span className="text-[11px] text-muted-foreground">{n}줄</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  {NEEDS_WIDTH(b) && (
                    <label className="flex items-center gap-1">폭(cm)
                      <input type="number" min={1} className={inp} value={width[b] ?? 0}
                        onChange={e => setWidth(p => ({ ...p, [b]: parseFloat(e.target.value) || 0 }))} />
                    </label>
                  )}
                  <label className="flex items-center gap-1">로스(%)
                    <input type="number" min={0} max={100} className={inp} value={loss[b] ?? 0}
                      onChange={e => setLoss(p => ({ ...p, [b]: parseFloat(e.target.value) || 0 }))} />
                  </label>
                </div>
                <div className="text-sm tabular-nums">
                  <span className="text-muted-foreground text-xs">Net </span>{net.toFixed(3)}
                  <span className="text-muted-foreground"> → 최종 </span>
                  <b>{withLoss(net, loss[b] || 0).toFixed(3)} {UNIT[b]}</b>
                </div>
                <div className="flex gap-2">
                  <select value={target[b] || ''} onChange={e => setTarget(p => ({ ...p, [b]: e.target.value }))}
                    className="h-8 flex-1 min-w-0 rounded-md border border-border bg-card px-2 text-xs" disabled={!n}>
                    <option value="">적용할 자재 줄…</option>
                    {targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <Button size="sm" className="text-xs h-8" disabled={!n} onClick={() => applyOne(b)}>적용</Button>
                </div>
                <Button size="sm" variant="outline" className="text-xs h-7 w-full"
                  disabled={!n || busy === b} onClick={() => registerMissing(b)}>
                  {busy === b ? '등록 중…' : `자재 마스터에 등록 (${ASSIGN_MATERIAL[b as Exclude<Assign, 'skip'>].category} · ${ASSIGN_MATERIAL[b as Exclude<Assign, 'skip'>].unit})`}
                </Button>
              </div>
            );
          })}
        </div>

        {/* 조각별 분류 — 틀린 줄만 고친다 */}
        <div className="flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr>
                <th className={`${th} text-left`}>조각 이름 (원문)</th>
                <th className={`${th} text-left`}>부위</th>
                <th className={th}>마커그룹</th>
                <th className={th}>부위</th>
                <th className={`${th} text-left`}>자재</th>
                <th className={`${th} text-right`}>수량</th>
                <th className={`${th} text-right`}>가로 × 세로</th>
                <th className={th}>분류</th>
                <th className={`${th} text-left`}>근거</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const first = i === 0 || lines[i - 1].raw !== l.raw;
                return (
                  <tr key={l.id} className="border-b border-border/60">
                    <td className="px-2 py-1 break-keep max-w-[240px]">{first ? l.raw : ''}</td>
                    <td className="px-2 py-1 text-muted-foreground break-keep">{l.part}</td>
                    <td className="px-2 py-1 text-center text-muted-foreground">{l.group || '-'}</td>
                    <td className="px-2 py-1 text-center">{bodyPartOf(assign[l.id] ?? l.assign, l.group, l.raw) || '—'}</td>
                    <td className="px-2 py-1 font-medium break-keep">
                      {l.lineName || l.material}
                      {l.wari ? <span className="text-muted-foreground ml-1">와리 {l.wari}</span> : null}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.count}{l.pair ? ' (좌우)' : ''}</td>
                    <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{l.w.toFixed(2)} × {l.h.toFixed(2)}</td>
                    <td className="px-2 py-1">
                      <select value={assign[l.id] ?? l.assign} onChange={e => setAssign(p => ({ ...p, [l.id]: e.target.value as Assign }))}
                        className="h-7 rounded border border-border bg-card px-1 text-[11px]">
                        {(['leather', 'outer', 'lining', 'interlining', 'skip'] as Assign[]).map(a =>
                          <option key={a} value={a}>{ASSIGN_LABEL[a]}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{l.why}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter className="shrink-0">
          <span className="text-[11px] text-muted-foreground mr-auto">적용 후 BOM 화면의 <b>저장</b>을 눌러야 확정됩니다.</span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
          <Button onClick={fillTable}>소요량 표에 채우기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
