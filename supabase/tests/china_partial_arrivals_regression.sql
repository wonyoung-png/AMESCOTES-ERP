begin;
do $$
declare v jsonb; q jsonb; t china_stock_transfers%rowtype; n bigint;
begin
  perform save_china_stock_move('{"id":"test_partial_stock","workspace":"LUMEN","styleNo":"TEST-PARTIAL","color":"BLACK","qty":10,"moveType":"adjust","moveDate":"2026-10-09","memo":"isolated fixture"}','test');
  q:='{"id":"test_partial_transfer","workspace":"LUMEN","styleNo":"TEST-PARTIAL","color":"BLACK","qty":10,"moveDate":"2026-10-09","action":"send"}';
  perform save_china_transfer(q,'test');
  q:='{"id":"test_partial_transfer","workspace":"LUMEN","action":"receive","receivedQty":4,"arrivalId":"test_first","receivedDate":"2026-10-10","confirmationRef":"TEST-3PL-1"}';
  v:=save_china_transfer(q,'test'); perform save_china_transfer(q,'test');
  select * into t from china_stock_transfers where id='test_partial_transfer';
  if t.received_qty<>4 or t.qty-t.received_qty<>6 or t.status<>'in_transit' or t.received_date is not null then raise exception 'partial status'; end if;
  if (select count(*) from china_stock_arrivals where transfer_id=t.id)<>1 then raise exception 'duplicate event'; end if;
  if jsonb_array_length((select e->'arrivals' from jsonb_array_elements(v->'transfers') e where e->>'id'=t.id))<>1 then raise exception 'history snapshot'; end if;
  begin
    perform save_china_transfer(q||'{"receivedQty":5}','test'); raise exception 'changed replay accepted';
  exception when others then if sqlerrm<>'stock_conflict' then raise; end if; end;
  begin
    perform save_china_transfer(q||'{"arrivalId":"test_over","receivedQty":7}','test'); raise exception 'overreceipt accepted';
  exception when others then if sqlerrm<>'arrival_exceeds_remaining' then raise; end if; end;
  begin
    perform save_china_transfer(q-'arrivalId'-'receivedQty','test'); raise exception 'implicit remaining accepted';
  exception when others then if sqlerrm<>'partial_arrival_requires_quantity' then raise; end if; end;
  begin
    perform save_china_transfer(q||'{"workspace":"AETALOOF"}','test'); raise exception 'wrong brand accepted';
  exception when others then if sqlerrm<>'transfer_not_found' then raise; end if; end;
  begin
    perform save_china_transfer(q||'{"arrivalId":"test_bad_date","receivedDate":"2026-10-08"}','test'); raise exception 'before send accepted';
  exception when others then if sqlerrm<>'invalid_transfer' then raise; end if; end;
  begin
    perform save_china_transfer(q||'{"arrivalId":"test_fraction","receivedQty":1.5}','test'); raise exception 'fraction accepted';
  exception when others then if sqlerrm<>'invalid_transfer' then raise; end if; end;
  begin
    perform save_china_transfer(q-'arrivalId','test'); raise exception 'missing event id accepted';
  exception when others then if sqlerrm<>'invalid_transfer' then raise; end if; end;
  begin
    perform save_china_transfer(q||'{"arrivalId":"test_null","receivedQty":null}','test'); raise exception 'null quantity accepted';
  exception when others then if sqlerrm<>'invalid_transfer' then raise; end if; end;
  perform save_china_transfer(q||'{"arrivalId":"test_final","receivedQty":6,"receivedDate":"2026-10-09","confirmationRef":"TEST-3PL-2"}','test');
  -- Even an earlier physical-date entry must not move the completion summary backwards.
  select * into t from china_stock_transfers where id='test_partial_transfer';
  if t.received_qty<>10 or t.status<>'received' or t.received_date<>'2026-10-10' or t.confirmation_ref<>'TEST-3PL-1' then raise exception 'full summary'; end if;
  perform save_china_transfer(q,'test');
  if (select count(*) from china_stock_arrivals where transfer_id=t.id)<>2 then raise exception 'late replay duplicate'; end if;
  begin
    perform save_china_transfer(q||'{"arrivalId":"test_after_full","receivedQty":1}','test'); raise exception 'receipt after full accepted';
  exception when others then if sqlerrm<>'arrival_exceeds_remaining' then raise; end if; end;
  select sum(case when move_type='outbound' then -qty else qty end) into n from china_stock_moves where style_no='TEST-PARTIAL';
  if n<>0 or (select count(*) from china_stock_moves where style_no='TEST-PARTIAL')<>2 then raise exception 'arrival altered physical stock'; end if;
  if has_table_privilege('anon','public.china_stock_arrivals','SELECT') or has_table_privilege('anon','public.china_stock_arrivals','INSERT') then raise exception 'anon arrival access'; end if;
  raise notice 'China partial arrivals regression PASS';
end $$;
rollback;
