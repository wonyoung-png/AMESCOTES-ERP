-- 합성 발주→입고→출고→청구→부분 수금/지급→완료. 전체 롤백.
begin;
set local plpgsql.check_asserts=on;
set local role erp_server;
do $$
declare root text := 'preui_flow_'||substr(md5(clock_timestamp()::text),1,12);
  r jsonb; statement_row jsonb; s jsonb; settlement_row jsonb; collection jsonb;
  checks int := 0;
begin
  insert into vendors(id,name,code) values(root||'_buyer','ISOLATED FLOW BUYER',root);
  insert into items(id,style_no,name,delivery_price) values(root||'_item',root,'ISOLATED FLOW',1500);
  insert into production_orders(id,order_no,quantity,status,buyer_id,style_id,style_no,style_name,workspace,project_no,factory_unit_price_krw)
    values(root||'_order',root,100,'생산중',root||'_buyer',root||'_item',root,'ISOLATED FLOW','OEM',root,1000);
  r := record_korea_receipt(jsonb_build_object('id',root||'_in1','orderId',root||'_order','qty',60,'defectQty',0,
    'receivedDate','2026-10-10','createPayable',true,'disposition','deduct'));
  assert (r->'payable'->>'amount_krw')::numeric=60000;
  checks := checks+1;
  perform record_korea_receipt(jsonb_build_object('id',root||'_in2','orderId',root||'_order','qty',40,'defectQty',0,
    'receivedDate','2026-10-10','createPayable',true,'disposition','deduct'));
  assert (select received_qty from production_orders where id=root||'_order')=100;
  assert (select sum(amount_krw) from payables where order_id=root||'_order')=100000; checks := checks+1;
  r := record_order_shipment(jsonb_build_object('id',root||'_out','orderId',root||'_order','qty',100,
    'logType','outbound_oem','deliveryMarket','b2b','receivedDate','2026-10-10'));
  statement_row := r->'statement';
  assert (r->>'statementCreated')::boolean;
  assert erp_statement_amount(statement_row->'lines')=165000;
  assert statement_row->>'project_no'=root and statement_row->>'workspace'='OEM'; checks := checks+1;
  assert (select trade_statement_id from production_orders where id=root||'_order')=statement_row->>'id';
  s := jsonb_build_object('id',statement_row->>'id','statementNo',statement_row->>'statement_no',
    'vendorId',root||'_buyer','vendorName','ISOLATED FLOW BUYER','vendorCode',root,'projectNo',root,
    'workspace','OEM','issueDate','2026-10-10','status','청구완료','lines',statement_row->'lines');
  r := save_statement_billing(jsonb_build_object('statement',s,'invoiceDate','2026-10-10',
    'expectedUpdatedAt',statement_row->>'updated_at'));
  settlement_row := r->'settlement';
  assert (settlement_row->>'billed_amount_krw')::numeric=165000;
  assert settlement_row->>'project_no'=root; checks := checks+1;
  assert settlement_row->>'invoice_no'=statement_row->>'statement_no';
  collection := jsonb_build_object('id',settlement_row->>'id','buyerId',settlement_row->>'buyer_id',
    'buyerName',settlement_row->>'buyer_name','projectNo',root,'workspace','OEM','channel',settlement_row->>'channel',
    'invoiceNo',settlement_row->>'invoice_no','invoiceDate',settlement_row->>'invoice_date',
    'dueDate',settlement_row->>'due_date','billedAmountKrw',165000,'collectedAmountKrw',50000,'collectedDate','2026-10-10');
  r := save_settlement(jsonb_build_object('settlement',collection,'expected',settlement_row));
  assert r->'statement'->>'status'='청구완료';
  assert (r->'settlement'->>'billed_amount_krw')::numeric-(r->'settlement'->>'collected_amount_krw')::numeric=115000; checks := checks+1;
  perform record_payable_payment('pay_'||root||'_in1',20000,0);
  assert (select sum(amount_krw-paid_amount_krw) from payables where order_id=root||'_order')=80000; checks := checks+1;
  settlement_row := r->'settlement';
  r := save_settlement(jsonb_build_object('settlement',collection||'{"collectedAmountKrw":165000}'::jsonb,'expected',settlement_row));
  assert r->'statement'->>'status'='수금완료';
  assert r->'settlement'->>'status'='완납'; checks := checks+1;
  assert (r->'settlement'->>'billed_amount_krw')::numeric-(r->'settlement'->>'collected_amount_krw')::numeric=0;
  perform record_payable_payment('pay_'||root||'_in1',40000,20000);
  perform record_payable_payment('pay_'||root||'_in2',40000,0);
  assert (select sum(amount_krw-paid_amount_krw) from payables where order_id=root||'_order')=0;
  assert (select count(*) from trade_statements where project_no=root)=1;
  assert (select count(*) from settlements where project_no=root)=1; checks := checks+1;
  raise notice 'pre_ui_end_to_end checks=% PASS; linked transactions rollback',checks;
end $$;
rollback;
