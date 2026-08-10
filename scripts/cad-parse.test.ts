// 소요량표 파서 자체 점검 — npx tsx scripts/cad-parse.test.ts
// 대표님이 짚어준 두 예시가 그대로 나오는지만 본다.
import assert from 'node:assert';
import * as XLSX from 'xlsx';
import { parseCadWorkbook } from '../client/src/lib/cadYardage';

/** 조각 하나를 CAD 소요량표 모양의 시트로 만든다 */
function sheet(name: string, group: string, qty: number, w: number, h: number) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Style:', 'TEST-01'],
    ['Name:', name],
    ['Marker Group:', group, 'Qty:', String(qty)],
    ['Width*Height:', `${w}*${h}`, 'Pair:', 'N'],
  ]), 'S1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const pick = (name: string, group = '겉감') =>
  parseCadWorkbook(sheet(name, group, 1, 10, 10)).lines
    .map(l => `${l.assign}:${l.material}=${l.count}`);

// 한 조각에 자재 3개 — 겉감 + 보강 2종
assert.deepStrictEqual(
  pick('뒷판 핸들 겉감 2EA(와리:1.2), VXP 0.6 1EA, 420D'),
  ['leather:겉감=2', 'interlining:VXP 0.6=1', 'interlining:420D=1'],
);

// 부위명은 앞 조각에서 물려받고, 뒤 조각은 자재만 바뀐다
assert.deepStrictEqual(
  pick('별도 속고판 싱 양면 S/L 1.0 1EA, 우라 2EA'),
  ['interlining:양면 S/L 1.0=1', 'lining:우라=2'],
);
assert.strictEqual(
  parseCadWorkbook(sheet('별도 속고판 싱 양면 S/L 1.0 1EA, 우라 2EA', '겉감', 1, 10, 10)).lines[0].part,
  '별도 속고판 싱',
);

// 기본패턴은 소요량이 아니다 — 계산에서 뺀다
for (const n of ['기본형', '몸판 닺지형 겉감 1EA', '닷지형']) {
  assert.strictEqual(pick(n)[0].split(':')[0], 'skip', n);
}

// VXP · 스타롱 · S/L 은 보강재
for (const n of ['0.4 VXP 1EA', '스타롱 1EA', '양면 S/L 1.0 1EA']) {
  assert.strictEqual(pick(n)[0].split(':')[0], 'interlining', n);
}

console.log('ok');

// 트림은 부위를 트림1 로 (트림2 는 유지)
const partOf = (name: string, group = '겉감') =>
  parseCadWorkbook(sheet(name, group, 1, 10, 10)).lines[0].part;
assert.strictEqual(partOf('앞판 트림 1EA'), '트림1');
assert.strictEqual(partOf('[트림] 앞판 1EA'), '트림1');
assert.strictEqual(partOf('앞판 1EA', '트림2'), '트림2');
console.log('ok2');
