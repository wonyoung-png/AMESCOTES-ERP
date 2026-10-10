begin;
-- Additive upgrade: preserve old full arrivals and the existing two-state contract.
alter table public.china_stock_transfers add column if not exists received_qty bigint not null default 0;
update public.china_stock_transfers set received_qty=qty where status='received' and received_qty=0;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.china_stock_transfers'::regclass and conname='china_transfer_received_quantity') then
    alter table public.china_stock_transfers add constraint china_transfer_received_quantity
      check(received_qty>=0 and received_qty<=qty and
        ((status='received' and received_qty=qty) or (status='in_transit' and received_qty<qty)));
  end if;
end $$;
create table if not exists public.china_stock_arrivals (
  id text primary key,
  transfer_id text not null references public.china_stock_transfers(id),
  qty bigint not null check(qty>0 and qty<=2147483647),
  received_date date not null,
  confirmation_ref text not null check(btrim(confirmation_ref)<>''),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists china_arrival_transfer on public.china_stock_arrivals(transfer_id,received_date);
revoke all on public.china_stock_arrivals from public,anon;
grant select,insert on public.china_stock_arrivals to erp_server;

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
    'transfers',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('arrivals',
      (select coalesce(jsonb_agg(to_jsonb(a) order by received_date,created_at,id),'[]') from china_stock_arrivals a where transfer_id=t.id))
      order by sent_date desc,t.id),'[]') from china_stock_transfers t where workspace=p_workspace));
end $$;

create or replace function public.save_china_transfer(p_input jsonb,p_actor text)
returns jsonb language plpgsql set search_path=public as $$
declare
  t china_stock_transfers%rowtype; a china_stock_arrivals%rowtype; m jsonb;
  tid text:=p_input->>'id'; ws text:=p_input->>'workspace'; aid text;
  dt date; ref text; q bigint; raw_q numeric; legacy boolean;
begin
  if tid is null or tid !~ '^[a-zA-Z0-9_-]{1,80}$' or ws is null or ws not in ('LUMEN','AETALOOF')
    or coalesce(btrim(p_actor),'')='' then raise exception 'invalid_transfer'; end if;
  if p_input->>'action'='receive' then
    legacy:=not (p_input ? 'receivedQty' or p_input ? 'arrivalId');
    if not legacy then
      if jsonb_typeof(p_input->'receivedQty') is distinct from 'number'
        or jsonb_typeof(p_input->'arrivalId') is distinct from 'string'
        or p_input->>'arrivalId' !~ '^[a-zA-Z0-9_-]{1,80}$' then raise exception 'invalid_transfer'; end if;
      raw_q:=(p_input->>'receivedQty')::numeric;
      if raw_q<=0 or raw_q>2147483647 or trunc(raw_q)<>raw_q then raise exception 'invalid_transfer'; end if;
      q:=raw_q;
      aid:='arrival_'||(p_input->>'arrivalId');
    else
      aid:='legacy_'||tid;
    end if;
    -- Lock the event first so reusing an ID for another transfer cannot race.
    perform pg_advisory_xact_lock(hashtextextended('china-arrival:'||aid,0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('china-transfer:'||tid,0));
  select * into t from china_stock_transfers where id=tid for update;
  if p_input->>'action'='receive' then
    if not found or t.workspace<>ws then raise exception 'transfer_not_found'; end if;
    dt:=(p_input->>'receivedDate')::date; ref:=btrim(p_input->>'confirmationRef');
    if jsonb_typeof(p_input->'confirmationRef') is distinct from 'string' or dt is null
      or to_char(dt,'YYYY-MM-DD')<>p_input->>'receivedDate' or dt<t.sent_date or coalesce(ref,'')='' then raise exception 'invalid_transfer'; end if;
    if legacy then
      -- Already completed legacy rows predate the arrival log; do not fabricate history.
      if t.status='received' then
        if t.received_date<>dt or t.confirmation_ref<>ref then raise exception 'stock_conflict'; end if;
        return china_stock_snapshot(ws);
      end if;
      if t.received_qty>0 then raise exception 'partial_arrival_requires_quantity'; end if;
      q:=t.qty;
    end if;
    select * into a from china_stock_arrivals where id=aid;
    if found then
      if a.transfer_id<>tid or a.qty<>q or a.received_date<>dt or a.confirmation_ref<>ref then raise exception 'stock_conflict'; end if;
      return china_stock_snapshot(ws);
    end if;
    if q>t.qty-t.received_qty then raise exception 'arrival_exceeds_remaining'; end if;
    insert into china_stock_arrivals(id,transfer_id,qty,received_date,confirmation_ref,created_by)
      values(aid,tid,q,dt,ref,p_actor);
    if t.received_qty+q=t.qty then
      -- Summary uses the latest physical arrival date, including backdated entry.
      select * into a from china_stock_arrivals where transfer_id=tid order by received_date desc,created_at desc,id desc limit 1;
      update china_stock_transfers set received_qty=qty,status='received',received_date=a.received_date,
        confirmation_ref=a.confirmation_ref,received_by=a.created_by where id=tid;
    else
      update china_stock_transfers set received_qty=received_qty+q where id=tid;
    end if;
  elsif p_input->>'action'='send' then
    if jsonb_typeof(p_input->'qty') is distinct from 'number' then raise exception 'invalid_transfer'; end if;
    raw_q:=(p_input->>'qty')::numeric; dt:=(p_input->>'moveDate')::date;
    if raw_q<=0 or raw_q>2147483647 or trunc(raw_q)<>raw_q or dt is null
      or to_char(dt,'YYYY-MM-DD')<>p_input->>'moveDate' then raise exception 'invalid_transfer'; end if;
    q:=raw_q;
    if found then
      if t.workspace<>ws or t.style_no is distinct from btrim(p_input->>'styleNo') or t.color is distinct from btrim(p_input->>'color')
        or t.qty<>q or t.sent_date is distinct from dt then raise exception 'stock_conflict'; end if;
    else
      m:=save_china_stock_move(p_input||jsonb_build_object('id','transfer_'||tid,'moveType','outbound','receiptLogId',null,'memo','중국 → 한국 이동'),p_actor);
      insert into china_stock_transfers(id,workspace,style_no,color,qty,sent_date,created_by,move_id)
        values(tid,ws,m->>'style_no',m->>'color',(m->>'qty')::bigint,(m->>'move_date')::date,p_actor,m->>'id');
    end if;
  else raise exception 'invalid_transfer'; end if;
  return china_stock_snapshot(ws);
end $$;
revoke all on function public.china_stock_snapshot(text),public.save_china_transfer(jsonb,text) from public,anon;
grant execute on function public.china_stock_snapshot(text),public.save_china_transfer(jsonb,text) to erp_server;
notify pgrst,'reload schema';
commit;
