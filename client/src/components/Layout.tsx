// AMESCOTES ERP — Layout
// Design: Maison Atelier — Dark sidebar (ebony) + warm ivory content area
// Gold accents (#C9A96E) on active nav items

import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { store } from '@/lib/store';
import { getCurrentUser, logout } from '@/lib/auth';
import {
  BarChart3, Package, ClipboardList, FlaskConical, Factory,
  ShoppingCart, Building2, FileText, Receipt, CreditCard, Settings,
  ChevronLeft, ChevronRight, TrendingUp, DollarSign, LogOut, Layers,
  Menu, X, MoreHorizontal, Bot, GitCompare, LayoutDashboard,
} from 'lucide-react';
import ChatWidget from './ChatWidget';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: '',
    items: [
      { path: '/', label: '대시보드', icon: <BarChart3 size={17} /> },
    ]
  },
  {
    label: '바이어',
    items: [
      { path: '/vendors', label: '바이어 마스터', icon: <Building2 size={17} /> },
    ]
  },
  {
    label: '품목/생산',
    items: [
      { path: '/samples', label: '샘플 관리', icon: <FlaskConical size={17} /> },
      { path: '/items', label: '품목 마스터', icon: <Package size={17} /> },
      { path: '/materials', label: '자재 마스터', icon: <Layers size={17} /> },
      { path: '/bom', label: 'BOM / 원가 관리', icon: <ClipboardList size={17} /> },
      { path: '/cost-comparison', label: '원가 비교', icon: <GitCompare size={17} /> },
      { path: '/orders', label: '생산 발주', icon: <Factory size={17} /> },
    ]
  },
  {
    label: '원가/구매',
    items: [
      { path: '/purchase', label: '자재 구매', icon: <ShoppingCart size={17} /> },
    ]
  },
  {
    label: '정산',
    items: [
      { path: '/trade-statement', label: '거래명세표', icon: <FileText size={17} /> },
      { path: '/sales', label: '매출 관리', icon: <TrendingUp size={17} /> },
      { path: '/md-dashboard', label: 'MD 대시보드', icon: <LayoutDashboard size={17} /> },
      { path: '/settlement', label: '정산 / 미수금', icon: <Receipt size={17} /> },
      { path: '/expense', label: '지출 전표', icon: <CreditCard size={17} /> },
      { path: '/documents', label: '서류 출력', icon: <FileText size={17} /> },
    ]
  },
  {
    label: '설정',
    items: [
      { path: '/settings', label: '환율 / 설정', icon: <Settings size={17} /> },
    ]
  },
  {
    label: 'AI',
    items: [
      { path: '/agent', label: 'AI 어시스턴트', icon: <Bot size={17} /> },
    ]
  },
];

// 하단 탭바용 주요 메뉴 (모바일)
const bottomTabs = [
  { path: '/samples', label: '샘플', icon: <FlaskConical size={20} /> },
  { path: '/orders', label: '발주', icon: <Factory size={20} /> },
  { path: '/trade-statement', label: '거래명세', icon: <FileText size={20} /> },
  { path: '/settlement', label: '정산', icon: <Receipt size={20} /> },
  { path: '/', label: '더보기', icon: <MoreHorizontal size={20} />, isMore: true },
];

interface LayoutProps {
  children: React.ReactNode;
  onLogout?: () => void;
}

export default function Layout({ children, onLogout }: LayoutProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    <div className="flex h-screen overflow-hidden bg-[#F5F4EF]">
      {/* 모바일 오버레이 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          flex flex-col bg-[#1C1C1E] text-white shrink-0 transition-all duration-200
          md:relative md:translate-x-0
          fixed inset-y-0 left-0 z-40
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:flex
          ${collapsed ? 'w-16' : 'w-[240px]'}
        `}
      >
        {/* Logo */}
        <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/8 ${collapsed ? 'justify-center px-2' : ''}`}>
          <div className="w-8 h-8 rounded-lg bg-[#C9A96E] flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-xs leading-none">AM</span>
          </div>
          {!collapsed && (
            <div className="overflow-hidden flex-1">
              <h1 className="text-sm font-bold text-white tracking-wide leading-tight">AMESCOTES</h1>
              <p className="text-[10px] text-white/35 tracking-wider leading-tight">ERP System</p>
            </div>
          )}
          {/* 모바일 닫기 버튼 */}
          {!collapsed && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden text-white/40 hover:text-white/70 p-1"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {navGroups.map((group, gi) => (
            <div key={gi} className="mb-1">
              {group.label && !collapsed && (
                <div className="px-3 pt-4 pb-1.5">
                  <span className="text-[10px] font-semibold text-white/25 uppercase tracking-[0.15em]">
                    {group.label}
                  </span>
                </div>
              )}
              {group.label && collapsed && <div className="my-2 mx-2 h-px bg-white/10" />}
              {group.items.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 mb-0.5
                      ${active
                        ? 'bg-[#C9A96E]/15 text-[#C9A96E] font-medium border border-[#C9A96E]/20'
                        : 'text-white/55 hover:text-white/90 hover:bg-white/8'
                      }
                      ${collapsed ? 'justify-center px-2' : ''}
                    `}
                  >
                    <span className={`shrink-0 ${active ? 'text-[#C9A96E]' : ''}`}>
                      {item.icon}
                    </span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {active && !collapsed && (
                      <span className="ml-auto w-1 h-4 rounded-full bg-[#C9A96E]" />
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* 사용자 / 로그아웃 */}
        <div className="px-2 py-3 border-t border-white/8 space-y-1">
          {!collapsed && currentUser && (
            <div className="px-3 py-2 text-xs text-white/40 truncate">
              <span className="text-white/70 font-medium">{currentUser.name}</span>
              <span className="ml-1.5">· {currentUser.role}</span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-white/35 hover:text-red-400 hover:bg-white/8 transition-colors text-xs ${collapsed ? 'justify-center' : ''}`}
          >
            <LogOut size={14} />
            {!collapsed && <span>로그아웃</span>}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`w-full hidden md:flex items-center gap-2 px-3 py-2 rounded-lg text-white/35 hover:text-white/70 hover:bg-white/8 transition-colors text-xs ${collapsed ? 'justify-center' : ''}`}
          >
            {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /><span>접기</span></>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="h-12 bg-white border-b border-stone-200 flex items-center justify-between px-4 md:px-6 shrink-0">
          {/* 모바일 햄버거 버튼 */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-stone-500 hover:text-stone-800 hover:bg-stone-100"
            >
              <Menu size={20} />
            </button>
            <div className="text-xs text-stone-400">
              시즌: <span className="font-semibold text-stone-600">{settings.currentSeason}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-stone-500">
            <span className="hidden sm:flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              USD {settings.usdKrw.toLocaleString()}
            </span>
            <span className="hidden sm:inline text-stone-300">|</span>
            <span className="hidden sm:inline">CNY {settings.cnyKrw.toLocaleString()}</span>
            {currentUser && (
              <div className="flex items-center gap-1.5 ml-2">
                <div className="w-7 h-7 rounded-full bg-[#C9A96E] flex items-center justify-center text-white text-xs font-bold">
                  {currentUser.name.slice(0, 1)}
                </div>
                <span className="text-stone-600 font-medium hidden sm:inline">{currentUser.name}</span>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          {children}
        </main>
      </div>

      {/* 플로팅 AI 챗봇 버튼 */}
      <ChatWidget />

      {/* 하단 탭바 (모바일 전용) */}
      <nav className="fixed bottom-0 left-0 right-0 md:hidden bg-white border-t border-stone-200 z-20 safe-area-pb">
        <div className="flex items-center justify-around">
          {bottomTabs.map((tab) => {
            const active = tab.isMore ? false : isActive(tab.path);
            return (
              <Link
                key={tab.path}
                href={tab.isMore ? '#' : tab.path}
                onClick={tab.isMore ? (e) => { e.preventDefault(); setSidebarOpen(true); } : undefined}
                className={`flex flex-col items-center justify-center py-2 px-3 flex-1 gap-0.5 transition-colors ${
                  active
                    ? 'text-[#C9A96E]'
                    : 'text-stone-400 hover:text-stone-600'
                }`}
              >
                <span>{tab.icon}</span>
                <span className="text-[10px] font-medium">{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
