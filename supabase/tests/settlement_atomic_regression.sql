begin;
-- 수금 저장 후 연결 명세표 실패를 유도한다. 함수·트리거·합성 자료 모두 마지막에 롤백한다.
create or replace function public.test_collection_failure() returns trigger language plpgsql as $$
begin
  if new.memo='synthetic_collection_failure' and new.status='수금완료' then raise exception 'test_collection_failure'; end if;
  return new;
end $$;
create trigger test_collection_failure before update on public.trade_statements for each row execute function public.test_collection_failure();
set local role erp_server;
do $$
declare
  root text:='test_collect_'||substr(md5(clock_timestamp()::text),1,12);
  s jsonb; r jsonb; first_row jsonb; current_row jsonb; changed jsonb; b jsonb; linked_s jsonb; checks int:=0;
begin
  s:=jsonb_build_object('id',root,'buyerName','test manual','channel','기타','invoiceDate','2026-10-10',
    'dueDate','2026-11-10','billedAmountKrw',1000,'collectedAmountKrw',0);
  r:=public.save_settlement(jsonb_build_object('settlement',s,'expected',null)); first_row:=r->'settlement';
  assert (first_row->>'billed_amount_krw')::numeric=1000 and (first_row->>'collected_amount_krw')::numeric=0,'manual insert'; checks:=checks+1;
  r:=public.save_settlement(jsonb_build_object('settlement',s,'expected',null));
  assert (select count(*) from public.settlements where id=root)=1,'create retry duplicate'; checks:=checks+1;
  s:=s||'{"collectedAmountKrw":300,"collectedDate":"2026-10-10"}'::jsonb;
  r:=public.save_settlement(jsonb_build_object('settlement',s,'expected',first_row)); current_row:=r->'settlement';
  assert (current_row->>'collected_amount_krw')::numeric=300,'partial collect'; checks:=checks+1;
  r:=public.save_settlement(jsonb_build_object('settlement',s,'expected',first_row));
  assert (r->'settlement'->>'collected_amount_krw')::numeric=300,'partial retry incremented'; checks:=checks+1;
  begin perform public.save_settlement(jsonb_build_object('settlement',s||'{"memo":"stale"}'::jsonb,'expected',first_row)); raise exception 'assert_stale';
  exception when others then if sqlerrm<>'stale_settlement' then raise; end if; end; checks:=checks+1;
  begin perform public.save_settlement(jsonb_build_object('settlement',s||'{"collectedAmountKrw":200}'::jsonb,'expected',current_row)); raise exception 'assert_reversal';
  exception when others then if sqlerrm<>'collection_reversal_required' then raise; end if; end; checks:=checks+1;
  begin perform public.save_settlement(jsonb_build_object('settlement',s||'{"collectedAmountKrw":1001}'::jsonb,'expected',current_row)); raise exception 'assert_over';
  exception when others then if sqlerrm<>'invalid_settlement' then raise; end if; end; checks:=checks+1;
  begin perform public.save_settlement(jsonb_build_object('settlement',s||'{"collectedDate":""}'::jsonb,'expected',current_row)); raise exception 'assert_date';
  exception when others then if sqlerrm<>'invalid_settlement' then raise; end if; end; checks:=checks+1;
  begin perform public.save_settlement(jsonb_build_object('settlement',s||'{"invoiceNo":"changed"}'::jsonb,'expected',current_row)); raise exception 'assert_number';
  exception when others then if sqlerrm<>'settlement_number_changed' then raise; end if; end; checks:=checks+1;
  begin perform public.save_settlement(jsonb_build_object('settlement',s||'{"billedAmountKrw":0}'::jsonb,'expected',current_row)); raise exception 'assert_zero';
  exception when others then if sqlerrm<>'invalid_settlement' then raise; end if; end; checks:=checks+1;

  insert into public.vendors(id,name,code) values(root||'_buyer','test linked',root);
  b:=jsonb_build_object('id',root||'_statement','vendorId',root||'_buyer','issueDate','2026-10-10','workspace','OEM',
    'projectNo',root,'status','청구완료','lines','[{"description":"test","qty":10,"unitPrice":100,"taxType":"과세","taxRate":0.1}]'::jsonb);
  r:=public.save_statement_billing(jsonb_build_object('statement',b,'invoiceDate','2026-10-10','expectedUpdatedAt',null));
  current_row:=r->'settlement';
  linked_s:=jsonb_build_object('id',current_row->>'id','buyerId',root||'_buyer','buyerName','test linked',
    'workspace','OEM','projectNo',root,'channel','B2B직납','invoiceNo',current_row->>'invoice_no',
    'invoiceDate',current_row->>'invoice_date','dueDate',current_row->>'due_date','billedAmountKrw',1100,
    'collectedAmountKrw',300,'collectedDate','2026-10-10');
  r:=public.save_settlement(jsonb_build_object('settlement',linked_s,'expected',current_row)); current_row:=r->'settlement';
  assert r->'statement'->>'status'='청구완료' and r->'statement'->'collected_date'='null'::jsonb,'partial linked status'; checks:=checks+1;
  begin perform public.save_settlement(jsonb_build_object('settlement',linked_s||'{"billedAmountKrw":1200}'::jsonb,'expected',current_row)); raise exception 'assert_bill';
  exception when others then if sqlerrm<>'linked_bill_locked' then raise; end if; end; checks:=checks+1;
  begin perform public.save_settlement(jsonb_build_object('settlement',linked_s||jsonb_build_object('id',root||'_duplicate'),'expected',null)); raise exception 'assert_duplicate';
  exception when others then if sqlerrm<>'duplicate_settlement' then raise; end if; end; checks:=checks+1;
  update public.trade_statements set memo='synthetic_collection_failure' where id=root||'_statement';
  changed:=linked_s||'{"collectedAmountKrw":1100}'::jsonb;
  begin perform public.save_settlement(jsonb_build_object('settlement',changed,'expected',current_row)); raise exception 'assert_failure';
  exception when others then if sqlerrm<>'test_collection_failure' then raise; end if; end;
  assert (select collected_amount_krw from public.settlements where id=current_row->>'id')=300
    and (select status from public.trade_statements where id=root||'_statement')='청구완료','collection rollback'; checks:=checks+1;
  update public.trade_statements set memo=null where id=root||'_statement';
  r:=public.save_settlement(jsonb_build_object('settlement',changed,'expected',current_row));
  assert r->'settlement'->>'status'='완납' and r->'statement'->>'status'='수금완료'
    and r->'statement'->>'collected_date'='2026-10-10','linked full collection'; checks:=checks+1;
  first_row:=r->'statement';
  r:=public.save_settlement(jsonb_build_object('settlement',changed,'expected',current_row));
  assert r->'statement'->>'updated_at'=first_row->>'updated_at','retry changed statement version'; checks:=checks+1;
  b:=b||jsonb_build_object('status','청구완료','lines','[{"description":"test","qty":20,"unitPrice":100,"taxType":"과세","taxRate":0.1}]'::jsonb);
  r:=public.save_statement_billing(jsonb_build_object('statement',b,'invoiceDate','2026-10-10','expectedUpdatedAt',first_row->>'updated_at'));
  assert r->'settlement'->>'status'<>'완납' and (r->'settlement'->>'billed_amount_krw')::numeric=2200
    and (r->'settlement'->>'collected_amount_krw')::numeric=1100 and r->'statement'->'collected_date'='null'::jsonb,'rebill hid outstanding amount'; checks:=checks+1;
  begin perform public.save_settlement(jsonb_build_object('settlement',linked_s,'expected',current_row)); raise exception 'assert_stale_full';
  exception when others then if sqlerrm<>'stale_settlement' then raise; end if; end; checks:=checks+1;
  assert not has_function_privilege('anon','public.save_settlement(jsonb)','execute')
    and not has_table_privilege('anon','public.settlements','INSERT') and not has_table_privilege('anon','public.settlements','UPDATE'),'anon write privilege'; checks:=checks+1;
  assert exists(select 1 from pg_trigger where tgrelid='public.settlements'::regclass and tgname='protect_settlement_delete')
    and position('protected_settlement' in pg_get_functiondef('public.protect_settlement_delete()'::regprocedure))>0,'delete protection definition'; checks:=checks+1;
  update public.settlements set invoice_no='',memo='',collected_amount_krw=null where id=root;
  s:=s||'{"collectedAmountKrw":0,"memo":"normalized"}'::jsonb;
  select to_jsonb(t) into current_row from public.settlements t where id=root;
  current_row:=current_row||'{"invoice_no":null,"memo":null,"collected_amount_krw":0}'::jsonb;
  r:=public.save_settlement(jsonb_build_object('settlement',s,'expected',current_row));
  assert r->'settlement'->'invoice_no'='null'::jsonb and r->'settlement'->>'memo'='normalized','legacy empty normalization'; checks:=checks+1;
  raise notice 'settlement_atomic checks=% PASS; fixtures rolled back; no DELETE',checks;
end $$;
rollback;
