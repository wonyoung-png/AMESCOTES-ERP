import { useState } from 'react';
import { useAutoExchangeRate } from '@/hooks/useAutoExchangeRate';
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
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
import SalesManagement from "./pages/SalesManagement";
import MaterialMaster from "./pages/MaterialMaster";
import AgentPanel from "./pages/AgentPanel";
import CostComparison from "./pages/CostComparison";
import MDMockup from "./pages/MDMockup";
import NotFound from "./pages/NotFound";

function Router() {
  const [, forceUpdate] = useState(0);
  useAutoExchangeRate();

  const handleLogin = () => forceUpdate(n => n + 1);
  const handleLogout = () => forceUpdate(n => n + 1);

  // MD 목업 — 로그인 없이 full-page로 바로 접근
  if (window.location.pathname === '/md-mockup') {
    return <MDMockup />;
  }

  if (!isAuthenticated()) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Layout onLogout={handleLogout}>
      <Switch>
        <Route path="/login"><Redirect to="/" /></Route>
        <Route path="/" component={Dashboard} />
        <Route path="/items" component={ItemMaster} />
        <Route path="/bom" component={BomManagement} />
        <Route path="/samples" component={SampleManagement} />
        <Route path="/orders" component={ProductionOrders} />
        <Route path="/purchase" component={PurchaseMatching} />
        <Route path="/vendors" component={VendorMaster} />
        <Route path="/trade-statement" component={TradeStatement} />
        <Route path="/settlement" component={SettlementManagement} />
        <Route path="/expense" component={ExpenseEntry} />
        <Route path="/documents" component={DocumentOutput} />
        <Route path="/settings" component={ExchangeSettings} />
        <Route path="/sales" component={SalesManagement} />
        <Route path="/materials" component={MaterialMaster} />
        <Route path="/agent" component={AgentPanel} />
        <Route path="/cost-comparison" component={CostComparison} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
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
