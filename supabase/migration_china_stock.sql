begin;
create table if not exists public.china_stock_moves (
  id text primary key, workspace text not null check(workspace in ('LUMEN','AETALOOF')),
  style_no text not null check(btrim(style_no)<>''), style_name text, color text not null check(btrim(color)<>''),
  qty bigint not null check(qty<>0), move_type text not null check(move_type in ('inbound','outbound','adjust')),
  move_date date not null, order_id text, order_no text,
  receipt_log_id text unique references public.receipt_logs(id), memo text,
  created_at timestamptz not null default now(), created_by text not null,
  check(move_type='adjust' or qty>0)
);
create index if not exists china_stock_location on public.china_stock_moves(workspace,style_no,color);
create table if not exists public.china_stock_transfers (
  id text primary key, workspace text not null check(workspace in ('LUMEN','AETALOOF')),
  style_no text not null, color text not null, qty bigint not null check(qty>0),
  sent_date date not null, received_date date, confirmation_ref text,
  status text not null default 'in_transit' check(status in ('in_transit','received')),
  created_by text not null, received_by text,
  move_id text not null unique references public.china_stock_moves(id),
  check((status='in_transit' and received_date is null and confirmation_ref is null)
    or (status='received' and received_date is not null and received_date>=sent_date and confirmation_ref is not null and btrim(confirmation_ref)<>''))
);
revoke all on public.china_stock_moves,public.china_stock_transfers from public,anon;
grant select,insert,update on public.china_stock_moves,public.china_stock_transfers to erp_server;

create or replace function public.china_stock_snapshot(p_workspace text)
returns jsonb language plpgsql set search_path=public as $$
begin
  if p_workspace not in ('LUMEN','AETALOOF') or p_workspace is null then raise exception 'invalid_workspace'; end if;
  return jsonb_build_object('workspace',p_workspace,
    'moves',(select coalesce(jsonb_agg(to_jsonb(m) order by move_date desc,created_at desc,id),'[]') from china_stock_moves m where workspace=p_workspace),
    'balances',(select coalesce(jsonb_agg(to_jsonb(b) order by style_no,color),'[]') from (
      select workspace,style_no,max(coalesce(style_name,style_no)) style_name,color,
        sum(case when move_type='outbound' then -qty else qty end) on_hand,
        sum(case when move_type='inbound' or (move_type='adjust' and qty>0) then qty else 0 end) inbound_qty,
        sum(case when move_type='outbound' or (move_type='adjust' and qty<0) then abs(qty) else 0 end) outbound_qty
      from china_stock_moves where workspace=p_workspace group by workspace,style_no,color) b),
    'transfers',(select coalesce(jsonb_agg(to_jsonb(t) order by sent_date desc,id),'[]') from china_stock_transfers t where workspace=p_workspace));
end $$;

create or replace function public.save_china_stock_move(p_input jsonb,p_actor text)
returns jsonb language plpgsql set search_path=public as $$
declare
  m china_stock_moves%rowtype; r receipt_logs%rowtype; o production_orders%rowtype;
  mid text:=p_input->>'id'; ws text:=p_input->>'workspace'; s text:=btrim(p_input->>'styleNo');
  c text:=btrim(p_input->>'color'); kind text:=p_input->>'moveType'; q bigint; dt date; available bigint;
  rid text:=nullif(p_input->>'receiptLogId',''); brand text;
begin
  if mid is null or mid !~ '^[a-zA-Z0-9_-]{1,160}$' or ws is null or ws not in ('LUMEN','AETALOOF')
    or s is null or s='' or c is null or c='' or kind is null or kind not in ('inbound','outbound','adjust')
    or jsonb_typeof(p_input->'qty') is distinct from 'number' or coalesce(btrim(p_actor),'')='' then raise exception 'invalid_stock_move'; end if;
  q:=(p_input->>'qty')::numeric; dt:=(p_input->>'moveDate')::date;
  if q=0 or abs(q)>2147483647 or q::numeric<>(p_input->>'qty')::numeric or dt is null
    or to_char(dt,'YYYY-MM-DD')<>p_input->>'moveDate' or (kind<>'adjust' and q<0)
    or (kind='adjust' and coalesce(btrim(p_input->>'memo'),'')='') then raise exception 'invalid_stock_move'; end if;
  perform pg_advisory_xact_lock(hashtextextended('china-request:'||mid,0));
  perform pg_advisory_xact_lock(hashtextextended('china-stock:'||ws||':'||s||':'||c,0));
  if kind='inbound' then
    if rid is null then raise exception 'receipt_required'; end if;
    select * into r from receipt_logs where id=rid;
    if not found or r.log_type<>'inbound' or r.destination is distinct from 'china' then raise exception 'invalid_stock_receipt'; end if;
    select * into o from production_orders where id=r.order_id;
    if not found then raise exception 'invalid_stock_receipt'; end if;
    brand:=o.workspace;
    if o.brand_batch_id is not null then select workspace into brand from brand_order_batches where id=o.brand_batch_id; end if;
    if brand is distinct from ws or o.style_no is distinct from s or btrim(r.color) is distinct from c
      or r.qty-coalesce(r.defect_qty,0)<>q or r.received_date<>dt
      or coalesce(p_input->>'orderId',r.order_id)<>r.order_id then raise exception 'invalid_stock_receipt'; end if;
  elsif rid is not null then raise exception 'invalid_stock_receipt'; end if;
  select * into m from china_stock_moves where id=mid or (rid is not null and receipt_log_id=rid);
  if found then
    if m.workspace<>ws or m.style_no<>s or m.color<>c or m.qty<>q or m.move_type<>kind or m.move_date<>dt
      or m.receipt_log_id is distinct from rid or (kind<>'inbound' and coalesce(m.memo,'')<>coalesce(p_input->>'memo','')) then raise exception 'stock_conflict'; end if;
    return to_jsonb(m);
  end if;
  select coalesce(sum(case when move_type='outbound' then -qty else qty end),0) into available
    from china_stock_moves where workspace=ws and style_no=s and color=c;
  if available+(case when kind='outbound' then -q else q end)<0 then raise exception 'insufficient_china_stock'; end if;
  insert into china_stock_moves(id,workspace,style_no,style_name,color,qty,move_type,move_date,order_id,order_no,receipt_log_id,memo,created_by)
    values(mid,ws,s,p_input->>'styleName',c,q,kind,dt,case when kind='inbound' then r.order_id else p_input->>'orderId' end,
      case when kind='inbound' then r.order_no else p_input->>'orderNo' end,rid,p_input->>'memo',p_actor) returning * into m;
  return to_jsonb(m);
end $$;

create or replace function public.import_china_stock_history(p_workspace text,p_moves jsonb,p_actor text)
returns jsonb language plpgsql set search_path=public as $$
declare input jsonb;
begin
  if jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves)>5000 then raise exception 'invalid_import'; end if;
  -- Serialize imports; every item succeeds or the entire batch rolls back.
  perform pg_advisory_xact_lock(hashtextextended('china-import',0));
  for input in select value from jsonb_array_elements(p_moves) order by value->>'moveDate',value->>'createdAt',value->>'id' loop
    if input->>'workspace' is distinct from p_workspace then raise exception 'invalid_workspace'; end if;
    perform save_china_stock_move(input,p_actor);
  end loop;
  return china_stock_snapshot(p_workspace);
end $$;

create or replace function public.save_china_transfer(p_input jsonb,p_actor text)
returns jsonb language plpgsql set search_path=public as $$
declare t china_stock_transfers%rowtype; m jsonb; tid text:=p_input->>'id'; ws text:=p_input->>'workspace';
  dt date; ref text; q bigint;
begin
  if tid is null or tid !~ '^[a-zA-Z0-9_-]{1,80}$' or ws is null or ws not in ('LUMEN','AETALOOF')
    or coalesce(btrim(p_actor),'')='' then raise exception 'invalid_transfer'; end if;
  perform pg_advisory_xact_lock(hashtextextended('china-transfer:'||tid,0));
  select * into t from china_stock_transfers where id=tid for update;
  if p_input->>'action'='receive' then
    if not found or t.workspace<>ws then raise exception 'transfer_not_found'; end if;
    dt:=(p_input->>'receivedDate')::date; ref:=btrim(p_input->>'confirmationRef');
    if dt is null or to_char(dt,'YYYY-MM-DD')<>p_input->>'receivedDate' or dt<t.sent_date or coalesce(ref,'')='' then raise exception 'invalid_transfer'; end if;
    if t.status='received' and (t.received_date<>dt or t.confirmation_ref<>ref) then raise exception 'stock_conflict'; end if;
    if t.status='in_transit' then update china_stock_transfers set status='received',received_date=dt,confirmation_ref=ref,received_by=p_actor where id=tid; end if;
  elsif p_input->>'action'='send' then
    q:=(p_input->>'qty')::numeric; dt:=(p_input->>'moveDate')::date;
    if jsonb_typeof(p_input->'qty') is distinct from 'number' or q is null or q<=0 or q>2147483647
      or q::numeric<>(p_input->>'qty')::numeric or dt is null or to_char(dt,'YYYY-MM-DD')<>p_input->>'moveDate' then raise exception 'invalid_transfer'; end if;
    if found then
      if t.workspace<>ws or t.style_no is distinct from btrim(p_input->>'styleNo') or t.color is distinct from btrim(p_input->>'color')
        or q is null or t.qty<>q or t.sent_date is distinct from dt then raise exception 'stock_conflict'; end if;
    else
      m:=save_china_stock_move(p_input||jsonb_build_object('id','transfer_'||tid,'moveType','outbound','receiptLogId',null,'memo','중국 → 한국 이동'),p_actor);
      insert into china_stock_transfers(id,workspace,style_no,color,qty,sent_date,created_by,move_id)
        values(tid,ws,m->>'style_no',m->>'color',(m->>'qty')::bigint,(m->>'move_date')::date,p_actor,m->>'id');
    end if;
  else raise exception 'invalid_transfer'; end if;
  return china_stock_snapshot(ws);
end $$;
revoke all on function public.china_stock_snapshot(text),public.save_china_stock_move(jsonb,text),
  public.import_china_stock_history(text,jsonb,text),public.save_china_transfer(jsonb,text) from public,anon;
grant execute on function public.china_stock_snapshot(text),public.save_china_stock_move(jsonb,text),
  public.import_china_stock_history(text,jsonb,text),public.save_china_transfer(jsonb,text) to erp_server;
notify pgrst,'reload schema';
commit;
