begin;
create or replace function public.generate_receipt_payables(p_order_id text)
returns jsonb language plpgsql set search_path=public as $$
declare o production_orders%rowtype; r receipt_logs%rowtype; p payables%rowtype; cn vendors%rowtype;
  unit numeric; amount numeric; n int; created int:=0; result jsonb:='[]';
begin
  select * into o from production_orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  unit:=coalesce(o.factory_unit_price_krw,0);
  for r in select * from receipt_logs where order_id=p_order_id and log_type='inbound' order by id loop
    select count(*) into n from payables where source_id=r.id or coalesce(receipt_log_ids,'[]') @> jsonb_build_array(r.id);
    if n>1 then raise exception 'ambiguous_payable'; end if;
    if n=1 then
      select * into p from payables where source_id=r.id or coalesce(receipt_log_ids,'[]') @> jsonb_build_array(r.id);
      if p.source_type is distinct from 'order_receipt' or p.order_id is distinct from o.id then raise exception 'ambiguous_payable'; end if;
    else
      if unit<=0 or unit::text in ('NaN','Infinity','-Infinity') or r.qty<=0 then raise exception 'price_required'; end if;
      if coalesce(r.destination,'korea') not in ('korea','china') then raise exception 'invalid_destination'; end if;
      if exists(select 1 from payables where id='pay_'||r.id) then raise exception 'ambiguous_payable'; end if;
      amount:=round(unit*r.qty);
      if amount<=0 or amount>9007199254740991 then raise exception 'price_required'; end if;
      if r.destination='china' then
        if (select count(*) from vendors where code='AMES-CN')<>1 then raise exception 'china_vendor_required'; end if;
        select * into cn from vendors where code='AMES-CN';
      end if;
      insert into payables(id,vendor_id,vendor_name,project_no,source_type,source_id,amount_krw,paid_amount_krw,due_date,status,memo,payee_type,order_id,receipt_log_ids)
        values('pay_'||r.id,case when r.destination='china' then cn.id else o.vendor_id end,
          case when r.destination='china' then cn.name else coalesce(nullif(o.vendor_name,''),'공장') end,o.project_no,'order_receipt',r.id,amount,0,r.received_date,'pending',
          case when r.destination='china' then '중국입고 · ' else '한국입고 · ' end||coalesce(o.order_no,'')||' · '||r.qty||'pcs',
          case when r.destination='china' then 'china_corp' else 'factory_direct' end,o.id,jsonb_build_array(r.id)) returning * into p;
      -- Only unresolved zero-valued defect deductions from the original receipt may follow its newly fixed price.
      update defect_carryovers set amount_krw=unit*r.defect_qty where id='def_'||r.id and status='pending' and disposition='deduct' and amount_krw=0;
      created:=created+1;
    end if;
    result:=result||jsonb_build_array(to_jsonb(p));
  end loop;
  return jsonb_build_object('items',result,'created',created);
end $$;

create or replace function public.save_planned_payables(p_id text,p_rows jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare v jsonb; p payables%rowtype; dt date; q numeric; i int:=0; n int; result jsonb:='[]';
begin
  if p_id is null or p_id !~ '^[a-zA-Z0-9_-]{1,80}$' or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'invalid_plan'; end if;
  perform pg_advisory_xact_lock(hashtextextended('planned-payables:'||p_id,0));
  select count(*) into n from payables where source_type='manual' and source_id=p_id;
  if n>0 and n<>jsonb_array_length(p_rows) then raise exception 'plan_conflict'; end if;
  for v in select value from jsonb_array_elements(p_rows) loop
    i:=i+1; q:=(v->>'amountKrw')::numeric; dt:=(v->>'dueDate')::date;
    if jsonb_typeof(v->'amountKrw') is distinct from 'number' or q is null or q<=0 or q>9007199254740991 or q<>trunc(q)
      or dt is null or to_char(dt,'YYYY-MM-DD')<>v->>'dueDate' or coalesce(btrim(v->>'vendorName'),'')=''
      or coalesce(v->>'memo','') not like '[자금계획|%|예상|'||p_id||'|%' then raise exception 'invalid_plan'; end if;
    select * into p from payables where id='plan_'||p_id||'_'||i for update;
    if found then
      if p.source_type<>'manual' or p.source_id is distinct from p_id or p.amount_krw<>q or p.due_date<>dt
        or p.vendor_id is distinct from nullif(v->>'vendorId','') or p.vendor_name<>v->>'vendorName'
        or p.project_no is distinct from nullif(v->>'projectNo','') or p.memo is distinct from v->>'memo' then raise exception 'plan_conflict'; end if;
    else
      if n>0 then raise exception 'plan_conflict'; end if;
      insert into payables(id,vendor_id,vendor_name,project_no,source_type,source_id,amount_krw,paid_amount_krw,due_date,status,memo)
        values('plan_'||p_id||'_'||i,nullif(v->>'vendorId',''),v->>'vendorName',nullif(v->>'projectNo',''),'manual',p_id,q,0,dt,'pending',v->>'memo') returning * into p;
    end if;
    result:=result||jsonb_build_array(to_jsonb(p));
  end loop;
  return jsonb_build_object('items',result);
end $$;
revoke all on function public.generate_receipt_payables(text),public.save_planned_payables(text,jsonb) from public,anon;
grant execute on function public.generate_receipt_payables(text),public.save_planned_payables(text,jsonb) to erp_server;
notify pgrst,'reload schema';
commit;
