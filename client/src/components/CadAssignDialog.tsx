// CAD 소요량표를 올리면 조각을 부위(바디/트림1/트림2/안감/보강재)로 나누고,
// 부위마다 종류(가죽/원단)와 폭·로스율을 골라 소요량을 계산해 BOM 자재 줄에 적용한다.
//
// 소요량표에는 겉감이 가죽인지 원단인지 안 적혀 있다. 그래서 파서는 부위까지만 잡고,
// 종류는 여기서 부위별로 한 번씩 고른다.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { calcLeatherSF, calcFabricYD, calcRollM, withLoss, bodyPartOf, type CadLine } from '@/lib/cadYardage';
import { store, genId, COMMON_BRAND, YARD_UNIT, type Material, type MaterialCategory, type YardKind, type YardRow } from '@/lib/store';
import { fetchMaterials, upsertMaterial } from '@/lib/supabaseQueries';

/** 부위 — 소요량이 붙는 단위. 보강재는 부위를 안 쓰지만 한 덩어리로 묶어 계산한다 */
const PARTS = ['바디', '트림1', '트림2', '안감', '보강재'] as const;
type PartKey = typeof PARTS[number];
const ROW_OPTIONS: Array<PartKey | '제외'> = [...PARTS, '제외'];

/** 부위별 고를 수 있는 종류 — 보강재는 고정 */
const KIND_CHOICES: Record<PartKey, YardKind[]> = {
  '바디': ['가죽', '원단'],
  '트림1': ['가죽', '원단'],
  '트림2': ['가죽', '원단'],
  '안감': ['원단', '가죽'],
  '보강재': ['보강재'],
};
const DEFAULT_KIND: Record<PartKey, YardKind> = {
  '바디': '가죽', '트림1': '가죽', '트림2': '가죽', '안감': '원단', '보강재': '보강재',
};
/** 종류 → 자재 마스터 등록값 */
const MATERIAL_SPEC: Record<YardKind, { category: MaterialCategory; unit: string; subType?: string }> = {
  '가죽': { category: '가죽', unit: 'SF' },
  '원단': { category: '원단', unit: 'YD' },
  '보강재': { category: '보강재', unit: 'M' },
};

export type CadTarget = { id: string; label: string };

/** 파서가 잡아 준 부위 — 사용자가 행마다 바꿀 수 있다 */
const guessPart = (l: CadLine): PartKey | '제외' => {
  if (l.assign === 'skip') return '제외';
  if (l.assign === 'interlining') return '보강재';
  return (bodyPartOf(l.assign, l.group, l.raw) || '바디') as PartKey;
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
  const [part, setPart] = useState<Record<string, PartKey | '제외'>>({});
  const [kind, setKind] = useState<Record<string, YardKind>>({ ...DEFAULT_KIND });
  const [width, setWidth] = useState<Record<string, number>>({ '바디': 150, '트림1': 150, '트림2': 150, '안감': 150, '보강재': 100 });
  const [loss, setLoss] = useState<Record<string, number>>({ '바디': 15, '트림1': 15, '트림2': 15, '안감': 10, '보강재': 10 });
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<PartKey | null>(null);
  const queryClient = useQueryClient();
  const { data: materials = [] } = useQuery({ queryKey: ['materials'], queryFn: fetchMaterials });

  // 파일을 새로 올릴 때마다 파서가 잡은 부위로 초기화
  useEffect(() => {
    if (!open) return;
    setPart(Object.fromEntries(lines.map(l => [l.id, guessPart(l)])));
    setKind({ ...DEFAULT_KIND });
  }, [open, lines]);

  const groups = useMemo(() => {
    const g = {} as Record<PartKey, CadLine[]>;
    for (const l of lines) {
      const p = part[l.id] ?? guessPart(l);
      if (p === '제외') continue;
      (g[p] ||= []).push(l);
    }
    return g;
  }, [lines, part]);

  const skipCount = lines.filter(l => (part[l.id] ?? guessPart(l)) === '제외').length;
  const kindOf = (p: PartKey) => kind[p] ?? DEFAULT_KIND[p];
  const needsWidth = (p: PartKey) => kindOf(p) !== '가죽';

  const netOf = (p: PartKey) => {
    const ls = groups[p] || [];
    if (!ls.length) return 0;
    const k = kindOf(p);
    if (k === '가죽') return calcLeatherSF(ls);
    if (k === '보강재') return calcRollM(ls, width[p] || 0);
    return calcFabricYD(ls, width[p] || 0);
  };

  // 자재 마스터에 없는 자재명을 그대로 등록한다 (예: 0.4 VXP → 보강재 / 공통 / 단위 M)
  const registerMissing = async (p: PartKey) => {
    const spec = MATERIAL_SPEC[kindOf(p)];
    const have = new Set((materials as Material[]).map(m => m.name?.trim().toLowerCase()));
    const names = Array.from(new Set((groups[p] || []).map(l => l.material.trim())))
      .filter(n => n && !have.has(n.toLowerCase()));
    if (!names.length) { toast.info(`${p} — 새로 등록할 자재가 없습니다`); return; }

    setBusy(p);
    try {
      const list = [...(materials as Material[])];
      for (const name of names) {
        const m = {
          id: genId(),
          itemCode: store.getNextItemCode(spec.category, list),
          name,
          category: spec.category,
          subType: spec.subType,
          brand: COMMON_BRAND,
          unit: spec.unit,
          createdAt: new Date().toISOString(),
        } as Material;
        await upsertMaterial(m);
        list.push(m);
      }
      await queryClient.invalidateQueries({ queryKey: ['materials'] });
      toast.success(`${p} ${names.length}건 등록 — ${spec.category} / ${COMMON_BRAND} / 단위 ${spec.unit}`);
    } catch (err) {
      toast.error(`자재 등록 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const applyOne = (p: PartKey) => {
    const t = target[p];
    if (!t) { toast.error(`${p} 를 적용할 자재 줄을 고르세요`); return; }
    const net = netOf(p);
    if (!net) { toast.error(`${p} 계산값이 0입니다`); return; }
    const unit = YARD_UNIT[kindOf(p)];
    onApply(t, Math.ceil(net * 1000) / 1000, loss[p] || 0, unit);
    toast.success(`${p} ${withLoss(net, loss[p] || 0).toFixed(3)} ${unit} 적용`);
  };

  // 배정 결과를 소요량 표 행으로 옮긴다 — 종류·부위가 그대로 따라간다
  const fillTable = () => {
    const rows = lines
      .map(l => ({ l, p: part[l.id] ?? guessPart(l) }))
      .filter(x => x.p !== '제외')
      .map(({ l, p }) => {
        const k = kindOf(p as PartKey);
        return {
          kind: k,
          part: k === '보강재' ? '' : (p as string),
          가로: l.w, 세로: l.h,
          폭: k === '가죽' ? 0 : (width[p] || 150),
          로스: loss[p] || 0,
          수량: l.count,
        };
      });
    if (!rows.length) { toast.error('표에 넣을 줄이 없습니다'); return; }
    onFill(rows);
  };

  const th = 'text-[11px] text-muted-foreground font-semibold py-2 px-2 whitespace-nowrap';
  const inp = 'w-20 border border-border rounded px-2 py-1 text-sm text-right bg-card focus:outline-none focus:ring-1 focus:ring-ring';
  const sel = 'h-7 rounded border border-border bg-card px-1 text-[11px]';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            CAD 소요량 분석 {styleNo ? <span className="text-muted-foreground font-normal">· {styleNo}</span> : null}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            소요량표에는 겉감이 가죽인지 원단인지 안 적혀 있습니다. 그래서 <b>부위</b>까지만 자동으로 잡았습니다 —
            부위마다 <b>종류</b>를 고르고 폭·로스율을 넣으면 계산됩니다. 적용 대상은 <b>{scopeLabel}</b> 입니다.
            {skipCount > 0 && <> 기본패턴(원형·그림형·닺지형 등) <b>{skipCount}줄</b>은 제외했습니다.</>}
          </p>
        </DialogHeader>

        {/* 부위별 — 종류·폭·로스·적용 대상 */}
        <div className="grid gap-2 sm:grid-cols-2 shrink-0">
          {PARTS.map(p => {
            const n = (groups[p] || []).length;
            const k = kindOf(p);
            const net = netOf(p);
            return (
              <div key={p} className={`rounded-lg border p-3 space-y-2 ${n ? 'border-border bg-card' : 'border-dashed border-border opacity-50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{p}</span>
                    {KIND_CHOICES[p].length > 1 ? (
                      <select className={sel} value={k} onChange={e => setKind(s => ({ ...s, [p]: e.target.value as YardKind }))} disabled={!n}>
                        {KIND_CHOICES[p].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{k}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">{n}줄</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  {needsWidth(p) && (
                    <label className="flex items-center gap-1">폭(cm)
                      <input type="number" min={1} className={inp} value={width[p] ?? 0}
                        onChange={e => setWidth(s => ({ ...s, [p]: parseFloat(e.target.value) || 0 }))} />
                    </label>
                  )}
                  <label className="flex items-center gap-1">로스(%)
                    <input type="number" min={0} max={100} className={inp} value={loss[p] ?? 0}
                      onChange={e => setLoss(s => ({ ...s, [p]: parseFloat(e.target.value) || 0 }))} />
                  </label>
                </div>
                <div className="text-sm tabular-nums">
                  <span className="text-muted-foreground text-xs">Net </span>{net.toFixed(3)}
                  <span className="text-muted-foreground"> → 최종 </span>
                  <b>{withLoss(net, loss[p] || 0).toFixed(3)} {YARD_UNIT[k]}</b>
                </div>
                <div className="flex gap-2">
                  <select value={target[p] || ''} onChange={e => setTarget(s => ({ ...s, [p]: e.target.value }))}
                    className="h-8 flex-1 min-w-0 rounded-md border border-border bg-card px-2 text-xs" disabled={!n}>
                    <option value="">적용할 자재 줄…</option>
                    {targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <Button size="sm" className="text-xs h-8" disabled={!n} onClick={() => applyOne(p)}>적용</Button>
                </div>
                <Button size="sm" variant="outline" className="text-xs h-7 w-full"
                  disabled={!n || busy === p} onClick={() => registerMissing(p)}>
                  {busy === p ? '등록 중…' : `자재 마스터에 등록 (${MATERIAL_SPEC[k].category} · ${MATERIAL_SPEC[k].unit})`}
                </Button>
              </div>
            );
          })}
        </div>

        {/* 조각별 — 부위가 틀린 줄만 고친다 */}
        <div className="flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr>
                <th className={`${th} text-left`}>조각 이름 (원문)</th>
                <th className={`${th} text-left`}>자재 행 이름</th>
                <th className={th}>마커그룹</th>
                <th className={`${th} text-right`}>수량</th>
                <th className={`${th} text-right`}>가로 × 세로</th>
                <th className={th}>부위</th>
                <th className={th}>종류</th>
                <th className={`${th} text-left`}>근거</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const first = i === 0 || lines[i - 1].raw !== l.raw;
                const p = part[l.id] ?? guessPart(l);
                return (
                  <tr key={l.id} className={`border-b border-border/60 ${p === '제외' ? 'opacity-50' : ''}`}>
                    <td className="px-2 py-1 break-keep max-w-[220px]">{first ? l.raw : ''}</td>
                    <td className="px-2 py-1 font-medium break-keep">{l.lineName || l.material}</td>
                    <td className="px-2 py-1 text-center text-muted-foreground">{l.group || '-'}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.count}</td>
                    <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{l.w.toFixed(1)} × {l.h.toFixed(1)}</td>
                    <td className="px-2 py-1">
                      <select value={p} onChange={e => setPart(s => ({ ...s, [l.id]: e.target.value as PartKey | '제외' }))} className={sel}>
                        {ROW_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center text-muted-foreground">
                      {p === '제외' ? '—' : kindOf(p)}
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
