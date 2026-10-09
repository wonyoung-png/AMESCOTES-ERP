-- 업무 카드 (work_cards) + 알림 (notifications)
--
-- 직원이 챗봇에 한 줄 쓰면 AI 가 카드로 바꾼다.
--  - 확인 요청  → 팀장에게 알림, 팀장이 답하면 올린 사람에게 알림
--  - 일정·기획전 → 확정하면 운영캘린더(campaigns)에 '예정(draft)'으로 들어가고 관련 팀에 공유
--  - 공유·메모  → 팀 피드에만 남는다
--
-- 카드는 지우지 않는다. 나중에 마스터 에이전트가 "누가 언제 뭘 정했나"를 여기서 읽는다.
--
-- 접수함과 같은 권한 구조: 직원 토큰(anon)으로는 못 만지고 서버(erp_server)만 쓴다.
-- 직원이 PostgREST 를 직접 불러 남의 카드를 확정하거나 알림을 지우지 못하게.

create table if not exists public.work_cards (
  id               text primary key,
  created_by       text,
  created_by_name  text,
  team             text,                 -- 올린 사람의 팀 (올린 시점 사본)
  created_at       timestamptz not null default now(),

  raw_text         text not null,        -- 원문. AI 가 틀려도 이게 근거다
  kind             text not null default 'share',   -- request_check | schedule | share
  parsed           jsonb not null default '{}'::jsonb,
  confirmed_payload jsonb,               -- 확정 때 사람이 고친 값. parsed 는 덮지 않는다

  status           text not null default 'open',    -- open | done
  assignee_id      text,                 -- 답해야 할 사람 (확인 요청이면 팀장)
  assignee_name    text,
  reply_text       text,
  replied_by_name  text,
  replied_at       timestamptz,

  related_id       text,                 -- 같은 건의 앞 카드 (W컨셉 문의 → W컨셉 확정)
  shared_teams     text[] not null default '{}',
  result_ref       jsonb,                -- 확정 후 생긴 레코드 {"table":"campaigns","id":"..."}
  done_by_name     text,
  done_at          timestamptz,
  updated_at       timestamptz not null default now()
);

create index if not exists work_cards_team_idx     on public.work_cards (team, created_at desc);
create index if not exists work_cards_assignee_idx on public.work_cards (assignee_id, status);
create index if not exists work_cards_shared_idx   on public.work_cards using gin (shared_teams);

create table if not exists public.notifications (
  id          text primary key,
  user_id     text not null,
  card_id     text,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

revoke all on public.work_cards    from anon;
revoke all on public.notifications from anon;
grant all on public.work_cards    to erp_server;
grant all on public.notifications to erp_server;

-- ── 일정 카드 확정 = 기획전 생성 + 카드 종결 + 앞 카드 종결, 한 트랜잭션
-- 두 사람이 동시에 확정해도 기획전은 하나만 생긴다 (행 잠금)
create or replace function public.confirm_schedule_card(
  p_id          text,
  p_payload     jsonb,
  p_actor_name  text,
  p_shared      text[]
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
  if v_card.kind <> 'schedule' then raise exception 'not_schedule'; end if;
  if v_card.status <> 'open' then raise exception 'already:%', v_card.status; end if;

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

  -- 같은 건으로 열려 있던 확인 요청은 이걸로 결정된 것이다
  if v_card.related_id is not null then
    update public.work_cards set
      status = 'done',
      reply_text = coalesce(reply_text, '기획전 확정으로 종결: ' || v_title),
      replied_by_name = coalesce(replied_by_name, p_actor_name),
      replied_at = coalesce(replied_at, now()),
      done_by_name = p_actor_name, done_at = now(), updated_at = now()
    -- related_id 는 AI 가 고른 값이다. 같은 팀의 확인 요청만 닫는다 (코덱스 지적)
    where id = v_card.related_id and status = 'open'
      and kind = 'request_check' and team is not distinct from v_card.team;
  end if;

  return jsonb_build_object('table', 'campaigns', 'id', v_cid);
end $$;

revoke all on function public.confirm_schedule_card(text, jsonb, text, text[]) from public;
revoke all on function public.confirm_schedule_card(text, jsonb, text, text[]) from anon;
grant execute on function public.confirm_schedule_card(text, jsonb, text, text[]) to erp_server;
