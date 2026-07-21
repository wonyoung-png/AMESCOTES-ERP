import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  GitBranch, ExternalLink, Building2, FlaskConical, Package, ClipboardList,
  Factory, ShoppingCart, Truck, FileText, Receipt, Wallet, BarChart3,
  ClipboardCheck, Warehouse, Network, CalendarDays, Settings,
} from 'lucide-react';

type FlowId = 'oem' | 'brand';

interface FlowNode {
  id: string;
  label: string;
  sub?: string;
  path: string;
  icon?: React.ReactNode;
  tone?: 'master' | 'produce' | 'buy' | 'settle' | 'brand' | 'external';
}

const TONE: Record<NonNullable<FlowNode['tone']>, string> = {
  master: 'border-stone-300 bg-white hover:border-stone-500 hover:bg-stone-50',
  produce: 'border-amber-300 bg-amber-50/80 hover:border-amber-500 hover:bg-amber-50',
  buy: 'border-sky-300 bg-sky-50/80 hover:border-sky-500 hover:bg-sky-50',
  settle: 'border-emerald-300 bg-emerald-50/80 hover:border-emerald-500 hover:bg-emerald-50',
  brand: 'border-violet-300 bg-violet-50/80 hover:border-violet-500 hover:bg-violet-50',
  external: 'border-dashed border-stone-300 bg-stone-50 text-stone-500 hover:border-stone-400',
};

function ArrowDown({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-1 text-stone-400">
      <div className="w-px h-3 bg-stone-300" />
      {label && <span className="text-[10px] my-0.5 px-1.5 text-stone-500">{label}</span>}
      <svg width="12" height="8" viewBox="0 0 12 8" className="text-stone-400">
        <path d="M6 8L0 0h12L6 8z" fill="currentColor" />
      </svg>
    </div>
  );
}

function ArrowRight() {
  return (
    <div className="hidden sm:flex items-center px-1 text-stone-300">
      <svg width="20" height="12" viewBox="0 0 20 12">
        <path d="M0 5h14M14 5l-4-4M14 5l-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}

function FlowCard({
  node,
  onGo,
}: {
  node: FlowNode;
  onGo: (path: string, label: string) => void;
}) {
  const tone = node.tone || 'master';
  const external = tone === 'external' || !node.path;
  return (
    <button
      type="button"
      disabled={external && !node.path}
      onClick={() => node.path && onGo(node.path, node.label)}
      className={`group relative w-full sm:w-auto min-w-[140px] max-w-[200px] text-left rounded-xl border-2 px-3 py-2.5 transition shadow-sm
        ${TONE[tone]}
        ${external && !node.path ? 'cursor-default opacity-80' : 'cursor-pointer'}
        focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40`}
    >
      <div className="flex items-start gap-2">
        {node.icon && <span className="mt-0.5 text-stone-600 shrink-0">{node.icon}</span>}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-800 leading-tight">{node.label}</p>
          {node.sub && <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">{node.sub}</p>}
        </div>
        {node.path && (
          <ExternalLink size={12} className="text-stone-300 group-hover:text-amber-600 shrink-0 mt-0.5" />
        )}
      </div>
    </button>
  );
}

function BranchSplit({
  left,
  right,
  onGo,
}: {
  left: FlowNode;
  right: FlowNode;
  onGo: (path: string, label: string) => void;
}) {
  return (
    <div className="w-full max-w-xl mx-auto">
      <div className="flex justify-center">
        <div className="w-px h-3 bg-stone-300" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border border-stone-200 rounded-2xl p-3 bg-stone-50/50">
        <div className="flex flex-col items-center gap-1">
          <Badge variant="outline" className="text-[10px] mb-1">본사 사입</Badge>
          <FlowCard node={left} onGo={onGo} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <Badge variant="outline" className="text-[10px] mb-1">공장 완사입</Badge>
          <FlowCard node={right} onGo={onGo} />
        </div>
      </div>
      <div className="flex justify-center">
        <div className="w-px h-3 bg-stone-300" />
      </div>
    </div>
  );
}

const OEM_PRE: FlowNode[] = [
  { id: 'vendors', label: '거래처', sub: '바이어 · 공장 · 자재처', path: '/vendors', icon: <Building2 size={16} />, tone: 'master' },
  { id: 'samples', label: '샘플', sub: '개발 · 승인', path: '/samples', icon: <FlaskConical size={16} />, tone: 'master' },
  { id: 'items', label: '품목', sub: '스타일 · 컬러', path: '/items', icon: <Package size={16} />, tone: 'master' },
  { id: 'bom', label: 'BOM / 원가', sub: '사후원가 우선', path: '/bom', icon: <ClipboardList size={16} />, tone: 'master' },
];

const OEM_MAIN: FlowNode[] = [
  { id: 'orders', label: '생산 발주', sub: '공장 PO · project_no', path: '/orders', icon: <Factory size={16} />, tone: 'produce' },
  { id: 'docs', label: '작업지시서 / 공장발주서', sub: '서류 출력 · 공장 전달', path: '/documents', icon: <FileText size={16} />, tone: 'produce' },
];

const OEM_BUY: FlowNode = {
  id: 'purchase', label: '자재 구매', sub: '구매 → 지출결의', path: '/purchase', icon: <ShoppingCart size={16} />, tone: 'buy',
};
const OEM_FACTORY_ONLY: FlowNode = {
  id: 'factory-only', label: '수량만 전달', sub: '구매 없음 · 공장 자체 사입', path: '/orders', icon: <Factory size={16} />, tone: 'produce',
};

const OEM_AFTER: FlowNode[] = [
  { id: 'recv', label: '입고 · 출고', sub: '부분입고 · 직출고', path: '/receiving', icon: <Truck size={16} />, tone: 'produce' },
  { id: 'trade', label: '거래명세표', sub: '청구 · 세금계산서', path: '/trade-statement', icon: <FileText size={16} />, tone: 'settle' },
  { id: 'settle', label: '미수금 / 정산', sub: '수금 · D-day', path: '/settlement', icon: <Receipt size={16} />, tone: 'settle' },
  { id: 'pay', label: '미지급 · 불량차감', sub: '자재·임가공 결제', path: '/payables', icon: <Wallet size={16} />, tone: 'settle' },
  { id: 'pl', label: '프로젝트 손익', sub: '품목·컬러 원가', path: '/project-pl', icon: <BarChart3 size={16} />, tone: 'settle' },
];

const BRAND_PRE: FlowNode[] = [
  { id: 'b-items', label: '품목 · 샘플 · BOM', sub: '브랜드 전용 스타일', path: '/items', icon: <Package size={16} />, tone: 'brand' },
  { id: 'b-orders', label: '리오더 · 오더관리', sub: '묶음 발주 · R3 승인', path: '/brand-orders', icon: <ClipboardCheck size={16} />, tone: 'brand' },
  { id: 'b-org', label: '조직도 · R3담당', sub: '역할·승인자', path: '/org', icon: <Network size={16} />, tone: 'brand' },
  { id: 'b-po', label: '생산 발주', sub: '승인 후 자동생성', path: '/orders', icon: <Factory size={16} />, tone: 'produce' },
  { id: 'b-docs', label: '작업지시서 / 공장발주서', sub: '서류 출력 · 공장 전달', path: '/documents', icon: <FileText size={16} />, tone: 'produce' },
];

const BRAND_AFTER: FlowNode[] = [
  { id: 'b-china', label: '중국창고', sub: '중국입고 · 선입', path: '/china-warehouse', icon: <Warehouse size={16} />, tone: 'brand' },
  { id: 'b-recv', label: '입고 · 출고', sub: '3PL / 한국입고', path: '/receiving', icon: <Truck size={16} />, tone: 'produce' },
  { id: 'b-pay', label: '미지급 · 결제', sub: '공장·자재 지출결의', path: '/payables', icon: <Wallet size={16} />, tone: 'settle' },
  { id: 'b-pl', label: '프로젝트 손익', sub: '생산비 체크', path: '/project-pl', icon: <BarChart3 size={16} />, tone: 'settle' },
  { id: 'b-ez', label: '이지어드민', sub: 'B2C · 쇼룸 출고 (외부)', path: '', icon: <ExternalLink size={16} />, tone: 'external' },
];

const QUICK_LINKS: FlowNode[] = [
  { id: 'q-cal', label: '운영 캘린더', path: '/calendar', icon: <CalendarDays size={14} /> },
  { id: 'q-dead', label: '납기 캘린더', path: '/deadlines', icon: <CalendarDays size={14} /> },
  { id: 'q-mat', label: '자재 마스터', path: '/materials', icon: <Package size={14} /> },
  { id: 'q-set', label: '환율 / 설정', path: '/settings', icon: <Settings size={14} /> },
];

export default function WorkflowGuide() {
  const { workspace } = useWorkspace();
  const isBrand = workspace === 'LUMEN' || workspace === 'AETALOOP';
  const [flow, setFlow] = useState<FlowId>(isBrand ? 'brand' : 'oem');
  const [, navigate] = useLocation();
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    setFlow(isBrand ? 'brand' : 'oem');
  }, [isBrand]);

  const go = (path: string, label: string) => {
    if (!path) return;
    setHint(`${label} → 이동`);
    navigate(path);
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
            <GitBranch size={22} className="text-amber-700" />
            워크플로우
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            박스를 누르면 해당 메뉴로 이동합니다 · 현재 워크스페이스: <span className="font-medium text-stone-700">{workspace}</span>
          </p>
        </div>
        <div className="flex rounded-lg border border-stone-200 overflow-hidden">
          <Button
            size="sm"
            variant={flow === 'oem' ? 'default' : 'ghost'}
            className={`rounded-none ${flow === 'oem' ? 'bg-stone-800' : ''}`}
            onClick={() => setFlow('oem')}
          >
            OEM 생산
          </Button>
          <Button
            size="sm"
            variant={flow === 'brand' ? 'default' : 'ghost'}
            className={`rounded-none ${flow === 'brand' ? 'bg-stone-800' : ''}`}
            onClick={() => setFlow('brand')}
          >
            브랜드 (LUMEN/AE)
          </Button>
        </div>
      </div>

      {hint && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5">
          {hint}
        </p>
      )}

      {/* 범례 */}
      <div className="flex flex-wrap gap-2 text-[11px] text-stone-500">
        <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-stone-400" />마스터</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-amber-400" />생산</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-sky-400" />구매</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-emerald-400" />정산</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-violet-400" />브랜드</span>
      </div>

      {flow === 'oem' ? (
        <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-stone-700 mb-4">OEM 생산 파이프라인</h2>

          {/* 사전 가로 스크롤 */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-1 mb-2 justify-center">
            {OEM_PRE.map((n, i) => (
              <div key={n.id} className="flex flex-col sm:flex-row items-center">
                <FlowCard node={n} onGo={go} />
                {i < OEM_PRE.length - 1 && (
                  <>
                    <div className="sm:hidden"><ArrowDown /></div>
                    <div className="hidden sm:block"><ArrowRight /></div>
                  </>
                )}
              </div>
            ))}
          </div>

          <ArrowDown label="발주" />

          <div className="flex flex-col items-center gap-0">
            {OEM_MAIN.map(n => (
              <div key={n.id} className="flex flex-col items-center">
                <FlowCard node={n} onGo={go} />
                <ArrowDown />
              </div>
            ))}
          </div>

          <BranchSplit left={OEM_BUY} right={OEM_FACTORY_ONLY} onGo={go} />

          <div className="flex flex-col items-center">
            <p className="text-[11px] text-stone-400 mb-1">공장 생산</p>
            <ArrowDown />
            {OEM_AFTER.map((n, i) => (
              <div key={n.id} className="flex flex-col items-center">
                <FlowCard node={n} onGo={go} />
                {i < OEM_AFTER.length - 1 && <ArrowDown />}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-violet-200/60 bg-gradient-to-b from-violet-50/40 to-white p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-stone-700 mb-1">브랜드 MD → 생산팀</h2>
          <p className="text-xs text-stone-500 mb-4">승인 후 생산발주 · 작업지시서/공장발주서 → 사입·완사입 (OEM과 동일)</p>

          <div className="flex flex-col items-center">
            {BRAND_PRE.map((n, i) => (
              <div key={n.id} className="flex flex-col items-center">
                <FlowCard node={n} onGo={go} />
                {i < BRAND_PRE.length - 1 && (
                  <ArrowDown label={n.id === 'b-orders' ? 'R3 6단계' : undefined} />
                )}
              </div>
            ))}
          </div>

          <ArrowDown />
          <BranchSplit left={OEM_BUY} right={OEM_FACTORY_ONLY} onGo={go} />

          <div className="flex flex-col items-center">
            <p className="text-[11px] text-stone-400 mb-1">공장 생산</p>
            <ArrowDown />
            {BRAND_AFTER.map((n, i) => (
              <div key={n.id} className="flex flex-col items-center">
                <FlowCard node={n} onGo={go} />
                {i < BRAND_AFTER.length - 1 && <ArrowDown />}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 바로가기 */}
      <div>
        <h3 className="text-xs font-semibold text-stone-500 mb-2 uppercase tracking-wide">관련 메뉴</h3>
        <div className="flex flex-wrap gap-2">
          {QUICK_LINKS.map(n => (
            <button
              key={n.id}
              type="button"
              onClick={() => go(n.path, n.label)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-stone-200 bg-white hover:border-amber-400 hover:bg-amber-50 text-stone-700 transition"
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
