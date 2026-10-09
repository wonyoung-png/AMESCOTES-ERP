import test from 'node:test';
import assert from 'node:assert/strict';
import { captureQuery } from './capture';

test('통합 업무함에서도 일반 직원은 본인 접수만 조회한다', () => {
  const query = captureQuery({ id: 'staff 1', role: 'MD' }, 'pending', 'id');
  assert.ok(query.includes('created_by=eq.staff%201'));
  assert.ok(query.includes('status=eq.pending'));
  assert.ok(!query.includes('limit=200'));
});
test('기존 승인권자의 접수 범위와 전체 이력 필터를 유지한다', () => {
  const query = captureQuery({ id: 'boss', role: '대표' }, 'all');
  assert.ok(!query.includes('created_by='));
  assert.ok(!query.includes('status='));
});
