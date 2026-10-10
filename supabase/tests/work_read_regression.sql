begin;
set local role erp_server;
do $$
declare prefix text:='wc_testfeed'||substr(md5(clock_timestamp()::text),1,16); first_id text; amount int; checks int:=0;
begin
  insert into public.work_cards(id,created_by,raw_text,kind,team,assignee_id,created_at)
    select prefix||lpad(g::text,5,'0'),'test_feed_author','test-work-feed','todo','test_feed_team','test_feed_reader','2026-10-10T01:00:00Z'::timestamptz from generate_series(1,1001) g;
  first_id:=prefix||'00001';
  assert public.mark_work_read('test_feed_reader',array[first_id])=1,'first read';
  assert public.mark_work_read('test_feed_reader',array[first_id])=0,'duplicate read';
  assert public.mark_work_read('test_feed_reader2',array[first_id])=1,'second reader';
  assert (select read_by @> array['test_feed_reader','test_feed_reader2'] from public.work_cards where id=first_id),'reader lost';
  assert (select count(*) from public.work_cards where id like prefix||'%' and not (read_by @> array['test_feed_reader']))=1000,'unread truncated'; checks:=checks+1;
  begin
    insert into public.work_cards(id,created_by,raw_text) values(first_id,'test_feed_author','changed retry');
    raise exception 'duplicate request allowed';
  exception when unique_violation then null; end;
  assert (select raw_text from public.work_cards where id=first_id)='test-work-feed','retry overwrote work'; checks:=checks+1;
  select id into first_id from public.work_cards where id like prefix||'%' order by created_at desc,id desc offset 199 limit 1;
  select count(*) into amount from public.work_cards where id like prefix||'%' and (created_at<'2026-10-10T01:00:00Z' or (created_at='2026-10-10T01:00:00Z' and id<first_id));
  assert amount=801,'timestamp/ID cursor omitted work'; checks:=checks+1;
  insert into public.notifications(id,user_id,title) select prefix||'_ntf'||g,'test_feed_reader','test-work-feed' from generate_series(1,31) g;
  insert into public.notifications(id,user_id,title) values(prefix||'_outside','test_feed_other','test-work-feed');
  update public.notifications set read_at=now() where user_id='test_feed_reader' and id in (select id from public.notifications where user_id='test_feed_reader' and id like prefix||'%' order by id limit 30);
  assert (select count(*) from public.notifications where user_id='test_feed_reader' and id like prefix||'%' and read_at is null)=1,'hidden notification marked read';
  assert (select read_at is null from public.notifications where id=prefix||'_outside'),'other user notification marked'; checks:=checks+1;
  assert not has_function_privilege('anon','public.mark_work_read(text,text[])','EXECUTE'),'anon can mark work'; checks:=checks+1;
  raise notice 'work_read_checks=%',checks;
end $$;
rollback;
