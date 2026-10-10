-- Forward only: no historical backfill, no changes to work/notification rows.
begin;
create table if not exists public.work_notification_outbox (
  id text primary key default ('ntf_' || replace(gen_random_uuid()::text,'-','')),
  event_no bigint generated always as identity unique,
  event_kind text not null,
  card_id text not null,
  user_id text not null,
  title text not null,
  body text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  suppressed_reason text
);
create index if not exists work_notification_pending_idx
  on public.work_notification_outbox (created_at, id) where delivered_at is null;
alter table public.work_notification_outbox enable row level security;
revoke all on public.work_notification_outbox from public, anon, erp_server;

-- Intent is committed with the work mutation, even if the application stops
-- before attempting delivery. Only the server role can mutate work_cards.
create or replace function public.queue_work_notifications() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_event text;
  v_actor text;
  v_title text;
  v_body text;
begin
  -- Subscription checks have a separate existing lifecycle; do not double send.
  if coalesce((new.parsed->>'subscriptionCheck') = 'true', false) then return new; end if;
  v_actor := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb->>'x-work-actor-id';
  if new.kind = 'request_check' and new.status = 'open' and new.assignee_id is not null then
    if tg_op = 'INSERT' then v_event := 'request';
    elsif old.kind is distinct from new.kind or old.status is distinct from new.status
      or old.assignee_id is distinct from new.assignee_id then v_event := 'request'; end if;
    if v_event is not null then
      insert into public.work_notification_outbox (event_kind, card_id, user_id, title, body)
      select v_event, new.id, u.id, coalesce(new.created_by_name,'직원') || ' — 확인 요청', new.raw_text
      from public.app_users u where u.id = new.assignee_id and u.is_active = true
      on conflict (id) do nothing;
    end if;
  end if;
  if tg_op <> 'UPDATE' or old.status <> 'open' or new.status <> 'done' then return new; end if;
  if new.kind = 'request_check' and new.reply_text is not null then
    insert into public.work_notification_outbox (event_kind, card_id, user_id, title, body)
    select 'reply', new.id, u.id, coalesce(new.replied_by_name,'담당자') || ' — 답변', new.reply_text
    from public.app_users u where u.id = new.created_by and u.is_active = true
      and u.id is distinct from v_actor
    on conflict (id) do nothing;
  elsif new.kind = 'schedule' and new.confirmed_payload is not null
    and new.result_ref->>'table' = 'campaigns' then
    v_title := coalesce(new.confirmed_payload->>'title',new.raw_text);
    v_body := coalesce(new.confirmed_payload->>'startDate','') ||
      case when coalesce(new.confirmed_payload->>'endDate','') not in ('',new.confirmed_payload->>'startDate')
        then '~' || (new.confirmed_payload->>'endDate') else '' end || ' ' || v_title;
    insert into public.work_notification_outbox (event_kind, card_id, user_id, title, body)
    select 'confirm', new.id, u.id,
      case when u.id = new.created_by then coalesce(new.done_by_name,'담당자') || ' — 캘린더 등록'
        else '[' || coalesce(nullif(new.team,''),'팀') || '] 일정 공유' end, v_body
    from public.app_users u where u.is_active = true and u.id is distinct from v_actor
      and (u.team = any(new.shared_teams) or u.id = new.created_by)
    on conflict (id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.queue_work_notifications() from public, anon, erp_server;
-- Re-runnable without ever dropping a table or deleting a row.
create or replace trigger work_notification_intent
  after insert or update on public.work_cards
  for each row execute function public.queue_work_notifications();

create or replace function public.deliver_work_notifications(p_card_id text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_row public.work_notification_outbox%rowtype;
  v_candidate public.work_notification_outbox%rowtype;
  v_count integer := 0;
begin
  for v_candidate in select * from public.work_notification_outbox
    where delivered_at is null and (p_card_id is null or card_id = p_card_id)
    order by created_at,id limit 200
  loop
    -- Always lock work before outbox, matching the mutation trigger. SKIP LOCKED
    -- prevents workers waiting on each other or a multi-card confirmation.
    perform 1 from public.work_cards where id=v_candidate.card_id for update skip locked;
    if not found then continue; end if;
    select * into v_row from public.work_notification_outbox where id=v_candidate.id
      and delivered_at is null for update skip locked;
    if not found then continue; end if;
    -- Requests superseded by cancellation/decision/reassignment must not arrive
    -- as a new outstanding request. Inactive recipients also remain unactionable.
    if not exists (select 1 from public.app_users where id=v_row.user_id and is_active=true)
      or (v_row.event_kind='request' and (
        not exists (select 1 from public.work_cards where id=v_row.card_id
          and kind='request_check' and status='open' and assignee_id=v_row.user_id)
        or exists (select 1 from public.work_notification_outbox where card_id=v_row.card_id
          and event_kind='request' and event_no>v_row.event_no))) then
      update public.work_notification_outbox set delivered_at=clock_timestamp(),
        suppressed_reason='superseded_or_inactive' where id=v_row.id;
      continue;
    end if;
    -- The same event's delivery id never changes. Never upsert read_at/body.
    insert into public.notifications (id,user_id,card_id,title,body,link)
      values (v_row.id,v_row.user_id,v_row.card_id,v_row.title,v_row.body,'/work')
      on conflict (id) do nothing;
    update public.work_notification_outbox set delivered_at = clock_timestamp() where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('delivered',v_count,'pending',exists(
    select 1 from public.work_notification_outbox where delivered_at is null
      and (p_card_id is null or card_id = p_card_id)));
end $$;
revoke all on function public.deliver_work_notifications(text) from public, anon;
grant execute on function public.deliver_work_notifications(text) to erp_server;
notify pgrst, 'reload schema';
commit;
