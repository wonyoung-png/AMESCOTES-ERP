// ATLM ERP — Layout (Phase 1: 제조/OEM)
// 기존 AMESCOTES 생산 기능 유지 · 브랜드운영·AI 메뉴는 Phase 2

import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { store } from '@/lib/store';
import { getCurrentUser, logout, isAdminEmail } from '@/lib/auth';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTheme } from '@/contexts/ThemeContext';
import type { Workspace } from '@/lib/phase1';
import {
  BarChart3, Zap, Package, ClipboardList, FlaskConical, Factory,
  ShoppingCart, Building2, FileText, Receipt, Settings,
  ChevronLeft, ChevronRight, DollarSign, LogOut, Layers,
  Menu, X, MoreHorizontal, GitCompare, Truck, Wallet, ClipboardCheck, CalendarClock, CalendarDays, Network,
  GitBranch, FileSpreadsheet, UserRound, Moon, Sun, ArrowUpRight,
  LineChart, Globe, BookOpen, Percent, Image as ImageIcon, TrendingUp, Inbox,
} from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  table?: string;
  /** LUMEN 워크스페이스에서만 표시 */
  lumenOnly?: boolean;
  /** OEM 워크스페이스에서만 표시 */
  oemOnly?: boolean;
  /** 관리자(ADMIN_EMAIL)에게만 표시 */
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  /** LUMEN 또는 AETALOOF 탭에서만 표시 (OEM 탭에서는 숨김) */
  brandOnly?: boolean;
  /** OEM 탭에서만 표시 (LUMEN/AETALOOF 탭에서는 숨김) */
  oemOnly?: boolean;
  items: NavItem[];
}

/** Phase 1 제조 ERP — DESIGN.md §2 생산 파이프라인 순서 */
const navGroups: NavGroup[] = [
  {
    label: '',
    items: [
      { path: '/', label: '대시보드', icon: <BarChart3 size={17} />, table: '생산 현황' },
      { path: '/quick', label: '간편등록', icon: <Zap size={17} />, table: '밖에서 빠르게 · 초안 저장' },
      { path: '/workflow', label: '워크플로우', icon: <GitBranch size={17} />, table: '클릭 → 탭 이동' },
    ],
  },
  {
    label: '기획 & 일정',
    brandOnly: true,
    items: [
      { path: '/projects', label: '프로젝트', icon: <ClipboardList size={17} />, table: 'projects' },
      { path: '/calendar', label: '운영 캘린더 · 기획전', icon: <CalendarDays size={17} />, table: 'campaigns' },
    ],
  },
  {
    label: '마스터',
    items: [
      { path: '/vendors', label: '거래처 마스터', icon: <Building2 size={17} />, table: 'vendors' },
      { path: '/samples', label: '샘플 관리', icon: <FlaskConical size={17} />, table: 'samples' },
      { path: '/items', label: '품목 마스터', icon: <Package size={17} />, table: 'items' },
      { path: '/materials', label: '자재 마스터', icon: <Layers size={17} />, table: 'materials' },
    ],
  },
  {
    label: '생산',
    items: [
      { path: '/bom', label: 'BOM / 원가', icon: <ClipboardList size={17} />, table: 'boms', oemOnly: true },
      { path: '/cost-comparison', label: '원가 비교', icon: <GitCompare size={17} />, table: 'boms', oemOnly: true },
      { path: '/inbound-po', label: '수주함', icon: <Inbox size={17} />, table: 'brand_order_lines', oemOnly: true },
      { path: '/orders', label: '생산 발주', icon: <Factory size={17} />, table: 'production_orders', oemOnly: true },
      { path: '/brand-orders', label: '오더관리', icon: <Factory size={17} />, table: 'production_orders', lumenOnly: true },
      { path: '/deadlines', label: '납기 캘린더', icon: <CalendarClock size={17} />, table: 'milestones', oemOnly: true },
    ],
  },
  {
    label: '구매',
    oemOnly: true,
    items: [
      { path: '/purchase', label: '자재 구매', icon: <ShoppingCart size={17} />, table: 'purchase_items' },
    ],
  },
  {
    label: '정산',
    items: [
      { path: '/trade-statement', label: '거래명세표', icon: <FileText size={17} />, table: 'trade_statements', oemOnly: true },
      { path: '/settlement', label: '미수금 / 정산', icon: <Receipt size={17} />, table: 'settlements', oemOnly: true },
      { path: '/payables', label: '미지급 · 불량차감', icon: <Wallet size={17} />, table: 'payables' },
      { path: '/expense', label: '지출결의', icon: <Receipt size={17} />, table: 'expenses' },
      { path: '/project-pl', label: '매출 · 영업이익', icon: <BarChart3 size={17} />, table: 'projects' },
      { path: '/sales-summary', label: '매출집계', icon: <LineChart size={17} />, table: '누적생산량', oemOnly: true },
      { path: '/documents', label: '서류 출력', icon: <FileText size={17} />, table: '공장PO · PI · PL', oemOnly: true },
    ],
  },
  {
    label: '설정',
    items: [
      { path: '/settings', label: '환율 / 설정', icon: <Settings size={17} />, table: 'exchange_rates' },
      { path: '/users', label: '사용자 관리', icon: <UserRound size={17} />, table: 'app_users', adminOnly: true },
      { path: '/org', label: '조직도 · R3담당', icon: <Network size={17} />, table: 'org_chart' },
    ],
  },
];

const bottomTabs = [
  { path: '/samples', label: '샘플', icon: <FlaskConical size={20} /> },
  { path: '/orders', label: '발주', icon: <Factory size={20} /> },
  { path: '/purchase', label: '구매', icon: <ShoppingCart size={20} /> },
  { path: '/trade-statement', label: '명세', icon: <FileText size={20} /> },
  { path: '/', label: '더보기', icon: <MoreHorizontal size={20} />, isMore: true },
];

const PMS_URL = 'https://daily.54-116-241-64.sslip.io/app/';

/**
 * LUMEN/AETALOOF 탭 사이드바 = PMS 탭 미러.
 * PMS(atlm-daily-check web/src/App.tsx) 탭 구조와 동기 — PMS 탭이 바뀌면 이 배열만 갱신.
 * 링크는 PMS의 location.hash 라우팅(#탭이름)으로 해당 탭 직행. 인증은 ERP 쿠키 SSO.
 */
const pmsTabs: { group: string; label: string; icon: React.ReactNode }[] = [
  { group: '데이터 & 점검', label: '일일점검', icon: <BarChart3 size={17} /> },
  { group: '데이터 & 점검', label: '채널별 매출', icon: <LineChart size={17} /> },
  { group: '데이터 & 점검', label: '상품 성과', icon: <TrendingUp size={17} /> },
  { group: '데이터 & 점검', label: '주문관리', icon: <Truck size={17} /> },
  { group: '데이터 & 점검', label: '국가별 주간', icon: <Globe size={17} /> },
  { group: '데이터 & 점검', label: '주간·일회성', icon: <FileSpreadsheet size={17} /> },
  { group: '데이터 & 점검', label: '점검 가이드', icon: <BookOpen size={17} /> },
  { group: '데이터 & 점검', label: '상품 리스트', icon: <Package size={17} /> },
  { group: '데이터 & 점검', label: '상품 손익', icon: <FileSpreadsheet size={17} /> },
  { group: '데이터 & 점검', label: '재고관리', icon: <Layers size={17} /> },
  { group: '데이터 & 점검', label: '채널 플랜', icon: <FileSpreadsheet size={17} /> },
  { group: '상품 운영', label: '상품 콘텐츠', icon: <Package size={17} /> },
  { group: '상품 운영', label: '상세페이지 교정', icon: <ClipboardCheck size={17} /> },
  { group: '콘텐츠 제작', label: '이미지 생성', icon: <ImageIcon size={17} /> },
  { group: '브랜드 인텔리전스', label: '브랜드 분석', icon: <Building2 size={17} /> },
  { group: '분석 & 진단', label: '매출분석', icon: <BarChart3 size={17} /> },
  { group: '분석 & 진단', label: '마케팅 대시보드', icon: <Percent size={17} /> },
  { group: '분석 & 진단', label: '채널 대조', icon: <ClipboardCheck size={17} /> },
  { group: '실행 & 일정', label: '할인 캠페인', icon: <Percent size={17} /> },
  { group: '실행 & 일정', label: '배송비 분석', icon: <Truck size={17} /> },
  { group: '실행 & 일정', label: '사이트 진단', icon: <Globe size={17} /> },
  { group: '실행 & 일정', label: '업로드 캘린더', icon: <CalendarDays size={17} /> },
  { group: '실행 & 일정', label: '일정 목록', icon: <CalendarDays size={17} /> },
];

/**
 * PMS 탭 링크. ERP 로그인 토큰을 함께 실어 보내 비밀번호를 다시 묻지 않게 한다.
 * PMS는 같은 PGRST_JWT_SECRET으로 이 토큰을 검증하고, 받자마자 주소창에서 지운다.
 */
const pmsTabUrl = (label: string) => {
  const t = localStorage.getItem('erp_token');
  const q = t ? `?erp=${encodeURIComponent(t)}` : '';
  return `${PMS_URL}${q}#${encodeURIComponent(label)}`;
};

type WorkspaceId = Workspace;

interface LayoutProps {
  children: React.ReactNode;
  onLogout?: () => void;
}

export default function Layout({ children, onLogout }: LayoutProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  // 사이드바 그룹 접기 — 접힌 그룹 라벨을 저장한다
  const [closedGroups, setClosedGroups] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nav_closed_groups') || '[]'); } catch { return []; }
  });
  const toggleGroup = (label: string) => setClosedGroups(prev => {
    const next = prev.includes(label) ? prev.filter(g => g !== label) : [...prev, label];
    localStorage.setItem('nav_closed_groups', JSON.stringify(next));
    return next;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { workspace, setWorkspace } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const settings = store.getSettings();
  const currentUser = getCurrentUser();

  const isActive = (path: string) => {
    if (path === '/') return location === '/';
    return location.startsWith(path);
  };

  const handleLogout = () => {
    logout();
    onLogout?.();
  };

  const isBrand = workspace !== 'OEM';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0 transition-all duration-200
          md:relative md:translate-x-0
          fixed inset-y-0 left-0 z-40
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:flex
          ${collapsed ? 'w-16' : 'w-[240px]'}
        `}
      >
        <div className={`flex items-center gap-3 px-4 py-5 border-b border-sidebar-border ${collapsed ? 'justify-center px-2' : ''}`}>
          <a href="https://os.54-116-241-64.sslip.io/" aria-label="OS 홈"
            className="w-8 h-8 rounded-md bg-sidebar-primary flex items-center justify-center shrink-0">
            <span className="text-sidebar-primary-foreground font-bold text-xs leading-none">AT</span>
          </a>
          {!collapsed && (
            <div className="overflow-hidden flex-1">
              <h1 className="text-sm font-bold text-foreground leading-tight">AMESCOTES OS</h1>
              <p className="text-[11px] text-muted-foreground leading-tight">Dev by BGROW Corp</p>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden text-muted-foreground hover:text-foreground p-1"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* 워크스페이스 탭 — 어떤 화면에서도 사라지면 안 된다.
            여기서만 OEM↔LUMEN↔AETALOOF를 오갈 수 있어서, 없어지면 돌아올 길이 막힌다.
            사이드바를 접어도 첫 글자로 남긴다. */}
        <div className={`border-b border-sidebar-border ${collapsed ? 'px-2 py-2' : 'px-3 py-3'}`}>
            <div className={`flex gap-1 bg-[var(--fill-tertiary)] rounded-md p-1 ${collapsed ? 'flex-col' : ''}`}>
              {(['OEM', 'LUMEN', 'AETALOOF'] as WorkspaceId[]).map((ws) => {
                const active = workspace === ws;
                return (
                  <button
                    key={ws}
                    type="button"
                    onClick={() => setWorkspace(ws)}
                    title={ws}
                    className={`
                      flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-all
                      ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-[var(--fill-quaternary)]'}
                    `}
                  >
                    {collapsed ? ws[0] : ws}
                  </button>
                );
              })}
            </div>
            {!collapsed && (
              <p className="text-[11px] text-muted-foreground mt-1.5 px-1">
                {workspace === 'OEM' ? 'OEM 제조 운영' : `${workspace} 브랜드 운영`}
              </p>
            )}
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {navGroups.map((group, gi) => {
            // oemOnly: LUMEN/AETALOOF에서 숨김 · brandOnly: OEM에서 숨김
            if (group.oemOnly && isBrand) return null;
            if (group.brandOnly && !isBrand) return null;
            // 항목이 전부 걸러진 그룹은 머리글만 남아 빈칸이 된다
            if (!group.items.some(i => !(i.oemOnly && isBrand) && !(i.lumenOnly && !isBrand))) return null;
            return (
            <div key={gi} className="mb-1">
              {group.label && !collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-3 pt-4 pb-1.5 group/nav"
                >
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                    {group.label}
                  </span>
                  <ChevronRight
                    size={12}
                    className={`text-muted-foreground transition-transform ${closedGroups.includes(group.label) ? '' : 'rotate-90'}`}
                  />
                </button>
              )}
              {group.label && collapsed && <div className="my-2 mx-2 h-px bg-border" />}
              {(group.label && !collapsed && closedGroups.includes(group.label) ? [] : group.items).map((item) => {
                if (item.oemOnly && isBrand) return null;
                if (item.lumenOnly && !isBrand) return null;
                if (item.adminOnly && !isAdminEmail(currentUser?.email)) return null;
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150 mb-0.5 outline-none focus-visible:outline-none
                      ${active
                        ? 'bg-[var(--fill-quaternary)] text-foreground font-medium'
                        : 'text-sidebar-foreground hover:text-foreground hover:bg-[var(--fill-quaternary)]'
                      }
                      ${collapsed ? 'justify-center px-2' : ''}
                    `}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-[var(--accent-mint)]" />
                    )}
                    <span className={`shrink-0 ${active ? 'text-sidebar-primary' : ''}`}>
                      {item.icon}
                    </span>
                    {!collapsed && (
                      <span className="flex-1 min-w-0 truncate">{item.label}</span>
                    )}
                  </Link>
                );
              })}
            </div>
            );
          })}
          {isBrand && (
            <>
            {/* LUMEN/AETALOOF: PMS 탭 미러 — 클릭 시 PMS 해당 탭으로 (named window 재사용) */}
            {pmsTabs.map((tab, ti) => {
              const groupStart = ti === 0 || pmsTabs[ti - 1].group !== tab.group;
              return (
                <div key={tab.label} className="mb-0.5">
                  {groupStart && !collapsed && (
                    <div className="px-3 pt-4 pb-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                        {tab.group}
                      </span>
                    </div>
                  )}
                  {groupStart && collapsed && ti !== 0 && <div className="my-2 mx-2 h-px bg-border" />}
                  <a
                    href={pmsTabUrl(tab.label)}
                    target="pms"
                    rel="noopener noreferrer"
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150 outline-none focus-visible:outline-none
                      text-sidebar-foreground hover:text-foreground hover:bg-[var(--fill-quaternary)]
                      ${collapsed ? 'justify-center px-2' : ''}
                    `}
                  >
                    <span className="shrink-0">{tab.icon}</span>
                    {!collapsed && (
                      <span className="flex-1 min-w-0 truncate">{tab.label}</span>
                    )}
                  </a>
                </div>
              );
            })}
            </>
          )}
        </nav>

        <div className="px-2 py-3 border-t border-sidebar-border space-y-1">
          {!collapsed && currentUser && (
            <div className="px-3 py-2 text-xs text-muted-foreground truncate">
              <span className="text-foreground font-medium">{currentUser.name}</span>
              <span className="ml-1.5">· {currentUser.role}</span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-muted-foreground hover:text-[var(--system-red)] hover:bg-[var(--fill-quaternary)] transition-colors text-xs ${collapsed ? 'justify-center' : ''}`}
          >
            <LogOut size={14} />
            {!collapsed && <span>로그아웃</span>}
          </button>
          {!collapsed && (
            <p className="px-3 pt-1 text-[11px] text-muted-foreground">
              개발문의 <a href="mailto:dev@bgrow.co.kr" className="underline-offset-2 hover:underline">dev@bgrow.co.kr</a>
            </p>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`w-full hidden md:flex items-center gap-2 px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--fill-quaternary)] transition-colors text-xs ${collapsed ? 'justify-center' : ''}`}
          >
            {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /><span>접기</span></>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-12 bg-card border-b border-border flex items-center justify-between px-4 md:px-6 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Menu size={20} />
            </button>
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{workspace}</span>
              <span className="mx-1.5 text-muted-foreground">·</span>
              시즌 <span className="font-semibold text-foreground">{settings.currentSeason}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <a
              href="https://os.54-116-241-64.sslip.io/"
              className="hidden sm:inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
            >
              OS 홈 <ArrowUpRight size={12} />
            </a>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="테마 전환"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--fill-quaternary)]"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <span className="hidden sm:flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              USD {settings.usdKrw.toLocaleString()}
            </span>
            <span className="hidden sm:inline text-muted-foreground">|</span>
            <span className="hidden sm:inline">CNY {settings.cnyKrw.toLocaleString()}</span>
            {currentUser && (
              <div className="flex items-center gap-1.5 ml-2">
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                  {currentUser.name.slice(0, 1)}
                </div>
                <span className="text-foreground font-medium hidden sm:inline">{currentUser.name}</span>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          {children}
        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 md:hidden bg-card border-t border-border z-20 safe-area-pb">
        <div className="flex items-center justify-around">
          {bottomTabs.map((tab) => {
            const active = tab.isMore ? false : isActive(tab.path);
            return (
              <Link
                key={tab.path}
                href={tab.isMore ? '#' : tab.path}
                onClick={tab.isMore ? (e) => { e.preventDefault(); setSidebarOpen(true); } : undefined}
                className={`flex flex-col items-center justify-center py-2 px-3 flex-1 gap-0.5 transition-colors ${
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{tab.icon}</span>
                <span className="text-[11px] font-medium">{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
