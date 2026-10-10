begin;
set local role erp_server;
do $$
declare v jsonb; rows jsonb; r jsonb; n int;
begin
  insert into production_orders(id,order_no,workspace,style_no,quantity,color_qtys,status,factory_unit_price_krw)
    values('test_gen_order','TEST-GEN','LUMEN','TEST_GEN',30,'[{"color":"BLACK","qty":30}]','생산중',0);
  r:='{"id":"test_gen_r1","orderId":"test_gen_order","qty":10,"defectQty":1,"receivedDate":"2026-10-10","color":"BLACK","createPayable":false,"disposition":"deduct"}';
  perform record_korea_receipt(r); perform record_korea_receipt(r||'{"id":"test_gen_r2","defectQty":0}');
  begin perform generate_receipt_payables('test_gen_order');raise exception 'unpriced accepted';
  exception when others then if sqlerrm<>'price_required' then raise; end if;end;
  if exists(select 1 from payables where order_id='test_gen_order') then raise exception 'unpriced partial';end if;
  update production_orders set factory_unit_price_krw=100 where id='test_gen_order';
  insert into payables(id,vendor_name,source_type,source_id,amount_krw,paid_amount_krw,status)
    values('pay_test_gen_r2','collision','manual','other',1,0,'pending');
  begin perform generate_receipt_payables('test_gen_order');raise exception 'collision accepted';
  exception when others then if sqlerrm<>'ambiguous_payable' then raise; end if;end;
  if exists(select 1 from payables where id='pay_test_gen_r1') then raise exception 'generation partial write';end if;
  update payables set id='test_gen_reserved' where id='pay_test_gen_r2';
  v:=generate_receipt_payables('test_gen_order');
  if (v->>'created')::int<>2 or (select amount_krw from payables where id='pay_test_gen_r1')<>1000
    or (select amount_krw from defect_carryovers where id='def_test_gen_r1')<>100 then raise exception 'wrong fixed price';end if;
  perform record_payable_payment('pay_test_gen_r1',300,0);
  update production_orders set factory_unit_price_krw=500 where id='test_gen_order';
  v:=generate_receipt_payables('test_gen_order');
  if (v->>'created')::int<>0 or (select amount_krw from payables where id='pay_test_gen_r1')<>1000
    or (select paid_amount_krw from payables where id='pay_test_gen_r1')<>300 then raise exception 'retry overwrote payment';end if;
  if (select count(*) from vendors where code='AMES-CN')=1 then
    perform record_korea_receipt(r||'{"id":"test_gen_cn","qty":2,"defectQty":0,"destination":"china"}');
    v:=generate_receipt_payables('test_gen_order');
    if (v->>'created')::int<>1 or (select payee_type from payables where id='pay_test_gen_cn')<>'china_corp' then raise exception 'China route';end if;
  end if;
  rows:='[{"vendorName":"test","amountKrw":1000,"dueDate":"2026-11-10","memo":"[자금계획|LUMEN|인테리어|예상|test_gen_plan|계약금] test"},{"vendorName":"test","amountKrw":2000,"dueDate":"2026-12-10","memo":"[자금계획|LUMEN|인테리어|예상|test_gen_plan|잔금] test"}]';
  v:=save_planned_payables('test_gen_plan',rows);v:=save_planned_payables('test_gen_plan',rows);
  if (select count(*) from payables where source_id='test_gen_plan')<>2 then raise exception 'duplicate plan';end if;
  begin perform save_planned_payables('test_gen_plan',jsonb_build_array(rows->0));raise exception 'short retry accepted';
  exception when others then if sqlerrm<>'plan_conflict' then raise;end if;end;
  begin perform save_planned_payables('test_gen_plan',jsonb_set(rows,'{1,amountKrw}','3000'));raise exception 'changed retry accepted';
  exception when others then if sqlerrm<>'plan_conflict' then raise;end if;end;
  begin
    perform save_planned_payables('test_gen_bad',jsonb_build_array(
      jsonb_set(rows->0,'{memo}','"[자금계획|LUMEN|인테리어|예상|test_gen_bad|계약금] test"'),
      jsonb_set(jsonb_set(rows->1,'{memo}','"[자금계획|LUMEN|인테리어|예상|test_gen_bad|잔금] test"'),'{amountKrw}','0')));
    raise exception 'invalid second accepted';
  exception when others then if sqlerrm<>'invalid_plan' then raise;end if;end;
  if exists(select 1 from payables where source_id='test_gen_bad') then raise exception 'partial split plan';end if;
  if has_function_privilege('anon','public.generate_receipt_payables(text)','EXECUTE')
    or has_function_privilege('anon','public.save_planned_payables(text,jsonb)','EXECUTE') then raise exception 'anon mutation';end if;
  raise notice 'payable generation regression PASS';
end $$;
rollback;
