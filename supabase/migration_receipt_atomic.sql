begin;
create or replace function public.record_korea_receipt(p_input jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  o public.production_orders%rowtype; r public.receipt_logs%rowtype;
  p public.payables%rowtype; d public.defect_carryovers%rowtype;
  rid text := p_input->>'id'; oid text := p_input->>'orderId';
  q int; dq int; dt date; c text := nullif(btrim(p_input->>'color'),'');
  disp text := p_input->>'disposition'; want boolean; advance boolean;
  received bigint; defects bigint; color_total bigint; color_received bigint;
  unit numeric; amount numeric; retry boolean := false;
  dest text:=coalesce(p_input->>'destination','korea'); brand text; cn public.vendors%rowtype;
begin
  if rid is null or rid !~ '^[a-zA-Z0-9_-]{1,100}$' or oid is null
    or jsonb_typeof(p_input->'qty') is distinct from 'number'
    or jsonb_typeof(p_input->'defectQty') is distinct from 'number'
    or jsonb_typeof(p_input->'createPayable') is distinct from 'boolean'
    or disp is null or disp not in ('deduct','rework','repair') or dest not in ('korea','china') then raise exception 'invalid_receipt'; end if;
  begin
    q := (p_input->>'qty')::numeric; dq := (p_input->>'defectQty')::numeric;
    dt := (p_input->>'receivedDate')::date;
    want := (p_input->>'createPayable')::boolean;
    advance := coalesce((p_input->>'isAdvance')::boolean,false);
  exception when others then raise exception 'invalid_receipt'; end;
  if q <= 0 or dq < 0 or dq > q or q::numeric <> (p_input->>'qty')::numeric
    or dq::numeric <> (p_input->>'defectQty')::numeric or dt is null
    or to_char(dt,'YYYY-MM-DD') <> p_input->>'receivedDate' then raise exception 'invalid_receipt'; end if;

  -- 동일 ID는 다른 발주에서도 직렬화하고 재시도는 기존 결과만 반환한다.
  perform pg_advisory_xact_lock(hashtextextended('receipt:' || rid,0));
  select * into o from public.production_orders where id=oid for update;
  if not found then raise exception 'order_not_found'; end if;
  if dest='china' then
    brand:=o.workspace;
    if o.brand_batch_id is not null then select workspace into brand from public.brand_order_batches where id=o.brand_batch_id; end if;
    if brand is null or brand not in ('LUMEN','AETALOOF') or c is null then raise exception 'invalid_stock_receipt'; end if;
  end if;
  select * into r from public.receipt_logs where id=rid;
  if found then
    if r.order_id is distinct from oid or r.log_type <> 'inbound' or r.destination is distinct from dest
      or r.qty <> q or r.defect_qty <> dq or r.received_date <> dt
      or nullif(btrim(r.color),'') is distinct from c or coalesce(r.memo,'') <> coalesce(p_input->>'memo','')
      or coalesce(r.defect_note,'') <> coalesce(p_input->>'defectNote','')
      or coalesce(r.is_advance,false) <> advance then raise exception 'receipt_conflict'; end if;
    retry := true;
    select * into p from public.payables where id='pay_'||rid;
    select * into d from public.defect_carryovers where id='def_'||rid;
    if d.id is not null and d.disposition <> disp then raise exception 'receipt_conflict'; end if;
  else
    if o.status is null or o.status not in ('발주생성','생산중','생산완료','입고완료') then raise exception 'invalid_order_status'; end if;
    if coalesce(o.quantity,0)<=0 then raise exception 'over_receipt'; end if;
    -- 기존 이력 없는 누적값을 버리지 않는다. 이력/발주 중 큰 값을 입고 기준으로 사용한다.
    select greatest(coalesce(o.received_qty,0),coalesce(sum(qty),0)),
      greatest(coalesce(o.defect_qty,0),coalesce(sum(defect_qty),0)) into received,defects
      from public.receipt_logs where order_id=oid and log_type='inbound';
    if received+q>o.quantity then raise exception 'over_receipt'; end if;
    if c is not null then
      select sum((line->>'qty')::bigint) into color_total from jsonb_array_elements(coalesce(o.color_qtys,'[]')) line
        where btrim(line->>'color')=c;
      select coalesce(sum(qty),0) into color_received from public.receipt_logs where order_id=oid and log_type='inbound' and btrim(color)=c;
      if color_total is null or color_received+q>color_total then raise exception 'invalid_color'; end if;
    end if;
    unit := coalesce(o.factory_unit_price_krw,0);
    if unit<0 or unit::text in ('NaN','Infinity','-Infinity') then raise exception 'invalid_price'; end if;
    amount := round(unit*q);
    if dest='china' and want and amount>0 then
      if (select count(*) from public.vendors where code='AMES-CN')<>1 then raise exception 'china_vendor_required'; end if;
      select * into cn from public.vendors where code='AMES-CN';
    end if;
    insert into public.receipt_logs(id,order_id,order_no,project_no,log_type,qty,defect_qty,defect_note,received_date,memo,destination,color,is_advance)
      values(rid,oid,o.order_no,o.project_no,'inbound',q,dq,p_input->>'defectNote',dt,p_input->>'memo',dest,c,advance) returning * into r;
    update public.production_orders set received_qty=received+q,defect_qty=defects+dq,
      received_date=greatest(received_date,dt),status=case when received+q>=quantity then '입고완료' else status end,updated_at=now()
      where id=oid returning * into o;
    if want and amount>0 then
      insert into public.payables(id,vendor_id,vendor_name,project_no,source_type,source_id,amount_krw,paid_amount_krw,due_date,status,memo,payee_type,order_id,receipt_log_ids)
        values('pay_'||rid,case when dest='china' then cn.id else o.vendor_id end,
          case when dest='china' then cn.name else coalesce(nullif(o.vendor_name,''),'공장') end,o.project_no,'order_receipt',rid,amount,0,dt,'pending',
          case when dest='china' then '중국입고 · ' else '한국입고 · ' end||coalesce(o.order_no,'')||coalesce(' · '||c,'')||' · '||q||'pcs',
          case when dest='china' then 'china_corp' else 'factory_direct' end,oid,jsonb_build_array(rid)) returning * into p;
    end if;
    if dq>0 then
      insert into public.defect_carryovers(id,style_no,order_no,project_no,vendor_id,vendor_name,amount_krw,qty,disposition,reason,defect_date,status)
        values('def_'||rid,o.style_no,o.order_no,o.project_no,o.vendor_id,o.vendor_name,case when disp='deduct' then unit*dq else 0 end,dq,disp,
          coalesce(nullif(p_input->>'defectNote',''),'입고 불량'),dt,'pending') returning * into d;
    end if;
  end if;
  if dest='china' and q>dq then
    perform public.save_china_stock_move(jsonb_build_object('id','receipt_'||rid,'workspace',brand,'styleNo',o.style_no,
      'styleName',o.style_name,'color',c,'qty',q-dq,'moveType','inbound','moveDate',to_char(dt,'YYYY-MM-DD'),
      'orderId',oid,'receiptLogId',rid,'memo',p_input->>'memo'),coalesce(nullif(p_input->>'actor',''),'erp-server'));
  end if;
  return jsonb_build_object('receipt',to_jsonb(r),'order',to_jsonb(o),'payable',case when p.id is not null then to_jsonb(p) end,
    'defect',case when d.id is not null then to_jsonb(d) end,'retry',retry,
    'logs',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.receipt_logs l where order_id=oid));
end $$;
revoke all on function public.record_korea_receipt(jsonb) from public,anon;
grant execute on function public.record_korea_receipt(jsonb) to erp_server;
notify pgrst,'reload schema';
commit;
