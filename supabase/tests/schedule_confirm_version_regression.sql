-- Isolated DB only, after migration_schedule_confirm_version.sql. Never run on production.
begin;
set local plpgsql.check_asserts = on;
set local role erp_server;
do $$
declare
  test_id text := 'test_confirm_version_' || md5(clock_timestamp()::text);
  payload jsonb := '{"title":"version-regression","workspace":"LUMEN","channel":"W컨셉","startDate":"2026-10-20","discountRate":20}';
  original_version timestamptz := '2098-01-01T00:00:00.123456Z';
  current_version timestamptz := '2098-01-01T00:00:00.123457Z';
  before_count bigint;
  result jsonb;
begin
  assert has_function_privilege('erp_server', 'public.confirm_schedule_card(text,jsonb,text,text[],timestamptz)', 'EXECUTE'), 'server cannot use versioned RPC';
  assert not has_function_privilege('erp_server', 'public.confirm_schedule_card(text,jsonb,text,text[])', 'EXECUTE'), 'server can bypass version check';
  assert not has_function_privilege('anon', 'public.confirm_schedule_card(text,jsonb,text,text[],timestamptz)', 'EXECUTE'), 'anon can confirm';
  assert not has_function_privilege('anon', 'public.confirm_schedule_card(text,jsonb,text,text[])', 'EXECUTE'), 'anon can use legacy';
  select count(*) into before_count from public.campaigns;
  insert into public.work_cards(id, team, created_by_name, raw_text, kind, status, updated_at, related_id) values
    (test_id || '_same', '국내 MD', 'test', 'same-team request', 'request_check', 'open', original_version, null),
    (test_id || '_other', '글로벌 MD', 'test', 'other-team request', 'request_check', 'open', original_version, null),
    (test_id, '국내 MD', 'test', 'synthetic schedule', 'schedule', 'open', original_version, test_id || '_same');

  -- Same kind/status again, but newer source. Microseconds must not be rounded away.
  update public.work_cards set kind = 'todo', updated_at = current_version where id = test_id;
  update public.work_cards set kind = 'schedule' where id = test_id;
  begin
    perform public.confirm_schedule_card(test_id, payload, 'test', array['마케팅'], original_version);
    raise exception 'assert_stale_accepted';
  exception when sqlstate 'PT409' then
    assert sqlerrm = 'stale_work_version', 'wrong stale error';
  end;
  begin
    perform public.confirm_schedule_card(test_id, payload, 'test', array['마케팅'], null::timestamptz);
    raise exception 'assert_null_version_accepted';
  exception when sqlstate '22023' then
    assert sqlerrm = 'expected_work_version_required', 'wrong missing-version error';
  end;
  begin
    perform public.confirm_schedule_card(test_id, payload, 'test', array['마케팅']);
    raise exception 'assert_legacy_accepted';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.campaigns) = before_count, 'rejected request created campaign';
  assert exists(select 1 from public.work_cards where id = test_id and status = 'open' and confirmed_payload is null and result_ref is null and updated_at = current_version), 'rejected request changed source';
  assert (select status from public.work_cards where id = test_id || '_same') = 'open', 'stale request closed related card';

  -- Payload validation still runs when the version matches, before any write.
  begin
    perform public.confirm_schedule_card(test_id, payload || '{"discountRate":101}', 'test', array['마케팅'], current_version);
    raise exception 'assert_invalid_accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'discount_invalid' then raise; end if;
  end;
  result := public.confirm_schedule_card(test_id, payload, 'test', array['마케팅'], current_version);
  assert exists(select 1 from public.campaigns where id = result->>'id' and discount_rate = 20 and end_date = '2026-10-20' and workspace = 'LUMEN'), 'calendar payload changed';
  assert exists(select 1 from public.work_cards where id = test_id and status = 'done' and result_ref = result and confirmed_payload->>'discountRate' = '20' and shared_teams = array['마케팅']), 'confirmation not atomic';
  assert (select status from public.work_cards where id = test_id || '_same') = 'done', 'same-team related card not closed';
  assert (select status from public.work_cards where id = test_id || '_other') = 'open', 'cross-team card closed';
  begin
    perform public.confirm_schedule_card(test_id, payload, 'test', array['마케팅'], current_version);
    raise exception 'assert_retry_accepted';
  exception when sqlstate 'PT409' then
    assert sqlerrm = 'stale_work_version', 'wrong retry error';
  end;
  assert (select count(*) from public.campaigns) = before_count + 1, 'retry duplicated campaign';
end $$;
reset role;
-- Even a migration owner with EXECUTE cannot use the retained legacy signature.
do $$
begin
  begin
    perform public.confirm_schedule_card('not_a_real_card', '{}'::jsonb, 'test', array[]::text[]);
    raise exception 'assert_owner_legacy_accepted';
  exception when sqlstate '22023' then
    assert sqlerrm = 'expected_work_version_required', 'legacy owner bypass';
  when insufficient_privilege then null;
  end;
end $$;
rollback;
