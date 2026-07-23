-- ─────────────────────────────────────────────────────────────
-- RLS 1단계: DB 잠금 — 익명(anon) 차단, 로그인 직원(authenticated) 전체 허용
--
-- ⚠️ 실행 전제 (순서 지키지 않으면 전 직원 화면이 빈 데이터가 됨):
--   1. Supabase Authentication에 직원 계정 5개 생성 완료
--   2. 전 직원이 새 버전에서 한 번씩 재로그인 (Supabase 세션 확보)
--   3. 그 다음에 이 파일을 SQL Editor에 붙여넣고 실행
--
-- 되돌리기(문제 발생 시):
--   alter table public.items disable row level security;  (테이블별 반복)
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'items','boms','vendors','materials',
    'production_orders','samples','purchase_items','exchange_rates'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "authenticated all" on public.%I', t);
    execute format(
      'create policy "authenticated all" on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- 확인: 아래 조회에서 8개 테이블 모두 rowsecurity = true 여야 함
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename in ('items','boms','vendors','materials','production_orders','samples','purchase_items','exchange_rates')
order by tablename;
