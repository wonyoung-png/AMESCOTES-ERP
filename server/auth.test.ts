import assert from 'node:assert/strict';
import test from 'node:test';
import { privateAccessAllowed } from './auth';

test('개발 잠금 중에는 대표 계정만 접근한다', () => {
  assert.equal(privateAccessAllowed('wonyoung@atlm.kr', true), true);
  assert.equal(privateAccessAllowed('staff@atlm.kr', true), false);
  assert.equal(privateAccessAllowed('staff@atlm.kr', false), true);
});
