import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChinaTransfer } from './chinaStock';
test('중국 운송 잔여는 발송에서 누적 도착만 차감한다', () => {
  const partial=normalizeChinaTransfer({qty:10,received_qty:4,status:'in_transit',arrivals:[]});
  assert.equal(partial.qty-partial.received_qty,6);
  assert.equal(normalizeChinaTransfer({qty:10,status:'received'}).received_qty,10);
  assert.equal(normalizeChinaTransfer({qty:10,status:'in_transit'}).received_qty,0);
  for (const v of [{qty:10,received_qty:11,status:'received'}, {qty:10,received_qty:10,status:'in_transit'},
    {qty:10,received_qty:null,status:'in_transit'},{qty:10,received_qty:9,status:'received'}]) assert.throws(()=>normalizeChinaTransfer(v));
});
