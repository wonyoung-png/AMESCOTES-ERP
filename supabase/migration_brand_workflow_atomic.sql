-- 승인·발행·수주는 서버 전용 트랜잭션이다. 실거래 데이터는 변경하지 않는다.
begin;
create or replace function public.validate_brand_lines(p_id text)
returns void language plpgsql as $$
begin
  if not exists(select 1 from public.brand_order_lines where batch_id=p_id) then raise exception 'empty_lines'; end if;
  if exists(select 1 from public.brand_order_lines l where batch_id=p_id and (
    coalesce(btrim(style_no),'')='' or coalesce(btrim(factory_id),'')='' or coalesce(qty,0)<=0
    or coalesce(route,'oem') not in ('oem','direct')
    or jsonb_typeof(color_qtys) is distinct from 'array'
    or coalesce((select sum((c->>'qty')::numeric) from jsonb_array_elements(color_qtys) c),0)<>qty
    or exists(select 1 from jsonb_array_elements(color_qtys) c where coalesce((c->>'qty')::numeric,0)<=0 or (c->>'qty')::numeric<>trunc((c->>'qty')::numeric))
  )) then raise exception 'invalid_lines'; end if;
end $$;
create or replace function public.approve_brand_batch(p_id text, p_actor_id text, p_actor_name text)
returns jsonb language plpgsql as $$
declare b public.brand_order_batches%rowtype;
begin
  select * into b from public.brand_order_batches where id=p_id for update;
  if not found then raise exception 'not_found'; end if;
  if b.status='approved' then return jsonb_build_object('id',b.id,'status','approved'); end if;
  if b.status not in ('draft','in_approval') then raise exception 'invalid_status'; end if;
  perform 1 from public.brand_order_lines where batch_id=p_id order by id for update;
  perform public.validate_brand_lines(p_id);
  insert into public.approval_logs(id,batch_id,step,action,actor_id,actor_name,comment)
    values('appr_'||md5(p_id||clock_timestamp()::text),p_id,6,'approve',p_actor_id,p_actor_name,'대표 최종 승인');
  update public.brand_order_batches set status='approved',approval_step=6,updated_at=now() where id=p_id;
  return jsonb_build_object('id',p_id,'status','approved');
end $$;

create or replace function public.issue_brand_batch(p_id text)
returns jsonb language plpgsql as $$
declare b public.brand_order_batches%rowtype; g record; n int:=0; po text; result jsonb;
begin
  select * into b from public.brand_order_batches where id=p_id for update;
  if not found then raise exception 'not_found'; end if;
  if b.status not in ('approved','issued','split') then raise exception 'not_approved'; end if;
  perform 1 from public.brand_order_lines where batch_id=p_id order by id for update;
  if not exists(select 1 from public.brand_order_lines where batch_id=p_id) then raise exception 'empty_lines'; end if;
  if b.status='approved' then
    perform public.validate_brand_lines(p_id);
    for g in select coalesce(route,'oem') as route,factory_id from public.brand_order_lines where batch_id=p_id group by coalesce(route,'oem'),factory_id order by coalesce(route,'oem'),factory_id loop
      n:=n+1; if n>26 then raise exception 'too_many_factories'; end if;
      po:=b.project_no||'-'||chr(64+n);
      update public.brand_order_lines set po_no=po,issued_at=now() where batch_id=p_id and coalesce(route,'oem')=g.route and factory_id=g.factory_id;
    end loop;
    update public.brand_order_batches set status='issued',updated_at=now() where id=p_id;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x."poNo"),'[]'::jsonb) into result from (
    select po_no as "poNo",max(factory_name) as "factoryName",count(*) as lines,coalesce(route,'oem') as route
    from public.brand_order_lines where batch_id=p_id group by po_no,coalesce(route,'oem')
  ) x;
  return result;
end $$;

create or replace function public.accept_brand_po(p_po_no text,p_due_date date)
returns jsonb language plpgsql as $$
declare b public.brand_order_batches%rowtype; l public.brand_order_lines%rowtype; buyer text; item text; item_season text; rev int; oid text; total int:=0;
begin
  if p_due_date is null then raise exception 'invalid_due'; end if;
  select bb.* into b from public.brand_order_batches bb where bb.id=(select batch_id from public.brand_order_lines where po_no=p_po_no limit 1) for update;
  if not found then raise exception 'not_found'; end if;
  perform 1 from public.brand_order_lines where batch_id=b.id and po_no=p_po_no order by id for update;
  if b.status not in ('issued','split') then raise exception 'invalid_status'; end if;
  if exists(select 1 from public.brand_order_lines where batch_id=b.id and po_no=p_po_no and coalesce(route,'oem')<>'oem') then raise exception 'invalid_status'; end if;
  if not exists(select 1 from public.brand_order_lines where batch_id=b.id and po_no=p_po_no and accepted_at is null) then
    if (select count(*) from public.production_orders where po_batch_no=p_po_no)<>(select count(*) from public.brand_order_lines where batch_id=b.id and po_no=p_po_no) then raise exception 'conflicting_orders'; end if;
    return jsonb_build_object('poNo',p_po_no,'count',(select count(*) from public.production_orders where po_batch_no=p_po_no),'already',true);
  end if;
  if exists(select 1 from public.production_orders where po_batch_no=p_po_no) then raise exception 'conflicting_orders'; end if;
  perform public.validate_brand_lines(b.id);
  select id into buyer from public.vendors where type='바이어' and (upper(name)=b.workspace or upper(company_name)=b.workspace or upper(code)=case b.workspace when 'LUMEN' then 'LLL' else 'AET' end) order by id limit 1;
  if buyer is null then
    buyer:='vendor-internal-'||lower(b.workspace);
    insert into public.vendors(id,name,code,company_name,type,country,currency,created_at,memo)
      values(buyer,b.workspace,case b.workspace when 'LUMEN' then 'LLL' else 'AET' end,b.workspace,'바이어','한국','KRW',now(),'브랜드 내부거래 바이어 자동 생성') on conflict(id) do nothing;
  end if;
  for l in select * from public.brand_order_lines where batch_id=b.id and po_no=p_po_no order by style_no,id loop
    if coalesce(l.qty,0)<=0 or coalesce(btrim(l.style_no),'')='' or coalesce(btrim(l.factory_id),'')='' then raise exception 'invalid_lines'; end if;
    -- 같은 품번의 차수 발급을 다른 발주서 수주와 직렬화한다.
    perform pg_advisory_xact_lock(hashtext(l.style_no));
    select coalesce(max(greatest(coalesce(revision,0),coalesce((regexp_match(order_no,'-R([0-9]+)$'))[1]::int,0))),0)+1 into rev from public.production_orders where style_no=l.style_no;
    select id,season into item,item_season from public.items where style_no=l.style_no order by id limit 1;
    oid:='ord_brand_'||md5(l.id);
    insert into public.production_orders(id,order_no,workspace,po_batch_no,project_no,brand_batch_id,buyer_id,style_id,style_no,style_name,season,quantity,color_qtys,vendor_id,vendor_name,production_origin,is_employee_purchase,delivery_date,status,hq_supply_items,revision,is_reorder,created_at,updated_at)
      values(oid,l.style_no||'-R'||rev,'OEM',p_po_no,b.project_no,b.id,buyer,item,l.style_no,l.style_name,item_season,l.qty,l.color_qtys,l.factory_id,l.factory_name,l.production_origin,l.is_employee_purchase,p_due_date,'발주생성','[]'::jsonb,rev,false,now(),now());
    total:=total+1;
  end loop;
  update public.brand_order_lines set accepted_at=now() where batch_id=b.id and po_no=p_po_no;
  update public.brand_order_batches set expected_dely=(select max(delivery_date) from public.production_orders where brand_batch_id=b.id),
    status=case when not exists(select 1 from public.brand_order_lines where batch_id=b.id and coalesce(route,'oem')='oem' and accepted_at is null) then 'split' else 'issued' end,updated_at=now() where id=b.id;
  return jsonb_build_object('poNo',p_po_no,'count',total,'already',false);
end $$;

create or replace function public.cancel_brand_issue(p_id text)
returns jsonb language plpgsql as $$
declare b public.brand_order_batches%rowtype;
begin
  select * into b from public.brand_order_batches where id=p_id for update;
  if not found then raise exception 'not_found'; end if;
  perform 1 from public.brand_order_lines where batch_id=p_id order by id for update;
  if b.status='draft' and not exists(select 1 from public.brand_order_lines where batch_id=p_id and (po_no is not null or accepted_at is not null)) then
    return jsonb_build_object('id',p_id,'status','draft');
  end if;
  if b.status not in ('issued','approved','in_approval') then raise exception 'invalid_status'; end if;
  if exists(select 1 from public.brand_order_lines where batch_id=p_id and accepted_at is not null)
    or exists(select 1 from public.production_orders where brand_batch_id=p_id) then raise exception 'already_accepted'; end if;
  update public.brand_order_lines set po_no=null,issued_at=null where batch_id=p_id;
  update public.brand_order_batches set status='draft',approval_step=1,expected_dely=null,updated_at=now() where id=p_id;
  return jsonb_build_object('id',p_id,'status','draft');
end $$;

revoke all on function public.validate_brand_lines(text),public.approve_brand_batch(text,text,text),public.issue_brand_batch(text),public.accept_brand_po(text,date),public.cancel_brand_issue(text) from public,anon;
grant execute on function public.validate_brand_lines(text),public.approve_brand_batch(text,text,text),public.issue_brand_batch(text),public.accept_brand_po(text,date),public.cancel_brand_issue(text) to erp_server;
notify pgrst,'reload schema';
commit;
