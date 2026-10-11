#!/bin/bash
# Attest an automatic deployment by exact runtime files, not source HEAD alone.
set -euo pipefail
set +x
umask 077
sha=${1:?pinned release required}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
app=/opt/app
backup="$app/backups/ads-rollout-$sha"
test ! -e "$backup/switch-aborted"
test "$(cat "$backup/database-ready")" = "$sha"
exec 9>"$app/.deploy.lock"
flock -w 60 9
test "$(git -C "$app/src/erp" rev-parse HEAD)" = "$sha"
test "$(git -C "$app/src/erp" rev-parse origin/aws-migration)" = "$sha"
test -z "$(git -C "$app/src/erp" status --porcelain)"
git -C "$app/src/erp" show "$sha:deploy/migrate/Caddyfile" >"$backup/pinned-Caddyfile"
cmp "$backup/pinned-Caddyfile" "$backup/Caddyfile"
docker exec app-caddy-1 cat /etc/caddy/Caddyfile >"$backup/live-mounted-Caddyfile"
cmp "$backup/live-mounted-Caddyfile" "$app/Caddyfile"
test "$(docker inspect app-app-1 --format '{{.State.Running}}')" = true
test "$(docker inspect app-app-1 --format '{{.State.Health.Status}}')" = healthy
test "$(docker inspect app-app-1 --format '{{.Image}}')" != "$(cat "$backup/image-id.txt")"
# All built runtime assets must match the separately prebuilt/rehearsed release.
docker exec app-app-1 node -e 'const fs=require("fs");function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const q=p+"/"+e.name;if(e.isDirectory())walk(q);else fs.accessSync(q,fs.constants.R_OK);}}walk("/app/dist");'
docker exec --user root app-app-1 sh -c 'cd /app && find dist package.json -type f -exec sha256sum {} \; | sort' >"$backup/live-runtime-files.sha256"
docker run --rm --network none --user root --entrypoint sh "amescotes-erp:ads-$sha" -c 'cd /app && find dist package.json -type f -exec sha256sum {} \; | sort' >"$backup/pinned-runtime-files.sha256"
test -s "$backup/pinned-runtime-files.sha256"
cmp "$backup/live-runtime-files.sha256" "$backup/pinned-runtime-files.sha256"
test "$(docker exec app-db-1 psql -X -At -U postgres -d erp -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('ads_analysis_runs','ads_analysis_budget','ads_analysis_jobs','ads_analysis_notices','product_listings','channel_tokens','sample_workflow_settings');")" = 7
curl -fsS --max-time 10 http://localhost/healthz >/dev/null
curl -fsS --max-time 10 https://erp.ameserp.kr/healthz >/dev/null
test ! -e "$backup/switch-aborted"
printf 'sha=%s\nruntime_files_match=true\nhealth=true\nnew_tables=7\n' "$sha" >"$backup/live-attestation.txt"
# The installed legacy auto-deploy does not write state. This is verified evidence,
# not a fabricated marker based on HEAD or an unverified image replacement.
mkdir -p "$app/.deployed"
printf '%s\n' "$sha" >"$app/.deployed/erp.attested"
mv "$app/.deployed/erp.attested" "$app/.deployed/erp"
echo "LIVE_RELEASE_ATTESTED=$sha"
