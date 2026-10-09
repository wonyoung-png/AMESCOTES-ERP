begin;
create or replace function public.record_payable_payment(p_id text,p_amount numeric,p_expected_paid numeric)
returns jsonb language plpgsql as $$
declare p public.payables%rowtype; paid numeric;
begin
  if p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_expected_paid is null or p_expected_paid<0 or p_expected_paid::text in ('NaN','Infinity','-Infinity') then raise exception 'invalid_payment'; end if;
  select * into p from public.payables where id=p_id for update;
  if not found then raise exception 'not_found'; end if;
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
notify pgrst,'reload schema';
commit;
