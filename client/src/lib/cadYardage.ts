// CAD 패턴차트(소요량표) 파서 — 공장에서 오는 .xls 를 그대로 읽는다.
// 파일 구조: Name: / Marker Group: + Qty: / Width*Height: + Pair: 블록이 조각 수만큼 반복.
//
// 조각 이름 한 줄에 자재가 여러 개 들어온다:
//   "뒷판 핸들 겉감 2EA(와리:1.2), VXP 0.6 1EA, 420D"
//     → 겉감 2EA + VXP 0.6(보강) 1EA + 420D(보강) 1EA
//   "별도 속고판 싱 양면 S/L 1.0 1EA, 우라 2EA"
//     → 보강 "별도 속고판 싱 양면 S/L 1.0" 1EA + 안감 "별도 속고판 싱" 2EA
import * as XLSX from 'xlsx';

export type Assign = 'leather' | 'outer' | 'lining' | 'interlining' | 'skip';

export const ASSIGN_LABEL: Record<Assign, string> = {
  leather: '가죽',
  outer: '원단(겉감)',
  lining: '안감',
  interlining: '보강재',
  skip: '제외',
};

/** 배정 → 자재 마스터 등록값. 보강재(VXP·스타롱·S/L 등)는 M 로 산다. */
export const ASSIGN_MATERIAL: Record<Exclude<Assign, 'skip'>, { category: string; unit: string; subType?: string }> = {
  leather: { category: '가죽', unit: 'SF' },
  outer: { category: '원단', unit: 'YD', subType: '겉감용' },
  lining: { category: '원단', unit: 'YD', subType: '안감용' },
  interlining: { category: '보강재', unit: 'M' },
};

/** 자재 한 줄 = 배정 단위. 팝업에서 assign 을 바꿀 수 있다. */
export type CadLine = {
  id: string;
  raw: string;        // 조각 이름 원문
  part: string;       // 부위명 (원판·속고 등 조각 이름)
  lineName: string;   // 이 자재 행의 이름 — 부위 + 자재 (예: 가락지 겉감 420D)
  bodyPart: string;   // 바디 / 트림1 / 트림2 / 안감 — 보강재는 빈 값
  group: string;      // 마커그룹
  material: string;   // 자재명
  ea: number;         // 이 자재의 EA
  wari?: number;      // 와리(폭)
  w: number;          // cm
  h: number;          // cm
  pair: boolean;
  qty: number;        // 마커그룹 Qty
  count: number;      // qty × (pair?2:1) × ea
  assign: Assign;
  why: string;        // 분류 근거
};

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** 기본패턴 — 소요량이 아니라 패턴 자체다. 계산에서 뺀다 */
const BASE_PATTERN_RE = /기본형|닺지형|닷지형|그림형|원형/;

/** 자재명·마커그룹으로 무엇으로 볼지 판정 */
function classify(matName: string, group: string, raw = ''): { a: Assign; why: string } {
  const t = String(matName).trim().toLowerCase();
  const g = (group || '').trim();
  if (BASE_PATTERN_RE.test(raw) || BASE_PATTERN_RE.test(matName)) return { a: 'skip', why: '기본패턴' };
  if (/vxp|스타롱|부직포|접착|심지|보강|420d|210d|eva|스펀지|폼|hdpe|pe판|철심|s\/l|싱지|양면/.test(t)) return { a: 'interlining', why: '자재명' };
  if (/우라|안감|里子|lining/.test(t)) return { a: 'lining', why: '자재명' };
  if (/원단|fabric|canvas|자카드|나일론|폴리/.test(t)) return { a: 'outer', why: '자재명' };
  if (/겉감|트림|self/.test(t)) {
    if (/^(안감|里子)$/.test(g)) return { a: 'lining', why: `마커그룹 ${g}` };
    return { a: 'leather', why: '겉감/트림' };
  }
  if (/^(심|芯)$/.test(g)) return { a: 'interlining', why: `마커그룹 ${g}` };
  if (/^(안감|里子|lining)$/.test(g)) return { a: 'lining', why: `마커그룹 ${g}` };
  if (/^(皮|가죽|leather)$/.test(g)) return { a: 'leather', why: `마커그룹 ${g}` };
  if (/^(겉감|self|트림2|型)$/.test(g)) return { a: 'leather', why: `마커그룹 ${g}` };
  return { a: 'leather', why: '기본값' };
}

/** 자재를 가리키는 말 — 이 앞은 부위, 이 뒤는 자재로 본다 */
const MAT_WORDS = [
  '겉감', '우라', '안감', '里子', '트림', '자재',
  '양면\\s*S/L', 'S/L', 'VXP', '스타롱', '420D', '210D', '부직포', '접착', '심지', '보강', 'EVA', '스펀지', '폼',
  'HDPE', 'PE판', '철심', '싱지', '원단',
];
const MAT_RE = new RegExp('(' + MAT_WORDS.join('|') + ')', 'i');

type Mat = { label: string; ea: number; wari?: number };

/** 자재어가 어디서 시작하는지 — 붙어 있는 자재어는 한 덩어리로 본다.
 *  "안감 D링고리 겉감" 은 안감 / 겉감 두 덩어리라 뒤엣것(겉감)이 자재,
 *  "별도 속고판 싱 양면 S/L 1.0" 은 양면·S/L 이 붙어 있어 한 덩어리(양면 S/L)다.
 *  → 앞에 붙은 말(안감 D링고리, 별도 속고판 싱)이 부위명이 된다. */
function materialStart(text: string): number {
  const re = new RegExp(MAT_RE.source, 'gi');
  const hits: Array<{ s: number; e: number }> = [];
  for (let m = re.exec(text); m; m = re.exec(text)) hits.push({ s: m.index, e: m.index + m[0].length });
  if (!hits.length) return -1;

  let start = hits[hits.length - 1].s;
  for (let i = hits.length - 1; i > 0; i--) {
    // 두 자재어 사이가 공백·숫자·기호뿐이면 같은 덩어리로 이어 붙인다
    if (!/^[\s\d.\-/]*$/.test(text.slice(hits[i - 1].e, hits[i].s))) break;
    start = hits[i - 1].s;
  }
  return start;
}

type Seg = { text: string; ea: number; bothSides: boolean };

/** 쉼표로 끊되, 자재가 아닌 쉼표는 도로 이어 붙인다.
 *  - "핸들 겉감 좌2EA, 우2EA"          → 좌우는 같은 자재. 수량만 4로 합친다
 *  - "뒷판 구찌, 뒷판 우라 구찌 싱 VXP 0.4 2EA" → 앞 조각에 수량이 없으면 이름이 이어지는 것 */
function splitSegments(clean: string): Seg[] {
  const eaSum = (s: string) =>
    (s.match(/([\d.]+)\s*EA/gi) || []).reduce((a, x) => a + (parseFloat(x) || 0), 0);
  const out: Seg[] = [];

  for (const piece of clean.split(',').map(s => s.trim()).filter(Boolean)) {
    const prev = out[out.length - 1];
    // '우 2EA' 는 반대쪽 짝 — '우라 2EA' 는 자재라 걸리지 않는다
    if (prev && /^[좌우]\s*[\d.]*\s*EA\b/i.test(piece)) {
      prev.ea += eaSum(piece) || 1;
      prev.bothSides = true;
      continue;
    }
    if (prev && !/[\d.]+\s*EA/i.test(prev.text)) {
      prev.text += `, ${piece}`;
      prev.ea = eaSum(prev.text) || 1;
      continue;
    }
    out.push({ text: piece, ea: eaSum(piece) || 1, bothSides: false });
  }
  return out.length ? out : [{ text: clean, ea: 1, bothSides: false }];
}

/** 조각 이름을 부위 + 자재 목록으로 쪼갠다 */
function splitName(raw: string, group: string): { part: string; base: string; tag: string; materials: Mat[] } {
  const tag = (String(raw || '').match(/^\[([^\]]+)\]/) || [])[1] || '';
  const clean = String(raw || '').replace(/^\[[^\]]*\]\s*/, '');
  const segs = splitSegments(clean);

  const materials: Mat[] = [];
  let part = '';
  let base = '';   // 첫 세그먼트 전체 — 뒤따르는 자재 이름의 머리말이 된다

  segs.forEach((seg, i) => {
    const ea = seg.ea;
    const wariM = seg.text.match(/와리\s*:?\s*([\d.]+)/);

    let text = seg.text
      .replace(/\([^)]*\)/g, '')
      .replace(/[\d.]+\s*EA/gi, '')
      .replace(/,\s*V\s*$/i, '')
      .replace(/\s+\/\s+.*$/, '')   // ' / 맞부착' 같은 공정 노트는 이름이 아니다 (S/L 은 붙여 쓰므로 안 잘린다)
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (seg.bothSides) text = text.replace(/좌\s*$/, '좌,우');

    const at = materialStart(text);
    if (i === 0) {
      // '가락지 겉감' 처럼 몸판 자재면 통째로 머리말에 쓰고,
      // '별도 속고판 싱 양면 S/L' 처럼 보강재·안감이면 부위명까지만 쓴다
      const first = at >= 0 ? text.slice(at).trim() : '';
      const bodyish = !first || /겉감|트림|self/i.test(first);
      base = (tag ? `[${tag}] ` : '') + (bodyish ? text : text.slice(0, at).trim());
    }

    let label: string;
    if (at >= 0) {
      const head = text.slice(0, at).trim();
      label = text.slice(at).trim();
      if (i === 0 || !part) part = head;
    } else if (i === 0) {
      part = text;
      label = tag || group || '겉감';
    } else {
      label = text;
    }
    if (!label) return;
    materials.push({ label: normalizeMaterialName(label), ea, wari: wariM ? parseFloat(wariM[1]) : undefined });
  });

  if (materials.length === 0) materials.push({ label: tag || group || '겉감', ea: 1 });

  // "트림" 이라고만 적힌 것은 부위를 트림1 로 잡는다 (트림2 는 그대로 둔다)
  const trim = [tag, clean].find(s => /트림/.test(s || ''));
  if (trim) part = /트림\s*2/.test(trim) ? '트림2' : '트림1';

  return { part: part || clean, base: base || clean, tag, materials };
}

/** 자재명 표기 통일 — 두께를 앞에 쓴다 (VXP 0.4 → 0.4 VXP) */
function normalizeMaterialName(label: string) {
  return label.replace(/^(VXP)\s+([\d.]+)$/i, '$2 $1');
}

type RawPiece = { name: string; qty: number; w: number; h: number; pair: boolean; group: string };

export function parseCadWorkbook(data: ArrayBuffer): { styleNo?: string; lines: CadLine[] } {
  const wb = XLSX.read(data, { type: 'array' });
  const pieces: RawPiece[] = [];
  let styleNo: string | undefined;

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    let cur: RawPiece | null = null;
    const flush = () => { if (cur && cur.name && (cur.w || cur.h)) pieces.push(cur); };

    for (const row of rows) {
      const key = String(row[0] ?? '').trim();
      const val = String(row[1] ?? '').trim();

      if (key === 'Style:' && !styleNo) styleNo = val;
      if (key === 'Name:') { flush(); cur = { name: val, qty: 1, w: 0, h: 0, pair: false, group: '' }; continue; }
      if (!cur) continue;

      if (key.startsWith('Marker Group')) {
        cur.group = val;
        const qi = row.findIndex(c => String(c ?? '').trim().startsWith('Qty'));
        if (qi >= 0) cur.qty = num(row[qi + 1]) || 1;
      }
      if (key.startsWith('Width*Height')) {
        const m = val.match(/([\d.]+)\s*[xX*]\s*([\d.]+)/);
        if (m) { cur.w = parseFloat(m[1]); cur.h = parseFloat(m[2]); }
        const pi = row.findIndex(c => String(c ?? '').trim().startsWith('Pair'));
        if (pi >= 0) cur.pair = String(row[pi + 1] ?? '').trim().toUpperCase() === 'Y';
      }
    }
    flush();
  }

  const lines: CadLine[] = [];
  for (const p of pieces) {
    const { part, base, materials } = splitName(p.name, p.group);
    materials.forEach((m, mi) => {
      const cls = classify(m.label, p.group, p.name);
      lines.push({
        id: `${lines.length}`,
        raw: p.name, part, group: p.group,
        lineName: base.endsWith(m.label) ? base : `${base} ${m.label}`,
        bodyPart: bodyPartOf(cls.a, p.group, p.name),
        material: m.label, ea: m.ea, wari: m.wari,
        w: p.w, h: p.h, pair: p.pair, qty: p.qty,
        count: p.qty * (p.pair ? 2 : 1) * (m.ea || 1),
        assign: cls.a, why: cls.why,
      });
    });
  }

  return { styleNo, lines };
}

/** 가죽 — 조각마다 사방 0.5cm 여유를 주고 SF 로 환산 (기존 계산기와 같은 식) */
export function calcLeatherSF(lines: CadLine[]) {
  return lines.reduce((s, p) => s + (p.w + 0.5) * (p.h + 0.5) * p.count / 10000 * 10.764, 0);
}

/** 원단·안감 — 원단 폭(cm)으로 나눠 YD 로 환산 */
export function calcFabricYD(lines: CadLine[], widthCm: number) {
  if (!widthCm) return 0;
  return lines.reduce((s, p) => s + p.w * p.h * p.count, 0) / widthCm / 91.44;
}

/** 바디 / 트림1 / 트림2 / 안감 판정.
 *  공장 파일의 마커그룹이 실제로 쓰는 값은 SELF · 겉감 · 안감 · 심 · 트림2 다섯 개뿐이라
 *  트림2 와 안감은 파일이 직접 알려주고, 나머지는 조각 이름으로 가른다. */
export function bodyPartOf(assign: Assign, group: string, raw: string): string {
  if (assign === 'interlining' || assign === 'skip') return '';   // 보강재는 부위를 안 쓴다
  const tag = (String(raw || '').match(/^\[([^\]]+)\]/) || [])[1] || '';
  if (/트림\s*2/.test(tag)) return '트림2';
  if (/트림|trim/i.test(tag)) return '트림1';
  if (assign === 'lining' || /안감|里子|lining/i.test((group || '').trim())) return '안감';
  return '바디';
}

/** 보강재 — 롤 폭(cm)으로 나눠 M 로 환산 (자재 마스터 단위가 M 이다) */
export function calcRollM(lines: CadLine[], widthCm: number) {
  if (!widthCm) return 0;
  return lines.reduce((s, p) => s + p.w * p.h * p.count, 0) / widthCm / 100;
}

/** 로스율(%) 적용 */
export const withLoss = (v: number, lossPct: number) => v * (1 + (lossPct || 0) / 100);
