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
test ! -e "$backup/database-ready"
test ! -e "$backup/switch-aborted"
grep -qx 'tables=7' "$backup/rehearsal-proof.txt"
sha256sum -c "$backup/atomic-migrations.sha256" >/dev/null
exec 9>"$app/.deploy.lock"
flock -w 60 9
test "$(git -C "$app/src/erp" rev-parse HEAD)" = "$old"
test -z "$(git -C "$app/src/erp" status --porcelain)"
test "$(docker inspect app-app-1 --format '{{.Image}}')" = "$(<"$backup/image-id.txt")"
export GIT_SSH_COMMAND="ssh -i $app/.ssh/deploy_erp -o UserKnownHostsFile=$app/.ssh/known_hosts -o IdentitiesOnly=yes"
git -C "$app/src/erp" fetch -q origin aws-migration
test "$(git -C "$app/src/erp" rev-parse origin/aws-migration)" = "$old"
git -C "$app/src/erp" merge-base --is-ancestor "$old" "$sha"
unset GIT_SSH_COMMAND
# Preserve baseline routine bodies and known trigger definitions locally only.
docker exec app-db-1 psql -X -At -U postgres -d erp -c "SELECT pg_get_functiondef(p.oid)||';' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e') ORDER BY p.oid;" >"$backup/baseline-functions.sql"
docker exec app-db-1 psql -X -At -U postgres -d erp -c "SELECT 'REVOKE ALL ON FUNCTION '||p.oid::regprocedure||' FROM PUBLIC,anon,erp_server;' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('record_payable_payment','save_settlement'); SELECT 'GRANT '||a.privilege_type||' ON FUNCTION '||p.oid::regprocedure||' TO '||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END||CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END||';' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='public' AND p.proname IN ('record_payable_payment','save_settlement');" >"$backup/baseline-function-acl.sql"
docker exec app-db-1 psql -X -At -U postgres -d erp -c "SELECT 'ALTER FUNCTION '||p.oid::regprocedure||' OWNER TO '||quote_ident(pg_get_userbyid(p.proowner))||';' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('record_payable_payment','save_settlement');" >"$backup/baseline-function-owners.sql"
docker exec app-db-1 psql -X -At -U postgres -d erp -c "SELECT pg_get_triggerdef(t.oid)||';' FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname IN ('sample_workflow_guard','sample_workflow_delete_guard','defect_approval_guard','deducted_payable_guard','guard_linked_expense','guard_expense_payable_link');" >"$backup/baseline-triggers.sql"
{
  printf 'BEGIN;\n'
  printf 'DROP TRIGGER IF EXISTS sample_workflow_guard ON public.samples;\nDROP TRIGGER IF EXISTS sample_workflow_delete_guard ON public.samples;\nDROP TRIGGER IF EXISTS defect_approval_guard ON public.defect_carryovers;\nDROP TRIGGER IF EXISTS deducted_payable_guard ON public.payables;\nDROP TRIGGER IF EXISTS guard_linked_expense ON public.expenses;\nDROP TRIGGER IF EXISTS guard_expense_payable_link ON public.payables;\n'
  cat "$backup/baseline-functions.sql" "$backup/baseline-function-owners.sql" "$backup/baseline-function-acl.sql" "$backup/baseline-triggers.sql"
  printf 'NOTIFY pgrst,\x27reload schema\x27;\nCOMMIT;\n'
} >"$backup/rollback-routines.sql"
# Validate rollback on the stopped isolated rehearsal database BEFORE touching production.
name="ads-db-rehearsal-${sha:0:12}"
proof_sql="SELECT 'function:'||p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid))||':'||(SELECT string_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||a.privilege_type||':'||a.is_grantable::text,',' ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('record_payable_payment','save_settlement') UNION ALL SELECT 'trigger:'||t.tgname||':'||md5(pg_get_triggerdef(t.oid))||':'||t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname IN ('sample_workflow_guard','sample_workflow_delete_guard','defect_approval_guard','deducted_payable_guard','guard_linked_expense','guard_expense_payable_link') ORDER BY 1;"
docker exec app-db-1 psql -X -At -U postgres -d erp -c "$proof_sql" >"$backup/rollback-baseline-proof.txt"
docker start "$name" >/dev/null
ready=false
for i in {1..30}; do
  if docker exec "$name" pg_isready -U postgres -d erp >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
$ready || exit 3
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d erp <"$backup/rollback-routines.sql" >"$backup/rehearsal-rollback.log" 2>&1
docker exec "$name" psql -X -At -U postgres -d erp -c "$proof_sql" >"$backup/rollback-restored-proof.txt"
cmp "$backup/rollback-baseline-proof.txt" "$backup/rollback-restored-proof.txt"
docker stop "$name" >/dev/null
committed=false
remote_seen=false
cleanup() {
  if $committed && ! $remote_seen; then
    systemctl disable --now erp-auto-deploy.timer
    printf 'aborted\n' >"$backup/switch-aborted"
    docker exec -i app-db-1 psql -X -v ON_ERROR_STOP=1 -U postgres -d erp <"$backup/rollback-routines.sql" >"$backup/production-rollback.log" 2>&1 || return 1
  fi
  if test -f "$backup/Caddyfile"; then
    cp "$backup/Caddyfile" "$app/Caddyfile"
    docker exec app-caddy-1 caddy reload --config /etc/caddy/Caddyfile >"$backup/maintenance-end.log" 2>&1
  fi
}
# Temporarily reject ERP/CEO external writes while the old app sees the new guards.
# Running Caddy keeps this configuration during automatic app build; its file is restored
# by auto-deploy, but no reload is performed until the new image/schema are verified.
cp "$app/Caddyfile" "$backup/Caddyfile"
trap cleanup EXIT
python3 - "$app/Caddyfile" <<'MAINTENANCE'
import pathlib,sys
p=pathlib.Path(sys.argv[1]); original=p.read_text()
gate='\n\t\t@ads_rollout_write {\n\t\t\tmethod POST PUT PATCH DELETE\n\t\t\tnot path /api/pixel/*\n\t\t}\n\t\trespond @ads_rollout_write "ERP update in progress; retry after completion" 503\n'
start='\thandle_path /rest/v1/* {'
end='\n}\n\n{$ERP_HOST}'
ceo='\treverse_proxy app:4000 {\n\t\tflush_interval -1\n\t}\n}'
if any(original.count(n)!=1 for n in [start,end,ceo]): raise SystemExit('unexpected Caddy structure')
original=original.replace(start,'\troute {'+gate+'\n'+start).replace(end,'\n\t}'+end)
original=original.replace(ceo,'\troute {'+gate+'\n'+ceo[:-1]+'\t}\n}')
p.write_text(original)
MAINTENANCE
docker exec app-caddy-1 caddy validate --config /etc/caddy/Caddyfile >"$backup/maintenance-validate.log" 2>&1
cp "$app/Caddyfile" "$backup/Caddyfile-maintenance"
docker exec app-caddy-1 caddy reload --config /etc/caddy/Caddyfile >"$backup/maintenance-reload.log" 2>&1
for url in https://erp.ameserp.kr/api/ads-rollout-block-check https://erp.ameserp.kr/rest/v1/ads_rollout_block_check https://ceo.ameserp.kr/api/ads-rollout-block-check; do
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$url")" = 503
done
# Fresh backup captures any legitimate changes since preparation; no ledger rewrite/delete.
docker exec app-db-1 pg_dump -U postgres -d erp -Fc >"$backup/pre-switch.dump"
test -s "$backup/pre-switch.dump"
committed=true
docker exec -i app-db-1 psql -X -v ON_ERROR_STOP=1 -U postgres -d erp <"$backup/atomic-migrations.sql" >"$backup/production-migrate.log" 2>&1
printf '%s\n' "$sha" >"$backup/database-ready"
echo "DATABASE_MIGRATIONS_COMMITTED=$sha"
# Codex watches database-ready then performs a normal fast-forward push (never force).
# Keep deploy lock and maintenance gate while waiting. Timeout restores old routines/ACL.
export GIT_SSH_COMMAND="ssh -i $app/.ssh/deploy_erp -o UserKnownHostsFile=$app/.ssh/known_hosts -o IdentitiesOnly=yes"
for i in {1..24}; do
  if ! git -C "$app/src/erp" fetch -q origin aws-migration; then sleep 5; continue; fi
  remote=$(git -C "$app/src/erp" rev-parse origin/aws-migration)
  if [ "$remote" = "$sha" ]; then remote_seen=true; break; fi
  if [ "$remote" != "$old" ]; then systemctl disable --now erp-auto-deploy.timer; exit 7; fi
  sleep 5
done
unset GIT_SSH_COMMAND
$remote_seen || exit 8
flock -u 9
# Do not invoke automatic deployment manually. Wait up to ten minutes for its evidence.
for i in {1..120}; do
  if [ "$(cat "$app/.deployed/erp" 2>/dev/null || true)" = "$sha" ] &&
    curl -fsS --max-time 5 http://localhost/healthz >/dev/null &&
    [ "$(docker inspect app-app-1 --format '{{.Image}}')" != "$(<"$backup/image-id.txt")" ]; then
    echo "AUTO_DEPLOY_VERIFIED=$sha"
    exit 0
  fi
  sleep 5
done
# Keep maintenance and stop repeat replacement attempts. Codex must fast-forward a
# reviewed revert, then restore routines and resume the timer; never force/reset data.
systemctl disable --now erp-auto-deploy.timer
printf 'automatic-deploy-failed\n' >"$backup/switch-aborted"
cp "$app/Caddyfile" "$backup/Caddyfile-auto-copy"
# Persist the maintenance configuration too, so a Caddy restart cannot reopen writes.
cp "$backup/Caddyfile-maintenance" "$app/Caddyfile"
trap - EXIT
echo 'AUTO_DEPLOY_FAILED_MAINTENANCE_HELD=true'
exit 9
