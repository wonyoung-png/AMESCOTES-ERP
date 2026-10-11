#!/bin/bash
# Requires successful backup/rehearsal and a reviewed pinned merge. Keeps automatic deployment.
set -euo pipefail
set +x
umask 077
sha=${1:?pinned commit required}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
app=/opt/app
old=1ceb6143297e4f5fab7bb3683146b061acfd13e3
backup="$app/backups/ads-rollout-$sha"
test -s "$backup/erp.dump"
test -s "$backup/atomic-migrations.sql"
grep -qx 'tables=7' "$backup/rehearsal-proof.txt"
exec 9>"$app/.deploy.lock"
flock -w 60 9
test "$(git -C "$app/src/erp" rev-parse HEAD)" = "$old"
test -z "$(git -C "$app/src/erp" status --porcelain)"
test "$(docker inspect app-app-1 --format '{{.Image}}')" = "$(<"$backup/image-id.txt")"
export GIT_SSH_COMMAND="ssh -i $app/.ssh/deploy_erp -o UserKnownHostsFile=$app/.ssh/known_hosts -o IdentitiesOnly=yes"
git -C "$app/src/erp" fetch -q origin aws-migration
test "$(git -C "$app/src/erp" rev-parse origin/aws-migration)" = "$old"
unset GIT_SSH_COMMAND
# Preserve baseline routine bodies and known trigger definitions locally only.
docker exec app-db-1 psql -X -At -U postgres -d erp -c "SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.oid;" >"$backup/baseline-functions.sql"
docker exec app-db-1 psql -X -At -U postgres -d erp -c "SELECT pg_get_triggerdef(t.oid)||';' FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname IN ('sample_workflow_guard','sample_workflow_delete_guard','defect_approval_guard','deducted_payable_guard','guard_linked_expense','guard_expense_payable_link');" >"$backup/baseline-triggers.sql"
{
  printf 'BEGIN;\n'
  printf 'DROP TRIGGER IF EXISTS sample_workflow_guard ON public.samples;\nDROP TRIGGER IF EXISTS sample_workflow_delete_guard ON public.samples;\nDROP TRIGGER IF EXISTS defect_approval_guard ON public.defect_carryovers;\nDROP TRIGGER IF EXISTS deducted_payable_guard ON public.payables;\nDROP TRIGGER IF EXISTS guard_linked_expense ON public.expenses;\nDROP TRIGGER IF EXISTS guard_expense_payable_link ON public.payables;\n'
  cat "$backup/baseline-functions.sql" "$backup/baseline-triggers.sql"
  printf 'NOTIFY pgrst,\x27reload schema\x27;\nCOMMIT;\n'
} >"$backup/rollback-routines.sql"
# Validate rollback on the stopped isolated rehearsal database BEFORE touching production.
name="ads-db-rehearsal-${sha:0:12}"
docker start "$name" >/dev/null
ready=false
for i in {1..30}; do
  if docker exec "$name" pg_isready -U postgres -d erp >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
$ready || exit 3
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d erp <"$backup/rollback-routines.sql" >"$backup/rehearsal-rollback.log" 2>&1
docker stop "$name" >/dev/null
# Fresh backup captures any legitimate changes since preparation; no ledger rewrite/delete.
docker exec app-db-1 pg_dump -U postgres -d erp -Fc >"$backup/pre-switch.dump"
test -s "$backup/pre-switch.dump"
docker exec -i app-db-1 psql -X -v ON_ERROR_STOP=1 -U postgres -d erp <"$backup/atomic-migrations.sql" >"$backup/production-migrate.log" 2>&1
echo "DATABASE_MIGRATIONS_COMMITTED=$sha"
echo 'AWAITING_REVIEWED_REMOTE_FAST_FORWARD=true'
# Remote fast-forward is performed by Codex immediately after this command succeeds.
# This helper never resets source, edits .env, or invokes the deployment script manually.
