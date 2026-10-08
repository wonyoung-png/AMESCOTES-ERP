// PMS 내보내기(NDJSON, scripts/pms_export.py) → ERP PostgreSQL. ERP 앱 컨테이너 안에서 돌린다.
//
//   docker exec app-app-1 node /tmp/pms-import.mjs /tmp/pms_export.ndjson            # 미리보기 (건수만)
//   docker exec app-app-1 node /tmp/pms-import.mjs /tmp/pms_export.ndjson --write    # 실제로 넣기
//
// 같은 키는 덮어쓴다(upsert) — 여러 번 돌려도 같은 결과. 서버 역할(erp_server) 토큰으로 PostgREST 에 넣는다.
import fs from 'node:fs';
import readline from 'node:readline';
import crypto from 'node:crypto';

const [file, flag] = process.argv.slice(2);
const WRITE = flag === '--write';
const SECRET = process.env.PGRST_JWT_SECRET;
const PGRST = process.env.POSTGREST_URL || 'http://postgrest:3000';
if (!file || !SECRET) { console.error('사용: node pms-import.mjs <ndjson> [--write]  (PGRST_JWT_SECRET 필요)'); process.exit(1); }

const b64 = (x) => Buffer.from(x).toString('base64url');
function token() {
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ role: 'erp_server', iss: 'erp-server', exp: Math.floor(Date.now() / 1000) + 600 }));
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const KEYS = { pms_sheets: 'brand,name', pms_meta: 'brand,key', pms_sales: 'brand,date,channel,sku' };

async function flush(t, rows) {
  if (!rows.length || !WRITE) return;
  const r = await fetch(`${PGRST}/${t}?on_conflict=${KEYS[t]}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`${t} 저장 실패 ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

const buf = {}; const count = {};
const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const { t, ...row } = JSON.parse(line);
  if (!KEYS[t]) continue;
  if (t === 'pms_sheets') {
    // 시트는 머리글·행이 배열이어야 한다 — 아니면 넣지 않고 알린다 (화면·칸 고치기가 배열을 전제, 코덱스 지적)
    if (!Array.isArray(row.headers) || !Array.isArray(row.rows) || !row.rows.every(Array.isArray)) { console.warn('형식이 다른 시트 건너뜀:', row.brand, row.name); continue; }
    row.updated_at = new Date().toISOString(); // 다시 넣으면 버전도 바뀐다 — 열어 둔 화면의 옛 값이 덮어쓰지 못하게
  }
  if (t === 'pms_meta') row.updated_at = new Date().toISOString();
  (buf[t] ||= []).push(row);
  count[t] = (count[t] || 0) + 1;
  if (buf[t].length >= (t === 'pms_sheets' ? 5 : 500)) { await flush(t, buf[t]); buf[t] = []; } // 시트 한 행이 커서 작게 묶는다
}
for (const t of Object.keys(buf)) await flush(t, buf[t]);
console.log(WRITE ? '넣음' : '미리보기 (--write 로 실제 저장)', JSON.stringify(count));
