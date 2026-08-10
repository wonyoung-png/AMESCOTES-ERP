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
import {
  store, genId, COMMON_BRAND, YARD_UNIT, ROLL_52IN,
  DEFAULT_YARD_CFG, YARD_KINDS,
  type Material, type MaterialCategory, type YardCfg, type YardKind, type YardRow,
} from '@/lib/store';
import { fetchMaterials, upsertMaterial } from '@/lib/supabaseQueries';

/** 배정 단위 — 부위 4개 + 보강재. 소요량은 이 단위로 따로 나온다 */
const BUCKETS = ['바디', '트림1', '트림2', '안감', '보강재'] as const;
type Bucket = typeof BUCKETS[number];
const ROW_OPTIONS: Array<Bucket | '제외'> = [...BUCKETS, '제외'];

/** 버킷별 고를 수 있는 종류 — 안감·보강재는 고정 */
const KIND_CHOICES: Record<Bucket, YardKind[]> = {
  '바디': ['가죽', '원단'],
  '트림1': ['가죽', '원단'],
  '트림2': ['가죽', '원단'],
  '안감': ['안감'],
  '보강재': ['보강재'],
};
const DEFAULT_KIND: Record<Bucket, YardKind> = {
  '바디': '가죽', '트림1': '가죽', '트림2': '가죽', '안감': '안감', '보강재': '보강재',
};
/** 종류 → 자재 마스터 등록값 */
const MATERIAL_SPEC: Record<YardKind, { category: MaterialCategory; unit: string; subType?: string }> = {
  '가죽': { category: '가죽', unit: 'SF' },
  '원단': { category: '원단', unit: 'YD', subType: '겉감용' },
  '안감': { category: '원단', unit: 'YD', subType: '안감용' },
  '보강재': { category: '보강재', unit: 'M' },
};

export type CadTarget = { id: string; label: string };

/** 파서가 잡아 준 부위 — 사용자가 행마다 바꿀 수 있다 */
const guessBucket = (l: CadLine): Bucket | '제외' => {
  if (l.assign === 'skip') return '제외';
  if (l.assign === 'interlining') return '보강재';
  return (bodyPartOf(l.assign, l.group, l.raw) || '바디') as Bucket;
};

export function CadAssignDialog({
  open, onOpenChange, styleNo, lines, onFill,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  styleNo?: string;
  lines: CadLine[];
  onFill: (rows: Array<Omit<YardRow, 'id'>>, cfg: YardCfg) => void;
}) {
  const [bucket, setBucket] = useState<Record<string, Bucket | '제외'>>({});
  const [kind, setKind] = useState<Record<string, YardKind>>({ ...DEFAULT_KIND });
  // 폭·로스는 부위가 아니라 종류에 달린다 (가죽 15%, 원단 10% …)
  const [cfg, setCfg] = useState<YardCfg>(DEFAULT_YARD_CFG);
  const [busy, setBusy] = useState<Bucket | null>(null);
  const widthOf = (b: Bucket) => cfg[kindOf(b)].폭;
  const lossOf = (b: Bucket) => cfg[kindOf(b)].로스;
  const setCfgField = (k: YardKind, f: '폭' | '로스', v: number) => setCfg(c => ({ ...c, [k]: { ...c[k], [f]: v } }));
  const [onlyChecked, setOnlyChecked] = useState(false);
  const queryClient = useQueryClient();
  const { data: materials = [] } = useQuery({ queryKey: ['materials'], queryFn: fetchMaterials });

  useEffect(() => {
    if (!open) return;
    setBucket(Object.fromEntries(lines.map(l => [l.id, guessBucket(l)])));
    setKind({ ...DEFAULT_KIND });
    setCfg(DEFAULT_YARD_CFG);
  }, [open, lines]);

  const groups = useMemo(() => {
    const g = {} as Record<Bucket, CadLine[]>;
    for (const l of lines) {
      const b = bucket[l.id] ?? guessBucket(l);
      if (b === '제외') continue;
      (g[b] ||= []).push(l);
    }
    return g;
  }, [lines, bucket]);

  const skipCount = lines.filter(l => (bucket[l.id] ?? guessBucket(l)) === '제외').length;
  const kindOf = (b: Bucket) => kind[b] ?? DEFAULT_KIND[b];
  const needsWidth = (b: Bucket) => kindOf(b) !== '가죽';

  const netOf = (b: Bucket) => {
    const ls = groups[b] || [];
    if (!ls.length) return 0;
    const k = kindOf(b);
    if (k === '가죽') return calcLeatherSF(ls);
    if (k === '보강재') return calcRollM(ls, cfg[k].폭 || 0);
    return calcFabricYD(ls, cfg[k].폭 || 0);
  };

  const registerMissing = async (b: Bucket) => {
    const spec = MATERIAL_SPEC[kindOf(b)];
    const have = new Set((materials as Material[]).map(m => m.name?.trim().toLowerCase()));
    const names = Array.from(new Set((groups[b] || []).map(l => l.material.trim())))
      .filter(n => n && !have.has(n.toLowerCase()));
    if (!names.length) { toast.info(`${b} — 새로 등록할 자재가 없습니다`); return; }

    setBusy(b);
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
      toast.success(`${b} ${names.length}건 등록 — ${spec.category} / ${COMMON_BRAND} / 단위 ${spec.unit}`);
    } catch (err) {
      toast.error(`자재 등록 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const fillTable = () => {
    const active = BUCKETS.filter(b => (groups[b] || []).length);
    const noWidth = Array.from(new Set(active.filter(b => needsWidth(b) && !widthOf(b)).map(kindOf)));
    if (noWidth.length) { toast.error(`폭(cm)을 먼저 입력하세요 — ${noWidth.join(', ')}`); return; }
    const rows = lines
      .map(l => ({ l, b: bucket[l.id] ?? guessBucket(l) }))
      .filter(x => x.b !== '제외')
      .map(({ l, b }) => {
        const k = kindOf(b as Bucket);
        return {
          kind: k,
          part: k === '보강재' ? '' : (b === '안감' ? '바디' : (b as string)),
          가로: l.w, 세로: l.h,
          수량: l.count,
        };
      });
    if (!rows.length) { toast.error('표에 넣을 줄이 없습니다'); return; }
    onFill(rows, cfg);
  };

  const th = 'text-[11px] text-muted-foreground font-semibold py-1.5 px-2 whitespace-nowrap';
  const num = 'w-[68px] border border-border rounded px-1.5 py-1 text-xs text-right bg-card focus:outline-none focus:ring-1 focus:ring-ring';
  const sel = 'h-7 rounded border border-border bg-card px-1 text-[11px]';
  const visible = onlyChecked ? lines.filter(l => l.why === '겉감/트림' || l.why === '기본값') : lines;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] flex flex-col gap-3">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">
            CAD 소요량 분석 {styleNo ? <span className="text-muted-foreground font-normal">· {styleNo}</span> : null}
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground leading-snug">
            소요량표엔 겉감이 가죽인지 원단인지 없습니다 — <b>부위</b>만 자동으로 잡았습니다.
            부위마다 <b>종류·폭·로스</b>를 넣고 아래 <b>소요량 표에 채우기</b>를 누르면, BOM 적용은 소요량 탭에서 합니다.
            {skipCount > 0 && <> 기본패턴 <b>{skipCount}줄</b> 제외.</>}
          </p>
        </DialogHeader>

        {/* 부위별 — 한 줄에 하나. 폭·로스는 같은 종류끼리 값을 공유한다 */}
        <div className="rounded-lg border border-border overflow-x-auto shrink-0">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-[var(--fill-quaternary)] border-b border-border">
              <tr>
                <th className={`${th} text-left`}>부위</th>
                <th className={`${th} text-right`}>줄</th>
                <th className={th}>종류</th>
                <th className={`${th} text-right`}>폭 CM</th>
                <th className={`${th} text-right`}>로스 %</th>
                <th className={`${th} text-right`}>최종 소요량</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map(b => {
                const n = (groups[b] || []).length;
                const k = kindOf(b);
                const net = netOf(b);
                const noW = needsWidth(b) && !widthOf(b);
                return (
                  <tr key={b} className={`border-b border-border/60 last:border-0 ${n ? '' : 'opacity-40'}`}>
                    <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{b}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{n}</td>
                    <td className="px-2 py-1.5 text-center">
                      {KIND_CHOICES[b].length > 1
                        ? <select className={sel} value={k} disabled={!n}
                            onChange={e => setKind(s => ({ ...s, [b]: e.target.value as YardKind }))}>
                            {KIND_CHOICES[b].map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        : <span className="text-muted-foreground">{k}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {needsWidth(b)
                        ? <>
                            <input type="number" min={1} className={num} placeholder="입력" value={cfg[k].폭 || ''} disabled={!n}
                              onChange={e => setCfgField(k, '폭', parseFloat(e.target.value) || 0)} />
                            {k === '보강재' && <span className="text-[10px] text-muted-foreground ml-1">52"</span>}
                          </>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input type="number" min={0} max={100} className={num} value={cfg[k].로스} disabled={!n}
                        onChange={e => setCfgField(k, '로스', parseFloat(e.target.value) || 0)} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {!n ? <span className="text-muted-foreground">—</span>
                        : noW ? <span className="text-[11px] text-[var(--system-orange,#B45309)]">폭 입력</span>
                        : <><b>{withLoss(net, lossOf(b)).toFixed(3)} {YARD_UNIT[k]}</b>
                            <span className="text-[10px] text-muted-foreground ml-1">Net {net.toFixed(3)}</span></>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-center">
                      <Button size="sm" variant="outline" className="text-[11px] h-7 px-2" disabled={!n || busy === b}
                        onClick={() => registerMissing(b)}>
                        {busy === b ? '등록중' : '자재 등록'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 조각별 — 부위가 틀린 줄만 고친다 */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">조각 {lines.length}줄</span>
          <label className="text-[11px] flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={onlyChecked} onChange={e => setOnlyChecked(e.target.checked)} />
            확인 필요만 보기
          </label>
        </div>
        <div className="flex-1 min-h-[180px] overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card border-b border-border z-10">
              <tr>
                <th className={`${th} text-left`}>조각 이름 (원문)</th>
                <th className={`${th} text-left`}>자재 행 이름</th>
                <th className={`${th} text-right`}>수량</th>
                <th className={`${th} text-right`}>가로 × 세로</th>
                <th className={th}>부위</th>
                <th className={th}>종류</th>
                <th className={`${th} text-left`}>근거</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l, i) => {
                const first = i === 0 || visible[i - 1].raw !== l.raw;
                const b = bucket[l.id] ?? guessBucket(l);
                return (
                  <tr key={l.id} className={`border-b border-border/60 ${b === '제외' ? 'opacity-50' : ''}`}>
                    <td className="px-2 py-1 break-keep max-w-[220px]">{first ? l.raw : ''}</td>
                    <td className="px-2 py-1 font-medium break-keep">{l.lineName || l.material}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.count}</td>
                    <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{l.w.toFixed(1)} × {l.h.toFixed(1)}</td>
                    <td className="px-2 py-1 text-center">
                      <select value={b} onChange={e => setBucket(s => ({ ...s, [l.id]: e.target.value as Bucket | '제외' }))} className={sel}>
                        {ROW_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center text-muted-foreground">{b === '제외' ? '—' : kindOf(b)}</td>
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
