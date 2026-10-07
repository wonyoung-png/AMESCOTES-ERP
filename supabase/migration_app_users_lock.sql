-- app_users 잠금 — 브라우저(anon)에서 직원 계정 테이블을 못 읽고 못 쓰게 한다.
--
-- 왜: anon 키는 프론트 번들에 들어 있다. 그 키로 /rest/v1/app_users 를 부르면 로그인 없이도
--     전 직원의 password_hash 가 나왔다. 해시가 32비트 simpleHash 라 사실상 비밀번호 노출이다.
--     역할(role)도 바꿀 수 있어 아무나 대표 권한을 얻을 수 있었다.
--
-- 순서 주의: server/users.ts · auth.ts · session.ts 가 erp_server 역할로 읽도록 배포된 "뒤에" 실행한다.
--            먼저 실행하면 로그인이 끊긴다.
--
-- erp_server 는 anon 을 물려받아 app_users 를 읽어 왔다. anon 에게서 거두면 같이 사라지므로 직접 준다.
grant select, insert, update on public.app_users to erp_server;
revoke all on public.app_users from anon;
notify pgrst, 'reload schema';
