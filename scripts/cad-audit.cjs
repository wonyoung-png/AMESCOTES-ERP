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
const BASE_PATTERN_RE = /기본형|닺지형|닷지형|그림형|원형/;
function classify(matName, group, raw = '') {
  const t = `${matName}`.trim().toLowerCase();
  const g = (group || '').trim();
  if (BASE_PATTERN_RE.test(raw) || BASE_PATTERN_RE.test(matName)) return { a: 'skip', why: '기본패턴' };
  if (/vxp|스타롱|부직포|접착|심지|보강|420d|210d|eva|스펀지|폼|hdpe|pe판|철심|s\/l|싱지|양면/.test(t)) return { a: 'interlining', why: '자재명' };
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
  '양면\s*S/L', 'S/L', 'VXP', '스타롱', '420D', '210D', '부직포', '접착', '심지', '보강', 'EVA', '스펀지', '폼',
  'HDPE', 'PE판', '철심', '싱지', '원단',
];
const MAT_RE = new RegExp('(' + MAT_WORDS.join('|') + ')', 'i');

/** 자재어 시작 위치 — 붙어 있는 자재어는 한 덩어리로 본다 */
function materialStart(text) {
  const re = new RegExp(MAT_RE.source, 'gi');
  const hits = [];
  for (let m = re.exec(text); m; m = re.exec(text)) hits.push({ s: m.index, e: m.index + m[0].length });
  if (!hits.length) return -1;
  let start = hits[hits.length - 1].s;
  for (let i = hits.length - 1; i > 0; i--) {
    if (!/^[\s\d.\-/]*$/.test(text.slice(hits[i - 1].e, hits[i].s))) break;
    start = hits[i - 1].s;
  }
  return start;
}

/** 쉼표로 끊되, 자재가 아닌 쉼표는 도로 이어 붙인다 */
function splitSegments(clean) {
  const eaSum = s => (s.match(/([\d.]+)\s*EA/gi) || []).reduce((a, x) => a + (parseFloat(x) || 0), 0);
  const out = [];
  for (const piece of clean.split(',').map(x => x.trim()).filter(Boolean)) {
    const prev = out[out.length - 1];
    if (prev && /^[좌우]\s*[\d.]*\s*EA\b/i.test(piece)) { prev.ea += eaSum(piece) || 1; prev.bothSides = true; continue; }
    if (prev && !/[\d.]+\s*EA/i.test(prev.text)) { prev.text += ', ' + piece; prev.ea = eaSum(prev.text) || 1; continue; }
    out.push({ text: piece, ea: eaSum(piece) || 1, bothSides: false });
  }
  return out.length ? out : [{ text: clean, ea: 1, bothSides: false }];
}

/** 자재명 표기 통일 — 두께를 앞에 (VXP 0.4 -> 0.4 VXP) */
const normalizeMaterialName = l => l.replace(/^(VXP)\s+([\d.]+)$/i, '$2 $1');

/** 이름을 부위 + 자재 목록으로 쪼갠다 — 한 패턴에 자재가 여러 개 올 수 있다 */
function splitName(raw, group) {
  const tag = (String(raw || '').match(/^\[([^\]]+)\]/) || [])[1] || '';
  const clean = String(raw || '').replace(/^\[[^\]]*\]\s*/, '');
  const segs = splitSegments(clean);

  const materials = [];
  let part = '';
  let base = '';

  segs.forEach((seg, i) => {
    const ea = seg.ea;
    const wariM = seg.text.match(/와리\s*:?\s*([\d.]+)/);

    // 수량·괄호를 걷어낸 알맹이
    let text = seg.text
      .replace(/\([^)]*\)/g, '')
      .replace(/[\d.]+\s*EA/gi, '')
      .replace(/,\s*V\s*$/i, '')
      .replace(/\s+\/\s+.*$/, '')          // ' / 맞부착' 같은 공정 노트는 이름이 아니다
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (seg.bothSides) text = text.replace(/좌\s*$/, '좌,우');

    const at = materialStart(text);
    if (i === 0) {
      const first = at >= 0 ? text.slice(at).trim() : '';
      const bodyish = !first || /겉감|트림|self/i.test(first);
      base = (tag ? '[' + tag + '] ' : '') + (bodyish ? text : text.slice(0, at).trim());
    }

    let label;
    if (at >= 0) {
      const head = text.slice(0, at).trim();
      label = text.slice(at).trim();
      if (i === 0 || !part) part = head;
    } else if (i === 0) {
      part = text;                          // 자재어가 없으면 전체가 부위명
      label = tag || group || '겉감';
    } else {
      label = text;                         // 뒤 조각은 통째로 자재명
    }
    if (!label) return;
    materials.push({ label: normalizeMaterialName(label), ea, wari: wariM ? parseFloat(wariM[1]) : undefined });
  });

  if (materials.length === 0) materials.push({ label: tag || group || '겉감', ea: 1 });
  return { part: part || clean, base: base || clean, tag, materials };
}


/** 바디/트림1/트림2/안감 — 마커그룹이 직접 알려주는 것을 우선한다 */
function bodyPartOf(assign, group, raw) {
  if (assign === 'interlining' || assign === 'skip') return '';
  const g = (group || '').trim();
  if (assign === 'lining' || /안감|里子|lining/i.test(g)) return '안감';
  if (/트림\s*2/.test(g) || /트림\s*2/.test(raw)) return '트림2';
  if (/트림|trim/i.test(g) || /트림/.test(raw)) return '트림1';
  return '바디';
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
    const { part, base, materials } = splitName(p.name, p.group);
    for (const m of materials) {
      const cls = classify(m.label, p.group, p.name);
      const count = p.qty * (p.pair ? 2 : 1) * (m.ea || 1);
      lines.push({
        raw: p.name, part, group: p.group,
        lineName: base.endsWith(m.label) ? base : base + ' ' + m.label, w: p.w, h: p.h, pair: p.pair, qty: p.qty,
        material: m.label, ea: m.ea, wari: m.wari,
        assign: cls.a, why: cls.why, count, bodyPart: bodyPartOf(cls.a, p.group, p.name),
        sf: (p.w + 0.5) * (p.h + 0.5) * count / 10000 * 10.764,
        cm2: p.w * p.h * count,
      });
    }
  }
  return { file: path.basename(file), styleNo, lines };
}


// ── 한글 소요량표만 본다. 중국어 파일은 폐기, 같은 스타일 중복 파일은 최신 하나만 ──────
const HAN = /[가-힣]/;
const raw = fs.readdirSync(DIR).filter(f => f.includes('소요량표') && /\.xlsx?$/i.test(f));
const parsed = raw.map(f => ({ ...parseFile(path.join(DIR, f)), mtime: fs.statSync(path.join(DIR, f)).mtimeMs }));

const dropped = [];
const byStyle = new Map();
for (const d of parsed) {
  const koreanNames = d.lines.filter(l => HAN.test(l.raw)).length;
  if (koreanNames === 0) { dropped.push({ file: d.file, why: '중국어 파일' }); continue; }
  const key = d.styleNo || d.file;
  const prev = byStyle.get(key);
  if (!prev) { byStyle.set(key, d); continue; }
  const [keep, drop] = prev.mtime >= d.mtime ? [prev, d] : [d, prev];
  byStyle.set(key, keep);
  dropped.push({ file: drop.file, why: `${key} 중복` });
}
const data = [...byStyle.values()].sort((a, b) => (a.styleNo || '').localeCompare(b.styleNo || ''));

const LB = { leather: '가죽', outer: '원단(겉감)', lining: '안감', interlining: '보강재', skip: '제외' };
const KEYS = ['leather', 'outer', 'lining', 'interlining', 'skip'];
const PARTS = ['바디', '트림1', '트림2', '안감', ''];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const allLines = data.flatMap(d => d.lines.map((l, i) => ({ ...l, style: d.styleNo || d.file, rid: `${d.styleNo || d.file}#${i}` })));
const stats = {};
allLines.forEach(l => { stats[l.assign] = (stats[l.assign] || 0) + 1; });
const CONFIDENT = new Set(['자재명', '기본패턴']);
const needCheck = allLines.filter(l => !CONFIDENT.has(l.why)).length;

let body = '';
for (const f of data) {
  body += `<tr class="fh"><td colspan="9"><b>${esc(f.styleNo || f.file)}</b> <span class="dim sm">${esc(f.file)} · ${f.lines.length}행</span></td></tr>`;
  let last = '';
  f.lines.forEach((l, i) => {
    const rid = `${f.styleNo || f.file}#${i}`;
    const first = l.raw !== last; last = l.raw;
    const sure = CONFIDENT.has(l.why);
    body += `<tr data-id="${esc(rid)}" data-style="${esc(f.styleNo || f.file)}" data-raw="${esc(l.raw)}" data-mat="${esc(l.lineName || l.material)}" data-a="${l.assign}" data-p="${esc(l.bodyPart)}" data-sure="${sure ? 1 : 0}" class="${l.assign === 'skip' ? 'off' : ''}">`
      + `<td class="nm">${first ? esc(l.raw) : '<span class="dim">〃</span>'}</td>`
      + `<td class="nm"><b>${esc(l.lineName || l.material)}</b>${sure ? '' : ' <span class="warn">확인</span>'}</td>`
      + `<td class="ctr dim sm">${esc(l.group || '-')}</td>`
      + `<td class="num">${l.count}</td>`
      + `<td class="num">${l.w.toFixed(1)} × ${l.h.toFixed(1)}</td>`
      + `<td class="ctr"><select class="kind">${KEYS.map(k => `<option value="${k}"${k === l.assign ? ' selected' : ''}>${LB[k]}</option>`).join('')}</select></td>`
      + `<td class="ctr"><select class="part">${PARTS.map(p => `<option value="${esc(p)}"${p === l.bodyPart ? ' selected' : ''}>${p || '—'}</option>`).join('')}</select></td>`
      + `<td class="dim sm">${esc(l.why)}</td>`
      + `<td><input class="memo" placeholder="틀린 점 적어주세요"></td>`
      + '</tr>';
  });
}

const html = `<title>CAD 소요량표 분류 검수</title>
<style>
:root{--bg:#F7F6F4;--panel:#fff;--ink:#1A1815;--muted:#6B6560;--line:#E6E1D9;--accent:#8A3A2E;--warn:#9A6B00;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",Segoe UI,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#131211;--panel:#1B1A18;--ink:#EAE7E2;--muted:#9C958C;--line:#2A2825;--accent:#E08D7A;--warn:#D8AE52}}
:root[data-theme="dark"]{--bg:#131211;--panel:#1B1A18;--ink:#EAE7E2;--muted:#9C958C;--line:#2A2825;--accent:#E08D7A;--warn:#D8AE52}
:root[data-theme="light"]{--bg:#F7F6F4;--panel:#fff;--ink:#1A1815;--muted:#6B6560;--line:#E6E1D9;--accent:#8A3A2E;--warn:#9A6B00}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
.wrap{max-width:1180px;margin:0 auto;padding:30px 14px 120px;display:flex;flex-direction:column;gap:12px}
h1{font-size:clamp(20px,3.2vw,28px);margin:0;letter-spacing:-.02em}
p.lede{margin:0;color:var(--muted);font-size:13.5px;max-width:72ch}
.stat{display:flex;flex-wrap:wrap;gap:6px;font-size:12px}
.stat span{border:1px solid var(--line);border-radius:999px;padding:3px 10px;background:var(--panel)}
.bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line)}
.bar button{font:inherit;font-size:12px;padding:5px 11px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer}
.bar button[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.bar input,.bar select{font:inherit;font-size:12px;padding:5px 9px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:1040px}
th{background:var(--panel);text-align:left;font-size:11px;color:var(--muted);padding:8px 9px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:4px 9px;border-bottom:1px solid var(--line);vertical-align:middle}
tr.fh td{background:color-mix(in srgb,var(--ink) 6%,transparent);padding:8px 9px}
tr.off{opacity:.5}
tr.edited{background:color-mix(in srgb,var(--accent) 10%,transparent);opacity:1}
.nm{word-break:keep-all;max-width:280px}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-family:var(--mono);font-size:11px}
.ctr{text-align:center;white-space:nowrap}
.dim{color:var(--muted)}.sm{font-size:11px}
.warn{color:var(--warn);font-size:10.5px;border:1px solid currentColor;border-radius:4px;padding:0 4px;vertical-align:2px}
select.kind,select.part{font:inherit;font-size:11.5px;padding:2px 3px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
input.memo{font:inherit;font-size:11.5px;width:100%;min-width:150px;padding:3px 7px;border-radius:6px;border:1px solid var(--line);background:transparent;color:var(--ink)}
input.memo:focus{background:var(--panel);outline:1px solid var(--accent)}
.dock{position:fixed;left:0;right:0;bottom:0;z-index:20;background:var(--panel);border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}
.dock b{color:var(--accent)}
.ok{color:#2E6B4F;font-size:12px;font-weight:600;margin-left:6px}
@media (prefers-color-scheme:dark){.ok{color:#6FBF95}}
.dock button{font:inherit;font-size:13px;font-weight:600;padding:8px 16px;border-radius:8px;border:0;background:var(--ink);color:var(--bg);cursor:pointer}
.dock button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line);font-weight:400}
#out{width:100%;max-width:1100px;font-family:var(--mono);font-size:11.5px;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);display:none}
.note{font-size:11.5px;color:var(--muted);border:1px dashed var(--line);border-radius:8px;padding:8px 10px}
</style>
<div class="wrap">
<h1>CAD 소요량표 — 분류 검수</h1>
<p class="lede">한글 소요량표 <b>${data.length}개</b>만 남겼습니다. 행마다 <b>분류·부위</b>를 고치고, 맨 오른쪽 <b>메모</b>에 틀린 점을 적으세요.
바꾼 행만 모아 고치는 즉시 <b>자동 저장</b>됩니다 — 새로고침해도 남습니다. 다 적으셨으면 화면 맨 아래 <b>수정분 복사하기</b>를 누르고 대화창에 붙여넣으세요.</p>
<div class="note">
<b>부위는 이렇게 가릅니다</b> — 이 파일들의 마커그룹은 <code>SELF · 겉감 · 안감 · 심 · 트림2</code> 다섯 개뿐입니다.<br>
· <b>안감</b> = 마커그룹 <code>안감</code> 또는 자재명 우라/안감 · <b>트림2</b> = 마커그룹 <code>트림2</code> (파일이 직접 알려줌)<br>
· <b>트림1</b> = 조각 이름에 "트림"이 있고 트림2가 아닌 것 · <b>바디</b> = 나머지(SELF·겉감) · <b>보강재</b>는 부위 없음(—)
</div>
${dropped.length ? `<div class="note">폐기 ${dropped.length}건 — ${dropped.map(d => `${esc(d.file)} <span class="dim">(${d.why})</span>`).join(' · ')}</div>` : ''}
<div class="stat">
<span>가죽 ${stats.leather || 0}</span><span>원단 ${stats.outer || 0}</span><span>안감 ${stats.lining || 0}</span>
<span>보강재 ${stats.interlining || 0}</span><span>제외(기본패턴) ${stats.skip || 0}</span>
<span style="color:var(--warn)">확인 필요 ${needCheck}</span>
</div>

<div class="bar">
<button data-f="all" aria-pressed="true">전체 ${allLines.length}</button>
<button data-f="check">확인 필요 ${needCheck}</button>
${KEYS.map(k => `<button data-f="${k}">${LB[k]}</button>`).join('')}
<select id="st"><option value="">스타일 전체</option>${data.map(d => `<option>${esc(d.styleNo || d.file)}</option>`).join('')}</select>
<input id="q" type="search" placeholder="조각·자재명 검색">
</div>

<div class="scroll"><table id="t"><thead><tr>
<th>조각 이름 (원문)</th><th>자재</th><th class="ctr">마커그룹</th><th class="num">수량</th><th class="num">가로 × 세로</th>
<th class="ctr">분류</th><th class="ctr">부위</th><th>근거</th><th>메모 (틀린 점)</th>
</tr></thead><tbody>${body}</tbody></table></div>
</div>

<div class="dock">
  <span>수정 <b id="n">0</b>행 <span id="flash" class="ok"></span></span>
  <button id="copy">수정분 복사하기 → 대화창에 붙여넣기</button>
  <button id="reset" class="ghost">되돌리기</button>
  <textarea id="out" rows="8" readonly></textarea>
</div>

<script>
const LB = ${JSON.stringify(LB)};
const KEY = 'cad-audit-v2';
const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
const rows = [...document.querySelectorAll('#t tbody tr[data-id]')];

function diff(tr){
  const id = tr.dataset.id, s = saved[id] || {};
  const k = tr.querySelector('.kind').value, p = tr.querySelector('.part').value, m = tr.querySelector('.memo').value.trim();
  const out = {};
  if (k !== tr.dataset.a) out.k = k;
  if (p !== tr.dataset.p) out.p = p;
  if (m) out.m = m;
  return out;
}
function save(tr){
  const d = diff(tr);
  if (Object.keys(d).length) saved[tr.dataset.id] = d; else delete saved[tr.dataset.id];
  localStorage.setItem(KEY, JSON.stringify(saved));
  tr.classList.toggle('edited', !!saved[tr.dataset.id]);
  document.getElementById('n').textContent = Object.keys(saved).length;
  const f = document.getElementById('flash');
  f.textContent = '✓ 저장됨';
  clearTimeout(window.__ft);
  window.__ft = setTimeout(() => { f.textContent = ''; }, 1500);
}
rows.forEach(tr => {
  const s = saved[tr.dataset.id];
  if (s) {
    if (s.k) tr.querySelector('.kind').value = s.k;
    if (s.p !== undefined) tr.querySelector('.part').value = s.p;
    if (s.m) tr.querySelector('.memo').value = s.m;
    tr.classList.add('edited');
  }
  tr.querySelectorAll('.kind,.part').forEach(el => el.addEventListener('change', () => save(tr)));
  tr.querySelector('.memo').addEventListener('input', () => save(tr));
});
document.getElementById('n').textContent = Object.keys(saved).length;

let filter = 'all', q = '', style = '';
function apply(){
  rows.forEach(tr => {
    const okF = filter === 'all' ? true
      : filter === 'check' ? tr.dataset.sure === '0'
      : tr.querySelector('.kind').value === filter;
    const okS = !style || tr.dataset.style === style;
    const hay = (tr.dataset.raw + ' ' + tr.dataset.mat).toLowerCase();
    tr.style.display = (okF && okS && (!q || hay.includes(q))) ? '' : 'none';
  });
  document.querySelectorAll('#t tbody tr.fh').forEach(h => {
    h.style.display = (filter === 'all' && !q && !style) ? '' : 'none';
  });
}
document.querySelectorAll('.bar button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.bar button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  filter = b.dataset.f; apply();
}));
document.getElementById('q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); apply(); });
document.getElementById('st').addEventListener('change', e => { style = e.target.value; apply(); });

document.getElementById('copy').addEventListener('click', async () => {
  const NL = String.fromCharCode(10);
  const ids = Object.keys(saved);
  let text;
  if (!ids.length) { text = '[CAD 분류 검수] 수정할 것 없음 - 전부 맞습니다.'; }
  else {
    const byStyle = {};
    ids.forEach(id => {
      const tr = rows.find(r => r.dataset.id === id); if (!tr) return;
      const d = saved[id], parts = [];
      if (d.k) parts.push('분류 ' + LB[tr.dataset.a] + ' -> ' + LB[d.k]);
      if (d.p !== undefined) parts.push('부위 ' + (tr.dataset.p || '없음') + ' -> ' + (d.p || '없음'));
      if (d.m) parts.push('메모: ' + d.m);
      (byStyle[tr.dataset.style] ||= []).push('  - [' + tr.dataset.raw + '] ' + tr.dataset.mat + ' : ' + parts.join(' / '));
    });
    text = '[CAD 분류 수정 ' + ids.length + '행]' + NL +
      Object.entries(byStyle).map(([s, ls]) => s + NL + ls.join(NL)).join(NL);
  }
  const out = document.getElementById('out');
  out.style.display = 'block'; out.value = text; out.select();
  try { await navigator.clipboard.writeText(text); alert('복사했습니다. 대화창에 붙여 주세요.'); }
  catch { alert('아래 칸의 내용을 직접 복사해 주세요.'); }
});
document.getElementById('reset').addEventListener('click', () => {
  if (!confirm('수정한 것을 모두 되돌립니다.')) return;
  localStorage.removeItem(KEY);
  Object.keys(saved).forEach(k => delete saved[k]);
  rows.forEach(tr => {
    tr.querySelector('.kind').value = tr.dataset.a;
    tr.querySelector('.part').value = tr.dataset.p;
    tr.querySelector('.memo').value = '';
    tr.classList.remove('edited');
  });
  document.getElementById('n').textContent = '0'; apply();
});
</script>`;

fs.writeFileSync(OUT, html);
console.log(`한글 파일 ${data.length}개 (폐기 ${dropped.length}) · 행 ${allLines.length} · 확인필요 ${needCheck}`);
console.log(JSON.stringify(stats));
