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
  ['leather:겉감=2', 'interlining:0.6 VXP=1', 'interlining:420D=1'],
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
assert.strictEqual(partOf('[트림2] 앞판 1EA'), '트림2');
// 마커그룹 '트림2' 는 두 번째 재단 그룹일 뿐 — 부위를 트림으로 만들지 않는다
assert.strictEqual(partOf('앞판 1EA', '트림2'), '앞판');
console.log('ok2');

// 대표님 검수 회신 (10행) — 규칙으로 굳힌다
const linesOf = (name: string, group = '겉감') =>
  parseCadWorkbook(sheet(name, group, 1, 10, 10)).lines.map(l => `${l.assign}|${l.lineName}`);

// 그림형은 기본패턴 → 제외
assert.ok(linesOf('[파우치]5# 메탈 그림형 / 슬라이드 1EA / 앞,뒤 도매', 'SELF').every(x => x.startsWith('skip')));

// 자재 행 이름 = 첫 세그먼트 + 자재명, VXP 는 두께를 앞에, 210D 는 보강재
assert.deepStrictEqual(linesOf('[파우치]지퍼 플러 겉감 1EA(와리:1.2), VXP 0.6 1EA, 210D 1EA'), [
  'leather|[파우치] 지퍼 플러 겉감',
  'interlining|[파우치] 지퍼 플러 겉감 0.6 VXP',
  'interlining|[파우치] 지퍼 플러 겉감 210D',
]);
assert.deepStrictEqual(linesOf('가락지 겉감 2EA(와리:0.9), 420D 1EA'),
  ['leather|가락지 겉감', 'interlining|가락지 겉감 420D']);

// 부위명에 '안감'이 들어가도 자재는 뒤엣것(겉감) — 공정 노트는 이름에서 뺀다
assert.deepStrictEqual(linesOf('안감 D링고리 겉감 2EA(와리:1.0), 420D 1EA / 맞부착'),
  ['leather|안감 D링고리 겉감', 'interlining|안감 D링고리 겉감 420D']);

// 붙어 있는 자재어(양면 S/L)는 한 덩어리 — 머리말엔 부위명만 남는다
assert.deepStrictEqual(linesOf('별도 속고판 싱 양면 S/L 1.0 1EA, 우라 2EA'),
  ['interlining|별도 속고판 싱 양면 S/L 1.0', 'lining|별도 속고판 싱 우라']);

console.log('ok3');

// 2차 검수 회신 — 쉼표가 자재 구분이 아닌 경우 · 좌우 합산 · 원형 제외
const rowsOf = (name: string, group = '겉감') =>
  parseCadWorkbook(sheet(name, group, 1, 10, 10)).lines.map(l => `${l.assign}|${l.lineName}|${l.count}`);

// 앞 조각에 수량이 없으면 이름이 이어지는 것 (한 줄로 합친다)
assert.deepStrictEqual(rowsOf('뒷판 구찌, 뒷판 우라 구찌 싱 VXP 0.4 2EA', '심'),
  ['interlining|뒷판 구찌, 뒷판 우라 구찌 싱 0.4 VXP|2']);

// 좌/우는 같은 자재 — 수량만 합치고 한 줄로
assert.deepStrictEqual(rowsOf('핸들 겉감 좌2EA, 우2EA'), ['leather|핸들 겉감 좌,우|4']);
assert.deepStrictEqual(rowsOf('앞포켓 우라 좌2EA, 우2EA'), ['lining|앞포켓 우라 좌,우|4']);
assert.deepStrictEqual(rowsOf('원판 2 측면 싱 50g부직포 좌 2EA, 우 2EA', '심'),
  ['interlining|원판 2 측면 싱 50g 부직포 좌,우|4']);

// '우라'는 좌우가 아니라 자재 — 갈라져야 한다
assert.strictEqual(rowsOf('별도 속고판 싱 양면 S/L 1.0 1EA, 우라 2EA').length, 2);

// 원형도 기본패턴
assert.ok(rowsOf('원판 원형', 'SELF').every(x => x.startsWith('skip')));

console.log('ok4');

// 부위는 조각 이름 앞의 [태그]가 정한다. 마커그룹 '트림2'는 재단 그룹일 뿐 부위가 아니다.
const partKey = (name: string, group: string) => {
  const l = parseCadWorkbook(sheet(name, group, 1, 10, 10)).lines[0];
  return l.assign === 'skip' ? '제외' : l.assign === 'interlining' ? '보강재' : (l.bodyPart || '바디');
};
assert.strictEqual(partKey('[원단]앞판 겉감 1EA', '트림2'), '바디');            // ER2604HB01A
assert.strictEqual(partKey('[캔버스 원단]뒷판 겉감 1EA', '트림2'), '바디');     // NT2603HB02C
assert.strictEqual(partKey('[트림]뒷판 겉감 1EA', '겉감'), '트림1');
assert.strictEqual(partKey('[트림]지퍼플러 겉감 1EA(와리:1.1)', '트림2'), '트림1');
assert.strictEqual(partKey('뒷판 우라 1EA', '안감'), '안감');
assert.strictEqual(partKey('앞판 겉감 1EA', 'SELF'), '바디');

console.log('ok5');
