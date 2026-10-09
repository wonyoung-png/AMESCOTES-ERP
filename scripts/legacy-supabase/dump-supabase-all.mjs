// 컷오버용: Supabase 전 테이블 최종 덤프 (REST, 페이지네이션)
// 사용법: node scripts/dump-supabase-all.mjs <출력디렉토리> <SUPABASE_URL> <ANON_KEY>

import fs from 'node:fs';
import path from 'node:path';

const [outDir, baseUrl, key] = process.argv.slice(2);
if (!outDir || !baseUrl || !key) { console.error('사용법: dump-supabase-all.mjs <outDir> <url> <anonKey>'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const TABLES = [
  'vendors', 'items', 'materials', 'samples', 'boms', 'production_orders',
  'projects', 'brand_order_batches', 'brand_order_lines', 'approval_logs',
  'receipt_logs', 'defect_carryovers', 'payables', 'trade_statements',
  'settlements', 'purchase_items', 'exchange_rates',
  'sales_wconcept', 'sales_29cm', 'sales_atlm',
];

const headers = { apikey: key, Authorization: `Bearer ${key}` };
const PAGE = 1000;

for (const t of TABLES) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${baseUrl}/rest/v1/${t}?select=*&limit=${PAGE}&offset=${offset}`, { headers });
    if (!res.ok) { console.log(`- ${t}: HTTP ${res.status} (테이블 없음/접근불가 → 건너뜀)`); rows.length = 0; break; }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (rows.length || fs.existsSync(path.join(outDir, `${t}.json`))) {
    fs.writeFileSync(path.join(outDir, `${t}.json`), JSON.stringify(rows));
  }
  console.log(`${t}: ${rows.length}건`);
}
