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
! docker container inspect "$name" >/dev/null 2>&1
docker run -d --name "$name" --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
trap 'docker stop "$name" >/dev/null 2>&1 || true' EXIT
ready=false
for i in {1..30}; do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
$ready || exit 3
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -c 'CREATE ROLE anon; CREATE ROLE erp_server; CREATE ROLE authenticator; CREATE ROLE authenticated;' >"$backup/rehearsal-roles.log" 2>&1
docker exec "$name" createdb -U postgres erp
docker exec -i "$name" pg_restore --exit-on-error --no-owner --no-privileges -U postgres -d erp <"$backup/erp.dump" >"$backup/rehearsal-restore.log" 2>&1
files=(supabase/migration_purchase_material_spec.sql supabase/migration_sample_workflow.sql supabase/migration_defect_approval.sql supabase/migration_expense_payable.sql supabase/migration_sample_settlement.sql db/15_product_registration.sql db/016_ads_analysis.sql)
{
  printf 'BEGIN;\nSET LOCAL lock_timeout=\x275s\x27;\nSET LOCAL statement_timeout=\x2760s\x27;\n'
  for file in "${files[@]}"; do
    test -f "$release/$file"
    awk 'tolower($0) !~ /^[[:space:]]*(begin|commit);[[:space:]]*$/ {print}' "$release/$file"
  done
  printf '\nCOMMIT;\n'
} >"$backup/atomic-migrations.sql"
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d erp <"$backup/atomic-migrations.sql" >"$backup/rehearsal-migrate.log" 2>&1
docker exec "$name" psql -X -At -U postgres -d erp -c "SELECT 'tables='||count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('ads_analysis_runs','ads_analysis_budget','ads_analysis_jobs','ads_analysis_notices','product_listings','channel_tokens','sample_workflow_settings');" >"$backup/rehearsal-proof.txt"
grep -qx 'tables=7' "$backup/rehearsal-proof.txt"
echo "REHEARSAL_VALIDATED=$sha"
echo 'OPERATING_DB_UNCHANGED=true'
