-- 운영 DB에서도 합성 자료만 쓰고 전부 롤백한다. 실제 승인·전송을 실행하지 않는다.
begin;
set local role erp_server;
do $$
declare b text:='test_brand_'||md5(clock_timestamp()::text); a text:=b||'_aeta'; factory text:=b||'_factory';
  po text; direct_po text; result jsonb; first_result jsonb; stmt jsonb; checks int:=0;
begin
  insert into public.vendors(id,name,type) values(factory,'workflow-test','공장');
  insert into public.brand_order_batches(id,workspace,project_no,title,status)
    values(b,'LUMEN',b,'workflow-test','draft'),(a,'AETALOOF',a,'workflow-test-aeta','draft');
  insert into public.brand_order_lines(id,batch_id,style_no,style_name,factory_id,factory_name,qty,color_qtys,route) values
    (b||'_1',b,b||'_sku1','test1',factory,'workflow-test',50,'[{"color":"BLACK","qty":50}]','oem'),
    (b||'_2',b,b||'_sku2','test2',factory,'workflow-test',30,'[{"color":"BLACK","qty":30}]','oem'),
    (b||'_3',b,b||'_pkg','package',factory,'workflow-test',100,'[{"color":"BLACK","qty":100}]','direct'),
    (a||'_1',a,a||'_sku','test-aeta',factory,'workflow-test',20,'[{"color":"BLACK","qty":20}]','oem');
  begin
    perform public.issue_brand_batch(b);
    raise exception 'assert_unapproved_issue';
  exception when others then if sqlerrm<>'not_approved' then raise; end if; end;
  checks:=checks+1;
  perform public.approve_brand_batch(b,'test-actor','test-actor');
  perform public.approve_brand_batch(b,'test-actor','test-actor');
  assert (select count(*) from public.approval_logs where batch_id=b)=1,'duplicate approval'; checks:=checks+1;
  first_result:=public.issue_brand_batch(b);
  result:=public.issue_brand_batch(b);
  assert result=first_result and jsonb_array_length(result)=2,'factory route split/retry'; checks:=checks+1;
  perform public.cancel_brand_issue(b);
  perform public.cancel_brand_issue(b);
  assert (select status from public.brand_order_batches where id=b)='draft','cancel state';
  assert not exists(select 1 from public.brand_order_lines where batch_id=b and (po_no is not null or issued_at is not null)),'cancelled PO remains'; checks:=checks+1;
  begin
    perform public.issue_brand_batch(b);
    raise exception 'assert_reapproval_required';
  exception when others then if sqlerrm<>'not_approved' then raise; end if; end;
  perform public.approve_brand_batch(b,'test-actor','test-actor');
  result:=public.issue_brand_batch(b);
  assert result=first_result,'reissue changed PO'; checks:=checks+1;
  select po_no into po from public.brand_order_lines where id=b||'_1';
  select po_no into direct_po from public.brand_order_lines where id=b||'_3';
  begin
    perform public.accept_brand_po(direct_po,'2026-11-20');
    raise exception 'assert_direct_accept';
  exception when others then if sqlerrm<>'invalid_status' then raise; end if; end;
  checks:=checks+1;
  result:=public.accept_brand_po(po,'2026-11-20');
  assert (result->>'count')::int=2 and (result->>'already')::boolean=false,'accept count';
  assert (select count(*) from public.production_orders where po_batch_no=po and workspace='OEM' and brand_batch_id=b and project_no=b)=2,'origin links';
  assert (select expected_dely from public.brand_order_batches where id=b)='2026-11-20'::date,'brand due'; checks:=checks+1;
  result:=public.accept_brand_po(po,'2026-11-21');
  assert (result->>'already')::boolean=true and (select count(*) from public.production_orders where po_batch_no=po)=2,'accept retry';
  assert (select min(delivery_date) from public.production_orders where po_batch_no=po)='2026-11-20'::date,'retry must not alter due'; checks:=checks+1;
  begin
    perform public.cancel_brand_issue(b);
    raise exception 'assert_accepted_cancel';
  exception when others then if sqlerrm not in ('invalid_status','already_accepted') then raise; end if; end;
  assert (select count(*) from public.production_orders where brand_batch_id=b)=2,'cancel removed production'; checks:=checks+1;
  assert not exists(select 1 from public.production_orders where brand_batch_id=a),'brand isolation'; checks:=checks+1;
  -- 입력 오류로 승인이 실패하면 승인 이력·상태는 남지 않는다.
  update public.brand_order_lines set qty=21 where id=a||'_1';
  begin
    perform public.approve_brand_batch(a,'test-actor','test-actor');
    raise exception 'assert_invalid_quantity';
  exception when others then if sqlerrm<>'invalid_lines' then raise; end if; end;
  assert not exists(select 1 from public.approval_logs where batch_id=a),'failed approval persisted';
  assert (select status from public.brand_order_batches where id=a)='draft','failed status'; checks:=checks+1;
  update public.brand_order_lines set qty=20 where id=a||'_1';
  perform public.approve_brand_batch(a,'test-actor','test-actor');
  perform public.issue_brand_batch(a);
  select po_no into po from public.brand_order_lines where id=a||'_1';
  -- 2번째 품번의 외래키 오류가 1번째 생산발주까지 롤백하는지 확인한다.
  insert into public.brand_order_lines(id,batch_id,style_no,factory_id,qty,color_qtys,route,po_no)
    values(a||'_2',a,a||'_zzz','test-missing-factory',10,'[{"color":"BLACK","qty":10}]','oem',po);
  begin
    perform public.accept_brand_po(po,'2026-11-25');
    raise exception 'assert_missing_factory';
  exception when foreign_key_violation then null; end;
  assert not exists(select 1 from public.production_orders where brand_batch_id=a),'partial production persisted';
  assert not exists(select 1 from public.brand_order_lines where batch_id=a and accepted_at is not null),'partial acceptance persisted'; checks:=checks+1;
  -- 잘못된 공장 참조를 고친 뒤 정상 재시도할 수 있다.
  update public.brand_order_lines set factory_id=factory where id=a||'_2';
  result:=public.accept_brand_po(po,'2026-11-25');
  assert (result->>'count')::int=2,'retry after rollback'; checks:=checks+1;
  raise notice 'brand_workflow_checks=%',checks;
end $$;
rollback;
