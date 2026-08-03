// JSON 백업 → 셀프호스팅 PostgREST 적재 + 행수 대조
// 사용법: node scripts/import-json-to-db.mjs <JSON디렉토리> <베이스URL> <anon토큰>
// 예:     node scripts/import-json-to-db.mjs ../handover/DB백업_JSON http://localhost "$ANON_TOKEN"
// 재실행 안전: PK 충돌 시 merge-duplicates(업서트)

import fs from 'node:fs';
import path from 'node:path';

const [dir, baseUrl, token] = process.argv.slice(2);
if (!dir || !baseUrl || !token) {
  console.error('사용법: node import-json-to-db.mjs <JSON디렉토리> <베이스URL> <anon토큰>');
  process.exit(1);
}

// FK 순서: vendors ← items(buyer_id) 순서 중요, 나머지는 참조 없음/느슨함
const TABLE_ORDER = [
  'vendors', 'items', 'materials', 'samples', 'boms',
  'production_orders', 'purchase_items', 'exchange_rates',
];

const headers = {
  'Content-Type': 'application/json',
  apikey: token,
  Authorization: `Bearer ${token}`,
};

async function countRows(table) {
  const res = await fetch(`${baseUrl}/rest/v1/${table}?select=id`, {
    method: 'HEAD',
    headers: { ...headers, Prefer: 'count=exact' },
  });
  const range = res.headers.get('content-range') || '';
  return Number(range.split('/')[1] ?? -1);
}

let failed = false;
for (const table of TABLE_ORDER) {
  const file = path.join(dir, `${table}.json`);
  if (!fs.existsSync(file)) { console.log(`- ${table}: JSON 없음, 건너뜀`); continue; }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) { console.log(`- ${table}: 0건, 건너뜀`); continue; }

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await fetch(`${baseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error(`✗ ${table} [${i}..${i + chunk.length}] HTTP ${res.status}: ${await res.text()}`);
      failed = true;
      break;
    }
  }

  const dbCount = await countRows(table);
  const ok = dbCount === rows.length;
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${table}: JSON ${rows.length}건 → DB ${dbCount}건`);
}

process.exit(failed ? 1 : 0);
