#!/bin/bash
# PostgREST용 롤 생성 — postgres 초기 기동 시 1회 실행 (docker-entrypoint-initdb.d)
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE ROLE anon NOLOGIN;
	CREATE ROLE authenticator LOGIN PASSWORD '${PGRST_AUTHENTICATOR_PASSWORD}' NOINHERIT;
	GRANT anon TO authenticator;
EOSQL
