-- 기존 접수 승인 함수의 확인된 구간만 보완한다. 예상과 다른 정의는 덮지 않는다.
begin;
do $patch$
declare definition text; anchor text; replacement text; p integer; target text;
begin
  definition:=pg_get_functiondef('public.erp_statement_add_line(text,text,jsonb,date)'::regprocedure);
  if position('v_seq    int;' in definition)>0 then
    foreach target in array array['v_seq    int;','::int), 0)',
      'lpad((v_seq + 1)::text, 3, ''0'')',E'  if p_buyer is null then',
      E'    select statement_no, status into v_no, v_status',
      'where statement_no like v_prefix || ''%''',E'    update public.trade_statements\n'] loop
      p:=position(target in definition);
      if p=0 or position(target in substring(definition from p+length(target)))>0 then
        raise exception 'capture_helper_patch_conflict'; end if;
    end loop;
    definition:=replace(definition,'v_seq    int;','v_seq    bigint;');
    definition:=replace(definition,'::int), 0)','::bigint), 0)');
    definition:=replace(definition,'lpad((v_seq + 1)::text, 3, ''0'')',
      'case when v_seq+1<1000 then lpad((v_seq+1)::text,3,''0'') else (v_seq+1)::text end');
    anchor:=E'  if p_buyer is null then';
    if position(anchor in definition)=0 then raise exception 'capture_helper_patch_conflict'; end if;
    definition:=replace(definition,anchor,E'  -- 접수의 옛 10(퍼센트) 표기는 신규 줄에 한해 비율로 변환한다.\n'
      ||E'  if p_line->>''taxRate''=''10'' then p_line:=jsonb_set(p_line,''{taxRate}'',''0.1''::jsonb); end if;\n'
      ||E'  perform public.erp_statement_amount(jsonb_build_array(p_line));\n'||anchor);
    anchor:=E'    select statement_no, status into v_no, v_status';
    if position(anchor in definition)=0 then raise exception 'capture_helper_patch_conflict'; end if;
    definition:=replace(definition,anchor,E'    perform pg_advisory_xact_lock(hashtextextended(''statement:''||v_id,0));\n'||anchor);
    definition:=replace(definition,'where statement_no like v_prefix || ''%''',
      'where left(statement_no,length(v_prefix))=v_prefix');
    definition:=replace(definition,E'    update public.trade_statements\n',
      E'    if (select jsonb_array_length(coalesce(lines,''[]''::jsonb)) from public.trade_statements where id=v_id)>=500 then raise exception ''invalid_statement''; end if;\n    update public.trade_statements\n');
    execute definition;
  end if;
  foreach target in array array['v_seq    bigint;','::bigint), 0)',
    'case when v_seq+1<1000 then','perform public.erp_statement_amount',
    'hashtextextended(''statement:''||v_id,0)','>=500 then raise exception',
    'where left(statement_no,length(v_prefix))=v_prefix'] loop
    if position(target in definition)=0 then raise exception 'capture_helper_patch_conflict'; end if;
  end loop;

  definition:=pg_get_functiondef('public.approve_capture(text,text,jsonb,text,text)'::regprocedure);
  if position('v_shipped bigint;' in definition)=0 then
    foreach target in array array['  v_qty     int;','v_today   date := current_date;',
      E'    v_color := nullif(btrim(coalesce(p_payload->>''color'', '''')), '''');',
      'shipped_qty = coalesce(shipped_qty, 0) + v_qty',
      E'      v_stmt := public.erp_statement_add_line(\n        v_bill_to, p_payload->>''billStatementId'', v_line, v_date);'] loop
      p:=position(target in definition);
      if p=0 or position(target in substring(definition from p+length(target)))>0 then
        raise exception 'capture_approval_patch_conflict'; end if;
    end loop;
    anchor:='  v_qty     int;';
    if position(anchor in definition)=0 or
      (length(definition)-length(replace(definition,'''taxRate'', 10','')))/length('''taxRate'', 10')<>2 then
      raise exception 'capture_approval_patch_conflict'; end if;
    definition:=replace(definition,anchor,E'  v_shipped bigint;\n'||anchor);
    definition:=replace(definition,'v_today   date := current_date;',
      'v_today   date := (current_timestamp at time zone ''Asia/Seoul'')::date;');
    definition:=replace(definition,'''taxRate'', 10','''taxRate'', 0.1');
    anchor:=E'    v_color := nullif(btrim(coalesce(p_payload->>''color'', '''')), '''');';
    replacement:=$guard$    if coalesce(v_ord.status,'') not in ('발주생성','생산중','생산완료','입고완료') then
      raise exception 'invalid_order_status'; end if;
    if (p_payload->>'qty')::numeric<>v_qty or v_defect>v_qty then raise exception 'qty_required'; end if;
    select greatest(coalesce(v_ord.shipped_qty,0),coalesce(sum(qty),0)) into v_shipped
      from public.receipt_logs where order_id=v_ord.id and log_type in ('outbound_oem','outbound_3pl');
    if coalesce(v_ord.quantity,0)<=0 or v_shipped+v_qty>v_ord.quantity then raise exception 'over_shipment'; end if;
$guard$||anchor;
    if position(anchor in definition)=0 then raise exception 'capture_approval_patch_conflict'; end if;
    definition:=replace(definition,anchor,replacement);
    anchor:='shipped_qty = coalesce(shipped_qty, 0) + v_qty';
    if position(anchor in definition)=0 then raise exception 'capture_approval_patch_conflict'; end if;
    definition:=replace(definition,anchor,'shipped_qty = v_shipped + v_qty');
    -- 첫 납품 명세표를 발주에 연결해 다른 출고 화면의 전량 자동 초안과 중복되지 않게 한다.
    anchor:=E'      v_stmt := public.erp_statement_add_line(\n        v_bill_to, p_payload->>''billStatementId'', v_line, v_date);';
    p:=position(anchor in definition);
    if p=0 then raise exception 'capture_approval_patch_conflict'; end if;
    replacement:=$context$      p_payload:=jsonb_set(p_payload,'{billStatementId}',coalesce(to_jsonb(nullif(btrim(p_payload->>'billStatementId'),'')),'null'::jsonb));
      if nullif(p_payload->>'billStatementId','') is not null then
        if v_ord.trade_statement_id is not null and v_ord.trade_statement_id<>p_payload->>'billStatementId' then
          raise exception 'statement_link_conflict'; end if;
        perform pg_advisory_xact_lock(hashtextextended('statement:'||(p_payload->>'billStatementId'),0));
        perform 1 from public.trade_statements where id=p_payload->>'billStatementId' for update;
        if exists(select 1 from public.trade_statements where id=p_payload->>'billStatementId'
          and (project_no is distinct from v_ord.project_no
            or coalesce(workspace,'OEM') is distinct from coalesce(v_ord.workspace,'OEM'))) then
          raise exception 'statement_link_conflict'; end if;
      end if;
$context$||anchor||$link$
      if (v_stmt->>'isNew')::boolean then
        update public.trade_statements set project_no=v_ord.project_no,workspace=coalesce(v_ord.workspace,'OEM')
          where id=v_stmt->>'id';
      end if;
      update public.production_orders set trade_statement_id=v_stmt->>'id'
        where id=v_ord.id and trade_statement_id is null;
$link$;
    definition:=overlay(definition placing replacement from p for length(anchor));
    execute definition;
  end if;
  foreach target in array array['v_shipped bigint;','v_shipped+v_qty>v_ord.quantity',
    'shipped_qty = v_shipped + v_qty','trade_statement_id=v_stmt->>''id''',
    'project_no is distinct from v_ord.project_no','coalesce(workspace,''OEM'') is distinct',
    'nullif(btrim(p_payload->>''billStatementId''),'''')',
    'current_timestamp at time zone ''Asia/Seoul''','''taxRate'', 0.1'] loop
    if position(target in definition)=0 then raise exception 'capture_approval_patch_conflict'; end if;
  end loop;
  if position('''taxRate'', 10' in definition)>0 then raise exception 'capture_approval_patch_conflict'; end if;
end $patch$;
revoke all on function public.erp_statement_add_line(text,text,jsonb,date),
  public.approve_capture(text,text,jsonb,text,text) from public,anon;
grant execute on function public.erp_statement_add_line(text,text,jsonb,date),
  public.approve_capture(text,text,jsonb,text,text) to erp_server;
notify pgrst,'reload schema';
commit;
