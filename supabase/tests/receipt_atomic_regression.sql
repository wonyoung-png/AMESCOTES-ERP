-- 합성 자료만 작성하고 전체 롤백한다. 실발주·실입고는 변경하지 않는다.
begin;
set local role erp_server;
do $$
declare oid text:='test_receipt_'||md5(clock_timestamp()::text); v jsonb; r jsonb; checks int:=0;
begin
  insert into public.production_orders(id,style_no,quantity,status,factory_unit_price_krw,color_qtys,workspace,order_no,shipped_qty)
    values(oid,oid,100,'생산중',1000,'[{"color":"BLACK","qty":60},{"color":"WHITE","qty":40}]','OEM',oid,7);
  v:=jsonb_build_object('id',oid||'_1','orderId',oid,'qty',20,'defectQty',2,'receivedDate','2026-10-09',
    'createPayable',true,'disposition','deduct','color','BLACK');
  r:=public.record_korea_receipt(v);
  assert (r->'order'->>'received_qty')::int=20 and (r->'payable'->>'amount_krw')::numeric=20000
    and (r->'defect'->>'amount_krw')::numeric=2000,'receipt links'; checks:=checks+1;
  assert (select shipped_qty from public.production_orders where id=oid)=7,'receipt changed shipment'; checks:=checks+1;
  update public.payables set paid_amount_krw=5000,status='partial' where id='pay_'||oid||'_1';
  update public.production_orders set factory_unit_price_krw=1200 where id=oid;
  r:=public.record_korea_receipt(v);
  assert (r->>'retry')::boolean and (r->'payable'->>'paid_amount_krw')::numeric=5000
    and (r->'payable'->>'amount_krw')::numeric=20000 and (select received_qty from public.production_orders where id=oid)=20,'retry changed records'; checks:=checks+1;
  begin perform public.record_korea_receipt(v||'{"qty":21}'::jsonb); raise exception 'assert_conflict';
  exception when others then if sqlerrm<>'receipt_conflict' then raise; end if; end; checks:=checks+1;
  begin perform public.record_korea_receipt(v||jsonb_build_object('id',oid||'_color','color','BLACK','qty',41)); raise exception 'assert_color';
  exception when others then if sqlerrm<>'invalid_color' then raise; end if; end; checks:=checks+1;
  begin perform public.record_korea_receipt(v||jsonb_build_object('id',oid||'_over','qty',81)); raise exception 'assert_over';
  exception when others then if sqlerrm<>'over_receipt' then raise; end if; end; checks:=checks+1;
  begin perform public.record_korea_receipt(v||jsonb_build_object('id',oid||'_fraction','qty',1.5,'defectQty',0)); raise exception 'assert_fraction';
  exception when others then if sqlerrm<>'invalid_receipt' then raise; end if; end; checks:=checks+1;
  begin perform public.record_korea_receipt(v||jsonb_build_object('id',oid||'_date','receivedDate','2026-02-30')); raise exception 'assert_date';
  exception when others then if sqlerrm<>'invalid_receipt' then raise; end if; end; checks:=checks+1;
  -- 후속 미지급 ID 충돌로 실패해도 발주 누적/입고 이력/불량은 남으면 안 된다.
  insert into public.payables(id,vendor_name,amount_krw,status) values('pay_'||oid||'_collision','test',1,'pending');
  begin perform public.record_korea_receipt(v||jsonb_build_object('id',oid||'_collision'));
    raise exception 'assert_collision'; exception when unique_violation then null; end;
  assert (select received_qty from public.production_orders where id=oid)=20
    and not exists(select 1 from public.receipt_logs where id=oid||'_collision')
    and not exists(select 1 from public.defect_carryovers where id='def_'||oid||'_collision'),'partial save remained'; checks:=checks+1;
  r:=public.record_korea_receipt(v||jsonb_build_object('id',oid||'_rework','disposition','rework','color','WHITE','qty',10));
  assert (r->'defect'->>'amount_krw')::numeric=0 and (r->'defect'->>'qty')::int=2,'rework deducted payment'; checks:=checks+1;
  update public.production_orders set factory_unit_price_krw=null where id=oid;
  r:=public.record_korea_receipt(v||jsonb_build_object('id',oid||'_no_price','color','WHITE','qty',10,'defectQty',0));
  assert r->'payable'='null'::jsonb and (r->'order'->>'received_qty')::int=40,'unpriced false payable'; checks:=checks+1;
  r:=public.record_korea_receipt(v||jsonb_build_object('id',oid||'_full','color',null,'qty',60,'defectQty',0,'createPayable',false));
  assert (r->'order'->>'status')='입고완료' and (r->'order'->>'received_qty')::int=100,'completion'; checks:=checks+1;
  insert into public.production_orders(id,style_no,quantity,status,received_qty) values(oid||'_legacy',oid||'_legacy',10,'생산중',8);
  begin perform public.record_korea_receipt(v||jsonb_build_object('id',oid||'_legacy_log','orderId',oid||'_legacy','color',null,'qty',3,'defectQty',0)); raise exception 'assert_legacy';
  exception when others then if sqlerrm<>'over_receipt' then raise; end if; end; checks:=checks+1;
  update public.production_orders set status='초안' where id=oid||'_legacy';
  begin perform public.record_korea_receipt(v||jsonb_build_object('id',oid||'_draft','orderId',oid||'_legacy','color',null,'qty',1,'defectQty',0)); raise exception 'assert_draft';
  exception when others then if sqlerrm<>'invalid_order_status' then raise; end if; end; checks:=checks+1;
  assert not has_function_privilege('anon','public.record_korea_receipt(jsonb)','EXECUTE'),'anonymous RPC'; checks:=checks+1;
  raise notice 'receipt_atomic_checks=%',checks;
end $$;
rollback;
