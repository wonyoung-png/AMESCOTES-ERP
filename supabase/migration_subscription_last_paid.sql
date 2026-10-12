-- 구독 마지막 결제일 (2026-10-12, 운영 DB 적용 완료)
-- 카드 내역 업로드 시 서버가 갱신하고, 화면에서 직접 수정도 가능.
alter table subscriptions add column if not exists last_paid_on date;

-- 백필: 후보(subscription_candidates)의 마지막 결제일 → 없으면 다음 결제일에서 한 주기 전으로 추정
update subscriptions s set last_paid_on = c.last_paid_on
  from subscription_candidates c
 where s.candidate_id = c.id and s.last_paid_on is null and c.last_paid_on is not null;
update subscriptions
   set last_paid_on = case when billing_cycle = '연' then (next_billing_on - interval '1 year')::date
                           else (next_billing_on - interval '1 month')::date end
 where last_paid_on is null and next_billing_on is not null;
