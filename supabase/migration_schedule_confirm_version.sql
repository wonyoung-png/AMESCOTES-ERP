-- Apply after migration_work_cards.sql, before deploying the versioned caller.
-- No row/schema changes. Re-runnable; the four-argument entry point fails closed.
begin;

create or replace function public.confirm_schedule_card(
  p_id          text,
  p_payload     jsonb,
  p_actor_name  text,
  p_shared      text[],
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
as $$
declare
  v_card   public.work_cards%rowtype;
  v_cid    text;
  v_title  text;
  v_start  date;
  v_end    date;
  v_rate   numeric;
  v_ws     text;
  v_payload jsonb;
begin
  select * into v_card from public.work_cards where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected_work_version_required';
  end if;
  if v_card.updated_at is distinct from p_expected_updated_at then
    -- Business conflict, not a serialization failure that PostgREST may retry.
    raise exception using errcode = 'PT409', message = 'stale_work_version';
  end if;
  if v_card.kind <> 'schedule' then raise exception 'not_schedule'; end if;
  if v_card.status <> 'open' then raise exception 'already:%', v_card.status; end if;

  -- Existing validation and atomic campaign/card/related-card writes are unchanged.
  v_title := btrim(coalesce(p_payload->>'title', ''));
  if v_title = '' then raise exception 'title_required'; end if;

  begin v_start := (p_payload->>'startDate')::date;
  exception when others then v_start := null; end;
  if v_start is null then raise exception 'start_required'; end if;
  if (p_payload->>'startDate') is distinct from to_char(v_start,'YYYY-MM-DD') then raise exception 'start_required'; end if;

  begin v_end := coalesce(nullif(p_payload->>'endDate','')::date, v_start);
  exception when others then raise exception 'end_invalid'; end;
  if v_end < v_start or (nullif(p_payload->>'endDate','') is not null and p_payload->>'endDate'<>to_char(v_end,'YYYY-MM-DD')) then raise exception 'end_invalid'; end if;

  begin v_rate := nullif(p_payload->>'discountRate', '')::numeric;
  exception when others then raise exception 'discount_invalid'; end;
  if v_rate<0 or v_rate>100 then raise exception 'discount_invalid'; end if;

  v_ws := p_payload->>'workspace';
  if v_ws is null or v_ws not in ('LUMEN','AETALOOF') then raise exception 'workspace_required'; end if;
  if coalesce(p_payload->>'channel','') not in ('자사몰','센텀','29CM','W컨셉','쇼룸','해외') then raise exception 'channel_required'; end if;
  v_payload:=p_payload||jsonb_build_object('title',v_title,'startDate',to_char(v_start,'YYYY-MM-DD'),'endDate',to_char(v_end,'YYYY-MM-DD'),'discountRate',v_rate);
  v_cid := 'cmp_' || to_char(clock_timestamp(), 'YYMMDDHH24MISS') || substr(md5(random()::text), 1, 4);

  insert into public.campaigns (
    id, workspace, title, channel, start_date, end_date, status, discount_rate,
    owner, tasks, product_discounts, category_discounts, created_at, updated_at
  ) values (
    v_cid, v_ws, v_title, coalesce(nullif(btrim(p_payload->>'channel'), ''), '자사몰'),
    v_start, v_end, 'draft', v_rate,
    v_card.created_by_name, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now()
  );

  update public.work_cards set
    status = 'done', confirmed_payload = v_payload, shared_teams = coalesce(p_shared, '{}'),
    result_ref = jsonb_build_object('table', 'campaigns', 'id', v_cid),
    done_by_name = p_actor_name, done_at = now(), updated_at = now()
  where id = p_id;

  if v_card.related_id is not null then
    update public.work_cards set
      status = 'done',
      reply_text = coalesce(reply_text, '기획전 확정으로 종결: ' || v_title),
      replied_by_name = coalesce(replied_by_name, p_actor_name),
      replied_at = coalesce(replied_at, now()),
      done_by_name = p_actor_name, done_at = now(), updated_at = now()
    where id = v_card.related_id and status = 'open'
      and kind = 'request_check' and team is not distinct from v_card.team;
  end if;

  return jsonb_build_object('table', 'campaigns', 'id', v_cid);
end $$;

-- Keeping the signature avoids dependent-object breakage, but even its owner
-- cannot accidentally use it to bypass the mandatory expected version.
create or replace function public.confirm_schedule_card(
  p_id text, p_payload jsonb, p_actor_name text, p_shared text[]
) returns jsonb
language plpgsql
as $$
begin
  raise exception using errcode = '22023', message = 'expected_work_version_required';
end $$;

revoke all on function public.confirm_schedule_card(text, jsonb, text, text[]) from public, anon, erp_server;
revoke all on function public.confirm_schedule_card(text, jsonb, text, text[], timestamptz) from public, anon;
grant execute on function public.confirm_schedule_card(text, jsonb, text, text[], timestamptz) to erp_server;

notify pgrst, 'reload schema';
commit;
