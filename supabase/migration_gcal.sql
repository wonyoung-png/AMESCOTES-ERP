-- 직원별 구글 캘린더 연결.
-- 직원이 자기 구글 계정(@atlm.kr)을 연결하면 그 계정에 "ATLM 업무" 캘린더를 만들어
-- 할 일 마감·팀에 공유된 기획전을 넣고, 본인 일정을 업무 비서가 읽을 수 있게 한다.
--
-- refresh_enc 는 구글 갱신 토큰을 서버 비밀키로 암호화한 값이다 (평문 저장 안 함).
-- 해제하면 토큰을 지우고 status 만 남긴다 — 행을 지우지 않는다.
create table if not exists public.gcal_links (
  user_id       text primary key,
  google_email  text,
  refresh_enc   text,
  calendar_id   text,                 -- ERP 가 만든 "ATLM 업무" 캘린더
  status        text not null default 'connected',   -- connected | disconnected | error
  connected_at  timestamptz not null default now(),
  last_sync_at  timestamptz,
  last_error    text
);

revoke all on public.gcal_links from anon;
grant all on public.gcal_links to erp_server;
notify pgrst, 'reload schema';
