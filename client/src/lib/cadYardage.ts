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
  interlining: '심지·보강',
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
  part: string;       // 부위명
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
const BASE_PATTERN_RE = /기본형|닺지형|닷지형/;

/** 자재명·마커그룹으로 무엇으로 볼지 판정 */
function classify(matName: string, group: string, raw = ''): { a: Assign; why: string } {
  const t = String(matName).trim().toLowerCase();
  const g = (group || '').trim();
  if (BASE_PATTERN_RE.test(raw) || BASE_PATTERN_RE.test(matName)) return { a: 'skip', why: '기본패턴' };
  if (/vxp|스타롱|부직포|접착|심지|보강|420d|eva|스펀지|폼|hdpe|pe판|철심|s\/l|싱지|양면/.test(t)) return { a: 'interlining', why: '자재명' };
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
  '양면\\s*S/L', 'S/L', 'VXP', '스타롱', '420D', '부직포', '접착', '심지', '보강', 'EVA', '스펀지', '폼',
  'HDPE', 'PE판', '철심', '싱지', '원단',
];
const MAT_RE = new RegExp('(' + MAT_WORDS.join('|') + ')', 'i');

type Mat = { label: string; ea: number; wari?: number };

/** 조각 이름을 부위 + 자재 목록으로 쪼갠다 */
function splitName(raw: string, group: string): { part: string; tag: string; materials: Mat[] } {
  const tag = (String(raw || '').match(/^\[([^\]]+)\]/) || [])[1] || '';
  const clean = String(raw || '').replace(/^\[[^\]]*\]\s*/, '');
  const segs = clean.split(',').map(s => s.trim()).filter(Boolean);

  const materials: Mat[] = [];
  let part = '';

  segs.forEach((seg, i) => {
    const eaM = seg.match(/([\d.]+)\s*EA/i);
    const ea = eaM ? parseFloat(eaM[1]) : 1;
    const wariM = seg.match(/와리\s*:?\s*([\d.]+)/);

    const text = seg
      .replace(/\([^)]*\)/g, '')
      .replace(/[\d.]+\s*EA/i, '')
      .replace(/,\s*V\s*$/i, '')
      .trim();

    const m = text.match(MAT_RE);
    let label: string;
    if (m && m.index !== undefined) {
      const head = text.slice(0, m.index).trim();
      label = text.slice(m.index).trim();
      if (i === 0 || !part) part = head;
    } else if (i === 0) {
      part = text;
      label = tag || group || '겉감';
    } else {
      label = text;
    }
    if (!label) return;
    materials.push({ label, ea, wari: wariM ? parseFloat(wariM[1]) : undefined });
  });

  if (materials.length === 0) materials.push({ label: tag || group || '겉감', ea: 1 });

  // "트림" 이라고만 적힌 것은 부위를 트림1 로 잡는다 (트림2 는 그대로 둔다)
  const trim = [tag, group, clean].find(s => /트림/.test(s || ''));
  if (trim) part = /트림\s*2/.test(trim) ? '트림2' : '트림1';

  return { part: part || clean, tag, materials };
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
    const { part, materials } = splitName(p.name, p.group);
    for (const m of materials) {
      const cls = classify(m.label, p.group, p.name);
      lines.push({
        id: `${lines.length}`,
        raw: p.name, part, group: p.group,
        material: m.label, ea: m.ea, wari: m.wari,
        w: p.w, h: p.h, pair: p.pair, qty: p.qty,
        count: p.qty * (p.pair ? 2 : 1) * (m.ea || 1),
        assign: cls.a, why: cls.why,
      });
    }
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

/** 로스율(%) 적용 */
export const withLoss = (v: number, lossPct: number) => v * (1 + (lossPct || 0) / 100);
