/**
 * 브랜드 운영 — 시트형 탭 (옛 PMS SheetTab). /brand/sheet/:name
 * 데이터는 ERP DB(pms_sheets). 브랜드는 상단 워크스페이스(LUMEN/AETALOOF)를 따른다.
 * 칸을 두 번 누르면 고칠 수 있다 (서버가 그사이 바뀌었으면 막는다). 계획: docs/PMS_MERGE_PLAN.md
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'wouter';
import { toast } from 'sonner';
import { useWorkspace } from '@/contexts/WorkspaceContext';

type Sheet = { name: string; headers: string[]; rows: (string | number)[][]; updated_at: string; brand: string };
let seq = 0; // 마지막 요청만 반영 — 워크스페이스를 바꾸는 사이 늦게 온 옛 브랜드 응답이 덮지 않게 (코덱스 지적)

export default function BrandSheet() {
  const { name = '' } = useParams<{ name: string }>();
  const sheetName = decodeURIComponent(name);
  const { workspace } = useWorkspace();
  const brand = workspace === 'AETALOOF' ? 'aetaloof' : 'lumen';
  const [s, setS] = useState<Sheet | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ r: number; c: number; v: string } | null>(null);

  const load = () => {
    const my = ++seq;
    setErr(''); setEdit(null);
    fetch(`/api/brand-ops/sheet/${encodeURIComponent(sheetName)}?brand=${brand}`, { credentials: 'include', cache: 'no-store' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.message || j.error); return { ...j, brand }; })
      .then(j => { if (my === seq) setS(j); }, e => { if (my === seq) { setS(null); setErr(String(e.message || e)); } });
  };
  useEffect(load, [sheetName, brand]);

  // 원래 행 번호를 들고 다닌다 — 검색으로 걸러도 고칠 때 엉뚱한 행을 바꾸지 않게
  const rows = useMemo(() => (s?.rows || []).map((r, i) => ({ r, i }))
    .filter(({ r }) => !q || r.join(' ').toLowerCase().includes(q.toLowerCase())), [s, q]);

  const save = async () => {
    if (!edit || !s) return;
    const old = String(s.rows[edit.r]?.[edit.c] ?? '');
    if (edit.v === old) { setEdit(null); return; }
    const num = edit.v.trim() !== '' && !isNaN(Number(edit.v.replace(/,/g, ''))) && typeof s.rows[edit.r]?.[edit.c] === 'number';
    // 화면에 떠 있는 시트의 브랜드로 저장한다 (지금 워크스페이스가 아니라)
    const r = await fetch(`/api/brand-ops/sheet/${encodeURIComponent(sheetName)}/cell?brand=${s.brand}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row: edit.r, col: edit.c, value: num ? Number(edit.v.replace(/,/g, '')) : edit.v }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) toast.error(j.message || '저장 실패'); else toast.success('저장했습니다');
    setEdit(null); load();
  };

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-foreground">{sheetName}</h1>
          <p className="text-xs text-muted-foreground">
            {workspace} · {s ? `${s.rows.length}행 · 마지막 변경 ${new Date(s.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : ''}
          </p>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="검색"
          className="h-9 w-56 rounded-md border border-border bg-card px-3 text-sm" />
      </div>
      {err && <p className="text-sm text-[var(--system-red)]">{err}</p>}
      {s && (
        <div className="overflow-auto border border-border rounded-lg bg-card max-h-[calc(100vh-180px)]">
          <table className="text-xs border-collapse min-w-full">
            <thead className="sticky top-0 bg-[var(--fill-quaternary)]">
              <tr>{s.headers.map((h, i) => <th key={i} className="px-2 py-2 text-left font-medium whitespace-pre-line border-b border-border">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(({ r, i }) => (
                <tr key={i} className="border-b border-border/60 hover:bg-[var(--fill-quaternary)]">
                  {s.headers.map((_, c) => (
                    <td key={c} className="px-2 py-1.5 whitespace-nowrap" onDoubleClick={() => setEdit({ r: i, c, v: String(r[c] ?? '') })}>
                      {edit && edit.r === i && edit.c === c ? (
                        <input autoFocus value={edit.v} onChange={e => setEdit({ ...edit, v: e.target.value })}
                          onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(null); }}
                          className="h-7 w-full min-w-[80px] rounded border border-primary bg-background px-1" />
                      ) : typeof r[c] === 'number' ? <span className="tabular-nums">{Number(r[c]).toLocaleString()}</span> : String(r[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
