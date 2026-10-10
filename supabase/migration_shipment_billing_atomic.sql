begin;

create or replace function public.erp_statement_amount(p_lines jsonb)
returns numeric language plpgsql set search_path=public as $$
declare l jsonb; amount numeric:=0; q numeric; price numeric; rate numeric;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0
    or jsonb_array_length(p_lines)>500 then raise exception 'invalid_statement'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l->'description') is distinct from 'string' or btrim(l->>'description')=''
      or jsonb_typeof(l->'qty') is distinct from 'number' or jsonb_typeof(l->'unitPrice') is distinct from 'number'
      or jsonb_typeof(l->'taxRate') is distinct from 'number'
      or coalesce(l->>'taxType','') not in ('과세','면세') then raise exception 'invalid_statement'; end if;
    q:=(l->>'qty')::numeric; price:=(l->>'unitPrice')::numeric; rate:=(l->>'taxRate')::numeric;
    if q<=0 or price<0 or rate<0 or rate>1 then raise exception 'invalid_statement'; end if;
    amount:=amount+q*price*case when l->>'taxType'='과세' then 1+rate else 1 end;
  end loop;
  if amount>9007199254740991 then raise exception 'invalid_statement'; end if;
  return amount;
end $$;

create or replace function public.save_statement_billing(p_input jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare
  s jsonb:=p_input->'statement'; sid text:=s->>'id'; requested_no text:=nullif(s->>'statementNo','');
  original public.trade_statements%rowtype; saved public.trade_statements%rowtype;
  stl public.settlements%rowtype; v public.vendors%rowtype;
  dt date; invoice_dt date; amount numeric; billed boolean; issued boolean;
  prefix text; number text; seq bigint; same boolean; expected timestamptz;
  tax jsonb:=nullif(s->'taxInvoice','null'::jsonb);
begin
  if sid is null or sid !~ '^[a-zA-Z0-9_-]{1,100}$' or coalesce(s->>'status','') not in ('미청구','청구완료','수금완료')
    or (nullif(s->>'workspace','') is not null and s->>'workspace' not in ('OEM','LUMEN','AETALOOF'))
    then raise exception 'invalid_statement'; end if;
  begin
    dt:=(s->>'issueDate')::date; invoice_dt:=(p_input->>'invoiceDate')::date;
    expected:=nullif(p_input->>'expectedUpdatedAt','')::timestamptz;
    issued:=coalesce((tax->>'issued')::boolean,false);
  exception when others then raise exception 'invalid_statement'; end;
  if dt is null or invoice_dt is null or to_char(dt,'YYYY-MM-DD')<>s->>'issueDate'
    or to_char(invoice_dt,'YYYY-MM-DD')<>p_input->>'invoiceDate' then raise exception 'invalid_statement'; end if;
  amount:=public.erp_statement_amount(s->'lines');
  if tax is not null and (jsonb_typeof(tax) is distinct from 'object'
    or jsonb_typeof(tax->'issued') is distinct from 'boolean') then raise exception 'invalid_tax_invoice'; end if;
  billed:=s->>'status' in ('청구완료','수금완료') or issued;
  if billed and amount<=0 then raise exception 'zero_bill'; end if;
  if issued and (s->>'status'='미청구' or jsonb_typeof(tax->'totalAmount') is distinct from 'number'
    or abs((tax->>'totalAmount')::numeric-amount)>0.001) then raise exception 'invalid_tax_invoice'; end if;

  perform pg_advisory_xact_lock(hashtextextended('statement:'||sid,0));
  select * into original from public.trade_statements where id=sid for update;
  select * into v from public.vendors where id=s->>'vendorId';
  if not found then raise exception 'bill_buyer_not_found'; end if;
  if original.id is not null then
    number:=original.statement_no;
    if requested_no is not null and requested_no is distinct from number then raise exception 'statement_number_changed'; end if;
    same:=original.vendor_id=v.id and original.issue_date=dt and original.lines=s->'lines'
      and original.status=s->>'status' and original.tax_invoice is not distinct from tax
      and original.project_no is not distinct from nullif(s->>'projectNo','')
      and original.workspace is not distinct from nullif(s->>'workspace','')
      and coalesce(original.memo,'')=coalesce(s->>'memo','')
      and coalesce(original.tax_invoice_no,'')=coalesce(s->>'taxInvoiceNo','');
    if not coalesce(same,false) and (expected is null or expected is distinct from coalesce(original.updated_at,original.created_at))
      then raise exception 'stale_statement'; end if;
    if coalesce((original.tax_invoice->>'issued')::boolean,false) and
      (not issued or original.vendor_id<>v.id or public.erp_statement_amount(original.lines)<>amount)
      then raise exception 'issued_statement_locked'; end if;
  else
    if expected is not null then raise exception 'statement_not_found'; end if;
    -- 현장 접수 함수와 동일한 번호 앞자리 잠금을 사용한다.
    prefix:=to_char(dt,'YYYYMM')||'-'||coalesce(nullif(btrim(v.code),''),upper(substr(v.id,1,4)))||'-';
    perform pg_advisory_xact_lock(hashtext('ts:'||prefix));
    select coalesce(max(substring(statement_no from length(prefix)+1)::bigint),0) into seq
      from public.trade_statements where left(statement_no,length(prefix))=prefix
      and substring(statement_no from length(prefix)+1) ~ '^[0-9]+$';
    number:=prefix||case when seq+1<1000 then lpad((seq+1)::text,3,'0') else (seq+1)::text end;
    -- 신규 화면의 로컬 번호는 사용하지 않고 서버가 할당한다.
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invoice:'||number,0));
  if exists(select 1 from public.trade_statements where statement_no=number and id<>sid)
    then raise exception 'duplicate_statement'; end if;
  if (select count(*) from public.settlements where invoice_no=number)>1 then raise exception 'duplicate_settlement'; end if;
  select * into stl from public.settlements where invoice_no=number for update;
  if stl.id is not null then
    if not billed then raise exception 'linked_settlement'; end if;
    if stl.buyer_id is distinct from v.id then raise exception 'settlement_buyer_changed'; end if;
    if amount<coalesce(stl.collected_amount_krw,0) then raise exception 'below_collected'; end if;
  end if;
  if s->>'status'='수금완료' and (stl.id is null or coalesce(stl.collected_amount_krw,0)<>amount)
    then raise exception 'collection_required'; end if;

  if original.id is null then
    insert into public.trade_statements(id,statement_no,vendor_id,vendor_name,vendor_code,project_no,workspace,
      issue_date,lines,status,tax_invoice,tax_invoice_no,memo,created_at,updated_at)
      values(sid,number,v.id,v.name,v.code,nullif(s->>'projectNo',''),nullif(s->>'workspace',''),dt,s->'lines',
        s->>'status',tax,nullif(s->>'taxInvoiceNo',''),nullif(s->>'memo',''),now(),clock_timestamp()) returning * into saved;
  elsif coalesce(same,false) then
    saved:=original;
  else
    update public.trade_statements set vendor_id=v.id,vendor_name=v.name,vendor_code=v.code,
      project_no=nullif(s->>'projectNo',''),workspace=nullif(s->>'workspace',''),issue_date=dt,lines=s->'lines',
      status=s->>'status',tax_invoice=tax,tax_invoice_no=nullif(s->>'taxInvoiceNo',''),memo=nullif(s->>'memo',''),
      collected_date=case when s->>'status'='수금완료' then stl.collected_date else null end,
      updated_at=clock_timestamp() where id=sid returning * into saved;
  end if;
  if billed then
    if stl.id is null then
      insert into public.settlements(id,buyer_id,buyer_name,project_no,workspace,channel,invoice_no,invoice_date,
        due_date,billed_amount_krw,collected_amount_krw,status)
        values('stl_'||sid,v.id,v.name,saved.project_no,saved.workspace,'B2B직납',number,invoice_dt,
          invoice_dt+30,amount,0,'정상') returning * into stl;
    else
      -- 수금액·수금일·기한은 보존하고 잔액이 생기면 완납 상태를 해제한다.
      update public.settlements set buyer_name=v.name,billed_amount_krw=amount,
        status=case when coalesce(stl.collected_amount_krw,0)=amount then '완납'
          when stl.due_date<(now() at time zone 'Asia/Seoul')::date then '위험'
          when stl.due_date<=(now() at time zone 'Asia/Seoul')::date+14 then '주의' else '정상' end,
        project_no=saved.project_no,workspace=saved.workspace where id=stl.id returning * into stl;
    end if;
  end if;
  return jsonb_build_object('statement',to_jsonb(saved),'settlement',case when stl.id is not null then to_jsonb(stl) end);
end $$;

create or replace function public.record_order_shipment(p_input jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare
  rid text:=p_input->>'id'; oid text:=p_input->>'orderId'; kind text:=p_input->>'logType';
  market text:=p_input->>'deliveryMarket'; q int; dt date; shipped bigint; oem_qty bigint;
  o public.production_orders%rowtype; r public.receipt_logs%rowtype;
  s public.trade_statements%rowtype; v public.vendors%rowtype; item public.items%rowtype;
  marker text; generated jsonb; unit numeric:=0; retry boolean:=false; created boolean:=false; warning text;
begin
  if rid is null or rid !~ '^[a-zA-Z0-9_-]{1,100}$' or oid is null
    or coalesce(kind,'') not in ('outbound_oem','outbound_3pl')
    or coalesce(market,'') not in ('domestic','b2b','overseas')
    or jsonb_typeof(p_input->'qty') is distinct from 'number' then raise exception 'invalid_shipment'; end if;
  begin q:=(p_input->>'qty')::numeric; dt:=(p_input->>'receivedDate')::date;
  exception when others then raise exception 'invalid_shipment'; end;
  if q<=0 or q::numeric<>(p_input->>'qty')::numeric or dt is null
    or to_char(dt,'YYYY-MM-DD')<>p_input->>'receivedDate' then raise exception 'invalid_shipment'; end if;
  perform pg_advisory_xact_lock(hashtextextended('receipt:'||rid,0));
  select * into o from public.production_orders where id=oid for update;
  if not found then raise exception 'order_not_found'; end if;
  marker:='[AUTO-ORDER:'||oid||']';
  select * into r from public.receipt_logs where id=rid;
  if found then
    if r.order_id is distinct from oid or r.log_type is distinct from kind or r.qty<>q or r.received_date<>dt
      or coalesce(r.memo,'')<>coalesce(p_input->>'memo','') or r.delivery_market is distinct from market
      then raise exception 'receipt_conflict'; end if;
    retry:=true;
  else
    if coalesce(o.status,'') not in ('발주생성','생산중','생산완료','입고완료') then raise exception 'invalid_order_status'; end if;
    select greatest(coalesce(o.shipped_qty,0),coalesce(sum(qty),0)) into shipped
      from public.receipt_logs where order_id=oid and log_type in ('outbound_oem','outbound_3pl');
    if coalesce(o.quantity,0)<=0 or shipped+q>o.quantity then raise exception 'over_shipment'; end if;
    insert into public.receipt_logs(id,order_id,order_no,project_no,log_type,qty,defect_qty,received_date,memo,delivery_market)
      values(rid,oid,o.order_no,o.project_no,kind,q,0,dt,p_input->>'memo',market) returning * into r;
    update public.production_orders set shipped_qty=shipped+q,updated_at=clock_timestamp() where id=oid returning * into o;
  end if;
  if kind='outbound_oem' then
    if (select count(*) from public.trade_statements where position(marker in coalesce(memo,''))>0)>1
      then raise exception 'duplicate_statement'; end if;
    select * into s from public.trade_statements where position(marker in coalesce(memo,''))>0;
    if s.id is not null and o.trade_statement_id is not null and s.id<>o.trade_statement_id
      then raise exception 'statement_link_conflict'; end if;
    if s.id is null and o.trade_statement_id is not null then
      select * into s from public.trade_statements where id=o.trade_statement_id;
      if not found then raise exception 'statement_link_conflict'; end if;
      warning:='linked_statement_review';
    end if;
    select coalesce(sum(qty),0) into oem_qty from public.receipt_logs where order_id=oid and log_type='outbound_oem';
    if not retry and s.id is null and oem_qty>=o.quantity then
      select * into v from public.vendors where id=o.buyer_id;
      if v.id is null then warning:='buyer_missing';
      else
        select * into item from public.items where id=o.style_id;
        if item.id is null and (select count(*) from public.items where style_no=o.style_no)=1 then
          select * into item from public.items where style_no=o.style_no;
        end if;
        if item.id is not null and item.delivery_price>0 and item.delivery_price::text not in ('NaN','Infinity','-Infinity')
          then unit:=item.delivery_price; end if;
        if unit=0 then warning:='price_missing'; end if;
        generated:=public.save_statement_billing(jsonb_build_object('statement',jsonb_build_object(
          'id','ship_'||md5(oid),'vendorId',v.id,'issueDate',to_char(dt,'YYYY-MM-DD'),'status','미청구',
          'projectNo',o.project_no,'workspace',coalesce(o.workspace,'OEM'),'memo',marker||' OEM 직출고 완료 자동 초안',
          'lines',jsonb_build_array(jsonb_build_object('id','line_'||rid,
            'description','['||coalesce(o.style_no,'')||'] '||coalesce(o.style_name,''),'qty',oem_qty,
            'unitPrice',unit,'taxType','과세','taxRate',0.1))),'invoiceDate',to_char(dt,'YYYY-MM-DD')));
        select * into s from public.trade_statements where id=generated->'statement'->>'id';
        created:=true;
      end if;
    end if;
    if s.id is not null and o.trade_statement_id is null then
      update public.production_orders set trade_statement_id=s.id where id=oid returning * into o;
    end if;
  end if;
  return jsonb_build_object('receipt',to_jsonb(r),'order',to_jsonb(o),'retry',retry,'statementCreated',created,
    'statement',case when s.id is not null then to_jsonb(s) end,'warning',warning,
    'logs',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.receipt_logs l where order_id=oid));
end $$;

revoke all on function public.erp_statement_amount(jsonb),public.save_statement_billing(jsonb),public.record_order_shipment(jsonb) from public,anon;
grant execute on function public.erp_statement_amount(jsonb),public.save_statement_billing(jsonb),public.record_order_shipment(jsonb) to erp_server;
notify pgrst,'reload schema';
commit;
