import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { seedData } from "./lib/seed";

// ?reseed=1 파라미터로 강제 재시드 가능
if (new URLSearchParams(window.location.search).get('reseed') === '1') {
  const keys = ['ames_items','ames_vendors','ames_samples','ames_orders','ames_boms','ames_settlements','ames_sales','ames_purchases','ames_expenses','ames_seed_v1'];
  keys.forEach(k => localStorage.removeItem(k));
  window.history.replaceState({}, '', window.location.pathname);
}

seedData();

createRoot(document.getElementById("root")!).render(<App />);
