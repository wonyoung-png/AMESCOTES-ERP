begin;
create or replace function public.save_settlement(p_input jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare
  s jsonb:=p_input->'settlement'; expected jsonb:=nullif(p_input->'expected','null'::jsonb);
  sid text:=s->>'id'; inv text:=nullif(btrim(s->>'invoiceNo'),''); old_inv text;
  original public.settlements%rowtype; saved public.settlements%rowtype;
  linked public.trade_statements%rowtype; linked_id text; snapshot jsonb; requested jsonb;
  bill numeric; paid numeric; invoice_dt date; due_dt date; paid_dt date; state text;
  today date:=(now() at time zone 'Asia/Seoul')::date; same boolean;
begin
  if sid is null or sid !~ '^[a-zA-Z0-9_-]{1,100}$' or nullif(btrim(s->>'buyerName'),'') is null
    or coalesce(s->>'channel','') not in ('W Concept','29CM','자사몰','해외T/T','B2B직납','기타')
    or (nullif(s->>'workspace','') is not null and s->>'workspace' not in ('OEM','LUMEN','AETALOOF'))
    or jsonb_typeof(s->'billedAmountKrw') is distinct from 'number'
    or jsonb_typeof(s->'collectedAmountKrw') is distinct from 'number'
    then raise exception 'invalid_settlement'; end if;
  begin
    bill:=(s->>'billedAmountKrw')::numeric; paid:=(s->>'collectedAmountKrw')::numeric;
    invoice_dt:=(s->>'invoiceDate')::date; due_dt:=(s->>'dueDate')::date;
    paid_dt:=nullif(s->>'collectedDate','')::date;
  exception when others then raise exception 'invalid_settlement'; end;
  if bill<=0 or bill>9007199254740991 or paid<0 or paid>bill
    or invoice_dt is null or due_dt is null or to_char(invoice_dt,'YYYY-MM-DD')<>s->>'invoiceDate'
    or to_char(due_dt,'YYYY-MM-DD')<>s->>'dueDate'
    or (paid>0 and (paid_dt is null or to_char(paid_dt,'YYYY-MM-DD')<>s->>'collectedDate'))
    then raise exception 'invalid_settlement'; end if;
  if paid=0 then paid_dt:=null; end if;
  state:=case when paid=bill then '완납' when due_dt<today then '위험' when due_dt<=today+14 then '주의' else '정상' end;
  if nullif(s->>'buyerId','') is not null and not exists(select 1 from public.vendors where id=s->>'buyerId')
    then raise exception 'bill_buyer_not_found'; end if;

  select invoice_no into old_inv from public.settlements where id=sid;
  -- 번호 변경은 연결 원본을 잃게 하므로 기존 전표에서는 별도 정정이 필요하다.
  if found and nullif(btrim(old_inv),'') is distinct from inv then raise exception 'settlement_number_changed'; end if;
  if inv is not null then
    if (select count(*) from public.trade_statements where statement_no=inv)>1 then raise exception 'duplicate_statement'; end if;
    select id into linked_id from public.trade_statements where statement_no=inv;
    if linked_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('statement:'||linked_id,0));
      select * into linked from public.trade_statements where id=linked_id for update;
      if linked.statement_no is distinct from inv then raise exception 'statement_link_conflict'; end if;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('invoice:'||inv,0));
    if (select count(*) from public.trade_statements where statement_no=inv)>1 then raise exception 'duplicate_statement'; end if;
    if linked.id is null and exists(select 1 from public.trade_statements where statement_no=inv)
      then raise exception 'statement_link_conflict'; end if;
    if exists(select 1 from public.settlements where invoice_no=inv and id<>sid) then raise exception 'duplicate_settlement'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('settlement:'||sid,0));
  select * into original from public.settlements where id=sid for update;
  if original.id is not null and nullif(btrim(original.invoice_no),'') is distinct from inv then raise exception 'settlement_number_changed'; end if;
  requested:=jsonb_build_object('id',sid,'buyer_id',nullif(s->>'buyerId',''),'buyer_name',btrim(s->>'buyerName'),
    'project_no',nullif(s->>'projectNo',''),'workspace',nullif(s->>'workspace',''),'channel',s->>'channel',
    'invoice_no',inv,'invoice_date',invoice_dt,'due_date',due_dt,'billed_amount_krw',bill,
    'collected_amount_krw',paid,'collected_date',paid_dt,'memo',nullif(s->>'memo',''));
  if original.id is not null then
    snapshot:=to_jsonb(original)-'created_at'-'status';
    -- 현재 스키마에 없는 메타 열은 비교에서 제외하고 화면에서 읽은 필드만 검사한다.
    select jsonb_object_agg(key,case when value='""'::jsonb then 'null'::jsonb else value end)
      into snapshot from jsonb_each(snapshot) where requested ? key;
    snapshot:=snapshot||jsonb_build_object('billed_amount_krw',coalesce(original.billed_amount_krw,0),
      'collected_amount_krw',coalesce(original.collected_amount_krw,0));
    same:=snapshot=requested;
    if not same and (expected is null or (expected-'created_at'-'status') is distinct from snapshot)
      then raise exception 'stale_settlement'; end if;
    if paid<coalesce(original.collected_amount_krw,0) then raise exception 'collection_reversal_required'; end if;
  elsif expected is not null then raise exception 'settlement_not_found'; end if;
  if linked.id is not null then
    if linked.status not in ('청구완료','수금완료') then raise exception 'statement_not_billed'; end if;
    if linked.vendor_id is distinct from nullif(s->>'buyerId','') or public.erp_statement_amount(linked.lines)<>bill
      or linked.workspace is distinct from nullif(s->>'workspace','')
      or linked.project_no is distinct from nullif(s->>'projectNo','') then raise exception 'linked_bill_locked'; end if;
  end if;
  if original.id is null then
    insert into public.settlements(id,buyer_id,buyer_name,project_no,workspace,channel,invoice_no,invoice_date,due_date,
      billed_amount_krw,collected_amount_krw,collected_date,status,memo)
      values(sid,nullif(s->>'buyerId',''),btrim(s->>'buyerName'),nullif(s->>'projectNo',''),nullif(s->>'workspace',''),
        s->>'channel',inv,invoice_dt,due_dt,bill,paid,paid_dt,state,nullif(s->>'memo','')) returning * into saved;
  else
    update public.settlements set buyer_id=nullif(s->>'buyerId',''),buyer_name=btrim(s->>'buyerName'),
      project_no=nullif(s->>'projectNo',''),workspace=nullif(s->>'workspace',''),channel=s->>'channel',
      invoice_no=inv,invoice_date=invoice_dt,due_date=due_dt,billed_amount_krw=bill,collected_amount_krw=paid,
      collected_date=paid_dt,status=state,memo=nullif(s->>'memo','') where id=sid returning * into saved;
  end if;
  if linked.id is not null and (linked.status is distinct from case when paid=bill then '수금완료' else '청구완료' end
    or linked.collected_date is distinct from case when paid=bill then paid_dt else null end) then
    update public.trade_statements set status=case when paid=bill then '수금완료' else '청구완료' end,
      collected_date=case when paid=bill then paid_dt else null end,updated_at=clock_timestamp()
      where id=linked.id returning * into linked;
  end if;
  return jsonb_build_object('settlement',to_jsonb(saved),'statement',case when linked.id is not null then to_jsonb(linked) end);
end $$;
revoke all on function public.save_settlement(jsonb) from public,anon;
grant execute on function public.save_settlement(jsonb) to erp_server;
create or replace function public.protect_settlement_delete()
returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(old.collected_amount_krw,0)>0 or exists(select 1 from public.trade_statements where statement_no=old.invoice_no)
    then raise exception 'protected_settlement'; end if;
  return old;
end $$;
do $$begin
  if not exists(select 1 from pg_trigger where tgrelid='public.settlements'::regclass and tgname='protect_settlement_delete') then
    create trigger protect_settlement_delete before delete on public.settlements for each row execute function public.protect_settlement_delete();
  end if;
end $$;
revoke all on function public.protect_settlement_delete() from public,anon;
-- 구버전 브라우저의 전체 캐시 upsert도 서버 검증을 우회하지 못한다. 조회 권한은 유지한다.
revoke insert,update on public.settlements from anon;
grant select,insert,update on public.settlements to erp_server;
notify pgrst,'reload schema';
commit;
