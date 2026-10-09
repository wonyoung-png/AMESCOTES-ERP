-- 접수함 3차 — 자재 구매를 지출결의로
--
-- 샘플과 같은 함수에 종류 하나를 더한다. 승인 한 번에
-- "원본 레코드 생성 + 접수함 상태 변경"이 한 트랜잭션으로 끝나는 구조는 그대로다.
--
-- 지출결의(expenses)는 서버가 정본이다 (syncFromDb.ts의 "지출결의·기획전 — 서버가 정본").
-- 그래서 여기서 넣으면 다음 동기화 때 화면에 나온다.

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
  v_pay    text;
  v_desc   text;
begin
  -- 행을 잠그고 읽는다. 동시에 들어온 두 번째 승인은 여기서 기다렸다가 'already' 로 떨어진다
  select * into v_cap from public.capture_inbox where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_cap.status <> 'pending' then
    raise exception 'already:%', v_cap.status;
  end if;

  if p_kind not in ('sample', 'material') then
    raise exception 'kind_not_ready:%', p_kind;
  end if;

  -- 아래 셋은 현장에서 대충 들어오는 값이다. 캐스팅이 터져서 승인 자체가 실패하면 안 된다.
  -- 못 읽으면 기본값으로 넘기고, 팀장이 해당 화면에서 고친다
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

  -- ───────────────────────────────── 샘플 제작
  if p_kind = 'sample' then
    -- 공백만 친 것도 품명이 아니다
    v_name := btrim(coalesce(p_payload->>'styleName', ''));
    if v_name = '' then
      raise exception 'style_name_required';
    end if;

    v_stage := coalesce(nullif(p_payload->>'stage', ''), '1차');
    if v_stage not in ('1차','2차','3차','4차','최종승인','반려') then
      v_stage := '1차';
    end if;

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
      status = 'approved', kind = p_kind, reviewed_payload = p_payload,
      reviewed_by = p_reviewer, reviewed_by_name = p_reviewer_name, reviewed_at = now(),
      result_ref = jsonb_build_object('table', 'samples', 'id', v_sid),
      photo = null, updated_at = now()
    where id = p_id;

    return jsonb_build_object('table', 'samples', 'id', v_sid);
  end if;

  -- ───────────────────────────────── 자재 구매 → 지출결의
  -- 무엇을 샀는지가 없으면 전표가 아니다
  v_desc := btrim(coalesce(p_payload->>'styleName', ''));
  if v_desc = '' then
    raise exception 'description_required';
  end if;
  -- 금액 없는 지출결의는 의미가 없다. 영수증 사진에서 못 읽었으면 팀장이 넣어야 한다
  if v_cost <= 0 then
    raise exception 'amount_required';
  end if;

  v_pay := coalesce(nullif(p_payload->>'expenseType', ''), '법인카드');
  if v_pay not in ('법인카드','계좌이체','현금') then
    v_pay := '법인카드';
  end if;

  v_sid := 'exp_' || to_char(clock_timestamp(), 'YYMMDDHH24MISS') || substr(md5(random()::text), 1, 4);

  insert into public.expenses (
    id, expense_date, expense_type, category, description, amount_krw, lines,
    vendor_name, has_tax_invoice, memo
  ) values (
    v_sid,
    v_date,
    v_pay,
    '자재구매',
    v_desc,
    v_cost,
    -- 지출결의 화면은 lines 를 읽어 품목을 보여준다. 한 줄짜리로 만든다
    jsonb_build_array(jsonb_build_object(
      'id', 'ln_' || substr(md5(random()::text), 1, 8),
      'description', v_desc,
      'qty', 1,
      'unit', '건',
      'unitPrice', v_cost,
      'amountKrw', v_cost
    )),
    nullif(btrim(coalesce(p_payload->>'vendorName', '')), ''),
    false,
    -- 현장에서 올린 원문을 남긴다. 나중에 왜 이 전표인지 쫓을 수 있어야 한다
    '현장 접수: ' || coalesce(nullif(btrim(v_cap.raw_text), ''), '(글 없음)')
      || ' / 올린 사람 ' || coalesce(v_cap.created_by_name, '?')
  );

  update public.capture_inbox set
    status = 'approved', kind = p_kind, reviewed_payload = p_payload,
    reviewed_by = p_reviewer, reviewed_by_name = p_reviewer_name, reviewed_at = now(),
    result_ref = jsonb_build_object('table', 'expenses', 'id', v_sid),
    -- 영수증 사진은 증빙이다. 지출결의에는 사진 칸이 없어서 접수함에 남겨 둔다
    updated_at = now()
  where id = p_id;

  return jsonb_build_object('table', 'expenses', 'id', v_sid);
end $$;

revoke all on function public.approve_capture(text, text, jsonb, text, text) from public;
revoke all on function public.approve_capture(text, text, jsonb, text, text) from anon;
grant execute on function public.approve_capture(text, text, jsonb, text, text) to erp_server;
