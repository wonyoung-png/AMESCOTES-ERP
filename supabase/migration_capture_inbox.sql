-- 접수함 (capture_inbox)
--
-- 현장에서 사진 한 장과 한 줄만 올려두고, 팀장이 승인할 때 ERP 전표가 생긴다.
-- 바로 전표를 만들지 않는 이유: AI 판정이 틀리면 장부에 잘못된 전표가 남는다.
-- 접수함에서는 고치면 되지만 전표는 지우고 다시 만들어야 한다.
--
-- 사진은 base64 로 들어온다. 자체호스팅에 Storage 가 없어서다 (samples.image_urls 와 같은 방식).
-- 대신 승인·반려가 끝나면 photo 를 비운다 — 접수함은 거쳐 가는 곳이지 보관소가 아니다.
--
-- ⚠️ RLS 는 켜지 않는다.
-- migration_rls_step1.sql 은 Supabase 클라우드 시절 파일이라 정책을 authenticated 에만 열어 뒀다.
-- 지금 자체호스팅은 서버가 role:'anon' 토큰으로 PostgREST 를 부른다 (server/session.ts:95).
-- 그 상태에서 authenticated 전용 정책을 걸면 앱이 이 테이블을 통째로 못 읽는다.
-- 다른 운영 테이블(items·samples 등)과 같은 상태로 맞춘다.

create table if not exists public.capture_inbox (
  id                text primary key,

  -- 누가 올렸나. 클라이언트가 보낸 값을 믿지 않고 서버가 세션에서 넣는다
  created_by        text,
  created_by_name   text,          -- 계정이 지워져도 목록에 이름이 남도록 떠둔 사본
  created_at        timestamptz    not null default now(),

  photo             text,          -- base64 data URL. 처리 끝나면 비운다
  raw_text          text,          -- 올린 사람이 친 한 줄 원문. 판정이 틀렸을 때 근거가 된다

  -- AI 판정
  kind              text           not null default 'unknown',  -- sample | material | delivery | billing | unknown
  parsed            jsonb          not null default '{}'::jsonb,
  confidence        real,          -- 0~1. 낮으면 화면에서 눈에 띄게 둔다

  -- 팀장이 고친 확정값. parsed 를 덮지 않고 따로 둔다 — AI 가 뭘 틀렸는지 남아야 고칠 수 있다
  reviewed_payload  jsonb,

  status            text           not null default 'pending',  -- pending | approved | rejected
  reviewed_by       text,
  reviewed_by_name  text,
  reviewed_at       timestamptz,
  reject_reason     text,

  result_ref        jsonb,         -- 승인 후 만들어진 레코드 {"table":"samples","id":"..."}
  updated_at        timestamptz    not null default now()
);

create index if not exists capture_inbox_status_idx  on public.capture_inbox (status, created_at desc);
create index if not exists capture_inbox_creator_idx on public.capture_inbox (created_by, created_at desc);

-- 자체호스팅에는 authenticated 역할 자체가 없다 (실행해 보고 확인). anon 하나뿐이다
grant all on public.capture_inbox to anon;
