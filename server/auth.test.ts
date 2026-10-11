import assert from 'node:assert/strict';
import test from 'node:test';
import { privateAccessAllowed, restAsServer, withServerReadSignal } from './auth';

test('개발 잠금 중에는 대표 계정만 접근한다', () => {
  assert.equal(privateAccessAllowed('wonyoung@atlm.kr', true), true);
  assert.equal(privateAccessAllowed('staff@atlm.kr', true), false);
  assert.equal(privateAccessAllowed('staff@atlm.kr', false), true);
});

test('점검 조회의 취소 신호는 다른 요청·저장 요청에 전파되지 않는다', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const seen = new Map<string, AbortSignal | null | undefined>();
  globalThis.fetch = async (input, init) => {
    seen.set(String(input).split('/').pop()!, init?.signal);
    return new Response('[]');
  };
  const a = new AbortController(), b = new AbortController(), explicit = new AbortController();
  await Promise.all([
    withServerReadSignal(a.signal, async () => { await Promise.resolve(); await restAsServer('scope-a'); await restAsServer('scope-post', { method: 'POST' }); await restAsServer('explicit', { signal: explicit.signal }); }),
    withServerReadSignal(b.signal, async () => { await restAsServer('scope-b', { method: 'HEAD' }); }),
    restAsServer('outside'),
  ]);
  assert.equal(seen.get('scope-a'), a.signal); assert.equal(seen.get('scope-b'), b.signal);
  assert.equal(seen.get('scope-post'), undefined); assert.equal(seen.get('outside'), undefined);
  assert.equal(seen.get('explicit'), explicit.signal);
});

test('점검 취소가 실제 PostgREST 조회에 전달되고 이후 일반 조회는 정상이다', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_input, init) => {
    if (!init?.signal) return new Response('[]');
    init.signal.throwIfAborted();
    return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
  };
  const controller = new AbortController();
  const pending = withServerReadSignal(controller.signal, () => restAsServer('cancelled'));
  controller.abort(Error('test_read_timeout'));
  await assert.rejects(pending, /test_read_timeout/);
  assert.equal((await restAsServer('recovered')).ok, true);
});
