alter table receipt_logs add column if not exists delivery_market text
  check (delivery_market in ('domestic', 'b2b', 'overseas'));
