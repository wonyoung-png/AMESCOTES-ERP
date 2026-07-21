// AMESCOTES — 조직도 (임시)
import { useMemo, useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  ORG_UNITS, ORG_MEMBERS, R3_ROLE_LABEL, R3_STEP_ROLE,
  getUnitChildren, getMembersByUnit, getR3RoleBoard, getMember,
  saveRoleOverride, clearRoleOverrides, ensureOrgChartSeeded,
  type OrgUnit, type R3Role,
} from '@/lib/orgChart';
import { R3_STEPS } from '@/lib/phase1';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Network, RefreshCw, Users } from 'lucide-react';

ensureOrgChartSeeded();

function UnitCard({ unit, depth }: { unit: OrgUnit; depth: number }) {
  const members = getMembersByUnit(unit.id);
  const concurrent = ORG_MEMBERS.filter(m => m.unitId === unit.id && m.concurrent);
  const children = getUnitChildren(unit.id);
  const head = unit.headMemberId ? getMember(unit.headMemberId) : null;

  return (
    <div className={`${depth > 0 ? 'ml-3 border-l border-stone-200 pl-3' : ''}`}>
      <div className="rounded-xl border border-stone-200 bg-white overflow-hidden mb-3">
        <div className={`px-3 py-2 border-b flex items-center gap-2 ${
          depth === 0 ? 'bg-stone-800 text-white' :
          depth === 1 ? 'bg-stone-100' : 'bg-stone-50'
        }`}>
          <span className={`text-sm font-semibold ${depth === 0 ? 'text-white' : 'text-stone-800'}`}>{unit.name}</span>
          {head && !head.isVacant && (
            <span className={`text-[11px] ${depth === 0 ? 'text-amber-200' : 'text-stone-500'}`}>
              · {head.name} {head.title}
            </span>
          )}
          {head?.isVacant && (
            <Badge variant="outline" className="text-[10px] border-red-300 text-red-600 bg-red-50">공석</Badge>
          )}
        </div>
        {(members.length > 0 || concurrent.length > 0) && (
          <div className="p-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {members.map(m => (
              <div
                key={m.id}
                className={`rounded-lg border px-2.5 py-2 ${
                  m.isVacant ? 'border-dashed border-stone-300 bg-stone-50 text-stone-400' : 'border-stone-200 bg-white'
                }`}
              >
                <p className="text-sm font-medium text-stone-800">{m.name}</p>
                <p className="text-[11px] text-stone-500">{m.title}</p>
                {m.brands && (
                  <div className="flex gap-1 mt-1">
                    {m.brands.map(b => (
                      <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">{b}</span>
                    ))}
                  </div>
                )}
                {m.r3Roles && m.r3Roles.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.r3Roles.map(r => (
                      <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
                        R3·{R3_ROLE_LABEL[r]}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {concurrent.map(m => (
              <div key={m.id} className="rounded-lg border border-dashed border-stone-300 px-2.5 py-2 bg-stone-50/80">
                <p className="text-sm font-medium text-stone-600">{m.name}</p>
                <p className="text-[11px] text-stone-400">{m.title}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      {children.map(ch => <UnitCard key={ch.id} unit={ch} depth={depth + 1} />)}
    </div>
  );
}

export default function OrgChartPage() {
  const { workspace } = useWorkspace();
  const ws = workspace === 'AETALOOP' ? 'AETALOOP' : workspace === 'LUMEN' ? 'LUMEN' : undefined;
  const [, tick] = useState(0);
  const refresh = () => tick(n => n + 1);

  const roleBoard = useMemo(() => getR3RoleBoard(ws), [ws, tick]);
  const roots = getUnitChildren(null);
  const candidatePool = ORG_MEMBERS.filter(m => !m.isVacant && !m.concurrent);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
            <Network size={22} className="text-amber-700" />
            조직도
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            AMESCOTES 임시 조직도 · R3 승인 담당 매핑 (추후 로그인/권한과 연동)
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!confirm('R3 담당자 선택을 기본값으로 되돌릴까요?')) return;
            clearRoleOverrides();
            refresh();
            toast.success('기본 담당자로 복원');
          }}
        >
          <RefreshCw size={14} className="mr-1" />담당 기본값 복원
        </Button>
      </div>

      {/* R3 역할 매핑 */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-4 py-3 border-b bg-violet-50 flex items-center gap-2">
          <Users size={16} className="text-violet-700" />
          <span className="text-sm font-semibold text-violet-900">R3 승인 담당 (임시)</span>
          <span className="text-xs text-violet-600">
            워크스페이스 {workspace} · 디자인팀장은 루멘/에탈루프 분기
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-stone-500 bg-stone-50 border-b">
                <th className="text-left px-4 py-2">R3 역할</th>
                <th className="text-left px-4 py-2">승인 단계</th>
                <th className="text-left px-4 py-2">현재 담당</th>
                <th className="text-left px-4 py-2">담당자 변경</th>
              </tr>
            </thead>
            <tbody>
              {roleBoard.map(row => {
                const steps = R3_STEPS.filter(s => R3_STEP_ROLE[s.step] === row.role);
                return (
                  <tr key={row.role} className="border-t border-stone-100">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-stone-800">{row.label}</span>
                      <span className="ml-2 text-[10px] font-mono text-stone-400">{row.role}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-600">
                      {steps.map(s => `${s.step}.${s.label}`).join(' · ')}
                    </td>
                    <td className="px-4 py-3">
                      {row.member ? (
                        <span className="text-sm font-medium text-violet-800">
                          {row.member.name} <span className="text-xs text-stone-500 font-normal">{row.member.title}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-red-500">미지정</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="border rounded-md h-8 px-2 text-xs min-w-[160px]"
                        value={row.member?.id || ''}
                        onChange={e => {
                          saveRoleOverride(row.role, e.target.value);
                          refresh();
                          toast.success(`${row.label} → ${getMember(e.target.value)?.name || ''}`);
                        }}
                      >
                        {candidatePool.map(m => (
                          <option key={m.id} value={m.id}>{m.name} ({m.title})</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 조직 트리 */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">AMESCOTES, INC. 조직</p>
        {roots.map(u => <UnitCard key={u.id} unit={u} depth={0} />)}
      </div>
    </div>
  );
}
