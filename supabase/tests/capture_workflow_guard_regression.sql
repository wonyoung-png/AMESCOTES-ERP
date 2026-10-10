-- 합성 접수 승인만 실행하고 모든 자료를 되돌린다. DELETE 없음.
begin;
set local role erp_server;
do $$
declare root text:='test_capture_guard_'||substr(md5(clock_timestamp()::text),1,12);
  buyer text:=root||'_buyer'; oid text:=root||'_order'; r jsonb; st jsonb; s jsonb; checks int:=0;
begin
  insert into public.vendors(id,name,code) values(buyer,'test buyer',root);
  insert into public.trade_statements(id,statement_no,vendor_id,issue_date,lines,status)
    values(root||'_old','202610-'||root||'-999',buyer,'2026-10-01','[]','미청구');
  r:=public.erp_statement_add_line(buyer,null,'{"description":"test","qty":1,"unitPrice":100,"taxType":"과세","taxRate":10,"memo":"현장 접수"}', '2026-10-01');
  assert r->>'no'='202610-'||root||'-1000','sequence truncation'; checks:=checks+1;
  select to_jsonb(t) into st from public.trade_statements t where id=r->>'id';
  assert public.erp_statement_amount(st->'lines')=110,'rate normalization'; checks:=checks+1;
  s:=jsonb_build_object('id',st->>'id','statementNo',st->>'statement_no','vendorId',buyer,
    'issueDate','2026-10-01','lines',st->'lines','status','청구완료');
  r:=public.save_statement_billing(jsonb_build_object('statement',s,'invoiceDate','2026-10-01','expectedUpdatedAt',st->'updated_at'));
  assert (r->'settlement'->>'billed_amount_krw')::numeric=110,'capture draft billing'; checks:=checks+1;
  begin perform public.erp_statement_add_line(buyer,st->>'id','{"description":"test","qty":1,"unitPrice":100,"taxType":"과세","taxRate":0.1}', '2026-10-01');
    raise exception 'assert_locked'; exception when others then if sqlerrm not like 'statement_locked:%' then raise; end if; end; checks:=checks+1;
  insert into public.production_orders(id,order_no,quantity,status,workspace,project_no,buyer_id,style_name,shipped_qty)
    values(oid,oid,10,'초안','OEM',root,buyer,'test',0);
  insert into public.capture_inbox(id,kind,raw_text) values(root||'_a','delivery','synthetic');
  begin perform public.approve_capture(root||'_a','delivery',jsonb_build_object('orderId',oid,'qty',1,'noBill',true),'test','test');
    raise exception 'assert_status'; exception when others then if sqlerrm<>'invalid_order_status' then raise; end if; end; checks:=checks+1;
  update public.production_orders set status='생산중' where id=oid;
  begin perform public.approve_capture(root||'_a','delivery',jsonb_build_object('orderId',oid,'qty',11,'noBill',true),'test','test');
    raise exception 'assert_over'; exception when others then if sqlerrm<>'over_shipment' then raise; end if; end; checks:=checks+1;
  assert not exists(select 1 from public.receipt_logs where order_id=oid)
    and (select status from public.capture_inbox where id=root||'_a')='pending','failed approval rollback'; checks:=checks+1;
  r:=public.approve_capture(root||'_a','delivery',jsonb_build_object('orderId',oid,'qty',4,'billUnitPrice',100,'requestDate','2026-10-02'),'test','test');
  assert (select shipped_qty from public.production_orders where id=oid)=4,'capture shipment'; checks:=checks+1;
  assert (select trade_statement_id from public.production_orders where id=oid)=r->>'statementId','order link'; checks:=checks+1;
  assert (select workspace='OEM' and project_no=root from public.trade_statements where id=r->>'statementId'),'business context'; checks:=checks+1;
  assert (select public.erp_statement_amount(lines) from public.trade_statements where id=r->>'statementId')=440,'delivery tax'; checks:=checks+1;
  insert into public.trade_statements(id,statement_no,vendor_id,issue_date,lines,status,workspace,project_no)
    values(root||'_other',root||'_other',buyer,'2026-10-02','[]','미청구','LUMEN',root);
  insert into public.capture_inbox(id,kind,raw_text) values(root||'_context','delivery','synthetic');
  begin perform public.approve_capture(root||'_context','delivery',jsonb_build_object('orderId',oid,'qty',1,'billUnitPrice',100,'billStatementId',' '||root||'_other '),'test','test');
    raise exception 'assert_link_conflict'; exception when others then if sqlerrm<>'statement_link_conflict' then raise; end if; end; checks:=checks+1;
  -- 사업 정보 비교 자체도 기존 연결 제한과 분리해 검증한다.
  update public.production_orders set trade_statement_id=null where id=oid;
  begin perform public.approve_capture(root||'_context','delivery',jsonb_build_object('orderId',oid,'qty',1,'billUnitPrice',100,'billStatementId',' '||root||'_other '),'test','test');
    raise exception 'assert_brand_conflict'; exception when others then if sqlerrm<>'statement_link_conflict' then raise; end if; end; checks:=checks+1;
  update public.trade_statements set workspace='OEM',project_no=root||'_different' where id=root||'_other';
  begin perform public.approve_capture(root||'_context','delivery',jsonb_build_object('orderId',oid,'qty',1,'billUnitPrice',100,'billStatementId',root||'_other'),'test','test');
    raise exception 'assert_project_conflict'; exception when others then if sqlerrm<>'statement_link_conflict' then raise; end if; end; checks:=checks+1;
  update public.production_orders set trade_statement_id=r->>'statementId' where id=oid;
  assert (select shipped_qty from public.production_orders where id=oid)=4
    and (select status from public.capture_inbox where id=root||'_context')='pending','context failure rollback'; checks:=checks+1;
  r:=public.approve_capture(root||'_context','delivery',jsonb_build_object('orderId',oid,'qty',1,'billUnitPrice',100,
    'billStatementId',' '||(r->>'statementId')||' ','requestDate','2026-10-02'),'test','test');
  assert not (r->>'statementNew')::boolean and (select jsonb_array_length(lines) from public.trade_statements where id=r->>'statementId')=2,
    'same context append'; checks:=checks+1;
  begin perform public.approve_capture(root||'_a','delivery',jsonb_build_object('orderId',oid,'qty',4,'billUnitPrice',100),'test','test');
    raise exception 'assert_duplicate'; exception when others then if sqlerrm<>'already:approved' then raise; end if; end; checks:=checks+1;
  r:=public.record_order_shipment(jsonb_build_object('id',root||'_ship','orderId',oid,'qty',5,'logType','outbound_oem','deliveryMarket','b2b','receivedDate','2026-10-03'));
  assert r->>'statementCreated'='false' and r->>'warning'='linked_statement_review','no full order duplicate'; checks:=checks+1;
  insert into public.capture_inbox(id,kind,raw_text) values(root||'_b','delivery','synthetic');
  begin perform public.approve_capture(root||'_b','delivery',jsonb_build_object('orderId',oid,'qty',1,'noBill',true),'test','test');
    raise exception 'assert_mixed_over'; exception when others then if sqlerrm<>'over_shipment' then raise; end if; end; checks:=checks+1;
  assert (select shipped_qty from public.production_orders where id=oid)=10,'mixed path total'; checks:=checks+1;
  assert not has_function_privilege('anon','public.approve_capture(text,text,jsonb,text,text)','execute'),'anon approve'; checks:=checks+1;
  insert into public.capture_inbox(id,kind,raw_text) values(root||'_material','material','synthetic');
  r:=public.approve_capture(root||'_material','material',jsonb_build_object('styleName','test material','amountKrw',100,
    'billBuyerId',buyer,'billAmountKrw',150,'requestDate','2026-10-01'),'test','test');
  assert (select amount_krw from public.expenses where id=r->>'id')=100
    and (select public.erp_statement_amount(lines) from public.trade_statements where id=r->>'statementId')=165,
    'purchase cost and billing separate'; checks:=checks+1;
  raise notice 'capture_guard checks=% PASS; fixtures rollback; no DELETE',checks;
end $$;
rollback;
