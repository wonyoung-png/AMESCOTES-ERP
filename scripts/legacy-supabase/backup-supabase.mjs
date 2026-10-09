// Supabase 전체 테이블 → JSON 일일 백업 (Documents/ERP_백업/YYYY-MM-DD/)
// 사용: node scripts/backup-supabase.mjs  (스케줄러가 매일 실행)
// 30일 지난 백업 폴더는 자동 삭제.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}
const SB = env.VITE_SUPABASE_URL;
// RLS 적용 후에는 anon 키로 못 읽음 → .env에 SUPABASE_SERVICE_ROLE_KEY 있으면 우선 사용
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const today = new Date().toISOString().slice(0, 10);
const outDir = path.join(process.env.USERPROFILE || ROOT, 'Documents', 'ERP_백업', today);
fs.mkdirSync(outDir, { recursive: true });

// 앱 코드(.from('...'))가 참조하는 테이블 전부 — 없는 테이블은 404로 자동 스킵
// 새 테이블 추가 시 여기에도 한 줄 추가할 것
const tables = [
  'items', 'boms', 'vendors', 'materials', 'production_orders', 'samples',
  'purchase_items', 'exchange_rates', 'settlements', 'trade_statements',
  'payables', 'projects', 'approval_logs', 'receipt_logs', 'defect_carryovers',
  'brand_order_batches', 'brand_order_lines', 'sales_atlm', 'sales_wconcept',
];

let total = 0;
for (const t of tables) {
  // 1000행 단위 페이지네이션 (PostgREST 기본 상한 대응)
  const rows = [];
  let ok = true;
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SB}/rest/v1/${t}?select=*`, {
      headers: { ...H, Range: `${from}-${from + 999}` },
    });
    if (!r.ok) { console.warn(`skip ${t}: HTTP ${r.status}`); ok = from > 0; break; }
    const chunk = await r.json();
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  if (!ok) continue; // 테이블 없음 → 파일 안 만듦
  fs.writeFileSync(path.join(outDir, `${t}.json`), JSON.stringify(rows));
  console.log(`${t}: ${rows.length}행`);
  total += rows.length;
}
if (total === 0) throw new Error('0행 백업 — 비정상, 확인 필요');

// 30일 초과 백업 삭제
const base = path.dirname(outDir);
for (const d of fs.readdirSync(base)) {
  const age = (Date.now() - new Date(d).getTime()) / 86400000;
  if (!Number.isNaN(age) && age > 30) fs.rmSync(path.join(base, d), { recursive: true, force: true });
}
console.log(`백업 완료: ${outDir} (총 ${total}행)`);
