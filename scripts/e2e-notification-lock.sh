#!/bin/bash
# Disposable DB only. Proves mutation cannot commit between validity check and insert.
set -euo pipefail
db=erp-e2e-db-20261010
test "$(docker inspect -f '{{index .Config.Labels "codex.e2e"}}' "$db")" = 20261010
sql() { docker exec -i "$db" psql -U postgres -d erp_e2e -X -qAt -v ON_ERROR_STOP=1; }
sql <<'SQL'
insert into work_cards(id,created_by,created_by_name,team,raw_text,kind,assignee_id)
values('wc_ntlock','e2e_staff','fixture','국내 MD','lock fixture','request_check','e2e_leader');
create function public.fixture_pause_notification() returns trigger language plpgsql as $$
begin if new.card_id='wc_ntlock' then perform pg_sleep(4); end if; return new; end $$;
create trigger fixture_pause_notification before insert on notifications for each row execute function public.fixture_pause_notification();
SQL
sql <<'SQL' >/dev/null &
set application_name='fixture_notification_delivery';
select deliver_work_notifications('wc_ntlock');
SQL
delivery_pid=$!
paused=false
for i in $(seq 1 40); do
  if test "$(printf "select count(*) from pg_stat_activity where application_name='fixture_notification_delivery' and wait_event='PgSleep';" | sql)" = 1; then paused=true; break; fi
  sleep 0.1
done
test "$paused" = true
# The cancellation must time out rather than commit while the delivery holds work.
if err=$(sql 2>&1 <<'SQL'
set lock_timeout='150ms';
update work_cards set status='cancelled',updated_at=clock_timestamp() where id='wc_ntlock';
SQL
); then echo 'ERROR: cancellation bypassed delivery lock'; exit 1; fi
case "$err" in *'lock timeout'*) ;; *) echo 'ERROR: unexpected cancellation failure'; exit 1 ;; esac
wait "$delivery_pid"
sql <<'SQL'
update work_cards set status='cancelled',updated_at=clock_timestamp() where id='wc_ntlock';
do $$ begin
if (select count(*) from notifications where card_id='wc_ntlock')<>1 then raise exception 'notification count'; end if;
if (select status from work_cards where id='wc_ntlock')<>'cancelled' then raise exception 'cancellation missing'; end if;
end $$;
drop trigger fixture_pause_notification on notifications;
drop function public.fixture_pause_notification();
SQL
printf 'WORK_NOTIFICATION_CONCURRENT_CANCEL_LOCK_PASS\n'
