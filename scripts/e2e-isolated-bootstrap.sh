#!/bin/bash
# Creates no public ports/production mounts and copies schema only, never rows.
set -euo pipefail
net=erp-e2e-20261010
db=erp-e2e-db-20261010
api=erp-e2e-api-20261010
runner=erp-e2e-runner-20261010
for target in "$db" "$api" "$runner"; do
  if docker inspect "$target" >/dev/null 2>&1; then echo 'Test target already exists; inspect before reuse'; exit 1; fi
done
if docker network inspect "$net" >/dev/null 2>&1; then echo 'Test network already exists'; exit 1; fi
pass=$(cat /proc/sys/kernel/random/uuid)
secret=$(cat /proc/sys/kernel/random/uuid)$(cat /proc/sys/kernel/random/uuid)
docker network create --internal --label codex.e2e=20261010 "$net" >/dev/null
docker run -d --name "$db" --label codex.e2e=20261010 --network "$net" --memory 384m --cpus 1 \
  --tmpfs /var/lib/postgresql/data:rw,size=192m -e POSTGRES_DB=erp_e2e -e POSTGRES_PASSWORD="$pass" postgres:16-alpine >/dev/null
ready=false
for i in $(seq 1 45); do
  if docker exec "$db" sh -c 'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
docker exec app-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -qAt -c "select format('\''CREATE ROLE %I NOLOGIN;'\'',rolname) from pg_roles where rolname !~ '\''^pg_'\'' and rolname<>'\''postgres'\''"' \
  | docker exec -i "$db" psql -U postgres -d erp_e2e -X -q -v ON_ERROR_STOP=1
docker exec app-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -qAt -c "select format('\''GRANT %I TO %I;'\'',r.rolname,m.rolname) from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where r.rolname !~ '\''^pg_'\'' and m.rolname<>'\''postgres'\''"' \
  | docker exec -i "$db" psql -U postgres -d erp_e2e -X -q -v ON_ERROR_STOP=1
docker exec app-db-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema-only --no-owner' \
  | docker exec -i "$db" psql -U postgres -d erp_e2e -X -q -v ON_ERROR_STOP=1 >/dev/null
printf "ALTER ROLE authenticator LOGIN PASSWORD '%s';\n" "$pass" | docker exec -i "$db" psql -U postgres -d erp_e2e -X -q -v ON_ERROR_STOP=1
test "$(docker exec "$db" psql -U postgres -d erp_e2e -X -qAt -c 'select count(*) from app_users')" = 0
docker run -d --name "$api" --label codex.e2e=20261010 --network "$net" --memory 128m --cpus 1 \
  -e PGRST_DB_URI="postgres://authenticator:$pass@$db:5432/erp_e2e" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_JWT_SECRET="$secret" postgrest/postgrest:v12.2.12 >/dev/null
docker create -i --name "$runner" --label codex.e2e=20261010 --network "$net" --memory 256m --cpus 1 \
  -e ERP_E2E_ISOLATED=20261010 -e POSTGREST_URL="http://$api:3000" -e PGRST_JWT_SECRET="$secret" \
  -e ERP_PRIVATE_MODE=false -e ROOT_DOMAIN=fixture.invalid -e ANTHROPIC_API_KEY=isolated-fixture-not-real -e DAILY_URL=http://e2e-unavailable:8000 \
  --entrypoint node amescotes-erp:latest - >/dev/null
printf 'ISOLATED_STACK_READY_SCHEMA_ONLY\n'
