import { useState, useEffect, lazy, Suspense, type ComponentType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAutoExchangeRate } from '@/hooks/useAutoExchangeRate';
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import Layout from "./components/Layout";
import { isAuthenticated , restoreSession } from '@/lib/auth';


// 배포 직후 열려 있던 탭이 사라진 청크를 요청하면 로드 실패 → 세션당 1회 자동 새로고침
// (ErrorBoundary "unexpected error" 대신 최신 번들로 복구)
function lazyWithReload<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().catch((err) => {
      if (!sessionStorage.getItem('chunk_reload_once')) {
        sessionStorage.setItem('chunk_reload_once', '1');
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    })
  );
}

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
const ItemMaster = lazyWithReload(() => import("./pages/ItemMaster"));
const SalesSummary = lazyWithReload(() => import("./pages/SalesSummary"));
const BomManagement = lazyWithReload(() => import("./pages/BomManagement"));
const SampleManagement = lazyWithReload(() => import("./pages/SampleManagement"));
const ProductionOrders = lazyWithReload(() => import("./pages/ProductionOrders"));
const PurchaseMatching = lazyWithReload(() => import("./pages/PurchaseMatching"));
const VendorMaster = lazyWithReload(() => import("./pages/VendorMaster"));
const TradeStatement = lazyWithReload(() => import("./pages/TradeStatement"));
const SettlementManagement = lazyWithReload(() => import("./pages/SettlementManagement"));
const ExpenseEntry = lazyWithReload(() => import("./pages/ExpenseEntry"));
const DocumentOutput = lazyWithReload(() => import("./pages/DocumentOutput"));
const ExchangeSettings = lazyWithReload(() => import("./pages/ExchangeSettings"));
const MaterialMaster = lazyWithReload(() => import("./pages/MaterialMaster"));
const CostComparison = lazyWithReload(() => import("./pages/CostComparison"));
const CostSheetPrint = lazyWithReload(() => import("./pages/CostSheetPrint"));
const ReceivingShipping = lazyWithReload(() => import("./pages/ReceivingShipping"));
const PayablesManagement = lazyWithReload(() => import("./pages/PayablesManagement"));
const BrandOrders = lazyWithReload(() => import("./pages/BrandOrders"));
const ChinaWarehouse = lazyWithReload(() => import("./pages/ChinaWarehouse"));
const ProjectPL = lazyWithReload(() => import("./pages/ProjectPL"));
const DeadlineManagement = lazyWithReload(() => import("./pages/DeadlineManagement"));
const OperationalCalendar = lazyWithReload(() => import("./pages/OperationalCalendar"));
const OrgChartPage = lazyWithReload(() => import("./pages/OrgChart"));
const WorkflowGuide = lazyWithReload(() => import("./pages/WorkflowGuide"));
const LineSheet = lazyWithReload(() => import("./pages/LineSheet"));
const NotFound = lazyWithReload(() => import("./pages/NotFound"));
const UserManagement = lazyWithReload(() => import("./pages/UserManagement"));

import { ensureErpBootstrap } from "@/lib/ensureErpBootstrap";
import { setSbWriteFailureHandler } from "@/lib/store";
import { toast } from "sonner";

/** Phase 1 제조 ERP 라우트 — 브랜드운영(/sales), AI(/agent)는 Phase 2 */

// Supabase 저장 실패를 화면에 띄운다 (예전엔 console.warn으로 삼켜서
// 저장이 안 됐는데도 성공 토스트가 뜨던 문제)
const SB_TABLE_LABEL: Record<string, string> = {
  vendors: '거래처', items: '품목', samples: '샘플', boms: 'BOM',
  production_orders: '생산발주', materials: '자재',
};
setSbWriteFailureHandler(({ table, op, message }) => {
  toast.error(`${SB_TABLE_LABEL[table] || table} 저장 실패 (${op})`, {
    description: `${message}\n화면에 보이는 값이 서버에 저장되지 않았습니다.`,
    duration: 10000,
  });
});

function Router() {
  const [, forceUpdate] = useState(0);
  const [bootReady, setBootReady] = useState(!isAuthenticated());
  // OS 셸에서 로그인한 쿠키 세션 이어받기 — 성공 시 리로드로 정상 부트 경로 진입
  const [restoring, setRestoring] = useState(!isAuthenticated());
  useEffect(() => {
    if (isAuthenticated()) { setRestoring(false); return; }
    restoreSession().then(ok => {
      if (ok) window.location.reload();
      else setRestoring(false);
    });
  }, []);
  const queryClient = useQueryClient();
  useAutoExchangeRate();

  useEffect(() => {
    if (!isAuthenticated()) return;
    ensureErpBootstrap()
      .then(async boot => {
        if (boot.seeded) {
          await queryClient.invalidateQueries();
          toast.success(boot.message, { duration: 5000 });
        }
      })
      .finally(() => setBootReady(true));
  }, []);

  const handleLogin = async (seeded?: boolean) => {
    if (seeded) await queryClient.invalidateQueries();
    setBootReady(true);
    forceUpdate(n => n + 1);
  };
  const handleLogout = () => forceUpdate(n => n + 1);

  // 원가계산서 인쇄 전용 — Puppeteer PDF (로그인 불필요)
  if (window.location.pathname === '/cost-sheet-print') {
    return <CostSheetPrint />;
  }

  // 구 샘플/목업 URL → 대시보드
  if (window.location.pathname === '/md-mockup' || window.location.pathname === '/agent' || window.location.pathname === '/sales') {
    if (!isAuthenticated()) return <Login onLogin={handleLogin} />;
    return <Redirect to="/" />;
  }

  if (restoring) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Data Loading by AMESCOTES
      </div>
    );
  }

  if (!isAuthenticated()) {
    return <Login onLogin={handleLogin} />;
  }

  if (!bootReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Data Loading by AMESCOTES
      </div>
    );
  }

  return (
    <WorkspaceProvider>
    <Layout onLogout={handleLogout}>
      <Switch>
        <Route path="/login"><Redirect to="/" /></Route>
        <Route path="/" component={Dashboard} />
        <Route path="/workflow" component={WorkflowGuide} />
        <Route path="/users" component={UserManagement} />
        <Route path="/items" component={ItemMaster} />
        <Route path="/sales-summary" component={SalesSummary} />
        <Route path="/bom" component={BomManagement} />
        <Route path="/samples" component={SampleManagement} />
        <Route path="/orders" component={ProductionOrders} />
        <Route path="/receiving" component={ReceivingShipping} />
        <Route path="/deadlines" component={DeadlineManagement} />
        <Route path="/purchase" component={PurchaseMatching} />
        <Route path="/vendors" component={VendorMaster} />
        <Route path="/trade-statement" component={TradeStatement} />
        <Route path="/settlement" component={SettlementManagement} />
        <Route path="/payables" component={PayablesManagement} />
        <Route path="/project-pl" component={ProjectPL} />
        <Route path="/brand-orders" component={BrandOrders} />
        <Route path="/line-sheet" component={LineSheet} />
        <Route path="/china-warehouse" component={ChinaWarehouse} />
        <Route path="/calendar" component={OperationalCalendar} />
        <Route path="/expense" component={ExpenseEntry} />
        <Route path="/documents" component={DocumentOutput} />
        <Route path="/settings" component={ExchangeSettings} />
        <Route path="/org" component={OrgChartPage} />
        <Route path="/materials" component={MaterialMaster} />
        <Route path="/cost-comparison" component={CostComparison} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
    </WorkspaceProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
              Data Loading by AMESCOTES
            </div>
          }>
            <Router />
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
