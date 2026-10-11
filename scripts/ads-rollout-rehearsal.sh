#!/bin/bash
# Exact production backup rehearsal in an isolated, portless PostgreSQL container.
set -euo pipefail
set +x
umask 077
sha=${1:?pinned commit required}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
backup="/opt/app/backups/ads-rollout-$sha"
release="/opt/app/releases/ads-rollout-$sha"
test -s "$backup/erp.dump"
test "$(git -C "$release" rev-parse HEAD)" = "$sha"
name="ads-db-rehearsal-${sha:0:12}"
if docker container inspect "$name" >/dev/null 2>&1; then exit 4; fi
db_image=$(docker inspect app-db-1 --format '{{.Image}}')
docker run -d --name "$name" --network none -e POSTGRES_HOST_AUTH_METHOD=trust "$db_image" >/dev/null
trap 'docker stop "$name" >/dev/null 2>&1 || true' EXIT
ready=false
for i in {1..30}; do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
$ready || exit 3
awk '$0 != "CREATE ROLE postgres;" {print}' "$backup/roles.sql" | docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres >"$backup/rehearsal-roles.log" 2>&1
docker exec "$name" createdb -U postgres erp
docker exec -i "$name" pg_restore --exit-on-error --no-owner -U postgres -d erp <"$backup/erp.dump" >"$backup/rehearsal-restore.log" 2>&1
count_sql="SELECT 'samples='||count(*) FROM samples UNION ALL SELECT 'payables='||count(*) FROM payables UNION ALL SELECT 'defect_carryovers='||count(*) FROM defect_carryovers UNION ALL SELECT 'purchase_items='||count(*) FROM purchase_items UNION ALL SELECT 'trade_statements='||count(*) FROM trade_statements ORDER BY 1;"
docker exec "$name" psql -X -At -U postgres -d erp -c "$count_sql" >"$backup/rehearsal-counts-before.txt"
files=(supabase/migration_purchase_material_spec.sql supabase/migration_sample_workflow.sql supabase/migration_defect_approval.sql supabase/migration_expense_payable.sql supabase/migration_sample_settlement.sql db/15_product_registration.sql db/016_ads_analysis.sql)
{
  printf 'BEGIN;\nSET LOCAL lock_timeout=\x275s\x27;\nSET LOCAL statement_timeout=\x2760s\x27;\n'
  for file in "${files[@]}"; do
    git -C "$release" show "$sha:$file" >"$backup/migration-source.sql"
    test "$(grep -ciE '^[[:space:]]*(begin|commit);[[:space:]]*$' "$backup/migration-source.sql")" = 2
    awk 'tolower($0) !~ /^[[:space:]]*(begin|commit);[[:space:]]*$/ {print}' "$backup/migration-source.sql"
  done
  printf '\nCOMMIT;\n'
} >"$backup/atomic-migrations.sql"
test "$(grep -ciE '^[[:space:]]*(begin|commit);' "$backup/atomic-migrations.sql")" = 2
sha256sum "$backup/atomic-migrations.sql" >"$backup/atomic-migrations.sha256"
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d erp <"$backup/atomic-migrations.sql" >"$backup/rehearsal-migrate.log" 2>&1
if grep -Ei 'already a transaction in progress|no transaction in progress' "$backup/rehearsal-migrate.log" >/dev/null; then exit 5; fi
docker exec "$name" psql -X -At -U postgres -d erp -c "$count_sql" >"$backup/rehearsal-counts-after.txt"
cmp "$backup/rehearsal-counts-before.txt" "$backup/rehearsal-counts-after.txt"
docker exec "$name" psql -X -At -U postgres -d erp -c "SELECT 'tables='||count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('ads_analysis_runs','ads_analysis_budget','ads_analysis_jobs','ads_analysis_notices','product_listings','channel_tokens','sample_workflow_settings');" >"$backup/rehearsal-proof.txt"
grep -qx 'tables=7' "$backup/rehearsal-proof.txt"
echo "REHEARSAL_VALIDATED=$sha"
echo 'OPERATING_DB_UNCHANGED=true'
