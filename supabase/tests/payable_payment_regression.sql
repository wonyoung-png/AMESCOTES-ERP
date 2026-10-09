begin;
set local role erp_server;
do $$
declare test_id text:='test_payment_'||md5(clock_timestamp()::text); result jsonb; checks int:=0; bad numeric;
begin
  insert into public.payables(id,vendor_name,source_type,amount_krw,paid_amount_krw,status,due_date)
    values(test_id,'workflow-test','manual',1000,0,'pending','2026-11-10');
  result:=public.record_payable_payment(test_id,300,0);
  assert result->>'status'='partial' and (result->>'paid_amount_krw')::numeric=300,'partial payment'; checks:=checks+1;
  begin
    perform public.record_payable_payment(test_id,300,0);
    raise exception 'assert_stale';
  exception when others then if sqlerrm<>'stale_payment' then raise; end if; end;
  assert (select paid_amount_krw from public.payables where id=test_id)=300,'duplicate retry'; checks:=checks+1;
  begin
    perform public.record_payable_payment(test_id,701,300);
    raise exception 'assert_overpayment';
  exception when others then if sqlerrm<>'overpayment' then raise; end if; end;
  assert (select paid_amount_krw from public.payables where id=test_id)=300,'overpayment persisted'; checks:=checks+1;
  foreach bad in array array[0::numeric,-1,null,'NaN','Infinity'] loop
    begin
      perform public.record_payable_payment(test_id,bad,300);
      raise exception 'assert_invalid';
    exception when others then if sqlerrm<>'invalid_payment' then raise; end if; end;
    checks:=checks+1;
  end loop;
  update public.payables set memo='[자금계획|LUMEN|인테리어|예상] test' where id=test_id;
  begin
    perform public.record_payable_payment(test_id,100,300);
    raise exception 'assert_plan';
  exception when others then if sqlerrm<>'planned_only' then raise; end if; end; checks:=checks+1;
  update public.payables set memo='[자금계획|LUMEN|인테리어|확정] test' where id=test_id;
  result:=public.record_payable_payment(test_id,700,300);
  assert result->>'status'='paid' and (result->>'paid_amount_krw')::numeric=1000,'full payment'; checks:=checks+1;
  assert not has_function_privilege('anon','public.record_payable_payment(text,numeric,numeric)','EXECUTE'),'anon payment allowed'; checks:=checks+1;
  raise notice 'payable_payment_checks=%',checks;
end $$;
rollback;
