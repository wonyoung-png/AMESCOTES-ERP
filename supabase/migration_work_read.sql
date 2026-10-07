-- 업무 피드 읽음 체크 — 누가 어떤 카드를 확인했는지.
-- 사람별로 행을 따로 두지 않고 카드에 확인한 사람 id 를 모은다 (직원 수십 명 규모라 충분하다).
alter table public.work_cards add column if not exists read_by text[] not null default '{}';

-- 여러 장을 한 번에 확인 처리. 이미 든 사람은 다시 넣지 않는다.
-- 배열을 읽어서 다시 쓰면 두 사람이 동시에 확인할 때 한쪽이 지워지므로 DB 안에서 붙인다
create or replace function public.mark_work_read(p_user text, p_ids text[])
returns integer
language sql
as $$
  with u as (
    update public.work_cards
       set read_by = array_append(read_by, p_user)
     where id = any(p_ids) and not (p_user = any(read_by))
    returning 1
  )
  select count(*)::int from u;
$$;

revoke all on function public.mark_work_read(text, text[]) from public;
revoke all on function public.mark_work_read(text, text[]) from anon;
grant execute on function public.mark_work_read(text, text[]) to erp_server;
notify pgrst, 'reload schema';
