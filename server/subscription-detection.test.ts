import assert from 'node:assert/strict';
import { detectSubscriptionCandidates } from './subscription-detection.js';

const found = detectSubscriptionCandidates([
  { approvedOn: '2026-08-03', merchantName: 'SHOPIFY* 12345', cardLast4: '7788', amount: 39000, currency: 'KRW' },
  { approvedOn: '2026-09-03', merchantName: 'SHOPIFY* 67890', cardLast4: '7788', amount: 39000, currency: 'KRW' },
  { approvedOn: '2026-08-05', merchantName: 'FACEBK *ABCD', cardLast4: '7788', amount: 100000, currency: 'KRW' },
  { approvedOn: '2026-09-05', merchantName: 'FACEBK *EFGH', cardLast4: '7788', amount: 120000, currency: 'KRW' },
]);
assert.equal(found.length, 1);
assert.equal(found[0].merchantKey, 'SHOPIFY');
assert.equal(found[0].monthCount, 2);
console.log('구독 자동 발견 테스트 통과');
