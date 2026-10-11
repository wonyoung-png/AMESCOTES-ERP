#!/bin/bash
# Replace the confirmed legacy helper, never invoke it manually or rebuild other apps.
set -euo pipefail
set +x
umask 077
sha=${1:?reviewed commit required}
expected=${2:?installed helper hash required}
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$expected" =~ ^[0-9a-f]{64}$ ]] || exit 2
app=/opt/app
backup="$app/backups/ads-setup-20261012"
exec 9>"$app/.deploy.lock"
flock -w 60 9
test "$(sha256sum "$app/auto-deploy.sh" | cut -d' ' -f1)" = "$expected"
test "$(git -C "$app/src/erp" rev-parse HEAD)" = "$(cat "$app/.deployed/erp")"
curl -fsS --max-time 10 http://localhost/healthz >/dev/null
mkdir -p "$backup"
chmod 700 "$backup"
test ! -e "$backup/auto-deploy-before.sh"
cp "$app/auto-deploy.sh" "$backup/auto-deploy-before.sh"
git -C "$app/src/erp" show "$sha:deploy/migrate/auto-deploy.sh" >"$backup/auto-deploy-reviewed.sh"
bash -n "$backup/auto-deploy-reviewed.sh"
install -m 0755 "$backup/auto-deploy-reviewed.sh" "$app/.auto-deploy-reviewed"
mv "$app/.auto-deploy-reviewed" "$app/auto-deploy.sh"
cmp "$backup/auto-deploy-reviewed.sh" "$app/auto-deploy.sh"
echo 'AUTOMATIC_DEPLOY_HELPER_UPDATED=true'
