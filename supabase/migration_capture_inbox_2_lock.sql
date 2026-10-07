-- 접수함 2차 — 권한 잠금과 승인 원자화 (코덱스 지적 반영)
--
-- 1) 직원도 서버도 똑같이 role:'anon' 토큰으로 PostgREST 에 붙는다.
--    그 상태로 capture_inbox 에 grant all 을 주면, 직원이 화면을 거치지 않고
--    PostgREST 를 직접 호출해 자기 접수를 approved 로 바꿔버릴 수 있다.
--    서버 전용 역할을 따로 파고, anon 에게서는 쓰기를 거둔다.
--
-- 2) "읽고 → 샘플 만들고 → 상태 바꾸기" 를 서버에서 세 번에 나눠 하면
--    두 사람이 동시에 승인했을 때 샘플이 두 개 생긴다.
--    샘플 생성과 상태 변경을 DB 함수 한 번(=한 트랜잭션)으로 묶는다.

-- ── 서버 전용 역할
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'erp_server') then
    create role erp_server nologin;
  end if;
end $$;

-- anon 이 가진 것을 그대로 물려받는다 (app_users 조회 등). 그 위에 접수함 권한을 더한다
grant anon to erp_server;
grant erp_server to authenticator;

-- 접수함은 서버만 만진다. 직원 토큰(anon)으로는 손댈 수 없다
revoke all on public.capture_inbox from anon;
grant all on public.capture_inbox to erp_server;

-- ── 승인 = 샘플 생성 + 상태 변경, 한 트랜잭션
create or replace function public.approve_capture(
  p_id            text,
  p_kind          text,
  p_payload       jsonb,
  p_reviewer      text,
  p_reviewer_name text
) returns jsonb
language plpgsql
as $$
declare
  v_cap    public.capture_inbox%rowtype;
  v_sid    text;
  v_stage  text;
  v_today  date := current_date;
  v_name   text;
  v_buyer  text;
  v_date   date;
  v_cost   numeric;
begin
  -- 행을 잠그고 읽는다. 동시에 들어온 두 번째 승인은 여기서 기다렸다가 'already' 로 떨어진다
  select * into v_cap from public.capture_inbox where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_cap.status <> 'pending' then
    raise exception 'already:%', v_cap.status;
  end if;

  -- 지금은 샘플만 전표를 만든다
  if p_kind <> 'sample' then
    raise exception 'kind_not_ready:%', p_kind;
  end if;
  -- 화면에서도 막지만, API 를 직접 부르는 경우가 있어 여기서 다시 본다.
  -- 공백만 친 것도 품명이 아니다 (코덱스 지적)
  v_name := btrim(coalesce(p_payload->>'styleName', ''));
  if v_name = '' then
    raise exception 'style_name_required';
  end if;

  v_stage := coalesce(nullif(p_payload->>'stage', ''), '1차');
  if v_stage not in ('1차','2차','3차','4차','최종승인','반려') then
    v_stage := '1차';
  end if;

  -- 아래 셋은 현장에서 대충 들어오는 값이다. 캐스팅이 터져서 승인 자체가 실패하면 안 된다.
  -- 못 읽으면 기본값으로 넘기고, 팀장이 샘플관리에서 고친다 (코덱스 지적)
  begin
    v_date := coalesce((p_payload->>'requestDate')::date, v_today);
  exception when others then
    v_date := v_today;
  end;

  begin
    v_cost := coalesce((p_payload->>'amountKrw')::numeric, 0);
  exception when others then
    v_cost := 0;
  end;

  -- 없는 거래처 id 가 들어오면 FK 가 터진다. 있는 것만 넣는다
  v_buyer := nullif(p_payload->>'buyerId', '');
  if v_buyer is not null and not exists (select 1 from public.vendors where id = v_buyer) then
    v_buyer := null;
  end if;

  v_sid := 'smp_' || to_char(clock_timestamp(), 'YYMMDDHH24MISS') || substr(md5(random()::text), 1, 4);

  insert into public.samples (
    id, style_no, style_name, buyer_id, brand_code, season, stage, color,
    request_date, approved_by, cost_krw, cost_cny, image_urls, billing_status, memo
  ) values (
    v_sid,
    coalesce(p_payload->>'styleNo', ''),
    v_name,
    v_buyer,
    nullif(p_payload->>'brandCode', ''),
    coalesce(p_payload->>'season', ''),
    v_stage,
    nullif(btrim(coalesce(p_payload->>'color', '')), ''),
    v_date,
    case when v_stage = '최종승인' then p_reviewer_name else null end,
    v_cost,
    0,
    -- 현장 사진이 곧 샘플 사진이다. 여기로 옮기고 접수함 쪽은 비운다
    case when v_cap.photo is null then array[]::text[] else array[v_cap.photo] end,
    '미청구',
    nullif(p_payload->>'note', '')
  );

  update public.capture_inbox set
    status           = 'approved',
    kind             = p_kind,
    reviewed_payload = p_payload,
    reviewed_by      = p_reviewer,
    reviewed_by_name = p_reviewer_name,
    reviewed_at      = now(),
    result_ref       = jsonb_build_object('table', 'samples', 'id', v_sid),
    photo            = null,
    updated_at       = now()
  where id = p_id;

  return jsonb_build_object('table', 'samples', 'id', v_sid);
end $$;

revoke all on function public.approve_capture(text, text, jsonb, text, text) from public;
revoke all on function public.approve_capture(text, text, jsonb, text, text) from anon;
grant execute on function public.approve_capture(text, text, jsonb, text, text) to erp_server;
