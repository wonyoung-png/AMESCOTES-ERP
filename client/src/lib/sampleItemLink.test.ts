import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingSampleLinks, queueSampleLink, retrySampleLink, saveSampleItemLink, scopedSampleLinkStorage } from './sampleItemLink';
import { PostgrestClient } from '@supabase/postgrest-js';
import { readFileSync } from 'node:fs';

function storage() {
  const data = new Map<string, string>([['ames_link_sampleId', 's']]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
}
const link = { sampleId: 's', itemId: 'existing-item', styleNo: 'STYLE' };
test('샘플 연결 저장 실패도 재시도 대상 품목 ID를 보존한다', async () => {
  const s = storage(); queueSampleLink(s, link);
  assert.equal(s.getItem('ames_link_sampleId'), null);
  await assert.rejects(retrySampleLink(s, link, async () => { throw new Error('DB'); }));
  assert.deepEqual(pendingSampleLinks(s), [link]);
  let saved: any;
  await retrySampleLink(s, link, async value => { saved = value; });
  assert.equal(saved.itemId, 'existing-item');
  assert.deepEqual(pendingSampleLinks(s), []);
});
test('찾지 못한 샘플과 다른 품목 연결은 성공 처리하거나 덮어쓰지 않는다', async () => {
  const s = storage(); queueSampleLink(s, link);
  let updates = 0;
  const db = { from: () => ({ update: (value: any) => { updates++; assert.equal(value.memo, undefined); return {
    eq: (key: string, id: string) => { assert.equal(key, 'id'); assert.equal(id, 's'); return {
      or: (filter: string) => { assert.equal(filter, 'style_id.is.null,style_id.eq."existing-item"'); return { select: async () => ({ data: [], error: null }) }; },
    }; },
  }; } }) };
  await assert.rejects(retrySampleLink(s, link, value => saveSampleItemLink(db, value)));
  assert.equal(updates, 1); assert.deepEqual(pendingSampleLinks(s), [link]);
  assert.throws(() => queueSampleLink(s, { ...link, itemId: 'another' }));
});
test('대기 정보 저장이 실패하면 신규 샘플 연결 의도를 지우지 않는다', () => {
  const s = storage(); s.setItem = () => { throw new Error('storage'); };
  assert.throws(() => queueSampleLink(s, link)); assert.equal(s.getItem('ames_link_sampleId'), 's');
});
test('실제 DB 클라이언트는 연결 필드만 조건부 PATCH하며 업서트나 샘플 복제는 하지 않는다', async () => {
  let calls = 0;
  const db = new PostgrestClient('http://sample-link.fixture.invalid', { fetch: async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'http://sample-link.fixture.invalid');
    assert.equal(init?.method, 'PATCH'); assert.equal(url.pathname, '/samples');
    assert.equal(url.searchParams.get('id'), 'eq.s');
    assert.equal(url.searchParams.get('or'), '(style_id.is.null,style_id.eq."existing-item")');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(body).sort(), ['style_id', 'updated_at']);
    assert.equal(body.style_id, 'existing-item');
    return new Response(JSON.stringify([{ id: 's' }]), { headers: { 'Content-Type': 'application/json' } });
  } });
  const s = storage(); queueSampleLink(s, link);
  await retrySampleLink(s, link, value => saveSampleItemLink(db, value));
  assert.equal(calls, 1); assert.deepEqual(pendingSampleLinks(s), []);
});
test('연결 대기는 탭 세션과 분리된 계정별 저장소에서만 복구한다', () => {
  const backing = storage();
  const a = scopedSampleLinkStorage(backing, 'employee-a');
  const b = scopedSampleLinkStorage(backing, 'employee-b');
  queueSampleLink(a, link);
  assert.deepEqual(pendingSampleLinks(b), []);
  assert.deepEqual(pendingSampleLinks(scopedSampleLinkStorage(backing, 'employee-a')), [link]);
});
test('샘플 등록을 취소한 뒤 일반 품목을 열면 이전 샘플 연결 의도가 남지 않는다', () => {
  const source = readFileSync(new URL('../pages/ItemMaster.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const storedPrefill =', source.indexOf('const openAdd ='));
  const prefix = source.slice(start, source.indexOf('setEditItem({', start));
  const open = new Function('prefill', 'localStorage', 'sessionStorage', 'sampleForNewItem', prefix);
  const ref = { current: null };
  const local = storage(); const session = storage();
  open({ sampleId: 's' }, local, session, ref);
  assert.equal(ref.current, 's');
  open(undefined, local, session, ref);
  assert.equal(ref.current, null);
  assert.equal(session.getItem('ames_link_sampleId'), null);
});
