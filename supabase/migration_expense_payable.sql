-- Explicit link of an EXISTING approved capture expense. No draft conversion,
-- no second cash-plan record, no changes to supplier statement generation.
begin;
alter table public.payables add column if not exists source_expense_key text;
alter table public.payables add column if not exists expense_approval_snapshot jsonb;
create unique index if not exists payables_source_expense_key_unique
  on public.payables(source_expense_key) where source_expense_key is not null;
create unique index if not exists payables_expense_source_unique
  on public.payables(source_id) where source_type='expense' and source_id is not null;
-- Legacy duplicates stop migration atomically; never repair/delete ledger rows.

create or replace function public.expense_payable_action(
  p_id text, p_actor_id text, p_action text, p_due_date date default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  e public.expenses%rowtype; c public.capture_inbox%rowtype;
  a public.app_users%rowtype; p public.payables%rowtype; n integer;
  snapshot jsonb; amount numeric; vendor text;
begin
  select * into a from public.app_users where id=p_actor_id and is_active=true for share;
  if not found or not coalesce(((a.role='대표' and lower(a.email)='wonyoung@atlm.kr')
    or (coalesce(a.role,'')<>'대표' and a.team='경영지원' and (a.role='팀장' or a.position='팀장'))),false) then
    raise exception 'forbidden';
  end if;
  if p_action is null or p_action not in ('inspect','link') or (p_action='link' and
    (p_due_date is null or p_due_date < date '1900-01-01' or p_due_date > date '9999-12-31')) then
    raise exception 'invalid_expense_link';
  end if;
  -- Serialize links for this source even when no payable exists yet.
  perform pg_advisory_xact_lock(hashtextextended('expense-payable:'||p_id,0));
  select * into e from public.expenses where id=p_id for update;
  if not found then raise exception 'expense_not_found'; end if;
  select count(*) into n from public.capture_inbox where status='approved'
    and result_ref->>'table'='expenses' and result_ref->>'id'=p_id;
  if n<>1 then raise exception 'expense_not_approved'; end if;
  select * into c from public.capture_inbox where status='approved'
    and result_ref->>'table'='expenses' and result_ref->>'id'=p_id for share;
  if not found or c.reviewed_at is null or c.reviewed_by is null then raise exception 'expense_not_approved'; end if;
  -- Only the documented capture snapshot mapping is supported. Never guess a
  -- missing vendor, paid card/cash expenditure, invoice amount or due date.
  if coalesce(jsonb_typeof(c.reviewed_payload->'amountKrw'),'null') not in ('number','string') then
    raise exception 'expense_mapping_required';
  end if;
  begin
    amount := (c.reviewed_payload->>'amountKrw')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'expense_mapping_required';
  end;
  vendor := nullif(btrim(c.reviewed_payload->>'vendorName'),'');
  if amount is null or amount::text in ('NaN','Infinity','-Infinity')
    or amount<=0 or amount>1000000000000 or vendor is null
    or c.reviewed_payload->>'expenseType' is distinct from '계좌이체' then
    raise exception 'expense_mapping_required';
  end if;
  if e.amount_krw is distinct from amount or e.vendor_name is distinct from vendor
    or e.expense_type is distinct from '계좌이체' then raise exception 'expense_snapshot_mismatch'; end if;
  snapshot := jsonb_build_object('captureId',c.id,'reviewedBy',c.reviewed_by,
    'reviewedAt',c.reviewed_at,'payload',c.reviewed_payload,'resultRef',c.result_ref);
  select count(*) into n from public.payables where source_expense_key=p_id
    or (source_type='expense' and source_id=p_id);
  if n>1 then raise exception 'expense_payable_conflict'; end if;
  if n=1 then
    select * into p from public.payables where source_expense_key=p_id
      or (source_type='expense' and source_id=p_id) for update;
    if p.source_type is distinct from 'expense' or p.source_id is distinct from p_id
      or (p.source_expense_key is not null and p.source_expense_key is distinct from p_id)
      or p.amount_krw is distinct from amount or p.vendor_name is distinct from vendor
      or p.vendor_id is distinct from e.vendor_id or p.due_date is null
      or (p.expense_approval_snapshot is not null and p.expense_approval_snapshot is distinct from snapshot)
      or (p_action='link' and p.due_date is distinct from p_due_date) then
      raise exception 'expense_payable_conflict';
    end if;
    if p_action='link' then
      update public.payables set source_expense_key=p_id,expense_approval_snapshot=snapshot where id=p.id returning * into p;
    end if;
  elsif p_action='link' then
    if exists(select 1 from public.payables where id='pay_exp_'||p_id) then raise exception 'expense_payable_conflict'; end if;
    insert into public.payables(id,vendor_id,vendor_name,project_no,source_type,source_id,
      source_expense_key,expense_approval_snapshot,amount_krw,paid_amount_krw,due_date,status,memo)
    values('pay_exp_'||p_id,e.vendor_id,vendor,e.order_no,'expense',p_id,p_id,snapshot,
      amount,0,p_due_date,'pending','승인 지출 · '||coalesce(e.description,'')) returning * into p;
  end if;
  return jsonb_build_object('expenseId',p_id,'amountKrw',amount,'vendorName',vendor,
    'approvalId',c.id,'payable',case when p.id is null then null else to_jsonb(p) end);
end $$;
revoke all on function public.expense_payable_action(text,text,text,date) from public,anon;
grant execute on function public.expense_payable_action(text,text,text,date) to erp_server;

-- Legacy whole-cache upserts must not change financial input after linking.
create or replace function public.guard_linked_expense() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.payables where source_expense_key=old.id
      or (source_type='expense' and source_id=old.id)) then raise exception 'expense_payable_conflict'; end if;
    return old;
  end if;
  -- Keep legacy expense upserts working: BEFORE INSERT may see an existing id;
  -- the UPDATE branch below still validates the eventual ON CONFLICT update.
  if tg_op='INSERT' then
    if not exists(select 1 from public.expenses where id=new.id) and
      exists(select 1 from public.payables where source_expense_key=new.id
        or (source_type='expense' and source_id=new.id)) then raise exception 'expense_payable_conflict'; end if;
    return new;
  end if;
  if exists(select 1 from public.payables where source_expense_key=old.id
    or (source_type='expense' and source_id=old.id)) and
    (new.id,new.amount_krw,new.vendor_id,new.vendor_name,new.expense_type,new.lines,new.order_no)
      is distinct from (old.id,old.amount_krw,old.vendor_id,old.vendor_name,old.expense_type,old.lines,old.order_no) then
    raise exception 'expense_payable_conflict';
  end if;
  return new;
end $$;
create or replace trigger guard_linked_expense before insert or update or delete on public.expenses
  for each row execute function public.guard_linked_expense();

-- A browser cannot fabricate the new approval linkage through generic upserts.
-- Linked principal/source/due date remain fixed; payment updates still work.
create or replace function public.guard_expense_payable_link() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.source_type='expense' or old.source_expense_key is not null
      or old.expense_approval_snapshot is not null then raise exception 'expense_payable_conflict'; end if;
    return old;
  end if;
  if tg_op='INSERT' then
    -- BEFORE INSERT runs even for UPSERT conflicts. Linked liabilities must be
    -- edited with UPDATE, so default paid/status values cannot reset payments.
    if current_user in ('anon','authenticated','erp_server') and
      (new.source_type='expense' or new.source_expense_key is not null or new.expense_approval_snapshot is not null
        or exists(select 1 from public.payables where id=new.id and
          (source_type='expense' or source_expense_key is not null or expense_approval_snapshot is not null))) then
      raise exception 'forbidden';
    end if;
    return new;
  end if;
  if current_user in ('anon','authenticated','erp_server') and
    ((new.source_expense_key,new.expense_approval_snapshot) is distinct from
      (old.source_expense_key,old.expense_approval_snapshot)
      or (new.source_type='expense' and old.source_type is distinct from 'expense')) then
    raise exception 'forbidden';
  end if;
  if (old.source_type='expense' or old.source_expense_key is not null or old.expense_approval_snapshot is not null) then
    if (new.paid_amount_krw,new.status) is distinct from (old.paid_amount_krw,old.status) then
      -- Existing record_payable_payment is SECURITY INVOKER under erp_server.
      -- Permit its monotonic payment transition, never an anonymous reset/cancel.
      if current_user in ('anon','authenticated') or new.paid_amount_krw is null
        or new.paid_amount_krw::text in ('NaN','Infinity','-Infinity')
        or new.paid_amount_krw<=coalesce(old.paid_amount_krw,0) or new.paid_amount_krw>old.amount_krw
        or old.status is null or old.status not in ('pending','partial')
        or new.status is distinct from (case when new.paid_amount_krw=old.amount_krw then 'paid' else 'partial' end) then
        raise exception 'expense_payable_conflict';
      end if;
    end if;
  end if;
  if (old.source_type='expense' or old.source_expense_key is not null or old.expense_approval_snapshot is not null) and
    (new.id,new.source_expense_key,new.expense_approval_snapshot,new.source_type,new.source_id,
      new.amount_krw,new.vendor_id,new.vendor_name,new.due_date,new.project_no)
    is distinct from
    (old.id,old.source_expense_key,old.expense_approval_snapshot,old.source_type,old.source_id,
      old.amount_krw,old.vendor_id,old.vendor_name,old.due_date,old.project_no) then
    -- Only the dedicated definer RPC may attach snapshots to a legacy row.
    if current_user in ('anon','authenticated','erp_server') or
      (new.id,new.source_type,new.source_id,new.amount_krw,new.vendor_id,new.vendor_name,new.due_date,new.project_no)
        is distinct from
      (old.id,old.source_type,old.source_id,old.amount_krw,old.vendor_id,old.vendor_name,old.due_date,old.project_no)
      or (old.source_expense_key is not null and new.source_expense_key is distinct from old.source_expense_key)
      or (old.expense_approval_snapshot is not null and new.expense_approval_snapshot is distinct from old.expense_approval_snapshot) then
      raise exception 'expense_payable_conflict';
    end if;
  end if;
  return new;
end $$;
create or replace trigger guard_expense_payable_link before insert or update or delete on public.payables
  for each row execute function public.guard_expense_payable_link();
commit;
