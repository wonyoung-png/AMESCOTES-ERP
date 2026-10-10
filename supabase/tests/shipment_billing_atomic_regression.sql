-- 합성 자료·행 잠금·청구만 검증하고 전체 롤백한다.
begin;
set local role erp_server;
do $$
declare
  root text:='test_ship_bill_'||substr(md5(clock_timestamp()::text),1,12);
  buyer text:=root||'_buyer'; oid text:=root||'_order'; sid text:=root||'_statement';
  input jsonb; r jsonb; first_result jsonb; s jsonb; payload jsonb; changed jsonb; checks int:=0;
begin
  insert into public.vendors(id,name,code) values(buyer,'test buyer',root);
  insert into public.items(id,style_no,name,delivery_price) values(root||'_item',root,'test item',100);
  insert into public.production_orders(id,order_no,style_no,style_name,style_id,buyer_id,quantity,status,workspace,
    received_qty,defect_qty,received_date,project_no)
    values(oid,oid,root,'test item',root||'_item',buyer,100,'생산중','OEM',80,2,'2026-10-01',root);
  input:=jsonb_build_object('id',root||'_ship1','orderId',oid,'logType','outbound_oem',
    'qty',40,'deliveryMarket','b2b','receivedDate','2026-10-10','memo','test shipment');
  r:=public.record_order_shipment(input);
  assert (r->'order'->>'shipped_qty')::int=40 and r->'statement'='null'::jsonb,'partial OEM must not complete draft'; checks:=checks+1;
  r:=public.record_order_shipment(input);
  assert (r->>'retry')::boolean and (select count(*) from public.receipt_logs where order_id=oid)=1,'shipment retry duplicate'; checks:=checks+1;
  begin perform public.record_order_shipment(input||'{"qty":41}'::jsonb); raise exception 'assert_conflict';
  exception when others then if sqlerrm<>'receipt_conflict' then raise; end if; end; checks:=checks+1;
  begin perform public.record_order_shipment(input||jsonb_build_object('id',root||'_over','qty',61)); raise exception 'assert_over';
  exception when others then if sqlerrm<>'over_shipment' then raise; end if; end; checks:=checks+1;
  r:=public.record_order_shipment(input||jsonb_build_object('id',root||'_ship2','qty',60));
  assert (r->>'statementCreated')::boolean and (r->'statement'->'lines'->0->>'qty')::int=100
    and (r->'statement'->'lines'->0->>'unitPrice')::numeric=100,'OEM draft quantity/price'; checks:=checks+1;
  assert (r->'order'->>'received_qty')::int=80 and (r->'order'->>'defect_qty')::int=2
    and r->'order'->>'received_date'='2026-10-01' and r->'order'->>'status'='생산중','shipment changed inbound'; checks:=checks+1;
  first_result:=r;
  r:=public.record_order_shipment(input||jsonb_build_object('id',root||'_ship2','qty',60));
  assert r->'statement'->>'id'=first_result->'statement'->>'id' and not (r->>'statementCreated')::boolean,'draft retry duplicate'; checks:=checks+1;
  assert not exists(select 1 from public.settlements where invoice_no=r->'statement'->>'statement_no'),'draft created receivable'; checks:=checks+1;

  insert into public.production_orders(id,order_no,quantity,status,buyer_id,style_id,style_no,workspace)
    values(root||'_mixed',root||'_mixed',100,'생산중',buyer,root||'_item',root,'OEM');
  perform public.record_order_shipment(input||jsonb_build_object('id',root||'_3pl','orderId',root||'_mixed','qty',60,'logType','outbound_3pl'));
  r:=public.record_order_shipment(input||jsonb_build_object('id',root||'_mixed_oem','orderId',root||'_mixed','qty',40));
  assert (r->'order'->>'shipped_qty')::int=100 and r->'statement'='null'::jsonb,'3PL became OEM billing'; checks:=checks+1;

  insert into public.production_orders(id,quantity,status,shipped_qty) values(root||'_legacy',100,'생산중',70);
  begin perform public.record_order_shipment(input||jsonb_build_object('id',root||'_legacy_ship','orderId',root||'_legacy','qty',31)); raise exception 'assert_legacy';
  exception when others then if sqlerrm<>'over_shipment' then raise; end if; end; checks:=checks+1;
  for changed in select * from jsonb_array_elements('[{"qty":1.5},{"qty":0},{"receivedDate":"2026-02-30"},{"logType":"inbound"},{"deliveryMarket":"unknown"}]'::jsonb) loop
    begin perform public.record_order_shipment(input||jsonb_build_object('id',root||'_bad')||changed); raise exception 'assert_invalid';
    exception when others then if sqlerrm<>'invalid_shipment' then raise; end if; end; checks:=checks+1;
  end loop;
  insert into public.production_orders(id,quantity,status,trade_statement_id) values(root||'_broken_link',10,'생산중',root||'_missing');
  begin perform public.record_order_shipment(input||jsonb_build_object('id',root||'_broken_ship','orderId',root||'_broken_link','qty',10)); raise exception 'assert_link';
  exception when others then if sqlerrm<>'statement_link_conflict' then raise; end if; end;
  assert not exists(select 1 from public.receipt_logs where id=root||'_broken_ship')
    and coalesce((select shipped_qty from public.production_orders where id=root||'_broken_link'),0)=0,'failed draft left shipment'; checks:=checks+1;

  insert into public.production_orders(id,quantity,status,buyer_id,workspace) values(root||'_no_price',1,'생산중',buyer,'OEM');
  r:=public.record_order_shipment(input||jsonb_build_object('id',root||'_no_price_ship','orderId',root||'_no_price','qty',1));
  assert r->>'warning'='price_missing' and (r->'statement'->'lines'->0->>'unitPrice')::numeric=0
    and r->'statement'->>'status'='미청구','missing price billed'; checks:=checks+1;
  insert into public.production_orders(id,quantity,status) values(root||'_no_buyer',1,'생산중');
  r:=public.record_order_shipment(input||jsonb_build_object('id',root||'_no_buyer_ship','orderId',root||'_no_buyer','qty',1));
  assert r->>'warning'='buyer_missing' and r->'statement'='null'::jsonb
    and (r->'order'->>'shipped_qty')::int=1,'missing buyer shipment handling'; checks:=checks+1;

  s:=jsonb_build_object('id',sid,'vendorId',buyer,'status','청구완료','issueDate','2026-10-10','projectNo',root,'workspace','OEM',
    'lines',jsonb_build_array(jsonb_build_object('id','test_line','description','test product','qty',10,'unitPrice',100,'taxType','과세','taxRate',0.1)));
  payload:=jsonb_build_object('statement',s,'invoiceDate','2026-10-10');
  r:=public.save_statement_billing(payload);
  assert (r->'settlement'->>'billed_amount_krw')::numeric=1100 and r->'settlement'->>'due_date'='2026-11-09'
    and r->'statement'->>'project_no'=root and r->'statement'->>'workspace'='OEM','new billing links'; checks:=checks+1;
  first_result:=r;
  r:=public.save_statement_billing(payload);
  assert r->'statement'->>'id'=first_result->'statement'->>'id' and r->'statement'->>'statement_no'=first_result->'statement'->>'statement_no'
    and (select count(*) from public.settlements where invoice_no=r->'statement'->>'statement_no')=1,'billing retry duplicate'; checks:=checks+1;
  update public.settlements set collected_amount_krw=300,collected_date='2026-10-09',due_date='2026-12-01',status='일부수금' where id='stl_'||sid;
  changed:=s||jsonb_build_object('lines',jsonb_build_array((s->'lines'->0)||'{"qty":20}'::jsonb));
  payload:=jsonb_build_object('statement',changed,'invoiceDate','2026-10-11','expectedUpdatedAt',r->'statement'->>'updated_at');
  r:=public.save_statement_billing(payload);
  assert (r->'settlement'->>'billed_amount_krw')::numeric=2200 and (r->'settlement'->>'collected_amount_krw')::numeric=300
    and r->'settlement'->>'collected_date'='2026-10-09' and r->'settlement'->>'due_date'='2026-12-01'
    and r->'settlement'->>'invoice_date'='2026-10-10' and r->'settlement'->>'status'='일부수금','payment metadata overwritten'; checks:=checks+1;
  begin perform public.save_statement_billing(jsonb_build_object('statement',s,'invoiceDate','2026-10-10','expectedUpdatedAt',first_result->'statement'->>'updated_at')); raise exception 'assert_stale';
  exception when others then if sqlerrm<>'stale_statement' then raise; end if; end; checks:=checks+1;
  payload:=payload||jsonb_build_object('expectedUpdatedAt',r->'statement'->>'updated_at');
  begin perform public.save_statement_billing(payload||jsonb_build_object('statement',changed||'{"status":"수금완료"}'::jsonb)); raise exception 'assert_collection';
  exception when others then if sqlerrm<>'collection_required' then raise; end if; end; checks:=checks+1;
  begin perform public.save_statement_billing(payload||jsonb_build_object('statement',changed||'{"status":"미청구"}'::jsonb)); raise exception 'assert_cancel';
  exception when others then if sqlerrm<>'linked_settlement' then raise; end if; end; checks:=checks+1;
  begin perform public.save_statement_billing(payload||jsonb_build_object('statement',changed||jsonb_build_object('lines',jsonb_build_array((s->'lines'->0)||'{"qty":1}'::jsonb)))); raise exception 'assert_below';
  exception when others then if sqlerrm<>'below_collected' then raise; end if; end; checks:=checks+1;
  begin perform public.save_statement_billing(payload||jsonb_build_object('statement',changed||'{"statementNo":"different"}'::jsonb)); raise exception 'assert_number';
  exception when others then if sqlerrm<>'statement_number_changed' then raise; end if; end; checks:=checks+1;

  -- 후속 미수금 ID 충돌: 명세표 INSERT도 롤백되어야 한다.
  insert into public.settlements(id,buyer_id,invoice_no,billed_amount_krw) values('stl_'||root||'_collision',buyer,root||'_unrelated',1);
  begin perform public.save_statement_billing(jsonb_build_object('statement',s||jsonb_build_object('id',root||'_collision'),'invoiceDate','2026-10-10')); raise exception 'assert_collision';
  exception when unique_violation then null; end;
  assert not exists(select 1 from public.trade_statements where id=root||'_collision'),'failed receivable left statement'; checks:=checks+1;
  begin perform public.save_statement_billing(jsonb_build_object('statement',s||jsonb_build_object('id',root||'_zero','lines',jsonb_build_array((s->'lines'->0)||'{"unitPrice":0}'::jsonb)),'invoiceDate','2026-10-10')); raise exception 'assert_zero';
  exception when others then if sqlerrm<>'zero_bill' then raise; end if; end; checks:=checks+1;

  r:=public.save_statement_billing(payload||jsonb_build_object('statement',changed||jsonb_build_object('taxInvoice',jsonb_build_object('issued',true,'totalAmount',2200))));
  payload:=payload||jsonb_build_object('expectedUpdatedAt',r->'statement'->>'updated_at');
  begin perform public.save_statement_billing(payload); raise exception 'assert_issued';
  exception when others then if sqlerrm<>'issued_statement_locked' then raise; end if; end; checks:=checks+1;

  insert into public.settlements(id,buyer_id,invoice_no,billed_amount_krw) values(root||'_duplicate',buyer,r->'statement'->>'statement_no',2200);
  begin perform public.save_statement_billing(jsonb_build_object('statement',changed||jsonb_build_object('taxInvoice',jsonb_build_object('issued',true,'totalAmount',2200)),
    'invoiceDate','2026-10-10')); raise exception 'assert_duplicate';
  exception when others then if sqlerrm<>'duplicate_settlement' then raise; end if; end; checks:=checks+1;

  insert into public.trade_statements(id,statement_no,vendor_id,status,lines)
    values(root||'_seq999','202610-'||root||'-999',buyer,'미청구',s->'lines');
  r:=public.save_statement_billing(jsonb_build_object('statement',s||jsonb_build_object('id',root||'_seq1000','status','미청구'),'invoiceDate','2026-10-10'));
  assert r->'statement'->>'statement_no'='202610-'||root||'-1000','number truncated at 1000'; checks:=checks+1;
  r:=public.save_statement_billing(jsonb_build_object('statement',s||jsonb_build_object('id',root||'_seq1001','status','미청구'),'invoiceDate','2026-10-10'));
  assert r->'statement'->>'statement_no'='202610-'||root||'-1001','server number allocation'; checks:=checks+1;
  assert not has_function_privilege('anon','public.record_order_shipment(jsonb)','execute')
    and not has_function_privilege('anon','public.save_statement_billing(jsonb)','execute'),'anonymous RPC permitted'; checks:=checks+1;
  raise notice 'shipment_billing_atomic checks=% PASS; all fixtures rollback',checks;
end $$;
rollback;
