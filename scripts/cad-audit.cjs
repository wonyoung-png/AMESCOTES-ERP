// CAD 소요량표 분류 대조표 생성 — 검수용
// 조각 이름 한 줄에 자재가 여러 개 들어온다:
//   "뒷판 핸들 겉감 2EA(와리:1.2), VXP 0.6 1EA, 420D"
//   → 겉감 2EA + VXP 0.6(보강) 1EA + 420D(보강) 1EA
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DIR = process.argv[2] || 'C:/Users/이원영 AMES/Documents/카카오톡 받은 파일/';
const OUT = process.argv[3] || 'C:/Temp/cad-audit.html';

const num = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : 0; };

/** 자재 한 조각을 무엇으로 볼지 */
const BASE_PATTERN_RE = /기본형|닺지형|닷지형/;
function classify(matName, group, raw = '') {
  const t = `${matName}`.trim().toLowerCase();
  const g = (group || '').trim();
  if (BASE_PATTERN_RE.test(raw) || BASE_PATTERN_RE.test(matName)) return { a: 'skip', why: '기본패턴' };
  if (/vxp|스타롱|부직포|접착|심지|보강|420d|eva|스펀지|폼|hdpe|pe판|철심|s\/l|싱지|양면/.test(t)) return { a: 'interlining', why: '자재명' };
  if (/우라|안감|里子|lining/.test(t)) return { a: 'lining', why: '자재명' };
  if (/원단|fabric|canvas|자카드|나일론|폴리/.test(t)) return { a: 'outer', why: '자재명' };
  if (/겉감|트림|self/.test(t)) {
    if (/^(안감|里子)$/.test(g)) return { a: 'lining', why: '마커그룹 ' + g };
    return { a: 'leather', why: '겉감/트림' };
  }
  // 자재명이 없으면 마커그룹으로
  if (/^(심|芯)$/.test(g)) return { a: 'interlining', why: '마커그룹 ' + g };
  if (/^(안감|里子|lining)$/.test(g)) return { a: 'lining', why: '마커그룹 ' + g };
  if (/^(皮|가죽|leather)$/.test(g)) return { a: 'leather', why: '마커그룹 ' + g };
  if (/^(겉감|self|트림2|型)$/.test(g)) return { a: 'leather', why: '마커그룹 ' + g };
  return { a: 'leather', why: '기본값' };
}

/** 자재를 가리키는 말 — 이 앞은 부위, 이 뒤는 자재로 본다.
    예) "별도 속고판 싱 양면 S/L 1.0 1EA, 우라 2EA"
        → 부위 "별도 속고판 싱" / 자재 "양면 S/L 1.0"(보강) 1EA + "우라"(안감) 2EA */
const MAT_WORDS = [
  '겉감', '우라', '안감', '里子', '트림', '자재',
  '양면\s*S/L', 'S/L', 'VXP', '스타롱', '420D', '부직포', '접착', '심지', '보강', 'EVA', '스펀지', '폼',
  'HDPE', 'PE판', '철심', '싱지', '원단',
];
const MAT_RE = new RegExp('(' + MAT_WORDS.join('|') + ')', 'i');

/** 이름을 부위 + 자재 목록으로 쪼갠다 — 한 패턴에 자재가 여러 개 올 수 있다 */
function splitName(raw, group) {
  const tag = (String(raw || '').match(/^\[([^\]]+)\]/) || [])[1] || '';
  const clean = String(raw || '').replace(/^\[[^\]]*\]\s*/, '');
  const segs = clean.split(',').map(s => s.trim()).filter(Boolean);

  const materials = [];
  let part = '';

  segs.forEach((seg, i) => {
    const eaM = seg.match(/([\d.]+)\s*EA/i);
    const ea = eaM ? parseFloat(eaM[1]) : 1;
    const wariM = seg.match(/와리\s*:?\s*([\d.]+)/);

    // 수량·괄호를 걷어낸 알맹이
    let text = seg
      .replace(/\([^)]*\)/g, '')
      .replace(/[\d.]+\s*EA/i, '')
      .replace(/,\s*V\s*$/i, '')
      .trim();

    const m = text.match(MAT_RE);
    let label;
    if (m && m.index !== undefined) {
      const head = text.slice(0, m.index).trim();
      label = text.slice(m.index).trim();
      if (i === 0) part = head;            // 첫 조각의 앞부분이 부위명
      else if (!part) part = head;
    } else if (i === 0) {
      part = text;                          // 자재어가 없으면 전체가 부위명
      label = tag || group || '겉감';
    } else {
      label = text;                         // 뒤 조각은 통째로 자재명
    }
    if (!label) return;
    materials.push({ label, ea, wari: wariM ? parseFloat(wariM[1]) : undefined });
  });

  if (materials.length === 0) materials.push({ label: tag || group || '겉감', ea: 1 });
  return { part: part || clean, tag, materials };
}

function parseFile(file) {
  const wb = XLSX.readFile(file);
  const pieces = [];
  let styleNo = '';
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
    let cur = null;
    const flush = () => { if (cur && cur.name && (cur.w || cur.h)) pieces.push(cur); };
    for (const r of rows) {
      const k = String(r[0] ?? '').trim(), v = String(r[1] ?? '').trim();
      if (k === 'Style:' && !styleNo) styleNo = v;
      if (k === 'Name:') { flush(); cur = { name: v, qty: 1, w: 0, h: 0, pair: false, group: '' }; continue; }
      if (!cur) continue;
      if (k.startsWith('Marker Group')) {
        cur.group = v;
        const qi = r.findIndex(c => String(c ?? '').trim().startsWith('Qty'));
        if (qi >= 0) cur.qty = num(r[qi + 1]) || 1;
      }
      if (k.startsWith('Width*Height')) {
        const m = v.match(/([\d.]+)\s*[xX*]\s*([\d.]+)/);
        if (m) { cur.w = +m[1]; cur.h = +m[2]; }
        const pi = r.findIndex(c => String(c ?? '').trim().startsWith('Pair'));
        if (pi >= 0) cur.pair = String(r[pi + 1] ?? '').trim().toUpperCase() === 'Y';
      }
    }
    flush();
  }
  // 조각 → 자재별 행으로 펼친다
  const lines = [];
  for (const p of pieces) {
    const { part, materials } = splitName(p.name, p.group);
    for (const m of materials) {
      const cls = classify(m.label, p.group, p.name);
      const count = p.qty * (p.pair ? 2 : 1) * (m.ea || 1);
      lines.push({
        raw: p.name, part, group: p.group, w: p.w, h: p.h, pair: p.pair, qty: p.qty,
        material: m.label, ea: m.ea, wari: m.wari,
        assign: cls.a, why: cls.why, count,
        sf: (p.w + 0.5) * (p.h + 0.5) * count / 10000 * 10.764,
        cm2: p.w * p.h * count,
      });
    }
  }
  return { file: path.basename(file), styleNo, lines };
}

const files = fs.readdirSync(DIR).filter(f => f.includes('소요량표') && /\.xlsx?$/i.test(f));
const data = files.map(f => parseFile(path.join(DIR, f)));

const LB = { leather: '가죽', outer: '원단(겉감)', lining: '안감', interlining: '심지·보강', skip: '제외' };
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ── 자재명별로 묶는다. 648줄을 다 보는 대신 고유 자재명만 검수하면 된다 ──────────
const allLines = data.flatMap(d => d.lines.map(l => ({ ...l, file: d.styleNo || d.file })));
const groupMap = new Map();
for (const l of allLines) {
  const key = l.material.trim().toLowerCase();
  let g = groupMap.get(key);
  if (!g) { g = { key, name: l.material.trim(), assign: l.assign, why: l.why, n: 0, samples: [], files: new Set() }; groupMap.set(key, g); }
  g.n++;
  g.files.add(l.file);
  if (g.samples.length < 3 && !g.samples.includes(l.raw)) g.samples.push(l.raw);
}
const groups = [...groupMap.values()].sort((a, b) => b.n - a.n);
const GJSON = JSON.stringify(groups.map(g => ({ k: g.key, name: g.name, a: g.assign, n: g.n })));

// ── 자재명별 검수 시트 ────────────────────────────────────────────────────────
const KEYS = ['leather', 'outer', 'lining', 'interlining', 'skip'];
const CONFIDENT = new Set(['자재명', '기본패턴']);

let rows = '';
for (const g of groups) {
  const sure = CONFIDENT.has(g.why);
  rows += `<tr data-k="${esc(g.key)}" data-a="${g.assign}" data-sure="${sure ? 1 : 0}" data-name="${esc(g.name)}">`
    + `<td class="nm"><b>${esc(g.name)}</b>${sure ? '' : ' <span class="warn">확인</span>'}</td>`
    + `<td class="num">${g.n}</td>`
    + `<td class="ctr dim sm">${g.files.size}개</td>`
    + `<td class="nm dim sm">${esc(g.samples.join(' · '))}</td>`
    + `<td class="ctr"><select class="pick">`
    + KEYS.map(k => `<option value="${k}"${k === g.assign ? ' selected' : ''}>${LB[k]}</option>`).join('')
    + `</select></td>`
    + `<td class="dim sm">${esc(g.why)}</td>`
    + '</tr>';
}

// 전체 행은 접어둔다 — 자재명별로 고치면 여기 전부 따라간다
let detail = '';
for (const f of data) {
  detail += `<tr class="fh"><td colspan="7"><b>${esc(f.styleNo || f.file)}</b> <span class="dim sm">${esc(f.file)} · ${f.lines.length}행</span></td></tr>`;
  let last = '';
  for (const l of f.lines) {
    const first = l.raw !== last; last = l.raw;
    detail += `<tr class="${l.assign === 'skip' ? 'off' : ''}">`
      + `<td class="nm">${first ? esc(l.raw) : ''}</td>`
      + `<td class="nm dim sm">${esc(l.part)}</td>`
      + `<td class="ctr dim">${esc(l.group || '-')}</td>`
      + `<td class="nm"><b>${esc(l.material)}</b></td>`
      + `<td class="num">${l.count}</td>`
      + `<td class="num">${l.w.toFixed(2)} × ${l.h.toFixed(2)}</td>`
      + `<td class="ctr a-${l.assign}"><b>${LB[l.assign]}</b></td>`
      + '</tr>';
  }
}

const stats = {};
allLines.forEach(l => { stats[l.assign] = (stats[l.assign] || 0) + 1; });
const needCheck = groups.filter(g => !CONFIDENT.has(g.why)).length;

// 부위명 빈도 — 소요량 탭 드롭다운 후보를 뽑는 데 쓴다
const partCount = {};
allLines.forEach(l => { const p = (l.part || '').trim(); if (p) partCount[p] = (partCount[p] || 0) + 1; });
fs.writeFileSync(OUT.replace(/\.html$/, '-parts.json'),
  JSON.stringify(Object.entries(partCount).sort((a, b) => b[1] - a[1]), null, 0));

const html = `<title>CAD 소요량표 분류 검수</title>
<style>
:root{--bg:#F7F6F4;--panel:#fff;--ink:#1A1815;--muted:#6B6560;--line:#E6E1D9;--accent:#8A3A2E;--warn:#9A6B00;
--lea:#8A5A2E;--out:#2F6F7A;--lin:#5B4B8A;--int:#7A6A55;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",Segoe UI,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#131211;--panel:#1B1A18;--ink:#EAE7E2;--muted:#9C958C;--line:#2A2825;--accent:#E08D7A;--warn:#D8AE52;--lea:#D9A46B;--out:#7FC3CE;--lin:#A99BDD;--int:#C2AE8E}}
:root[data-theme="dark"]{--bg:#131211;--panel:#1B1A18;--ink:#EAE7E2;--muted:#9C958C;--line:#2A2825;--accent:#E08D7A;--warn:#D8AE52;--lea:#D9A46B;--out:#7FC3CE;--lin:#A99BDD;--int:#C2AE8E}
:root[data-theme="light"]{--bg:#F7F6F4;--panel:#fff;--ink:#1A1815;--muted:#6B6560;--line:#E6E1D9;--accent:#8A3A2E;--warn:#9A6B00;--lea:#8A5A2E;--out:#2F6F7A;--lin:#5B4B8A;--int:#7A6A55}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
.wrap{max-width:1080px;margin:0 auto;padding:32px 16px 130px;display:flex;flex-direction:column;gap:14px}
h1{font-size:clamp(21px,3.4vw,30px);margin:0;letter-spacing:-.02em}
p.lede{margin:0;color:var(--muted);font-size:14px;max-width:70ch}
.stat{display:flex;flex-wrap:wrap;gap:6px;font-size:12.5px}
.stat span{border:1px solid var(--line);border-radius:999px;padding:3px 10px;background:var(--panel)}
.bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line)}
.bar button{font:inherit;font-size:12px;padding:5px 11px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer}
.bar button[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.bar input{font:inherit;font-size:12px;padding:5px 10px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--ink);min-width:150px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:760px}
th{background:var(--panel);text-align:left;font-size:11px;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:5px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr.fh td{background:color-mix(in srgb,var(--ink) 6%,transparent)}
tr.off td{opacity:.45}
tr.edited{background:color-mix(in srgb,var(--accent) 10%,transparent)}
.nm{word-break:keep-all;max-width:330px}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-family:var(--mono);font-size:11.5px}
.ctr{text-align:center;white-space:nowrap}
.dim{color:var(--muted)}.sm{font-size:11px}
.warn{color:var(--warn);font-size:10.5px;border:1px solid currentColor;border-radius:4px;padding:0 4px;vertical-align:2px}
select.pick{font:inherit;font-size:11.5px;padding:2px 4px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
.a-leather b{color:var(--lea)}.a-outer b{color:var(--out)}.a-lining b{color:var(--lin)}.a-interlining b{color:var(--int)}.a-skip b{color:var(--muted)}
.dock{position:fixed;left:0;right:0;bottom:0;z-index:20;background:var(--panel);border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}
.dock b{color:var(--accent)}
.dock button{font:inherit;font-size:13px;font-weight:600;padding:8px 16px;border-radius:8px;border:0;background:var(--ink);color:var(--bg);cursor:pointer}
.dock button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line);font-weight:400}
#out{width:100%;max-width:1048px;font-family:var(--mono);font-size:11.5px;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);display:none}
details summary{cursor:pointer;font-size:13px;color:var(--muted);padding:6px 0}
</style>
<div class="wrap">
<h1>CAD 소요량표 — 분류 검수</h1>
<p class="lede">${allLines.length}줄을 다 보실 필요 없습니다. <b>자재명 ${groups.length}개</b>만 확인하시면 됩니다.
틀린 것만 오른쪽 드롭다운을 바꾸시고, 맨 아래 <b>회신용 텍스트 복사</b>를 눌러 저에게 붙여 주세요.
<span class="warn">확인</span> 표시는 제가 자신 없는 것이니 그것만 보셔도 됩니다.</p>
<div class="stat">
<span style="color:var(--lea)">가죽 ${stats.leather || 0}줄</span>
<span style="color:var(--out)">원단 ${stats.outer || 0}줄</span>
<span style="color:var(--lin)">안감 ${stats.lining || 0}줄</span>
<span style="color:var(--int)">심지·보강 ${stats.interlining || 0}줄</span>
<span>제외(기본패턴) ${stats.skip || 0}줄</span>
<span style="color:var(--warn)">확인 필요 ${needCheck}개</span>
</div>

<div class="bar">
<button data-f="all" aria-pressed="true">전체 ${groups.length}</button>
<button data-f="check">확인 필요 ${needCheck}</button>
${KEYS.map(k => `<button data-f="${k}">${LB[k]}</button>`).join('')}
<input id="q" type="search" placeholder="자재명 검색">
</div>

<div class="scroll"><table id="t"><thead><tr>
<th>자재명</th><th class="num">건수</th><th class="ctr">스타일</th><th>이 이름으로 나온 조각 (예시)</th><th class="ctr">분류</th><th>근거</th>
</tr></thead><tbody>${rows}</tbody></table></div>

<details><summary>▸ 전체 ${allLines.length}행 원문 보기 (참고용)</summary>
<div class="scroll" style="margin-top:8px"><table><thead><tr>
<th>조각 이름 (원문)</th><th>부위</th><th class="ctr">마커그룹</th><th>자재</th><th class="num">수량</th><th class="num">가로 × 세로</th><th class="ctr">분류</th>
</tr></thead><tbody>${detail}</tbody></table></div>
</details>
</div>

<div class="dock">
  <span>수정 <b id="n">0</b>건</span>
  <button id="copy">회신용 텍스트 복사</button>
  <button id="reset" class="ghost">되돌리기</button>
  <textarea id="out" rows="6" readonly></textarea>
</div>

<script>
const LB = ${JSON.stringify(LB)};
const KEY = 'cad-audit-fix';
const orig = {}, fix = JSON.parse(localStorage.getItem(KEY) || '{}');
const rowsEl = [...document.querySelectorAll('#t tbody tr')];

rowsEl.forEach(tr => {
  const k = tr.dataset.k, sel = tr.querySelector('.pick');
  orig[k] = tr.dataset.a;
  if (fix[k]) sel.value = fix[k];
  paint(tr);
  sel.addEventListener('change', () => {
    if (sel.value === orig[k]) delete fix[k]; else fix[k] = sel.value;
    localStorage.setItem(KEY, JSON.stringify(fix));
    paint(tr); count();
  });
});
function paint(tr){ tr.classList.toggle('edited', !!fix[tr.dataset.k]); }
function count(){ document.getElementById('n').textContent = Object.keys(fix).length; }
count();

let filter = 'all', q = '';
function apply(){
  rowsEl.forEach(tr => {
    const okF = filter === 'all' ? true
      : filter === 'check' ? tr.dataset.sure === '0'
      : (tr.querySelector('.pick').value === filter);
    const okQ = !q || tr.dataset.name.toLowerCase().includes(q);
    tr.style.display = okF && okQ ? '' : 'none';
  });
}
document.querySelectorAll('.bar button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.bar button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  filter = b.dataset.f; apply();
}));
document.getElementById('q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); apply(); });

document.getElementById('copy').addEventListener('click', async () => {
  const ks = Object.keys(fix);
  const text = ks.length
    ? '[CAD 분류 수정]' + String.fromCharCode(10) + ks.map(k => {
        const tr = rowsEl.find(r => r.dataset.k === k);
        return '- ' + tr.dataset.name + ' : ' + LB[orig[k]] + ' -> ' + LB[fix[k]];
      }).join(String.fromCharCode(10))
    : '[CAD 분류 검수] 수정할 것 없음 - 전부 맞습니다.';
  const out = document.getElementById('out');
  out.style.display = 'block'; out.value = text; out.select();
  try { await navigator.clipboard.writeText(text); alert('복사했습니다. 대화창에 붙여 주세요.'); }
  catch { alert('아래 칸의 내용을 직접 복사해 주세요.'); }
});
document.getElementById('reset').addEventListener('click', () => {
  if (!confirm('수정한 것을 모두 되돌립니다.')) return;
  localStorage.removeItem(KEY);
  Object.keys(fix).forEach(k => delete fix[k]);
  rowsEl.forEach(tr => { tr.querySelector('.pick').value = orig[tr.dataset.k]; paint(tr); });
  count(); apply();
});
</script>`;

fs.writeFileSync(OUT, html);
console.log(`파일 ${data.length} · 자재행 ${allLines.length} · 고유 자재명 ${groups.length} · 확인필요 ${needCheck}`);
console.log(JSON.stringify(stats));
