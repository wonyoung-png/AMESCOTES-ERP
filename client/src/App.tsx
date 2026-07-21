import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAutoExchangeRate } from '@/hooks/useAutoExchangeRate';
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import Layout from "./components/Layout";
import { isAuthenticated } from "@/lib/auth";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ItemMaster from "./pages/ItemMaster";
import BomManagement from "./pages/BomManagement";
import SampleManagement from "./pages/SampleManagement";
import ProductionOrders from "./pages/ProductionOrders";
import PurchaseMatching from "./pages/PurchaseMatching";
import VendorMaster from "./pages/VendorMaster";
import TradeStatement from "./pages/TradeStatement";
import SettlementManagement from "./pages/SettlementManagement";
import ExpenseEntry from "./pages/ExpenseEntry";
import DocumentOutput from "./pages/DocumentOutput";
import ExchangeSettings from "./pages/ExchangeSettings";
import MaterialMaster from "./pages/MaterialMaster";
import CostComparison from "./pages/CostComparison";
import CostSheetPrint from "./pages/CostSheetPrint";
import ReceivingShipping from "./pages/ReceivingShipping";
import PayablesManagement from "./pages/PayablesManagement";
import BrandOrders from "./pages/BrandOrders";
import ChinaWarehouse from "./pages/ChinaWarehouse";
import ProjectPL from "./pages/ProjectPL";
import DeadlineManagement from "./pages/DeadlineManagement";
import OperationalCalendar from "./pages/OperationalCalendar";
import OrgChartPage from "./pages/OrgChart";
import WorkflowGuide from "./pages/WorkflowGuide";
import LineSheet from "./pages/LineSheet";
import NotFound from "./pages/NotFound";
import { ensureErpBootstrap } from "@/lib/ensureErpBootstrap";
import { toast } from "sonner";

/** Phase 1 제조 ERP 라우트 — 브랜드운영(/sales), AI(/agent)는 Phase 2 */

function Router() {
  const [, forceUpdate] = useState(0);
  const [bootReady, setBootReady] = useState(!isAuthenticated());
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

  if (!isAuthenticated()) {
    return <Login onLogin={handleLogin} />;
  }

  if (!bootReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F4EF] text-stone-600 text-sm">
        데이터 준비 중...
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
        <Route path="/items" component={ItemMaster} />
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
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
