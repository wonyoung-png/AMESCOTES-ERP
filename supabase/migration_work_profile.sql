-- 업무 프로필 — 업무 비서가 "이 사람이 뭘 맡고 어디까지 정할 수 있는지"를 알게 한다.
-- 모델을 재학습하지 않고, 대화 때마다 이 글을 같이 넘긴다. 고치면 다음 대화부터 바로 반영된다.
-- 본인은 위젯에서, 대표는 사용자관리에서 쓴다 (둘 다 서버 API 경유).
alter table public.app_users add column if not exists work_profile text;

-- 화면·API 검사를 거치지 않고 PostgREST 를 직접 불러도 1000자를 못 넘게 (코덱스 지적)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_users_work_profile_len') then
    alter table public.app_users add constraint app_users_work_profile_len
      check (work_profile is null or char_length(work_profile) <= 1000);
  end if;
end $$;

notify pgrst, 'reload schema';
