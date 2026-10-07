-- 접수함 5차 — 메인 납품
--
-- 대표: "메인생산후 납품한것들도 바로 입력되게 할수있나?"
--
-- 승인 한 번에 세 가지가 끝난다:
--   1. 출고 기록 (receipt_logs, log_type = 'outbound_oem')
--   2. 발주의 출고수량 누적 (production_orders.shipped_qty)
--   3. 거래명세표 — 납품은 곧 청구다. 수량 × 단가로 한 줄
--
-- 청구 부분이 자재구매와 똑같아서 따로 함수로 뺐다. 두 군데에 같은 코드를 두면
-- 한쪽만 고치는 일이 생긴다 (바이어 확인·번호 잠금 같은 건 이미 그렇게 한 번 틀렸다).

-- ─────────────────────────────────────────────────────────────
-- 거래명세표에 한 줄 올린다. 없으면 새로 만들고, 주면 그 명세표에 더한다.
-- 반환: {id, no, isNew}
create or replace function public.erp_statement_add_line(
  p_buyer       text,
  p_statement_id text,
  p_line        jsonb,
  p_date        date
) returns jsonb
language plpgsql
as $$
declare
  v_id     text := nullif(btrim(coalesce(p_statement_id, '')), '');
  v_no     text;
  v_status text;
  v_vcode  text;
  v_prefix text;
  v_seq    int;
begin
  if p_buyer is null then
    raise exception 'bill_buyer_required';
  end if;
  if not exists (select 1 from public.vendors where id = p_buyer) then
    raise exception 'bill_buyer_not_found';
  end if;

  if v_id is not null then
    -- vendor_id 를 같이 본다. 바이어를 바꿔 고른 뒤 이전 명세표 id 가 남아 있으면
    -- A 바이어 청구가 B 바이어 명세표로 들어간다
    select statement_no, status into v_no, v_status
      from public.trade_statements
     where id = v_id and vendor_id = p_buyer for update;
    if not found then
      raise exception 'statement_not_found';
    end if;
    -- 이미 청구·수금이 끝난 전표에 줄을 더하면 이미 보낸 금액과 어긋난다
    if v_status <> '미청구' then
      raise exception 'statement_locked:%', v_status;
    end if;
    update public.trade_statements
       set lines = coalesce(lines, '[]'::jsonb) || jsonb_build_array(p_line),
           updated_at = now()
     where id = v_id;
    return jsonb_build_object('id', v_id, 'no', v_no, 'isNew', false);
  end if;

  -- 새 명세표. 번호는 YYYYMM-거래처코드-순번
  select coalesce(nullif(btrim(coalesce(code, '')), ''), upper(substr(id, 1, 4)))
    into v_vcode from public.vendors where id = p_buyer;

  v_prefix := to_char(p_date, 'YYYYMM') || '-' || v_vcode || '-';
  -- 번호를 나눠 쓰는 단위는 바이어가 아니라 이 앞자리다.
  -- 거래처 코드가 같은 바이어가 둘이면 바이어별로 잠가도 같은 번호가 나온다
  perform pg_advisory_xact_lock(hashtext('ts:' || v_prefix));

  select coalesce(max((substring(statement_no from char_length(v_prefix) + 1))::int), 0)
    into v_seq
    from public.trade_statements
   where statement_no like v_prefix || '%'
     and substring(statement_no from char_length(v_prefix) + 1) ~ '^[0-9]+$';
  v_no := v_prefix || lpad((v_seq + 1)::text, 3, '0');

  v_id := 'ts_' || to_char(clock_timestamp(), 'YYMMDDHH24MISS') || substr(md5(random()::text), 1, 4);
  insert into public.trade_statements (
    id, statement_no, vendor_id, vendor_name, vendor_code, issue_date, lines, status, memo
  )
  select v_id, v_no, p_buyer, v.name, v_vcode, p_date,
         jsonb_build_array(p_line), '미청구', '현장 접수'
    from public.vendors v where v.id = p_buyer;

  return jsonb_build_object('id', v_id, 'no', v_no, 'isNew', true);
end $$;

revoke all on function public.erp_statement_add_line(text, text, jsonb, date) from public;
revoke all on function public.erp_statement_add_line(text, text, jsonb, date) from anon;

-- ─────────────────────────────────────────────────────────────
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
  v_bill_to text;
  v_bill    numeric;
  v_stmt    jsonb;
  v_line    jsonb;
  v_memo    text;
  -- 메인 납품
  v_ord     public.production_orders%rowtype;
  v_qty     int;
  v_defect  int;
  v_unit    numeric;
  v_color   text;
begin
  -- 행을 잠그고 읽는다. 동시에 들어온 두 번째 승인은 여기서 기다렸다가 'already' 로 떨어진다
  select * into v_cap from public.capture_inbox where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_cap.status <> 'pending' then
    raise exception 'already:%', v_cap.status;
  end if;

  if p_kind not in ('sample', 'material', 'delivery') then
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

  -- 청구할 곳 — 세 종류가 같이 쓴다
  v_bill_to := nullif(btrim(coalesce(p_payload->>'billBuyerId', '')), '');

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

  -- ───────────────────────────────── 메인 납품 → 출고 기록 + 발주 출고수량 + 청구
  if p_kind = 'delivery' then
    -- 어느 발주의 납품인지가 없으면 출고 기록을 걸 곳이 없다
    select * into v_ord from public.production_orders
     where id = nullif(btrim(coalesce(p_payload->>'orderId', '')), '') for update;
    if not found then
      raise exception 'order_required';
    end if;

    begin
      v_qty := coalesce((p_payload->>'qty')::int, 0);
    exception when others then
      v_qty := 0;
    end;
    if v_qty <= 0 then
      raise exception 'qty_required';
    end if;

    begin
      v_defect := greatest(coalesce((p_payload->>'defectQty')::int, 0), 0);
    exception when others then
      v_defect := 0;
    end;

    v_color := nullif(btrim(coalesce(p_payload->>'color', '')), '');

    v_sid := 'rcp_' || to_char(clock_timestamp(), 'YYMMDDHH24MISS') || substr(md5(random()::text), 1, 4);
    insert into public.receipt_logs (
      id, order_id, order_no, project_no, log_type, qty, defect_qty, defect_note,
      received_date, color, delivery_market, memo
    ) values (
      v_sid, v_ord.id, v_ord.order_no, v_ord.project_no, 'outbound_oem', v_qty, v_defect,
      nullif(btrim(coalesce(p_payload->>'defectNote', '')), ''),
      v_date, v_color, 'b2b',
      '현장 접수: ' || coalesce(nullif(btrim(v_cap.raw_text), ''), '(글 없음)')
        || ' / 올린 사람 ' || coalesce(v_cap.created_by_name, '?')
    );

    -- 발주의 출고수량을 누적한다. 발주 화면에서 "얼마나 나갔나"를 이걸로 본다
    update public.production_orders
       set shipped_qty = coalesce(shipped_qty, 0) + v_qty, updated_at = now()
     where id = v_ord.id;

    -- 청구 — 납품은 곧 청구다. 안 고르면 발주의 바이어로 한다
    v_bill_to := coalesce(v_bill_to, nullif(v_ord.buyer_id, ''));
    -- "청구 안 함" 을 고르면 payload 에 빈 값이 오고 발주 바이어로 되돌아가면 안 된다
    if coalesce(p_payload->>'noBill', 'false') = 'true' then
      v_bill_to := null;
    -- 발주에 바이어가 없고 고르지도 않았는데 그냥 넘어가면 출고만 되고 청구가 조용히 빠진다.
    -- 안 할 거면 "청구 안 함" 을 눌러서 안 한다고 말해야 한다 (코덱스 지적)
    elsif v_bill_to is null then
      raise exception 'bill_buyer_required';
    end if;

    if v_bill_to is not null then
      -- 바이어에게 청구할 단가는 '납품가'(items.delivery_price)다.
      -- production_orders.unit_price 는 공장에 주는 단가라서, 그걸로 청구하면 원가로 파는 셈이 된다.
      select i.delivery_price into v_unit from public.items i
       where i.id = nullif(v_ord.style_id, '')
       limit 1;
      if v_unit is null then
        -- 같은 품번 품목이 둘 이상이고 납품가가 서로 다르면 아무 걸 집어선 안 된다.
        -- 어느 쪽으로 청구할지는 사람이 정해야 한다 (코덱스 지적)
        select max(i.delivery_price) into v_unit from public.items i
         where i.style_no = v_ord.style_no
        having count(distinct i.delivery_price) = 1;
      end if;
      begin
        -- 팀장이 적었으면 그 값이 우선이다
        v_unit := coalesce(nullif(p_payload->>'billUnitPrice', '')::numeric, v_unit, 0);
      exception when others then
        v_unit := coalesce(v_unit, 0);
      end;
      -- 납품가가 품목에 없으면 팀장이 넣어야 한다. 공장 단가로 대신 청구하지 않는다
      if v_unit <= 0 then
        raise exception 'bill_amount_required';
      end if;
      v_bill := v_unit * v_qty;

      v_line := jsonb_build_object(
        'id', 'tsl_' || substr(md5(random()::text), 1, 8),
        'description', btrim(coalesce(v_ord.style_no, '') || ' ' || coalesce(v_ord.style_name, ''))
          || case when v_color is null then '' else ' / ' || v_color end,
        'qty', v_qty,
        'unitPrice', v_unit,
        'taxType', '과세',
        'taxRate', 10,
        'memo', '현장 접수 납품 ' || coalesce(v_ord.order_no, '')
      );
      v_stmt := public.erp_statement_add_line(
        v_bill_to, p_payload->>'billStatementId', v_line, v_date);
    end if;

    update public.capture_inbox set
      status = 'approved', kind = p_kind, reviewed_payload = p_payload,
      reviewed_by = p_reviewer, reviewed_by_name = p_reviewer_name, reviewed_at = now(),
      result_ref = jsonb_strip_nulls(jsonb_build_object(
        'table', 'receipt_logs', 'id', v_sid,
        'order_no', v_ord.order_no,
        'statement_id', v_stmt->>'id', 'statement_no', v_stmt->>'no')),
      updated_at = now()
    where id = p_id;

    return jsonb_strip_nulls(jsonb_build_object(
      'table', 'receipt_logs', 'id', v_sid,
      'orderNo', v_ord.order_no, 'qty', v_qty,
      'statementId', v_stmt->>'id', 'statementNo', v_stmt->>'no',
      'statementNew', case when v_stmt is null then null else (v_stmt->>'isNew')::boolean end,
      'billAmountKrw', v_bill));
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
    v_stmt := public.erp_statement_add_line(
      v_bill_to, p_payload->>'billStatementId', v_line, v_date);
  end if;

  -- ── 지출결의. 청구와 짝이면 명세표 번호를 메모에 남겨 서로 찾을 수 있게 한다
  v_memo := '현장 접수: ' || coalesce(nullif(btrim(v_cap.raw_text), ''), '(글 없음)')
    || ' / 올린 사람 ' || coalesce(v_cap.created_by_name, '?')
    || case when v_stmt is null then ''
            else ' / 청구 ' || (v_stmt->>'no') || ' ' || to_char(v_bill, 'FM999,999,999') || '원' end;

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
      'statement_id', v_stmt->>'id', 'statement_no', v_stmt->>'no')),
    -- 영수증 사진은 증빙이다. 지출결의에는 사진 칸이 없어서 접수함에 남겨 둔다
    updated_at = now()
  where id = p_id;

  return jsonb_strip_nulls(jsonb_build_object(
    'table', 'expenses', 'id', v_sid,
    'statementId', v_stmt->>'id', 'statementNo', v_stmt->>'no',
    'statementNew', case when v_stmt is null then null else (v_stmt->>'isNew')::boolean end,
    'billAmountKrw', v_bill));
end $$;

revoke all on function public.approve_capture(text, text, jsonb, text, text) from public;
revoke all on function public.approve_capture(text, text, jsonb, text, text) from anon;
grant execute on function public.approve_capture(text, text, jsonb, text, text) to erp_server;
grant execute on function public.erp_statement_add_line(text, text, jsonb, date) to erp_server;
