begin;
set local role erp_server;
do $$
declare test_id text:='test_schedule_'||md5(clock_timestamp()::text); payload jsonb;
  result jsonb; checks int:=0; bad jsonb;
begin
  insert into public.work_cards(id,team,created_by_name,raw_text,kind,status,related_id) values
    (test_id||'_same','국내 MD','test','test same','request_check','open',null),
    (test_id||'_other','글로벌 MD','test','test other','request_check','open',null),
    (test_id,'국내 MD','test','test schedule','schedule','open',test_id||'_other');
  payload:='{"title":"workflow-test","workspace":"LUMEN","channel":"W컨셉","startDate":"2026-10-20","discountRate":20}';
  for bad in select value from jsonb_array_elements('[{"startDate":"2026-02-30"},{"endDate":"2026-10-19"},{"workspace":"OEM"},{"workspace":""},{"channel":""},{"discountRate":101},{"discountRate":-1},{"discountRate":"abc"}]') loop
    begin
      perform public.confirm_schedule_card(test_id,payload||bad,'test',array['마케팅','물류·CS']);
      raise exception 'assert_bad_payload';
    exception when others then if sqlerrm='assert_bad_payload' then raise; end if; end;
    assert (select status from public.work_cards where work_cards.id=test_id)='open','invalid input closed card';
    checks:=checks+1;
  end loop;
  result:=public.confirm_schedule_card(test_id,payload,'test',array['마케팅','물류·CS']);
  assert exists(select 1 from public.campaigns where campaigns.id=result->>'id' and workspace='LUMEN' and discount_rate=20 and start_date='2026-10-20' and end_date='2026-10-20'),'calendar payload';
  assert exists(select 1 from public.work_cards where work_cards.id=test_id and status='done' and shared_teams=array['마케팅','물류·CS'] and confirmed_payload->>'endDate'='2026-10-20'),'confirmation/share record';
  assert (select status from public.work_cards where work_cards.id=test_id||'_other')='open','cross-team request closed'; checks:=checks+1;
  begin
    perform public.confirm_schedule_card(test_id,payload,'test',array['마케팅']);
    raise exception 'assert_duplicate_schedule';
  exception when others then if sqlerrm not like 'already:%' then raise; end if; end;
  assert (select count(*) from public.campaigns where campaigns.id=result->>'id')=1,'duplicate calendar'; checks:=checks+1;
  insert into public.work_cards(id,team,created_by_name,raw_text,kind,status,related_id)
    values(test_id||'_second','국내 MD','test','test second','schedule','open',test_id||'_same');
  perform public.confirm_schedule_card(test_id||'_second',payload||'{"workspace":"AETALOOF"}','test',array[]::text[]);
  assert (select status from public.work_cards where work_cards.id=test_id||'_same')='done','same-team related request remains open'; checks:=checks+1;
  assert not has_function_privilege('anon','public.confirm_schedule_card(text,jsonb,text,text[])','EXECUTE'),'anon can confirm';
  assert not has_function_privilege('anon','public.approve_brand_batch(text,text,text)','EXECUTE'),'anon can approve';
  assert not has_function_privilege('anon','public.accept_brand_po(text,date)','EXECUTE'),'anon can accept'; checks:=checks+1;
  raise notice 'schedule_workflow_checks=%',checks;
end $$;
rollback;
