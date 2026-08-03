#!/bin/bash
# 스키마 적용 후 anon 롤에 권한 부여
# 현 운영(Supabase RLS 미적용 + anon 키 전체 CRUD)과 동일한 권한 모델.
# 외부 노출은 Basic Auth 게이트(SHARE_PASS)가 1차 차단 — RLS 도입은 추후 과제.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	GRANT USAGE ON SCHEMA public TO anon;
	GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
	GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
	ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
EOSQL
