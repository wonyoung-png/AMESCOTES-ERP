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
function classify(matName, group) {
  const t = `${matName}`.trim().toLowerCase();
  const g = (group || '').trim();
  if (/vxp|부직포|접착|심지|보강|420d|eva|스펀지|폼|hdpe|pe판|철심|s\/l|싱지|양면/.test(t)) return { a: 'interlining', why: '자재명' };
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
  '양면\s*S/L', 'S/L', 'VXP', '420D', '부직포', '접착', '심지', '보강', 'EVA', '스펀지', '폼',
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
      const cls = classify(m.label, p.group);
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

const LB = { leather: '가죽', outer: '원단(겉감)', lining: '안감', interlining: '심지·보강' };
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

let body = '';
for (const f of data) {
  const tot = {};
  f.lines.forEach(l => { tot[l.assign] = (tot[l.assign] || 0) + (l.assign === 'leather' ? l.sf : l.cm2); });
  body += `<tr class="fh"><td colspan="9"><b>${esc(f.styleNo || f.file)}</b> <span class="dim">${esc(f.file)} · 자재행 ${f.lines.length}</span></td></tr>`;
  let lastRaw = '';
  for (const l of f.lines) {
    const first = l.raw !== lastRaw; lastRaw = l.raw;
    body += '<tr>'
      + `<td class="nm">${first ? esc(l.raw) : ''}</td>`
      + `<td class="nm dim sm">${esc(l.part)}</td>`
      + `<td class="ctr dim">${esc(l.group || '-')}</td>`
      + `<td class="nm"><b>${esc(l.material)}</b>${l.wari ? ` <span class="dim sm">와리 ${l.wari}</span>` : ''}</td>`
      + `<td class="num">${l.ea}${l.pair ? ' ×2' : ''}</td>`
      + `<td class="num">${l.w.toFixed(2)} × ${l.h.toFixed(2)}</td>`
      + `<td class="ctr a-${l.assign}"><b>${LB[l.assign]}</b></td>`
      + `<td class="dim sm">${esc(l.why)}</td>`
      + `<td class="num">${l.assign === 'leather' ? l.sf.toFixed(3) + ' SF' : (l.cm2 / 10000).toFixed(3) + ' ㎡'}</td>`
      + '</tr>';
  }
  body += `<tr class="sum"><td colspan="6" class="r">합계</td><td colspan="3">`
    + Object.entries(tot).map(([k, v]) => `${LB[k]} ${k === 'leather' ? v.toFixed(2) + ' SF' : (v / 10000).toFixed(3) + ' ㎡'}`).join(' · ')
    + '</td></tr>';
}

const stats = {};
data.flatMap(d => d.lines).forEach(l => { stats[l.assign] = (stats[l.assign] || 0) + 1; });
const guessed = data.flatMap(d => d.lines).filter(l => l.why === '기본값').length;

const html = `<title>CAD 소요량표 분류 대조표</title>
<style>
:root{--bg:#F7F6F4;--panel:#fff;--ink:#1A1815;--muted:#6B6560;--line:#E6E1D9;--accent:#8A3A2E;
--lea:#8A5A2E;--out:#2F6F7A;--lin:#5B4B8A;--int:#7A6A55;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",Segoe UI,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#131211;--panel:#1B1A18;--ink:#EAE7E2;--muted:#9C958C;--line:#2A2825;--accent:#E08D7A;--lea:#D9A46B;--out:#7FC3CE;--lin:#A99BDD;--int:#C2AE8E}}
:root[data-theme="dark"]{--bg:#131211;--panel:#1B1A18;--ink:#EAE7E2;--muted:#9C958C;--line:#2A2825;--accent:#E08D7A;--lea:#D9A46B;--out:#7FC3CE;--lin:#A99BDD;--int:#C2AE8E}
:root[data-theme="light"]{--bg:#F7F6F4;--panel:#fff;--ink:#1A1815;--muted:#6B6560;--line:#E6E1D9;--accent:#8A3A2E;--lea:#8A5A2E;--out:#2F6F7A;--lin:#5B4B8A;--int:#7A6A55}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
.wrap{max-width:1120px;margin:0 auto;padding:36px 16px 64px;display:flex;flex-direction:column;gap:16px}
h1{font-size:clamp(22px,3.6vw,32px);margin:0;letter-spacing:-.02em}
p.lede{margin:0;color:var(--muted);font-size:14.5px;max-width:66ch}
.stat{display:flex;flex-wrap:wrap;gap:8px;font-size:12.5px}
.stat span{border:1px solid var(--line);border-radius:999px;padding:3px 10px;background:var(--panel)}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:900px}
th{background:var(--panel);text-align:left;font-size:11px;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr.fh td{background:color-mix(in srgb,var(--ink) 6%,transparent);font-size:13px;padding:9px 10px}
tr.sum td{background:color-mix(in srgb,var(--accent) 9%,transparent);font-weight:600}
.nm{word-break:keep-all;max-width:300px}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-family:var(--mono);font-size:11.5px}
.ctr{text-align:center;white-space:nowrap}.r{text-align:right}
.dim{color:var(--muted)}.sm{font-size:11px}
.a-leather b{color:var(--lea)}.a-outer b{color:var(--out)}.a-lining b{color:var(--lin)}.a-interlining b{color:var(--int)}
</style>
<div class="wrap">
<h1>CAD 소요량표 — 분류 대조표</h1>
<p class="lede">공장 소요량표 ${data.length}개를 읽어 <b>조각 이름 안에 섞여 있던 자재를 한 줄씩 분해</b>했습니다.
예: <code>뒷판 핸들 겉감 2EA(와리:1.2), VXP 0.6 1EA, 420D</code> → 겉감 2EA / VXP 0.6 1EA / 420D 1EA.
<b>근거</b> 칸이 마커그룹이면 파일이 직접 알려준 것이고, 자재명·기본값이면 제가 추정한 것입니다.</p>
<div class="stat">
<span style="color:var(--lea)">가죽 ${stats.leather || 0}</span>
<span style="color:var(--out)">원단(겉감) ${stats.outer || 0}</span>
<span style="color:var(--lin)">안감 ${stats.lining || 0}</span>
<span style="color:var(--int)">심지·보강 ${stats.interlining || 0}</span>
<span>추정(기본값) ${guessed}</span>
</div>
<div class="scroll"><table><thead><tr>
<th>조각 이름 (원문)</th><th>부위</th><th class="ctr">마커그룹</th><th>자재</th><th class="num">EA</th>
<th class="num">가로 × 세로 (cm)</th><th class="ctr">내 분류</th><th>근거</th><th class="num">기여</th>
</tr></thead><tbody>${body}</tbody></table></div>
</div>`;

fs.writeFileSync(OUT, html);
console.log(`파일 ${data.length} · 자재행 ${data.reduce((s, d) => s + d.lines.length, 0)} · 추정 ${guessed}`);
console.log(JSON.stringify(stats));
