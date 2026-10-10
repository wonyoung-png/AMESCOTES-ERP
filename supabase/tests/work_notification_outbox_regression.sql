-- Isolated schema only; fixtures are never committed into the production DB.
begin;
do $$ begin
 if current_database()<>'erp_e2e' then raise exception 'Disposable erp_e2e database only'; end if;
end $$;
-- Other HTTP fixtures may exist in the same disposable DB. Restore them at rollback.
update app_users set is_active=false;
insert into app_users(id,email,name,role,team,position,is_active,password_hash) values
 ('nt_author','nt-author@test.invalid','동명이인','사원','국내 MD','사원',true,'fixture'),
 ('nt_lead','nt-lead@test.invalid','동명이인','팀장','국내 MD','팀장',true,'fixture'),
 ('nt_marketing','nt-marketing@test.invalid','마케팅','사원','마케팅','사원',true,'fixture'),
 ('nt_inactive','nt-inactive@test.invalid','비활성','사원','마케팅','사원',false,'fixture');
select set_config('request.headers','{"x-work-actor-id":"nt_author"}',true);
insert into work_cards(id,created_by,created_by_name,team,raw_text,kind,assignee_id) values
 ('wc_ntrequest','nt_author','동명이인','국내 MD','check fixture','request_check','nt_lead');
do $$ begin
 if (select count(*) from work_notification_outbox where card_id='wc_ntrequest')<>1 then raise exception 'intent missing'; end if;
 if exists(select 1 from notifications where card_id='wc_ntrequest') then raise exception 'premature delivery'; end if;
end $$;
-- A database delivery failure rolls back notification and settlement together.
create function pg_temp.fail_nt_delivery() returns trigger language plpgsql as $$
 begin raise exception 'forced_delivery_failure'; end $$;
create trigger fixture_nt_failure before insert on notifications for each row execute function pg_temp.fail_nt_delivery();
do $$ begin
 begin perform deliver_work_notifications('wc_ntrequest'); raise exception 'expected forced failure';
 exception when others then if sqlerrm<>'forced_delivery_failure' then raise; end if; end;
 if exists(select 1 from work_notification_outbox where card_id='wc_ntrequest' and delivered_at is not null) then raise exception 'intent lost'; end if;
end $$;
drop trigger fixture_nt_failure on notifications;
select deliver_work_notifications('wc_ntrequest');
update notifications set read_at='2026-10-10T00:00:00Z' where card_id='wc_ntrequest';
select deliver_work_notifications('wc_ntrequest');
do $$ begin
 if (select count(*) from notifications where card_id='wc_ntrequest')<>1 then raise exception 'duplicate'; end if;
 if exists(select 1 from notifications where card_id='wc_ntrequest' and read_at is null) then raise exception 'read reset'; end if;
end $$;
select set_config('request.headers','{"x-work-actor-id":"nt_lead"}',true);
update work_cards set status='done',reply_text='approved fixture',replied_by_name='동명이인',updated_at=clock_timestamp() where id='wc_ntrequest';
select deliver_work_notifications('wc_ntrequest');
do $$ begin
 if not exists(select 1 from notifications where card_id='wc_ntrequest' and user_id='nt_author' and body='approved fixture') then raise exception 'same name reply lost'; end if;
end $$;
insert into work_cards(id,created_by,created_by_name,team,raw_text,kind,assignee_id) values
 ('wc_ntcancel','nt_author','작성자','국내 MD','cancel fixture','request_check','nt_lead');
update work_cards set status='cancelled',updated_at=clock_timestamp() where id='wc_ntcancel';
select deliver_work_notifications('wc_ntcancel');
do $$ begin
 if exists(select 1 from notifications where card_id='wc_ntcancel') then raise exception 'stale cancelled request'; end if;
end $$;
insert into work_cards(id,created_by,created_by_name,team,raw_text,kind,assignee_id) values
 ('wc_ntreassign','nt_author','작성자','국내 MD','routing fixture','request_check','nt_lead');
-- Even unchanged/coarse timestamps cannot collapse separate routing events.
update work_cards set assignee_id='nt_marketing' where id='wc_ntreassign';
update work_cards set assignee_id='nt_lead' where id='wc_ntreassign';
select deliver_work_notifications('wc_ntreassign');
do $$ begin
 if (select count(*) from work_notification_outbox where card_id='wc_ntreassign')<>3 then raise exception 'event key collision'; end if;
 if (select count(*) from notifications where card_id='wc_ntreassign')<>1 then raise exception 'superseded routing duplicate'; end if;
 if not exists(select 1 from notifications where card_id='wc_ntreassign' and user_id='nt_lead') then raise exception 'wrong routing'; end if;
end $$;
select set_config('request.headers','{"x-work-actor-id":"nt_lead"}',true);
insert into work_cards(id,created_by,created_by_name,team,raw_text,kind) values
 ('wc_ntschedule','nt_author','동명이인','국내 MD','draft fixture','schedule');
update work_cards set status='done',done_by_name='동명이인',updated_at=clock_timestamp(),
 confirmed_payload='{"title":"final fixture","startDate":"2026-11-20","endDate":"2026-11-21"}',
 shared_teams=array['국내 MD','마케팅','마케팅'],result_ref='{"table":"campaigns","id":"cmp_fixture"}' where id='wc_ntschedule';
select deliver_work_notifications('wc_ntschedule');
do $$ begin
 if (select count(*) from notifications where card_id='wc_ntschedule')<>2 then raise exception 'recipient dedup or actor exclusion'; end if;
 if not exists(select 1 from notifications where card_id='wc_ntschedule' and user_id='nt_author') then raise exception 'author name incorrectly excluded'; end if;
 if exists(select 1 from notifications where card_id='wc_ntschedule' and user_id in ('nt_lead','nt_inactive')) then raise exception 'excluded recipient'; end if;
 if exists(select 1 from notifications where card_id='wc_ntschedule' and body<>'2026-11-20~2026-11-21 final fixture') then raise exception 'snapshot changed'; end if;
 if has_function_privilege('anon','public.deliver_work_notifications(text)','EXECUTE') then raise exception 'public delivery'; end if;
 if has_table_privilege('anon','public.work_notification_outbox','SELECT') then raise exception 'public outbox'; end if;
 if has_table_privilege('erp_server','public.work_notification_outbox','UPDATE') then raise exception 'server bypass'; end if;
end $$;
insert into app_users(id,email,name,role,team,is_active,password_hash)
values('nt_boss','nt-boss@test.invalid','테스트 대표','대표','대표',true,'fixture');
insert into work_cards(id,created_by,created_by_name,team,raw_text,kind,assignee_id,parsed) values
 ('wc_ntdirective','nt_boss','테스트 대표','마케팅','대표 검수 지시','todo','nt_marketing','{"directive":{"team":"마케팅","notificationVersion":1}}'),
 ('wc_ntlegacy','nt_boss','테스트 대표','마케팅','구버전 지시','todo','nt_marketing','{"directive":{"team":"마케팅"}}'),
 ('wc_ntunassigned','nt_boss','테스트 대표','마케팅','미배정 지시','todo',null,'{"directive":{"team":"마케팅","notificationVersion":1}}');
do $$ begin
 if (select count(*) from work_notification_outbox where card_id='wc_ntdirective' and event_kind='directive')<>1 then raise exception 'directive intent missing'; end if;
 if exists(select 1 from work_notification_outbox where card_id in ('wc_ntlegacy','wc_ntunassigned')) then raise exception 'legacy creation duplicate/unassigned intent'; end if;
 if directive_notification_version()<>1 then raise exception 'readiness missing'; end if;
 if has_function_privilege('anon','public.directive_notification_version()','EXECUTE') then raise exception 'public readiness'; end if;
end $$;
select deliver_work_notifications('wc_ntdirective');
update notifications set read_at='2026-10-10T00:00:00Z' where card_id='wc_ntdirective';
select set_config('request.headers','{"x-work-actor-id":"nt_marketing"}',true);
update work_cards set status='done',done_by_name='마케팅',done_at=clock_timestamp(),reply_text='검수 완료',updated_at=clock_timestamp() where id in ('wc_ntdirective','wc_ntlegacy');
select deliver_work_notifications('wc_ntdirective');
select deliver_work_notifications('wc_ntdirective');
select deliver_work_notifications('wc_ntlegacy');
do $$ begin
 if (select count(*) from notifications where card_id='wc_ntdirective')<>2 then raise exception 'directive delivery duplicated/lost'; end if;
 if not exists(select 1 from notifications where card_id='wc_ntdirective' and user_id='nt_marketing' and read_at is not null) then raise exception 'read state lost'; end if;
 if not exists(select 1 from notifications where card_id='wc_ntdirective' and user_id='nt_boss' and body='검수 완료') then raise exception 'completion result missing'; end if;
 if (select count(*) from notifications where card_id='wc_ntlegacy' and user_id='nt_boss')<>1 then raise exception 'legacy completion missing'; end if;
end $$;
insert into work_cards(id,created_by,created_by_name,team,raw_text,kind,assignee_id,parsed) values
 ('wc_ntcancelorder','nt_boss','테스트 대표','마케팅','취소 지시','todo','nt_marketing','{"directive":{"team":"마케팅","notificationVersion":1}}');
update work_cards set status='cancelled',updated_at=clock_timestamp() where id='wc_ntcancelorder';
select deliver_work_notifications('wc_ntcancelorder');
do $$ begin
 if exists(select 1 from notifications where card_id='wc_ntcancelorder') then raise exception 'cancelled directive sent'; end if;
end $$;
select 'WORK_NOTIFICATION_SQL_REGRESSION_PASS';
rollback;
