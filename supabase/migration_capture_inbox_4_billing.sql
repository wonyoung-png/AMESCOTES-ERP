-- 접수함 4차 — 자재 구매 승인 한 번에 전표 2장 (지출결의 + 거래명세표)
--
-- 대표: "자재는 구매하고 바이어 청구를 같이하는데 사입비용하고 청구금액이 다를 때가 있어.
--        두 가지 동시에 해야 하고."
--
-- 산 금액과 청구할 금액은 다르다 (마진을 붙여 청구한다). 그래서 두 금액을 따로 받는다.
-- 청구할 바이어를 고르지 않으면 지금까지처럼 지출결의만 만든다 — 사내 자재는 청구할 곳이 없다.
--
-- 대표가 고른 방식: "승인할 때 명세표가 만들어지고, 추가로 같은 전표에 넣을 수 있게."
--   billStatementId 를 주면 그 명세표에 줄을 더하고, 없으면 새로 만든다.

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
  v_cap     public.capture_inbox%rowtype;
  v_sid     text;
  v_stage   text;
  v_today   date := current_date;
  v_name    text;
  v_buyer   text;
  v_date    date;
  v_cost    numeric;
  v_pay     text;
  v_desc    text;
  -- 바이어 청구
  v_bill_to    text;
  v_bill       numeric;
  v_stmt_id    text;
  v_stmt_no    text;
  v_stmt_new   boolean := false;
  v_vcode      text;
  v_prefix     text;
  v_seq        int;
  v_line       jsonb;
  v_stmt_status text;
  v_memo       text;
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

  -- 아래 둘은 현장에서 대충 들어오는 값이다. 캐스팅이 터져서 승인 자체가 실패하면 안 된다.
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

  -- ───────────────────────────────── 자재 구매 → 지출결의 (+ 바이어 청구)
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

  -- ── 청구할 바이어를 골랐을 때만 거래명세표를 만든다. 사내용 자재는 청구할 곳이 없다
  v_bill_to := nullif(btrim(coalesce(p_payload->>'billBuyerId', '')), '');
  if v_bill_to is not null and not exists (select 1 from public.vendors where id = v_bill_to) then
    -- 없는 거래처면 조용히 넘기지 않는다. 청구가 사라지면 돈을 못 받는다
    raise exception 'bill_buyer_not_found';
  end if;
  -- 청구금액만 적고 바이어를 안 고른 경우 — 그대로 넘기면 청구가 사라진다
  if v_bill_to is null and coalesce(nullif(p_payload->>'billAmountKrw', ''), '') <> '' then
    raise exception 'bill_buyer_required';
  end if;

  if v_bill_to is not null then
    begin
      -- 안 적었으면 산 값 그대로 청구한다 (마진 0)
      v_bill := coalesce(nullif(p_payload->>'billAmountKrw', '')::numeric, v_cost);
    exception when others then
      v_bill := v_cost;
    end;
    if v_bill <= 0 then
      raise exception 'bill_amount_required';
    end if;

    v_line := jsonb_build_object(
      'id', 'tsl_' || substr(md5(random()::text), 1, 8),
      'description', v_desc,
      'qty', 1,
      'unitPrice', v_bill,
      'taxType', '과세',
      'taxRate', 10,
      'memo', '현장 접수'
    );

    v_stmt_id := nullif(btrim(coalesce(p_payload->>'billStatementId', '')), '');

    if v_stmt_id is not null then
      -- ── 기존 명세표에 한 줄 더한다
      -- vendor_id 를 같이 본다. 바이어를 바꿔 고른 뒤 이전 명세표 id 가 남아 있으면
      -- A 바이어 청구가 B 바이어 명세표로 들어간다 (코덱스 지적)
      select statement_no, status into v_stmt_no, v_stmt_status
        from public.trade_statements
       where id = v_stmt_id and vendor_id = v_bill_to for update;
      if not found then
        raise exception 'statement_not_found';
      end if;
      -- 이미 청구·수금이 끝난 전표에 줄을 더하면 금액이 어긋난다. 새로 만들어야 한다
      if v_stmt_status <> '미청구' then
        raise exception 'statement_locked:%', v_stmt_status;
      end if;
      update public.trade_statements
         set lines = coalesce(lines, '[]'::jsonb) || jsonb_build_array(v_line),
             updated_at = now()
       where id = v_stmt_id;
    else
      -- ── 새 명세표. 번호는 YYYYMM-거래처코드-순번
      select coalesce(nullif(btrim(coalesce(code, '')), ''), upper(substr(id, 1, 4)))
        into v_vcode from public.vendors where id = v_bill_to;

      v_prefix := to_char(v_date, 'YYYYMM') || '-' || v_vcode || '-';
      -- 번호를 나눠 쓰는 단위는 바이어가 아니라 이 앞자리다.
      -- 거래처 코드가 같은 바이어가 둘이면 바이어별로 잠가도 같은 번호가 나온다 (코덱스 지적)
      perform pg_advisory_xact_lock(hashtext('ts:' || v_prefix));
      select coalesce(max((substring(statement_no from char_length(v_prefix) + 1))::int), 0)
        into v_seq
        from public.trade_statements
       where statement_no like v_prefix || '%'
         and substring(statement_no from char_length(v_prefix) + 1) ~ '^[0-9]+$';
      v_stmt_no := v_prefix || lpad((v_seq + 1)::text, 3, '0');

      v_stmt_id := 'ts_' || to_char(clock_timestamp(), 'YYMMDDHH24MISS') || substr(md5(random()::text), 1, 4);
      insert into public.trade_statements (
        id, statement_no, vendor_id, vendor_name, vendor_code,
        issue_date, lines, status, memo
      )
      select v_stmt_id, v_stmt_no, v_bill_to, v.name, v_vcode,
             v_date, jsonb_build_array(v_line), '미청구',
             '현장 접수 자재구매 청구'
        from public.vendors v where v.id = v_bill_to;
      v_stmt_new := true;
    end if;
  end if;

  -- ── 지출결의. 청구와 짝이면 명세표 번호를 메모에 남겨 서로 찾을 수 있게 한다
  v_memo := '현장 접수: ' || coalesce(nullif(btrim(v_cap.raw_text), ''), '(글 없음)')
    || ' / 올린 사람 ' || coalesce(v_cap.created_by_name, '?')
    || case when v_stmt_no is null then ''
            else ' / 청구 ' || v_stmt_no || ' ' || to_char(v_bill, 'FM999,999,999') || '원' end;

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
    v_memo
  );

  update public.capture_inbox set
    status = 'approved', kind = p_kind, reviewed_payload = p_payload,
    reviewed_by = p_reviewer, reviewed_by_name = p_reviewer_name, reviewed_at = now(),
    result_ref = jsonb_strip_nulls(jsonb_build_object(
      'table', 'expenses', 'id', v_sid,
      'statement_id', v_stmt_id, 'statement_no', v_stmt_no)),
    -- 영수증 사진은 증빙이다. 지출결의에는 사진 칸이 없어서 접수함에 남겨 둔다
    updated_at = now()
  where id = p_id;

  return jsonb_strip_nulls(jsonb_build_object(
    'table', 'expenses', 'id', v_sid,
    'statementId', v_stmt_id, 'statementNo', v_stmt_no,
    'statementNew', case when v_stmt_id is null then null else v_stmt_new end,
    'billAmountKrw', v_bill));
end $$;

revoke all on function public.approve_capture(text, text, jsonb, text, text) from public;
revoke all on function public.approve_capture(text, text, jsonb, text, text) from anon;
grant execute on function public.approve_capture(text, text, jsonb, text, text) to erp_server;
