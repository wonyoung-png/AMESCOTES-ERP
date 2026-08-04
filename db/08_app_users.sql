-- 사용자 계정 (DB 기반 — localStorage 계정의 서버 이관)
-- password_hash: 레거시 simpleHash (client/src/lib/auth.ts와 동일 알고리즘)
CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 기존 기본 계정 시드 (auth.ts initDefaultUsers와 동일 해시 — 현행 비밀번호 유지)
INSERT INTO app_users (id, email, password_hash, name, role) VALUES
  ('wonyoung@atlm.kr', 'wonyoung@atlm.kr', '5a33sm', '이원영', '대표'),
  ('pm@atlm.kr',       'pm@atlm.kr',       '27io5c', '생산관리팀장', '생산관리팀장'),
  ('mgr@atlm.kr',      'mgr@atlm.kr',      'xkvehy', '부관리 주임', '부관리 주임'),
  ('staff@atlm.kr',    'staff@atlm.kr',    '8nuuz1', '사원', '사원'),
  ('sales@atlm.kr',    'sales@atlm.kr',    'fse155', '영업과장', '영업과장')
ON CONFLICT (email) DO NOTHING;
