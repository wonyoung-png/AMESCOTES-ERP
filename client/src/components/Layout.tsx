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
  BarChart3, Package, ClipboardList, FlaskConical, Factory,
  ShoppingCart, Building2, FileText, Receipt, Settings,
  ChevronLeft, ChevronRight, DollarSign, LogOut, Layers,
  Menu, X, MoreHorizontal, GitCompare, Truck, Wallet, ClipboardCheck, CalendarClock, CalendarDays, Warehouse, Network,
  GitBranch, FileSpreadsheet, UserRound, Moon, Sun, ArrowUpRight,
} from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  table?: string;
  /** LUMEN 워크스페이스에서만 표시 */
  lumenOnly?: boolean;
  /** 관리자(ADMIN_EMAIL)에게만 표시 */
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  brandOnly?: boolean;
  items: NavItem[];
}

/** Phase 1 제조 ERP — DESIGN.md §2 생산 파이프라인 순서 */
const navGroups: NavGroup[] = [
  {
    label: '',
    items: [
      { path: '/', label: '대시보드', icon: <BarChart3 size={17} />, table: '생산 현황' },
      { path: '/workflow', label: '워크플로우', icon: <GitBranch size={17} />, table: '클릭 → 탭 이동' },
    ],
  },
  {
    label: '마스터',
    items: [
      { path: '/vendors', label: '거래처 마스터', icon: <Building2 size={17} />, table: 'vendors' },
      { path: '/items', label: '품목 마스터', icon: <Package size={17} />, table: 'items' },
      { path: '/materials', label: '자재 마스터', icon: <Layers size={17} />, table: 'materials' },
      { path: '/samples', label: '샘플 관리', icon: <FlaskConical size={17} />, table: 'samples' },
    ],
  },
  {
    label: '생산',
    items: [
      { path: '/bom', label: 'BOM / 원가', icon: <ClipboardList size={17} />, table: 'boms' },
      { path: '/cost-comparison', label: '원가 비교', icon: <GitCompare size={17} />, table: 'boms' },
      { path: '/orders', label: '생산 발주', icon: <Factory size={17} />, table: 'production_orders' },
      { path: '/receiving', label: '입고 · 출고', icon: <Truck size={17} />, table: 'receipt_logs' },
      { path: '/deadlines', label: '납기 캘린더', icon: <CalendarClock size={17} />, table: 'milestones' },
      { path: '/calendar', label: '운영 캘린더 · 기획전', icon: <CalendarDays size={17} />, table: 'campaigns' },
    ],
  },
  {
    label: '브랜드 운영',
    brandOnly: true,
    items: [
      { path: '/brand-orders', label: '리오더 · 오더관리', icon: <ClipboardCheck size={17} />, table: 'brand_order_batches' },
      { path: '/line-sheet', label: '라인시트', icon: <FileSpreadsheet size={17} />, table: 'wholesale line sheet', lumenOnly: true },
      { path: '/china-warehouse', label: '중국창고', icon: <Warehouse size={17} />, table: 'china_stock' },
    ],
  },
  {
    label: '구매',
    items: [
      { path: '/purchase', label: '자재 구매', icon: <ShoppingCart size={17} />, table: 'purchase_items' },
    ],
  },
  {
    label: '정산',
    items: [
      { path: '/trade-statement', label: '거래명세표', icon: <FileText size={17} />, table: 'trade_statements' },
      { path: '/settlement', label: '미수금 / 정산', icon: <Receipt size={17} />, table: 'settlements' },
      { path: '/payables', label: '미지급 · 불량차감', icon: <Wallet size={17} />, table: 'payables' },
      { path: '/project-pl', label: '발주 손익', icon: <BarChart3 size={17} />, table: 'projects' },
      { path: '/documents', label: '서류 출력', icon: <FileText size={17} />, table: '공장PO · PI · PL' },
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

type WorkspaceId = Workspace;

interface LayoutProps {
  children: React.ReactNode;
  onLogout?: () => void;
}

export default function Layout({ children, onLogout }: LayoutProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
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

        {/* 워크스페이스 — Phase 1: OEM만 활성 */}
        {!collapsed && (
          <div className="px-3 py-3 border-b border-sidebar-border">
            <div className="flex gap-1 bg-[var(--fill-tertiary)] rounded-md p-1">
              {(['OEM', 'LUMEN', 'AETALOOF'] as WorkspaceId[]).map((ws) => {
                const active = workspace === ws;
                return (
                  <button
                    key={ws}
                    type="button"
                    onClick={() => setWorkspace(ws)}
                    className={`
                      flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-all
                      ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-[var(--fill-quaternary)]'}
                    `}
                  >
                    {ws}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 px-1">
              {workspace === 'OEM' ? 'OEM + 브랜드 생산 공유' : `${workspace} 브랜드 발주`}
            </p>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {navGroups.map((group, gi) => {
            if (group.brandOnly && workspace === 'OEM') return null;
            if (!group.items.length) return null;
            return (
            <div key={gi} className="mb-1">
              {group.label && !collapsed && (
                <div className="px-3 pt-4 pb-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                    {group.label}
                  </span>
                </div>
              )}
              {group.label && collapsed && <div className="my-2 mx-2 h-px bg-border" />}
              {group.items.map((item) => {
                if (item.lumenOnly && workspace !== 'LUMEN') return null;
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
