-- Additive only. Receipt candidates remain pending until explicit representative approval.
-- Prerequisites: phase1 manufacturing + defect disposition + receipt/payable generation migrations.
begin;
-- No default disposition: legacy candidates must not silently become deductible.
alter table public.defect_carryovers add column if not exists qty integer;
alter table public.defect_carryovers add column if not exists disposition text;
alter table public.defect_carryovers add column if not exists approved_by text;
alter table public.defect_carryovers add column if not exists approved_at timestamptz;
alter table public.defect_carryovers add column if not exists approved_amount_krw numeric;
alter table public.defect_carryovers add column if not exists approval_reason text;
alter table public.defect_carryovers add column if not exists approved_payable_id text;
alter table public.defect_carryovers add column if not exists approval_result jsonb;

-- Existing generic browser saves cannot forge approval or overwrite an approved candidate.
create or replace function public.guard_defect_approval() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then
    if old.approved_at is not null or (old.id like 'def\_%' escape '\' and current_user in ('anon','authenticated','erp_server')) then
      raise exception 'defect_approval_required'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.id like 'def\_%' escape '\' and current_user in ('anon','authenticated')
    and (new.id,new.order_no,new.project_no,new.vendor_id,new.qty,new.disposition,new.status,new.amount_krw)
      is distinct from (old.id,old.order_no,old.project_no,old.vendor_id,old.qty,old.disposition,old.status,old.amount_krw) then
    raise exception 'defect_approval_required';
  end if;
  if tg_op='UPDATE' and old.approved_at is not null then
    if new is distinct from old then raise exception 'defect_approval_required'; end if;
  elsif new.approved_at is not null or new.approved_by is not null or new.approved_amount_krw is not null
    or new.approval_reason is not null or new.approved_payable_id is not null or new.approval_result is not null
    or (tg_op='INSERT' and new.status='applied') or (tg_op='UPDATE' and new.status='applied' and old.status is distinct from 'applied') then
    if current_user in ('anon','authenticated','erp_server')
      or current_setting('ames.defect_approval',true) is distinct from 'on' then raise exception 'defect_approval_required'; end if;
  end if;
  return new;
end $$;
do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.defect_carryovers'::regclass and tgname='defect_approval_guard') then
    create trigger defect_approval_guard before insert or update or delete on public.defect_carryovers
      for each row execute function public.guard_defect_approval();
  end if;
end $$;

-- Protect the original receipt liability BEFORE approval, including missing/deleted candidates.
-- Use receipt evidence as well as approval linkage so clearing a candidate cannot unlock money.
create or replace function public.guard_deducted_payable() returns trigger language plpgsql as $$
declare protected boolean;
  approval_write boolean := current_user not in ('anon','authenticated','erp_server')
    and current_setting('ames.defect_approval',true)='on';
begin
  if tg_op='INSERT' then
    if current_user in ('anon','authenticated','erp_server') and exists(
      select 1 from public.payables p where p.id=new.id and (
        exists(select 1 from public.defect_carryovers d where (d.approved_payable_id=p.id and d.approved_at is not null)
          or p.id='pay_'||substr(d.id,5) or d.id='def_'||p.source_id
          or coalesce(p.receipt_log_ids,'[]') @> jsonb_build_array(substr(d.id,5)))
        or exists(select 1 from public.receipt_logs r where r.log_type='inbound' and r.defect_qty>0
          and (p.id='pay_'||r.id or p.source_id=r.id or coalesce(p.receipt_log_ids,'[]') @> jsonb_build_array(r.id))))) then
      raise exception 'defect_approval_required';
    end if;
    if current_user in ('anon','authenticated') and exists(
      select 1 from public.receipt_logs r where r.log_type='inbound' and r.defect_qty>0
        and (new.id='pay_'||r.id or new.source_id=r.id or coalesce(new.receipt_log_ids,'[]') @> jsonb_build_array(r.id))) then
      raise exception 'defect_approval_required';
    end if;
    return new; -- Existing server receipt RPCs may create a NEW gross liability.
  end if;
  protected := exists(select 1 from public.defect_carryovers d where (d.approved_payable_id=old.id and d.approved_at is not null)
      or old.id='pay_'||substr(d.id,5) or d.id='def_'||old.source_id
      or coalesce(old.receipt_log_ids,'[]') @> jsonb_build_array(substr(d.id,5)))
    or exists(select 1 from public.receipt_logs r where r.log_type='inbound' and r.defect_qty>0
      and (old.id='pay_'||r.id or old.source_id=r.id or coalesce(old.receipt_log_ids,'[]') @> jsonb_build_array(r.id)));
  if not protected then return case when tg_op='DELETE' then old else new end; end if;
  if tg_op='DELETE' then
    raise exception 'defect_approval_required';
  end if;
  if (new.paid_amount_krw,new.status) is distinct from (old.paid_amount_krw,old.status)
    and not coalesce(approval_write,false) then
    if current_user<>'erp_server' or old.status is null or old.status not in ('pending','partial')
      or old.paid_amount_krw is null or old.paid_amount_krw<0
      or old.paid_amount_krw::text in ('NaN','Infinity','-Infinity')
      or new.paid_amount_krw is null or new.paid_amount_krw::text in ('NaN','Infinity','-Infinity')
      or new.paid_amount_krw<=old.paid_amount_krw or new.paid_amount_krw>old.amount_krw
      or new.status is distinct from (case when new.paid_amount_krw=old.amount_krw then 'paid' else 'partial' end) then
      raise exception 'defect_approval_required';
    end if;
  end if;
  if (new.id,new.amount_krw,new.vendor_id,new.order_id,new.project_no,new.source_type,new.source_id,new.payee_type,new.receipt_log_ids)
    is distinct from (old.id,old.amount_krw,old.vendor_id,old.order_id,old.project_no,old.source_type,old.source_id,old.payee_type,old.receipt_log_ids)
    and not coalesce(approval_write,false) then
    raise exception 'defect_approval_required';
  end if;
  return new;
end $$;
create or replace trigger deducted_payable_guard before insert or update or delete on public.payables
  for each row execute function public.guard_deducted_payable();

-- Extend the inspected migration_payable_payment_atomic.sql RPC in this additive migration.
-- Remains SECURITY INVOKER: existing erp_server monotonic payments work with the guard.
create or replace function public.record_payable_payment(p_id text,p_amount numeric,p_expected_paid numeric)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare p public.payables%rowtype; paid numeric;
begin
  if p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_expected_paid is null or p_expected_paid<0 or p_expected_paid::text in ('NaN','Infinity','-Infinity') then raise exception 'invalid_payment'; end if;
  select * into p from public.payables where id=p_id for update;
  if not found then raise exception 'not_found'; end if;
  if p.status is null or p.status not in ('pending','partial') then raise exception 'payable_not_pending'; end if;
  if p.paid_amount_krw<0 or p.paid_amount_krw::text in ('NaN','Infinity','-Infinity') then raise exception 'invalid_payment'; end if;
  if coalesce(p.memo,'') ~ '^\[자금계획\|[^|]+\|[^|]+\|예상(\||\])' then raise exception 'planned_only'; end if;
  if coalesce(p.paid_amount_krw,0)<>p_expected_paid then raise exception 'stale_payment'; end if;
  paid:=coalesce(p.paid_amount_krw,0)+p_amount;
  if p.amount_krw is null or p.amount_krw::text in ('NaN','Infinity','-Infinity') or paid>p.amount_krw then raise exception 'overpayment'; end if;
  update public.payables set paid_amount_krw=paid,
    status=case when paid=p.amount_krw then 'paid' else 'partial' end,updated_at=now() where id=p_id returning * into p;
  return to_jsonb(p);
end $$;
revoke all on function public.record_payable_payment(text,numeric,numeric) from public,anon;
grant execute on function public.record_payable_payment(text,numeric,numeric) to erp_server;

create or replace function public.defect_approval_version() returns integer language sql as $$ select 1 $$;
create or replace function public.approve_defect_deduction(p_id text,p_actor_id text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.defect_carryovers%rowtype; p public.payables%rowtype;
  r public.receipt_logs%rowtype; o public.production_orders%rowtype;
  amount numeric; result jsonb;
begin
  if not exists(select 1 from public.app_users where id=p_actor_id and is_active and role='대표' and lower(email)='wonyoung@atlm.kr') then
    raise exception 'forbidden'; end if;
  if p_id is null or p_id !~ '^def_[A-Za-z0-9_-]{1,96}$'
    or coalesce(p_input->>'payableId','') !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'invalid_approval'; end if;
  -- Lock order before candidate/payable to agree with receipt generation's lock order.
  select * into r from public.receipt_logs where id=substr(p_id,5);
  if not found then raise exception 'not_found'; end if;
  select * into o from public.production_orders where id=r.order_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into r from public.receipt_logs where id=substr(p_id,5) for update;
  select * into d from public.defect_carryovers where id=p_id for update;
  if not found then raise exception 'not_found'; end if;
  -- Same candidate/target retry returns ORIGINAL saved amount, even after later payments.
  if d.approved_at is not null then
    if d.approved_payable_id is distinct from p_input->>'payableId' or d.approval_result is null then raise exception 'approval_conflict'; end if;
    return d.approval_result || jsonb_build_object('retry',true);
  end if;
  if d.status is distinct from 'pending' or d.disposition is distinct from 'deduct' then raise exception 'not_deductible'; end if;
  if jsonb_typeof(p_input->'amount') is distinct from 'number'
    or p_input->'factoryResponsible' is distinct from 'true'::jsonb
    or jsonb_typeof(p_input->'reason') is distinct from 'string'
    or length(btrim(p_input->>'reason')) not between 1 and 1000 then raise exception 'invalid_approval'; end if;
  amount:=(p_input->>'amount')::numeric;
  if amount<=0 or amount>9007199254740991 or amount<>trunc(amount) then raise exception 'invalid_approval'; end if;
  if to_jsonb(d) is distinct from p_input->'expectedDefect' then raise exception 'stale_defect'; end if;
  select * into p from public.payables where id=p_input->>'payableId' for update;
  if not found then raise exception 'not_found'; end if;
  if to_jsonb(p) is distinct from p_input->'expectedPayable' then raise exception 'stale_payable'; end if;
  if r.log_type is distinct from 'inbound' or r.order_id is distinct from o.id
    or r.defect_qty is null or r.defect_qty<=0 or d.qty is distinct from r.defect_qty
    or nullif(btrim(o.order_no),'') is null
    or nullif(d.vendor_id,'') is null or d.vendor_id is distinct from o.vendor_id
    or d.order_no is distinct from o.order_no or r.order_no is distinct from o.order_no
    or d.project_no is distinct from o.project_no or p.project_no is distinct from o.project_no
    or p.vendor_id is distinct from d.vendor_id or p.order_id is distinct from o.id
    or p.source_type is distinct from 'order_receipt' or p.payee_type is distinct from 'factory_direct'
    or not (coalesce(p.source_id=r.id,false) or coalesce(p.receipt_log_ids,'[]'::jsonb) @> jsonb_build_array(r.id))
    then raise exception 'defect_mismatch'; end if;
  if p.status is null or p.status not in ('pending','partial')
    or o.status is null or o.status not in ('발주생성','생산중','생산완료','입고완료')
    or coalesce(p.memo,'') like '[자금계획|%|예상|%' then raise exception 'payable_not_pending'; end if;
  if p.amount_krw is null or p.paid_amount_krw is null or p.paid_amount_krw<0
    or p.amount_krw::text in ('NaN','Infinity','-Infinity') or p.paid_amount_krw::text in ('NaN','Infinity','-Infinity')
    or amount>p.amount_krw-p.paid_amount_krw then raise exception 'over_deduction'; end if;
  perform set_config('ames.defect_approval','on',true);
  update public.payables set amount_krw=amount_krw-amount,
    status=case when amount_krw-amount=paid_amount_krw then 'paid' when paid_amount_krw>0 then 'partial' else 'pending' end,
    updated_at=now() where id=p.id returning * into p;
  result:=jsonb_build_object('defectId',d.id,'payable',to_jsonb(p),'approvedAmount',amount,
    'approvedBy',p_actor_id,'approvedAt',now(),'reason',btrim(p_input->>'reason'),'retry',false);
  update public.defect_carryovers set status='applied',approved_by=p_actor_id,approved_at=now(),
    approved_amount_krw=amount,approval_reason=btrim(p_input->>'reason'),approved_payable_id=p.id,approval_result=result where id=d.id;
  perform set_config('ames.defect_approval','off',true);
  return result;
end $$;
revoke all on function public.approve_defect_deduction(text,text,jsonb),public.defect_approval_version() from public,anon;
grant execute on function public.approve_defect_deduction(text,text,jsonb),public.defect_approval_version() to erp_server;
notify pgrst,'reload schema';
commit;
