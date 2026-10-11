-- 실데이터 시드. 운영 DB 적용은 검수자가 수행한다.
update public.subscriptions set
  service_name = 'ShopMyShelf', latest_amount = 670000, average_amount = 670000,
  currency = 'KRW', card_last4 = '2200', auto_renew = true,
  term_end_on = date '2027-02-05', renewal_months = 6, notice_days = 45,
  owner_team = 'MD', memo = 'Launch Package, 8/5 DocuSign(원채은). 8~10월 귀속매출 $864(bella 1명) vs 구독료 약 207만',
  updated_at = now()
where lower(service_name) in ('shopmy', 'shopmyshelf')
   or lower(merchant_pattern) in ('shopmy', 'shopmyshelf');

insert into public.subscriptions
  (id, service_name, merchant_pattern, card_last4, latest_amount, average_amount, currency,
   billing_cycle, category, status, auto_renew, term_end_on, renewal_months, notice_days, owner_team, memo)
select 'sub_shopmy', 'ShopMyShelf', 'shopmy', '2200', 670000, 670000, 'KRW',
  '월', '마케팅', '사용 중', true, date '2027-02-05', 6, 45, 'MD',
  'Launch Package, 8/5 DocuSign(원채은). 8~10월 귀속매출 $864(bella 1명) vs 구독료 약 207만'
where not exists (
  select 1 from public.subscriptions
  where lower(service_name) in ('shopmy', 'shopmyshelf') or lower(merchant_pattern) in ('shopmy', 'shopmyshelf')
);
