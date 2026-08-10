// 소요량 → BOM 자재 줄 자체 점검 — npx tsx scripts/yard-bom.test.ts
// 실제 공장 CAD 파일을 읽어 끝까지 돌려 본다 (파싱 → 부위 배정 → BOM 줄).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { parseCadWorkbook, bodyPartOf } from '../client/src/lib/cadYardage';
import {
  buildYardBuckets, yardRowNet, usesPart,
  DEFAULT_YARD_CFG, type YardCfg, type YardKind, type YardRow,
} from '../client/src/lib/yardBom';

const CFG: YardCfg = {
  ...DEFAULT_YARD_CFG,
  '원단': { 폭: 150, 로스: 10 },
  '안감': { 폭: 150, 로스: 10 },
};

let n = 0;
const row = (kind: YardKind, part: string, 가로: number, 세로: number, 수량 = 1, 패턴부위 = ''): YardRow =>
  ({ id: `r${++n}`, kind, part: usesPart(kind) ? part : '', 패턴부위, 가로, 세로, 수량 });

// ── 1. 가죽은 부위마다 한 줄 ────────────────────────────────────────────────
{
  const rows = [
    row('가죽', '바디', 10, 10), row('가죽', '바디', 20, 5),
    row('가죽', '트림1', 8, 4),
    row('가죽', '트림2', 6, 3),
  ];
  const b = buildYardBuckets('가죽', rows, CFG);
  assert.deepStrictEqual(b.map(x => x.key), ['바디', '트림1', '트림2'], '가죽은 부위마다 한 줄');
  assert.deepStrictEqual(b.map(x => x.subPart), ['바디', '트림1', '트림2']);
  // 바디 = 두 줄 합계
  const expect = (10.5 * 10.5 + 20.5 * 5.5) / 10000 * 10.764;
  assert.ok(Math.abs(b[0].net - expect) < 1e-9, `바디 합계 ${b[0].net} != ${expect}`);
}

// ── 2. 원단도 부위마다 한 줄 ────────────────────────────────────────────────
{
  const rows = [row('원단', '바디', 30, 20), row('원단', '트림1', 10, 10)];
  const b = buildYardBuckets('원단', rows, CFG);
  assert.deepStrictEqual(b.map(x => x.key), ['바디', '트림1'], '원단도 부위마다 한 줄');
  assert.ok(Math.abs(b[0].net - (30 * 20) / 150 / 91.44) < 1e-9);
}

// ── 3. 안감은 부위 없이 한 줄 ───────────────────────────────────────────────
{
  const rows = [row('안감', '', 20, 10), row('안감', '', 5, 5)];
  const b = buildYardBuckets('안감', rows, CFG);
  assert.strictEqual(b.length, 1, '안감은 한 줄');
  assert.strictEqual(b[0].subPart, '안감');
  assert.ok(Math.abs(b[0].net - (20 * 10 + 5 * 5) / 150 / 91.44) < 1e-9);
}

// ── 4. 보강재는 자재마다 한 줄, 이름이 그대로 들어간다 ──────────────────────
{
  const rows = [
    row('보강재', '', 20, 4, 1, '마찌 싱 0.6 VXP'),
    row('보강재', '', 10, 3, 2, '속고 보강 고발포 1.0'),
  ];
  const b = buildYardBuckets('보강재', rows, CFG);
  assert.deepStrictEqual(b.map(x => x.itemName), ['마찌 싱 0.6 VXP', '속고 보강 고발포 1.0']);
  assert.deepStrictEqual(b.map(x => x.subPart), [undefined, undefined], '보강재는 부위 없음');
  assert.ok(Math.abs(b[0].net - (20 * 4) / 132 / 100) < 1e-9, '보강재는 52인치(132cm) 롤 기준 M');
}

// ── 5. 폭을 안 넣으면 0 (조용히 틀린 값이 나오지 않는다) ────────────────────
{
  const noW: YardCfg = { ...DEFAULT_YARD_CFG, '원단': { 폭: 0, 로스: 10 } };
  assert.strictEqual(buildYardBuckets('원단', [row('원단', '바디', 30, 20)], noW)[0].net, 0);
}

// ── 6. 실제 공장 파일로 끝까지 ──────────────────────────────────────────────
const DIR = 'C:/Users/이원영 AMES/Documents/카카오톡 받은 파일/';
const file = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).find(f => f.startsWith('ER2604HB01') && f.endsWith('.xls'))
  : undefined;

if (!file) {
  console.log('ok (공장 파일 없음 — 6번 생략)');
} else {
  const buf = fs.readFileSync(path.join(DIR, file));
  const { styleNo, lines } = parseCadWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  assert.strictEqual(styleNo, 'ER2604HB01A');

  // 팝업이 하는 일과 같은 배정 — 부위를 정하고 종류를 고른다 (바디=원단, 트림1=가죽)
  const KIND: Record<string, YardKind> = { '바디': '원단', '트림1': '가죽', '트림2': '가죽', '안감': '안감', '보강재': '보강재' };
  const rows: YardRow[] = lines
    .filter(l => l.assign !== 'skip')
    .map((l, i) => {
      const bucket = l.assign === 'interlining' ? '보강재' : (bodyPartOf(l.assign, l.group, l.raw) || '바디');
      const kind = KIND[bucket];
      return {
        id: `c${i}`, kind,
        part: usesPart(kind) ? bucket : '',
        패턴부위: l.lineName || l.material,
        가로: l.w, 세로: l.h, 수량: l.count,
      };
    });

  const got = Object.fromEntries(
    (['가죽', '원단', '안감', '보강재'] as YardKind[]).map(k => [k, buildYardBuckets(k, rows, CFG)]),
  );

  // [원단]앞판 겉감 → 바디(원단) 1줄 / [트림]… → 트림1(가죽) 1줄 / 우라 → 안감 1줄
  assert.deepStrictEqual(got['원단'].map(b => b.subPart), ['바디'], '원단은 바디 한 줄');
  assert.deepStrictEqual(got['가죽'].map(b => b.subPart), ['트림1'], '가죽은 트림1 한 줄');
  assert.strictEqual(got['안감'].length, 1, '안감 한 줄');
  assert.ok(got['보강재'].length >= 3, '보강재는 자재마다 — ' + got['보강재'].length + '줄');
  got['보강재'].forEach(b => assert.ok(b.itemName, '보강재 줄엔 자재명이 있다'));
  Object.values(got).flat().forEach(b => assert.ok(b.net > 0, '소요량이 0인 줄이 없다'));

  console.log(`ok — ${styleNo}: ` +
    (['가죽', '원단', '안감', '보강재'] as YardKind[])
      .map(k => `${k} ${got[k].length}줄(${got[k].map(b => b.subPart || b.itemName).join('/')})`).join(' · '));
}
console.log('ok');
