#!/bin/bash
# Preparation only: does not apply DB migrations or replace the running app.
set -euo pipefail
set +x
umask 077
sha=${1:?pinned commit required}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
app=/opt/app
expected=1ceb6143297e4f5fab7bb3683146b061acfd13e3
test "$(git -C "$app/src/erp" rev-parse HEAD)" = "$expected"
test -z "$(git -C "$app/src/erp" status --porcelain)"
exec 9>"$app/.deploy.lock"
flock -w 60 9
test "$(git -C "$app/src/erp" rev-parse HEAD)" = "$expected"
test -z "$(git -C "$app/src/erp" status --porcelain)"
test "$(df -Pk "$app" | awk 'NR==2 {print $4}')" -gt 4194304
before_image=$(docker inspect app-app-1 --format '{{.Image}}')
export GIT_SSH_COMMAND="ssh -i $app/.ssh/deploy_erp -o UserKnownHostsFile=$app/.ssh/known_hosts -o IdentitiesOnly=yes"
git -C "$app/src/erp" fetch -q origin ads-rollout-20261011
test "$(git -C "$app/src/erp" rev-parse origin/ads-rollout-20261011)" = "$sha"
git -C "$app/src/erp" merge-base --is-ancestor "$expected" "$sha"
unset GIT_SSH_COMMAND
backup="$app/backups/ads-rollout-$sha"
release="$app/releases/ads-rollout-$sha"
test ! -e "$backup"
test ! -e "$release"
mkdir -p "$backup" "$app/releases"
chmod 700 "$backup"
docker exec app-db-1 pg_dump -U postgres -d erp -Fc >"$backup/erp.dump"
test -s "$backup/erp.dump"
docker exec -i app-db-1 pg_restore --list <"$backup/erp.dump" >"$backup/dump-index.txt"
docker exec app-db-1 pg_dump -U postgres -d erp --schema-only >"$backup/schema.sql"
docker exec app-db-1 pg_dumpall -U postgres --globals-only --no-role-passwords >"$backup/roles.sql"
cp "$app/docker-compose.yml" "$backup/docker-compose.yml"
cp "$app/.env" "$backup/env.private"
docker inspect app-app-1 --format '{{.Image}}' >"$backup/image-id.txt"
docker tag "$(<"$backup/image-id.txt")" "amescotes-erp:pre-ads-$sha"
git -C "$app/src/erp" archive HEAD >"$backup/source.tar"
docker exec app-db-1 psql -X -At -U postgres -d erp -c "SELECT proname || ':' || count(*) FROM pg_proc WHERE proname IN ('queue_work_notifications','record_payable_payment','record_korea_receipt','save_settlement') GROUP BY proname ORDER BY proname" >"$backup/prerequisites.txt"
for f in queue_work_notifications record_payable_payment record_korea_receipt save_settlement; do
  grep -q "^$f:" "$backup/prerequisites.txt" || { echo "MISSING_PREREQUISITE=$f"; exit 3; }
done
git -C "$app/src/erp" worktree add --detach "$release" "$sha" >"$backup/worktree.log" 2>&1
docker build --build-arg VITE_ROOT_DOMAIN=ameserp.kr -t "amescotes-erp:ads-$sha" "$release" >"$backup/build.log" 2>&1
test "$(docker inspect app-app-1 --format '{{.Image}}')" = "$before_image"
test "$(git -C "$app/src/erp" rev-parse HEAD)" = "$expected"
echo "BACKUP_VALIDATED=$backup"
echo "PREBUILD_VALIDATED=$sha"
echo 'OPERATING_APP_AND_DB_UNCHANGED=true'
