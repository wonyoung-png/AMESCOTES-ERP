begin;
do $$
declare v jsonb; p jsonb; b bigint; n int; q jsonb;
begin
  insert into public.production_orders(id,order_no,workspace,style_no,style_name,quantity,color_qtys,status,factory_unit_price_krw)
    values('test_cn_order','TEST-CN-ORDER','LUMEN','TEST_CN','test',20,'[{"color":"BLACK","qty":20}]','생산중',0);
  p:='{"id":"test_cn_receipt","orderId":"test_cn_order","qty":10,"defectQty":0,"receivedDate":"2026-10-09","color":"BLACK","createPayable":false,"disposition":"deduct","destination":"china","actor":"test"}';
  v:=record_korea_receipt(p); v:=record_korea_receipt(p);
  select count(*) into n from china_stock_moves where receipt_log_id='test_cn_receipt';
  if n<>1 then raise exception 'duplicate receipt stock'; end if;
  if (select received_qty from production_orders where id='test_cn_order')<>10 then raise exception 'duplicate order receipt'; end if;
  if (select count(*) from china_stock_moves where workspace='AETALOOF' and style_no='TEST_CN')<>0 then raise exception 'brand isolation'; end if;
  q:='{"id":"test_cn_transfer","workspace":"LUMEN","styleNo":"TEST_CN","color":"BLACK","qty":4,"moveDate":"2026-10-09","action":"send"}';
  v:=save_china_transfer(q,'test');v:=save_china_transfer(q,'test');
  select sum(case when move_type='outbound' then -qty else qty end) into b from china_stock_moves where workspace='LUMEN' and style_no='TEST_CN';
  if b<>6 then raise exception 'transfer duplicate deduction'; end if;
  if (select sum(qty) from china_stock_transfers where id='test_cn_transfer' and status='in_transit')<>4 then raise exception 'in transit'; end if;
  begin
    perform save_china_transfer(q||'{"qty":1.5}','test');raise exception 'fraction accepted';
  exception when others then if sqlerrm<>'invalid_transfer' then raise; end if; end;
  begin
    perform save_china_transfer(q||'{"id":"test_cn_over","qty":7}','test');raise exception 'overdraw accepted';
  exception when others then if sqlerrm<>'insufficient_china_stock' then raise; end if; end;
  if exists(select 1 from china_stock_moves where id='transfer_test_cn_over') then raise exception 'partial transfer write'; end if;
  begin
    perform save_china_transfer('{"id":"test_cn_transfer","workspace":"AETALOOF","action":"receive","receivedDate":"2026-10-09","confirmationRef":"TEST-3PL"}','test');raise exception 'wrong brand accepted';
  exception when others then if sqlerrm<>'transfer_not_found' then raise; end if; end;
  q:='{"id":"test_cn_transfer","workspace":"LUMEN","action":"receive","receivedDate":"2026-10-09","confirmationRef":"TEST-3PL"}';
  v:=save_china_transfer(q,'test');v:=save_china_transfer(q,'test');
  if (select status from china_stock_transfers where id='test_cn_transfer')<>'received' then raise exception 'arrival not saved'; end if;
  if (select received_qty from production_orders where id='test_cn_order')<>10 then raise exception 'arrival counted as purchase receipt'; end if;
  begin
    perform save_china_transfer(q||'{"confirmationRef":"CHANGED"}','test');raise exception 'changed retry accepted';
  exception when others then if sqlerrm<>'stock_conflict' then raise; end if; end;
  q:='{"id":"test_cn_adjust","workspace":"LUMEN","styleNo":"TEST_CN","color":"BLACK","qty":-2,"moveType":"adjust","moveDate":"2026-10-09","memo":"실사"}';
  perform save_china_stock_move(q,'test');perform save_china_stock_move(q,'test');
  select sum(case when move_type='outbound' then -qty else qty end) into b from china_stock_moves where workspace='LUMEN' and style_no='TEST_CN';
  if b<>4 then raise exception 'adjust duplicate'; end if;
  begin
    perform import_china_stock_history('LUMEN',jsonb_build_array(q||'{"id":"test_cn_import_first","qty":2,"createdAt":"2026-10-09T00:00:00Z"}',q||'{"id":"test_cn_import_fail","qty":-100,"createdAt":"2026-10-09T00:01:00Z"}'),'test');raise exception 'bad import accepted';
  exception when others then if sqlerrm<>'insufficient_china_stock' then raise; end if; end;
  if exists(select 1 from china_stock_moves where id='test_cn_import_first') then raise exception 'partial import write'; end if;
  q:='{"id":"legacy_test_cn","workspace":"LUMEN","styleNo":"TEST_CN","color":"BLACK","qty":10,"moveType":"inbound","moveDate":"2026-10-09","receiptLogId":"test_cn_receipt"}';
  perform import_china_stock_history('LUMEN',jsonb_build_array(q),'test');
  if (select count(*) from china_stock_moves where receipt_log_id='test_cn_receipt')<>1 then raise exception 'legacy receipt duplicate'; end if;
  if has_table_privilege('anon','public.china_stock_moves','INSERT') or has_function_privilege('anon','public.save_china_transfer(jsonb,text)','EXECUTE') then raise exception 'anon write allowed'; end if;
  -- Force a stock ID collision after receipt/order writes; all receipt effects must roll back.
  perform save_china_stock_move('{"id":"receipt_test_cn_collision","workspace":"LUMEN","styleNo":"TEST_CN","color":"BLACK","qty":1,"moveType":"adjust","moveDate":"2026-10-09","memo":"collision test"}','test');
  begin
    perform record_korea_receipt(p||'{"id":"test_cn_collision","qty":2}');raise exception 'collision accepted';
  exception when others then if sqlerrm<>'stock_conflict' then raise; end if; end;
  if exists(select 1 from receipt_logs where id='test_cn_collision') or (select received_qty from production_orders where id='test_cn_order')<>10 then raise exception 'partial receipt write'; end if;
  -- Priced China receipt uses the explicit China vendor and excludes defective units from stock.
  if (select count(*) from vendors where code='AMES-CN')=1 then
    update production_orders set factory_unit_price_krw=100 where id='test_cn_order';
    v:=record_korea_receipt(p||'{"id":"test_cn_priced","qty":3,"defectQty":1,"createPayable":true}');
    if v->'payable'->>'payee_type'<>'china_corp' or (v->'payable'->>'amount_krw')::numeric<>300
      or v->'payable'->>'vendor_id' is distinct from (select id from vendors where code='AMES-CN') then raise exception 'wrong China payable'; end if;
    if (select qty from china_stock_moves where receipt_log_id='test_cn_priced')<>2 then raise exception 'defect counted as normal stock'; end if;
  else
    update production_orders set factory_unit_price_krw=100 where id='test_cn_order';
    begin
      perform record_korea_receipt(p||'{"id":"test_cn_priced","qty":3,"createPayable":true}');raise exception 'missing vendor accepted';
    exception when others then if sqlerrm<>'china_vendor_required' then raise; end if; end;
    if exists(select 1 from receipt_logs where id='test_cn_priced') then raise exception 'partial missing vendor receipt'; end if;
  end if;
  v:=record_korea_receipt(p||'{"id":"test_cn_all_defect","qty":1,"defectQty":1}');
  if exists(select 1 from china_stock_moves where receipt_log_id='test_cn_all_defect')
    or (select defect_qty from receipt_logs where id='test_cn_all_defect')<>1 then raise exception 'all defect stock handling'; end if;
  raise notice 'China stock checks=20 PASS';
end $$;
rollback;
