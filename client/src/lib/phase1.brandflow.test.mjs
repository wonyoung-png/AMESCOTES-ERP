// 발주서 발행 → 수주함 흐름 자체 점검.
//
// 실제 phase1.ts를 그대로 불러 돌린다. 로직을 다시 쓰면 그 사본만 통과하고
// 진짜 코드는 깨진 채로 남는다.
//
//   node client/src/lib/phase1.brandflow.test.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// localStorage — phase1이 유일하게 기대하는 브라우저 API
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};

const stub = {
  name: 'stub',
  setup(b) {
    // 서버·토스트는 이 점검의 대상이 아니다
    b.onResolve({ filter: /(^\.\/supabase$|^sonner$|^\.\/store$)/ }, a => ({
      path: a.path, namespace: 'stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `
        export const supabase = { from: () => ({ upsert: async () => ({ error: null }),
          select: () => ({ then: r => r({ data: [], error: null }) }) }) };
        export const toast = { error(){}, success(){} };
      `,
      loader: 'js',
    }));
  },
};

const out = await build({
  entryPoints: [path.join(here, 'phase1.ts')],
  bundle: true, write: false, format: 'esm', platform: 'neutral',
  target: 'es2020', plugins: [stub], logLevel: 'silent',
});
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
);
const { phase1 } = mod;

// ── 준비: 승인 완료 배치 1건, 라인 3개 (다산 경유 2 · 패키지공장 직발주 1)
const batch = phase1.createBrandBatch('LUMEN', '검증용 발주');
phase1.updateBrandBatch(batch.id, { status: 'approved', approvalStep: 6 });
const L = [
  { styleNo: 'LLL5F700B', styleName: '파니에 백', factoryId: 'F-A', factoryName: '다산', route: 'oem', qty: 50 },
  { styleNo: 'LLL5F780B', styleName: '마론백', factoryId: 'F-A', factoryName: '다산', route: 'oem', qty: 30 },
  { styleNo: 'LPKG-BOX', styleName: '패키지 박스', factoryId: 'F-B', factoryName: '패키지공장', route: 'direct', qty: 500 },
];
L.forEach(l => phase1.addBrandLine(batch.id, {
  ...l, colorQtys: [{ color: '기본', qty: l.qty }], productionOrigin: 'china', isEmployeePurchase: false,
}));

// ── 1. 제목이 비어도 만들어져야 한다 (버튼이 죽은 것처럼 보이던 원인)
const auto = phase1.createBrandBatch('LUMEN');
assert.ok(auto.title.trim(), '제목이 비면 발주번호로 지어야 한다');

// ── 2. 발행 = (공장 × 경로)별 1장
const issued = phase1.issueBrandBatch(batch.id);
assert.equal(issued.length, 2, `발주서는 2장이어야 한다 (받은 것: ${issued.length})`);
const oem = issued.find(i => i.route === 'oem');
const direct = issued.find(i => i.route === 'direct');
assert.ok(oem && direct, '경유 1장 + 직발주 1장이 나와야 한다');
assert.equal(oem.lines, 2, '다산 경유는 2 SKU가 한 장에 묶여야 한다');
assert.equal(direct.lines, 1, '패키지공장 직발주는 1 SKU');
assert.ok(oem.poNo.startsWith(batch.projectNo + '-'), `발주서 번호는 ${batch.projectNo}-X 형태`);
assert.notEqual(oem.poNo, direct.poNo, '같은 번호를 두 장이 쓰면 안 된다');

// ── 3. 수주함에는 경유 건만. 직발주가 섞이면 OEM이 남의 발주를 받는다
const inbox = phase1.getInboundPOs();
assert.equal(inbox.length, 1, `수주함은 1장이어야 한다 (받은 것: ${inbox.length})`);
assert.equal(inbox[0].poNo, oem.poNo, '수주함에 온 것은 경유 건이어야 한다');
assert.equal(inbox[0].lines.length, 2);
assert.ok(!inbox.some(p => p.lines.some(l => l.route === 'direct')), '직발주가 수주함에 오면 안 된다');

// ── 4. 받으면 수주함에서 빠진다 (두 번 받아 발주가 겹치는 사고 방지)
phase1.markPOAccepted(oem.poNo);
assert.equal(phase1.getInboundPOs().length, 0, '받은 발주서는 수주함에서 빠져야 한다');

// ── 5. 승인 안 된 배치는 발행되지 않는다
const draft = phase1.createBrandBatch('LUMEN', '작성중');
assert.equal(phase1.issueBrandBatch(draft.id).length, 0, '승인 전에는 발행되면 안 된다');

console.log('✓ 발행 2장(경유1·직발주1) · 수주함 경유만 · 수령 후 제외 · 미승인 차단 — 통과');
