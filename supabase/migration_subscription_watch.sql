-- 구독 감시 1단계. 운영 DB에는 검수 후 별도로 적용한다.
create table if not exists public.card_transactions (
  id text primary key,
  fingerprint text not null unique,
  approved_on date not null,
  merchant_name text not null,
  merchant_key text not null,
  card_last4 text,
  amount numeric(16,2) not null check (amount >= 0),
  currency text not null default 'KRW',
  uploaded_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_candidates (
  id text primary key,
  merchant_key text not null,
  merchant_name text not null,
  card_last4 text,
  latest_amount numeric(16,2) not null,
  average_amount numeric(16,2) not null,
  currency text not null default 'KRW',
  month_count integer not null,
  first_paid_on date not null,
  last_paid_on date not null,
  status text not null default '검토 필요' check (status in ('검토 필요','확정','제외')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_key, card_last4, currency)
);

create table if not exists public.subscriptions (
  id text primary key,
  service_name text not null,
  merchant_pattern text not null,
  card_last4 text,
  latest_amount numeric(16,2) not null default 0,
  average_amount numeric(16,2) not null default 0,
  currency text not null default 'KRW',
  billing_cycle text not null default '월' check (billing_cycle in ('월','연')),
  next_billing_on date,
  owner_id text,
  purpose text,
  category text not null default '업무 도구' check (category in ('AI 도구','마케팅','업무 도구','인프라')),
  status text not null default '사용 중' check (status in ('사용 중','검토 필요','해지 예정','해지됨')),
  memo text,
  last_usage_checked_at timestamptz,
  last_usage_result text check (last_usage_result is null or last_usage_result in ('계속 씀','안 씀','모름')),
  candidate_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_usage_checks (
  id text primary key,
  subscription_id text not null,
  work_card_id text not null unique,
  owner_id text,
  requested_at timestamptz not null default now(),
  answered_at timestamptz,
  answer text check (answer is null or answer in ('계속 씀','안 씀','모름')),
  escalated_at timestamptz
);

create index if not exists card_transactions_merchant_idx on public.card_transactions (merchant_key, approved_on);
create index if not exists subscriptions_next_idx on public.subscriptions (status, next_billing_on);
create index if not exists subscription_checks_open_idx on public.subscription_usage_checks (answered_at, requested_at);
create unique index if not exists subscription_checks_one_open_per_subscription_idx
  on public.subscription_usage_checks (subscription_id) where answered_at is null;

create or replace function public.answer_subscription_check(
  p_check_id text,
  p_answer text,
  p_actor_id text,
  p_actor_name text,
  p_ceo_id text default null,
  p_ceo_name text default null
) returns jsonb
language plpgsql
as $$
declare
  v_check public.subscription_usage_checks%rowtype;
  v_now timestamptz := now();
  v_risky boolean;
begin
  if p_answer not in ('계속 씀','안 씀','모름') then
    raise exception 'bad_answer';
  end if;

  select * into v_check
  from public.subscription_usage_checks
  where id = p_check_id
  for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_check.answered_at is not null then
    if v_check.answer = p_answer then
      return jsonb_build_object('check_id', v_check.id, 'answer', v_check.answer, 'newly_answered', false);
    end if;
    raise exception 'already_answered:%', v_check.answer;
  end if;

  perform 1 from public.subscriptions where id = v_check.subscription_id for update;
  if not found then raise exception 'subscription_not_found'; end if;
  perform 1 from public.work_cards where id = v_check.work_card_id for update;
  if not found then raise exception 'work_card_not_found'; end if;

  v_risky := p_answer <> '계속 씀';
  update public.subscriptions set
    last_usage_checked_at = v_now,
    last_usage_result = p_answer,
    status = case when v_risky then '검토 필요' else status end,
    updated_at = v_now
  where id = v_check.subscription_id;

  if v_risky and p_ceo_id is not null then
    update public.work_cards set
      reply_text = p_answer, replied_by_name = p_actor_name, replied_at = v_now,
      assignee_id = p_ceo_id, assignee_name = p_ceo_name, updated_at = v_now
    where id = v_check.work_card_id;
  else
    update public.work_cards set
      status = 'done', reply_text = p_answer, replied_by_name = p_actor_name, replied_at = v_now,
      done_at = v_now, done_by_name = p_actor_name, updated_at = v_now
    where id = v_check.work_card_id;
  end if;

  update public.subscription_usage_checks set
    answer = p_answer, answered_at = v_now,
    escalated_at = case when v_risky and p_ceo_id is not null then v_now else escalated_at end
  where id = v_check.id;

  return jsonb_build_object('check_id', v_check.id, 'answer', p_answer, 'newly_answered', true);
end $$;

revoke all on function public.answer_subscription_check(text, text, text, text, text, text) from public;
revoke all on function public.answer_subscription_check(text, text, text, text, text, text) from anon;
revoke all on function public.answer_subscription_check(text, text, text, text, text, text) from authenticated;
grant execute on function public.answer_subscription_check(text, text, text, text, text, text) to erp_server;

revoke all on public.card_transactions, public.subscription_candidates, public.subscriptions, public.subscription_usage_checks from public;
revoke all on public.card_transactions, public.subscription_candidates, public.subscriptions, public.subscription_usage_checks from anon;
revoke all on public.card_transactions, public.subscription_candidates, public.subscriptions, public.subscription_usage_checks from authenticated;
grant all on public.card_transactions, public.subscription_candidates, public.subscriptions, public.subscription_usage_checks to erp_server;
