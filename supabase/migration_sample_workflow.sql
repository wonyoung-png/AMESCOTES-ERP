-- Existing samples remain unchanged. Apply before the new caller; no historical auto-approval.
begin;
do $$ begin
  if to_regprocedure('public.queue_work_notifications()') is null then
    raise exception 'Apply migration_work_notification_outbox.sql first';
  end if;
end $$;
alter table public.samples add column if not exists completed_at timestamptz;
alter table public.samples add column if not exists completed_by text;
alter table public.samples add column if not exists review_status text;
alter table public.samples add column if not exists review_assignee_id text;
alter table public.samples add column if not exists review_card_id text;
alter table public.samples add column if not exists accepted_at timestamptz;
alter table public.samples add column if not exists accepted_by text;
alter table public.samples add column if not exists workflow_version integer not null default 0;

-- Generic browser saves cannot forge completion, acceptance or billing links.
create or replace function public.guard_sample_workflow() returns trigger language plpgsql as $$
begin
  if current_user <> 'erp_server' and current_user <> 'postgres' then
    if tg_op = 'INSERT' then
      if new.completed_at is not null or new.accepted_at is not null or new.review_status is not null
        or new.review_assignee_id is not null or new.review_card_id is not null
        or new.completed_by is not null or new.accepted_by is not null
        or new.stage = '최종승인' or new.billing_statement_id is not null
        or coalesce(new.billing_status,'미청구') <> '미청구' then
        raise exception using errcode='PT403', message='sample_workflow_required';
      end if;
    else
      if (new.completed_at,new.completed_by,new.review_status,new.review_assignee_id,new.review_card_id,
          new.accepted_at,new.accepted_by,new.approved_by,new.billing_status,new.billing_statement_id,new.billing_date)
        is distinct from
         (old.completed_at,old.completed_by,old.review_status,old.review_assignee_id,old.review_card_id,
          old.accepted_at,old.accepted_by,old.approved_by,old.billing_status,old.billing_statement_id,old.billing_date)
        or (new.stage = '최종승인' and old.stage is distinct from new.stage) then
        raise exception using errcode='PT403', message='sample_workflow_required';
      end if;
      if old.completed_at is not null and (new.image_urls,new.style_name,new.brand_code,new.buyer_id,new.sample_unit_price,new.stage)
        is distinct from (old.image_urls,old.style_name,old.brand_code,old.buyer_id,old.sample_unit_price,old.stage) then
        raise exception using errcode='PT403', message='sample_review_required';
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' then new.workflow_version := old.workflow_version + 1;
  else new.workflow_version := 0; end if;
  return new;
end $$;
drop trigger if exists sample_workflow_guard on public.samples;
create trigger sample_workflow_guard before insert or update on public.samples
for each row execute function public.guard_sample_workflow();

-- Keep the original behind review cards and ledger lines, including server callers.
create or replace function public.protect_sample_workflow_delete() returns trigger language plpgsql as $$
begin
  if old.completed_at is not null or old.review_card_id is not null or old.accepted_at is not null
    or old.review_status is not null or old.billing_statement_id is not null
    or coalesce(old.billing_status,'미청구') <> '미청구' then
    raise exception using errcode='PT409', message='protected_sample';
  end if;
  return old;
end $$;
drop trigger if exists sample_workflow_delete_guard on public.samples;
create trigger sample_workflow_delete_guard before delete on public.samples
for each row execute function public.protect_sample_workflow_delete();

create or replace function public.sample_workflow_version() returns integer language sql as $$ select 1 $$;
revoke all on function public.sample_workflow_version() from public, anon;
grant execute on function public.sample_workflow_version() to erp_server;
grant select,update on public.samples to erp_server;
grant select,insert,update on public.trade_statements to erp_server;
grant select on public.vendors to erp_server;

create or replace function public.act_sample_workflow(
  p_id text, p_action text, p_actor_id text, p_version integer, p_payload jsonb default '{}'
) returns jsonb language plpgsql as $$
declare
  s public.samples%rowtype; actor public.app_users%rowtype; lead public.app_users%rowtype;
  card_id text; boss boolean; today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  price numeric; photos jsonb;
  statement public.trade_statements%rowtype;
begin
  select * into actor from public.app_users where id=p_actor_id and is_active=true;
  if not found then raise exception using errcode='PT403',message='forbidden'; end if;
  boss := actor.role='대표' and lower(actor.email)='wonyoung@atlm.kr';
  if p_action='unbill' then
    select * into s from public.samples where id=p_id;
    if s.buyer_id is not null then perform pg_advisory_xact_lock(hashtext('sample-bill:'||s.buyer_id)); end if;
  end if;
  select * into s from public.samples where id=p_id for update;
  if not found then raise exception using errcode='PT404',message='not_found'; end if;
  if not boss and coalesce(actor.team,'') not in ('제품개발','생산관리') then
    raise exception using errcode='PT403',message='forbidden';
  end if;
  if p_action='complete' and s.completed_at is not null then return to_jsonb(s); end if;
  if p_action='accept' and s.review_status='accepted' then
    if not boss and s.review_assignee_id is distinct from actor.id then
      raise exception using errcode='PT403',message='forbidden';
    end if;
    return to_jsonb(s);
  end if;
  if p_action='unbill' and s.billing_statement_id is null and s.billing_status='미청구' then
    if not boss and s.review_assignee_id is distinct from actor.id then raise exception using errcode='PT403',message='forbidden'; end if;
    return to_jsonb(s);
  end if;
  if p_version is null or s.workflow_version <> p_version then
    raise exception using errcode='PT409',message='stale_sample';
  end if;
  if p_action='complete' then
    if s.stage='반려' or s.billing_statement_id is not null then
      raise exception using errcode='PT409',message='sample_not_editable';
    end if;
    photos := coalesce(p_payload->'imageUrls',to_jsonb(s.image_urls));
    if jsonb_typeof(photos)<>'array' or jsonb_array_length(photos) not between 1 and 5 then
      raise exception using errcode='22023',message='photo_required';
    end if;
    if exists(select 1 from jsonb_array_elements(photos) x where jsonb_typeof(x)<>'string' or length(x#>>'{}')<1) then
      raise exception using errcode='22023',message='photo_required';
    end if;
    if s.request_date::date > today then raise exception using errcode='22023',message='before_reception'; end if;
    -- Prefer the sole explicitly assigned lead; otherwise the org's designated development lead.
    select * into lead from public.app_users where is_active=true and team='제품개발'
      and (position like '%팀장%' or role like '%팀장%' or position like '%실장%') order by id limit 1;
    if (select count(*) from public.app_users where is_active=true and team='제품개발'
      and (position like '%팀장%' or role like '%팀장%' or position like '%실장%'))>1 then
      raise exception using errcode='PT409',message='sample_lead_ambiguous';
    end if;
    if lead.id is null then
      select * into lead from public.app_users where is_active=true and team='제품개발' and name='최세용';
      if (select count(*) from public.app_users where is_active=true and team='제품개발' and name='최세용')<>1 then
        raise exception using errcode='PT409',message='sample_lead_required';
      end if;
    end if;
    card_id := 'wc_'||md5('sample-review:'||s.id);
    update public.samples set image_urls=array(select jsonb_array_elements_text(photos)),completed_at=clock_timestamp(),completed_by=actor.id,
      review_status='pending',review_assignee_id=lead.id,review_card_id=card_id where id=s.id returning * into s;
    insert into public.work_cards(id,created_by,created_by_name,team,raw_text,kind,parsed,assignee_id,assignee_name,result_ref)
    values(card_id,actor.id,actor.name,'제품개발',coalesce(s.style_name,s.style_no)||' 샘플 완료 · 사진 확인 및 수락',
      'request_check',jsonb_build_object('title',coalesce(s.style_name,s.style_no)||' 샘플 확인','sampleReview',true,'sampleId',s.id),
      lead.id,lead.name,jsonb_build_object('table','samples','id',s.id));
    -- Existing durable work notification trigger queues exactly one request intent.
  elsif p_action='accept' then
    if not boss and s.review_assignee_id is distinct from actor.id then
      raise exception using errcode='PT403',message='forbidden';
    end if;
    if s.completed_at is null or s.review_status <> 'pending' then
      raise exception using errcode='PT409',message='sample_not_completed';
    end if;
    price := (p_payload->>'sampleUnitPrice')::numeric;
    if price is null or price<0 or price>100000000 or btrim(coalesce(p_payload->>'styleName',''))='' then
      raise exception using errcode='22023',message='sample_review_invalid';
    end if;
    if not exists(select 1 from public.vendors v where v.id=p_payload->>'buyerId' and v.type='바이어') then
      raise exception using errcode='22023',message='buyer_required';
    end if;
    if exists(select 1 from public.vendors v where v.id=p_payload->>'buyerId' and jsonb_typeof(v.brands)='array'
      and jsonb_array_length(v.brands)>0 and not exists(select 1 from jsonb_array_elements(v.brands) b
        where (jsonb_typeof(b)='string' and b#>>'{}'=p_payload->>'brandCode') or
          (jsonb_typeof(b)='object' and coalesce(nullif(b->>'code',''),b->>'name')=p_payload->>'brandCode'))) then
      raise exception using errcode='22023',message='brand_required';
    end if;
    update public.samples set style_name=btrim(p_payload->>'styleName'),buyer_id=p_payload->>'buyerId',
      brand_code=nullif(p_payload->>'brandCode',''),sample_unit_price=price,
      review_status='accepted',accepted_at=clock_timestamp(),accepted_by=actor.id,
      approved_by=actor.name,stage='최종승인' where id=s.id returning * into s;
    update public.work_cards set status='done',done_by_name=actor.name,done_at=clock_timestamp(),
      confirmed_payload=jsonb_build_object('sampleId',s.id,'acceptedBy',actor.id,'sampleUnitPrice',price),
      reply_text='샘플 수락 완료',replied_by_name=actor.name,updated_at=clock_timestamp() where id=s.review_card_id;
  elsif p_action='unbill' then
    if not boss and s.review_assignee_id is distinct from actor.id then raise exception using errcode='PT403',message='forbidden'; end if;
    select * into statement from public.trade_statements where id=s.billing_statement_id for update;
    if not found or statement.vendor_id is distinct from s.buyer_id or statement.status is distinct from '미청구'
      or statement.tax_invoice_no is not null or statement.collected_date is not null or s.billing_status='수금완료' then
      raise exception using errcode='PT409',message='statement_not_editable';
    end if;
    update public.trade_statements set lines=coalesce((select jsonb_agg(l) from jsonb_array_elements(coalesce(lines,'[]')) l
      where l->>'id' is distinct from 'sample-line-'||s.id and l->>'memo' is distinct from s.id),'[]'),updated_at=clock_timestamp()
      where id=statement.id;
    update public.samples set billing_status='미청구',billing_statement_id=null,billing_date=null where id=s.id returning * into s;
  else raise exception using errcode='22023',message='invalid_action'; end if;
  return to_jsonb(s);
end $$;
revoke all on function public.act_sample_workflow(text,text,text,integer,jsonb) from public,anon;
grant execute on function public.act_sample_workflow(text,text,text,integer,jsonb) to erp_server;

-- Lock each buyer before reading statements. Single/monthly/retry paths share one atomic writer.
create or replace function public.bill_accepted_samples(
  p_ids text[],p_actor_id text,p_statement_id text default null,p_month text default null
) returns jsonb language plpgsql as $$
declare
  actor public.app_users%rowtype; s public.samples%rowtype; st public.trade_statements%rowtype;
  buyer text; sid text; ids text[]; line jsonb; results jsonb := '[]'; vendor public.vendors%rowtype;
  today date := (clock_timestamp() at time zone 'Asia/Seoul')::date; seq integer; prefix text;
begin
  select * into actor from public.app_users where id=p_actor_id and is_active=true;
  if not found or not (actor.role='대표' and lower(actor.email)='wonyoung@atlm.kr'
      or actor.team='제품개발' and (actor.role like '%팀장%' or actor.position like '%팀장%' or actor.position like '%실장%' or actor.name='최세용')) then
    raise exception using errcode='PT403',message='forbidden';
  end if;
  if coalesce(cardinality(p_ids),0) not between 1 and 500 or
    (p_month is not null and p_month !~ '^\d{4}-(0[1-9]|1[0-2])$') then
    raise exception using errcode='22023',message='invalid_sample_ids';
  end if;
  if (select count(*) from public.samples where id=any(p_ids)) <> cardinality(p_ids) then
    raise exception using errcode='PT409',message='sample_selection_changed';
  end if;
  if p_statement_id is not null and (select count(distinct buyer_id) from public.samples where id=any(p_ids))<>1 then
    raise exception using errcode='22023',message='buyer_mismatch';
  end if;
  -- Consistent buyer order avoids cross-buyer deadlocks. Sample rows are locked after buyer locks.
  for buyer in select distinct buyer_id from public.samples where id=any(p_ids) order by buyer_id loop
    if buyer is null then raise exception using errcode='22023',message='buyer_required'; end if;
    perform pg_advisory_xact_lock(hashtext('sample-bill:'||buyer));
  end loop;
  perform 1 from public.samples where id=any(p_ids) order by id for update;
  for s in select * from public.samples where id=any(p_ids) order by id loop
    if not exists(select 1 from public.vendors v where v.id=s.buyer_id and v.type='바이어') then
      raise exception using errcode='22023',message='buyer_required';
    end if;
    if s.completed_at is null or s.review_status is distinct from 'accepted' or s.sample_unit_price is null or s.sample_unit_price<0
      or (p_month is not null and to_char(s.completed_at at time zone 'Asia/Seoul','YYYY-MM')<>p_month) then
      raise exception using errcode='PT409',message='sample_not_accepted';
    end if;
    if not (actor.role='대표' and lower(actor.email)='wonyoung@atlm.kr') and s.review_assignee_id is distinct from actor.id then
      raise exception using errcode='PT403',message='forbidden';
    end if;
  end loop;
  for buyer in select distinct buyer_id from public.samples where id=any(p_ids) order by buyer_id loop
    select array_agg(id order by id) into ids from public.samples where id=any(p_ids) and buyer_id=buyer;
    sid := coalesce(p_statement_id,'sample-batch-'||md5(buyer||':'||array_to_string(ids,',')));
    for s in select * from public.samples where id=any(ids) order by id loop
      -- Reuse a saved line regardless of caller mode/date, never create a second charge.
      select * into st from public.trade_statements t where t.vendor_id=buyer
        and exists(select 1 from jsonb_array_elements(coalesce(t.lines,'[]')) l where l->>'id'='sample-line-'||s.id or l->>'memo'=s.id)
        order by t.id limit 1 for update;
      if not found then
        if s.billing_statement_id is not null or s.billing_status<>'미청구' then
          raise exception using errcode='PT409',message='sample_billing_conflict';
        end if;
        select * into st from public.trade_statements where id=sid for update;
        if not found then
          if p_statement_id is not null then raise exception using errcode='PT404',message='statement_not_found'; end if;
          select * into vendor from public.vendors where id=buyer;
          -- Same lock family as the existing statement-number writer.
          prefix := to_char(today,'YYYYMM')||'-'||coalesce(nullif(vendor.vendor_code,''),nullif(vendor.code,''),'SAMP')||'-';
          perform pg_advisory_xact_lock(hashtext('ts:'||prefix));
          select coalesce(max(case when substring(statement_no from length(prefix)+1) ~ '^\d+$'
            then substring(statement_no from length(prefix)+1)::integer end),0)+1 into seq
            from public.trade_statements where statement_no like prefix||'%';
          insert into public.trade_statements(id,statement_no,vendor_id,vendor_name,vendor_code,issue_date,lines,status,created_at,updated_at)
            values(sid,prefix||lpad(seq::text,3,'0'),buyer,vendor.name,coalesce(vendor.vendor_code,vendor.code,'SAMP'),today,'[]','미청구',now(),now())
            returning * into st;
        end if;
        if st.vendor_id is distinct from buyer or st.status is distinct from '미청구' or st.tax_invoice_no is not null or st.collected_date is not null then
          raise exception using errcode='PT409',message='statement_not_editable';
        end if;
        line := jsonb_build_object('id','sample-line-'||s.id,'description',s.style_no||' · '||s.style_name||' 샘플비',
          'qty',1,'unitPrice',s.sample_unit_price,'taxType','과세','taxRate',0.1,'memo',s.id);
        update public.trade_statements set lines=coalesce(lines,'[]')||jsonb_build_array(line),updated_at=clock_timestamp()
          where id=st.id returning * into st;
      end if;
      if s.billing_statement_id is not null and s.billing_statement_id<>st.id then
        raise exception using errcode='PT409',message='sample_billing_conflict';
      end if;
      update public.samples set billing_status=case when billing_status='수금완료' then billing_status else '청구완료' end,
        billing_statement_id=st.id,billing_date=st.issue_date where id=s.id;
      results := results||jsonb_build_array(jsonb_build_object('sampleId',s.id,'statementId',st.id));
    end loop;
  end loop;
  return results;
end $$;
revoke all on function public.bill_accepted_samples(text[],text,text,text) from public,anon;
grant execute on function public.bill_accepted_samples(text[],text,text,text) to erp_server;
notify pgrst,'reload schema';
commit;
