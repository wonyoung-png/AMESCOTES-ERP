import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Search, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatKRW, type Material } from '@/lib/store';
import {
  materialToPackLine,
  packLineTotal,
  packLinesTotal,
  resolvePackLinesWithMaterials,
  type PackBomLine,
} from '@/lib/packBom';

interface PackBomEditorProps {
  lines: PackBomLine[];
  materials: Material[];
  onChange: (lines: PackBomLine[]) => void;
  compact?: boolean;
}

/** 표시용: "LPKG-XXX · 더스트백 SS" → "더스트백 SS" */
function displayMaterialName(name?: string, itemCode?: string): string {
  let n = (name || '').trim();
  if (!n) return '';
  n = n.replace(/^[A-Z0-9_-]+\s*[·\-–]\s*/i, '');
  if (itemCode) {
    const re = new RegExp(`^${itemCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[·\\-–]?\\s*`, 'i');
    n = n.replace(re, '');
  }
  return n.trim() || (name || '').trim();
}

function materialPool(materials: Material[], keepId?: string): Material[] {
  return materials.filter(m =>
    m.category === '포장재'
    || (m.itemCode || '').startsWith('LPKG-')
    || (m.itemCode || '').startsWith('HB-')
    || (keepId && m.id === keepId),
  );
}

function MaterialNameField({
  value,
  itemCode,
  materials,
  linked,
  onPickMaterial,
  onTypeName,
}: {
  value: string;
  itemCode?: string;
  materials: Material[];
  linked: boolean;
  onPickMaterial: (m: Material) => void;
  onTypeName: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => displayMaterialName(value, itemCode));
  const [findQ, setFindQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(displayMaterialName(value, itemCode));
  }, [value, itemCode]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setFindQ('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => findRef.current?.focus(), 0);
  }, [open]);

  const suggestions = useMemo(() => {
    const q = (findQ || draft).trim().toLowerCase();
    const list = !q
      ? materials
      : materials.filter(m =>
          displayMaterialName(m.name, m.itemCode).toLowerCase().includes(q)
          || (m.itemCode || '').toLowerCase().includes(q)
          || (m.spec || '').toLowerCase().includes(q),
        );
    return list.slice(0, 50);
  }, [findQ, draft, materials]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-stone-400 pointer-events-none" />
        <Input
          value={draft}
          onChange={e => {
            const next = e.target.value;
            setDraft(next);
            setFindQ(next);
            setOpen(true);
            onTypeName(next);
          }}
          onFocus={() => {
            setOpen(true);
            setFindQ(draft);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && suggestions[0]) {
              e.preventDefault();
              const m = suggestions[0];
              onPickMaterial(m);
              setDraft(displayMaterialName(m.name, m.itemCode));
              setOpen(false);
              setFindQ('');
            } else if (e.key === 'Escape') {
              setOpen(false);
              setFindQ('');
            }
          }}
          placeholder="자재명 입력 · 찾기"
          className={`h-7 text-xs pl-7 ${linked ? 'border-stone-200' : 'border-amber-400'}`}
        />
      </div>
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-0.5 rounded-md border border-stone-200 bg-white shadow-lg overflow-hidden min-w-[260px]">
          <div className="p-1.5 border-b border-stone-100 bg-stone-50">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-stone-400" />
              <input
                ref={findRef}
                value={findQ}
                onChange={e => setFindQ(e.target.value)}
                placeholder="자재 찾기 (이름·품번)"
                className="w-full h-7 pl-7 pr-2 text-xs rounded border border-stone-200 bg-white outline-none focus:border-amber-400"
                onKeyDown={e => {
                  if (e.key === 'Enter' && suggestions[0]) {
                    e.preventDefault();
                    onPickMaterial(suggestions[0]);
                    setDraft(displayMaterialName(suggestions[0].name, suggestions[0].itemCode));
                    setOpen(false);
                    setFindQ('');
                  }
                }}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {suggestions.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-stone-400">검색 결과 없음 — 자재명을 직접 입력하세요</div>
            ) : suggestions.map(m => (
              <button
                key={m.id}
                type="button"
                className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-amber-50 flex items-center justify-between gap-2"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  onPickMaterial(m);
                  setDraft(displayMaterialName(m.name, m.itemCode));
                  setOpen(false);
                  setFindQ('');
                }}
              >
                <span className="font-medium text-stone-800 truncate">
                  {displayMaterialName(m.name, m.itemCode)}
                </span>
                <span className="text-[10px] text-stone-400 tabular-nums shrink-0">
                  {formatKRW(m.unitPriceKrw ?? m.unitPriceCny ?? 0)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PackBomEditor({ lines, materials, onChange, compact }: PackBomEditorProps) {
  useEffect(() => {
    if (!materials.length || !lines.length) return;
    const resolved = resolvePackLinesWithMaterials(lines, materials, { syncPrice: true });
    const cleaned = resolved.map(l => ({
      ...l,
      itemName: displayMaterialName(l.itemName, l.itemCode) || l.itemName,
    }));
    const changed = cleaned.some((r, i) =>
      r.materialId !== lines[i]?.materialId
      || r.itemCode !== lines[i]?.itemCode
      || r.itemName !== lines[i]?.itemName
      || r.unitPriceKrw !== lines[i]?.unitPriceKrw,
    );
    if (changed) onChange(cleaned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materials]);

  const linkedCount = lines.filter(l => !!l.materialId && materials.some(m => m.id === l.materialId)).length;

  const replaceLineMaterial = (idx: number, m: Material) => {
    const qty = lines[idx]?.qty || 1;
    const line = materialToPackLine(m, qty);
    onChange(lines.map((l, i) => (i === idx ? {
      ...line,
      itemName: displayMaterialName(m.name, m.itemCode),
    } : l)));
  };

  const typeLineName = (idx: number, name: string) => {
    const q = name.trim().toLowerCase();
    const exact = materials.find(m =>
      displayMaterialName(m.name, m.itemCode).toLowerCase() === q
      || (m.name || '').toLowerCase() === q,
    );
    if (exact) {
      replaceLineMaterial(idx, exact);
      return;
    }
    onChange(lines.map((l, i) => (i === idx ? {
      ...l,
      itemName: name,
      materialId: '',
      itemCode: undefined,
      unitPriceKrw: 0,
      spec: undefined,
    } : l)));
  };

  const updateQty = (idx: number, qty: number) => {
    onChange(lines.map((l, i) => (i === idx ? { ...l, qty } : l)));
  };

  const removeLine = (idx: number) => {
    onChange(lines.filter((_, i) => i !== idx));
  };

  const addBlankRow = () => {
    onChange([...lines, {
      materialId: '',
      itemName: '',
      unit: 'EA',
      qty: 1,
      unitPriceKrw: 0,
    }]);
  };

  const total = packLinesTotal(lines);

  return (
    <div className={`space-y-3 ${compact ? '' : 'rounded-xl border border-amber-200 bg-amber-50/40 p-4'}`}>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
          <span>
            <b>패키지 구성</b> — 자재명 입력/찾기 · 단가는 자재마스터 전용 · 수량×단가 = 전체원가
          </span>
          <span className="text-[10px] text-amber-700/80">
            연결 {linkedCount}/{lines.length}
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-stone-50 text-stone-500">
            <tr>
              <th className="text-left px-3 py-2 w-28">품번</th>
              <th className="text-left px-3 py-2 min-w-[220px]">자재명</th>
              <th className="text-left px-3 py-2">규격</th>
              <th className="text-center px-2 py-2 w-14">단위</th>
              <th className="text-right px-2 py-2 w-16">수량</th>
              <th className="text-right px-2 py-2 w-28">단가 (마스터)</th>
              <th className="text-right px-3 py-2 w-24">금액</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-stone-400">
                  「행 추가」 후 자재명을 입력·선택하세요
                </td>
              </tr>
            ) : lines.map((line, idx) => {
              const linked = !!line.materialId && materials.some(m => m.id === line.materialId);
              const rowMaterials = materialPool(materials, line.materialId || undefined);
              return (
                <tr key={`pack-row-${idx}`} className="border-t border-stone-100">
                  <td className="px-3 py-2 font-mono text-[10px] text-stone-500">
                    {line.itemCode || '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <MaterialNameField
                      value={line.itemName}
                      itemCode={line.itemCode}
                      materials={rowMaterials}
                      linked={linked}
                      onPickMaterial={m => replaceLineMaterial(idx, m)}
                      onTypeName={name => typeLineName(idx, name)}
                    />
                  </td>
                  <td className="px-3 py-2 text-stone-500">{line.spec || '—'}</td>
                  <td className="px-2 py-2 text-center">{line.unit}</td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={line.qty || ''}
                      onChange={e => updateQty(idx, Number(e.target.value) || 0)}
                      className="h-7 text-xs text-right"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div
                      className="h-7 flex items-center justify-end gap-1 px-2 rounded bg-stone-100 text-stone-600 font-mono tabular-nums select-none cursor-not-allowed"
                      title="단가는 자재마스터에서만 수정할 수 있습니다"
                    >
                      <Lock className="w-3 h-3 text-stone-400 shrink-0" />
                      {formatKRW(line.unitPriceKrw || 0)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                    {formatKRW(packLineTotal(line))}
                  </td>
                  <td className="px-1 py-2 text-center">
                    <button type="button" onClick={() => removeLine(idx)} className="text-stone-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot className="bg-amber-50 border-t border-amber-100">
              <tr>
                <td colSpan={6} className="px-3 py-2.5 text-right font-semibold text-amber-900">전체원가</td>
                <td className="px-3 py-2.5 text-right font-bold text-amber-800 font-mono tabular-nums">
                  {formatKRW(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={addBlankRow}>
        <Plus className="w-3.5 h-3.5" />행 추가
      </Button>
    </div>
  );
}
