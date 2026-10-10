import { useState, useEffect, lazy as lazyPage, Suspense } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAutoExchangeRate } from '@/hooks/useAutoExchangeRate';
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import RouteContent from "./components/RouteContent";
import { ThemeProvider } from "./contexts/ThemeContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import Layout from "./components/Layout";
import { isAuthenticated , restoreSession } from '@/lib/auth';


import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
const ItemMaster = lazyPage(() => import("./pages/ItemMaster"));
const QuickEntry = lazyPage(() => import("./pages/QuickEntry"));
const CaptureUpload = lazyPage(() => import("./pages/CaptureUpload"));
const WorkHub = lazyPage(() => import("./pages/WorkHub"));
const MyCalendar = lazyPage(() => import("./pages/MyCalendar"));
const SalesSummary = lazyPage(() => import("./pages/SalesSummary"));
const BomManagement = lazyPage(() => import("./pages/BomManagement"));
const SampleManagement = lazyPage(() => import("./pages/SampleManagement"));
const ProductionOrders = lazyPage(() => import("./pages/ProductionOrders"));
const PurchaseMatching = lazyPage(() => import("./pages/PurchaseMatching"));
const VendorMaster = lazyPage(() => import("./pages/VendorMaster"));
const TradeStatement = lazyPage(() => import("./pages/TradeStatement"));
const SettlementManagement = lazyPage(() => import("./pages/SettlementManagement"));
const CashPlan = lazyPage(() => import("./pages/CashPlan"));
const ExpenseEntry = lazyPage(() => import("./pages/ExpenseEntry"));
const DocumentOutput = lazyPage(() => import("./pages/DocumentOutput"));
const ExchangeSettings = lazyPage(() => import("./pages/ExchangeSettings"));
const MaterialMaster = lazyPage(() => import("./pages/MaterialMaster"));
const CostComparison = lazyPage(() => import("./pages/CostComparison"));
const CostSheetPrint = lazyPage(() => import("./pages/CostSheetPrint"));
const ReceivingShipping = lazyPage(() => import("./pages/ReceivingShipping"));
const PayablesManagement = lazyPage(() => import("./pages/PayablesManagement"));
const BrandOrders = lazyPage(() => import("./pages/BrandOrders"));
const InboundPO = lazyPage(() => import("./pages/InboundPO"));
const ChinaWarehouse = lazyPage(() => import("./pages/ChinaWarehouse"));
const InventoryOverview = lazyPage(() => import("./pages/InventoryOverview"));
const ProjectPL = lazyPage(() => import("./pages/ProjectPL"));
const DeadlineManagement = lazyPage(() => import("./pages/DeadlineManagement"));
const OperationalCalendar = lazyPage(() => import("./pages/OperationalCalendar"));
import ProjectBoard from '@/pages/ProjectBoard';
const OrgChartPage = lazyPage(() => import("./pages/OrgChart"));
const WorkflowGuide = lazyPage(() => import("./pages/WorkflowGuide"));
const LineSheet = lazyPage(() => import("./pages/LineSheet"));
const NotFound = lazyPage(() => import("./pages/NotFound"));
const UserManagement = lazyPage(() => import("./pages/UserManagement"));
const PmsWorkspace = lazyPage(() => import("./pages/PmsWorkspace"));
const SubscriptionManagement = lazyPage(() => import("./pages/SubscriptionManagement"));

import { ensureErpBootstrap } from "@/lib/ensureErpBootstrap";
import { setDbWriteFailureHandler } from "@/lib/store";
import { toast } from "sonner";

/** Phase 1 제조 ERP 라우트 — 브랜드운영(/sales), AI(/agent)는 Phase 2 */

// 서버 DB 저장 실패를 화면에 띄운다 (예전엔 console.warn으로 삼켜서
// 저장이 안 됐는데도 성공 토스트가 뜨던 문제)
const SB_TABLE_LABEL: Record<string, string> = {
  vendors: '거래처', items: '품목', samples: '샘플', boms: 'BOM',
  production_orders: '생산발주', materials: '자재',
};
setDbWriteFailureHandler(({ table, op, message }) => {
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
      <RouteContent>
      <Switch>
        <Route path="/login"><Redirect to="/" /></Route>
        <Route path="/" component={Dashboard} />
        <Route path="/workflow" component={WorkflowGuide} />
        <Route path="/users" component={UserManagement} />
        <Route path="/quick" component={QuickEntry} />
        <Route path="/capture" component={CaptureUpload} />
        <Route path="/inbox"><Redirect to="/work?view=captures" /></Route>
        <Route path="/work" component={WorkHub} />
      <Route path="/my-calendar" component={MyCalendar} />
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
        <Route path="/cash-plan" component={CashPlan} />
        <Route path="/payables" component={PayablesManagement} />
        <Route path="/project-pl" component={ProjectPL} />
        <Route path="/brand-orders" component={BrandOrders} />
        <Route path="/inbound-po" component={InboundPO} />
        <Route path="/line-sheet" component={LineSheet} />
        <Route path="/china-warehouse" component={ChinaWarehouse} />
        <Route path="/inventory" component={InventoryOverview} />
        <Route path="/calendar" component={OperationalCalendar} />
        <Route path="/projects" component={ProjectBoard} />
        <Route path="/expense" component={ExpenseEntry} />
        <Route path="/documents" component={DocumentOutput} />
        <Route path="/settings" component={ExchangeSettings} />
        <Route path="/org" component={OrgChartPage} />
        <Route path="/materials" component={MaterialMaster} />
        <Route path="/cost-comparison" component={CostComparison} />
        <Route path="/pms" component={PmsWorkspace} />
        <Route path="/subscriptions" component={SubscriptionManagement} />
        <Route component={NotFound} />
      </Switch>
      </RouteContent>
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
