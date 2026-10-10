#!/bin/bash
# Docker host only. Feed reviewed esbuild CJS bundle through stdin; never key files.
set -euo pipefail
exec 9>/opt/app/.deploy.lock
flock -w 60 9
cd /opt/app/src/erp
test "$(git rev-parse HEAD)" = "${ERP_E2E_EXPECTED_HEAD:?Set the reviewed deployed commit}"
test "$(docker exec app-app-1 node -e 'process.stdout.write(process.env.ERP_PRIVATE_MODE || "")')" = true
net=erp-e2e-live-egress-20261010
if docker network inspect "$net" >/dev/null 2>&1; then echo 'Live egress target already exists'; exit 1; fi
for target in erp-e2e-runner-20261010 erp-e2e-api-20261010 erp-e2e-db-20261010; do
 if docker inspect "$target" >/dev/null 2>&1; then echo 'Test target already exists'; exit 1; fi
done
if docker network inspect erp-e2e-20261010 >/dev/null 2>&1; then echo 'Test internal network already exists'; exit 1; fi
cleanup() {
  bash scripts/e2e-isolated-cleanup.sh
  if docker network inspect "$net" >/dev/null 2>&1; then
    test "$(docker network inspect "$net" --format '{{index .Labels "codex.e2e"}}|{{len .Containers}}')" = '20261010|0'
    docker network rm "$net" >/dev/null
  fi
}
trap cleanup EXIT
bash scripts/e2e-isolated-bootstrap.sh
docker network create --label codex.e2e=20261010 "$net" >/dev/null
docker network connect "$net" erp-e2e-runner-20261010
ready=false
for i in $(seq 1 30); do
  if docker exec erp-e2e-db-20261010 psql -U postgres -d erp_e2e -X -Atqc 'select count(*) from app_users' | grep -qx 0; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
sleep 2
{
 docker exec app-app-1 node -e 'if(!process.env.ANTHROPIC_API_KEY)process.exit(1);process.stdout.write("process.env.ERP_E2E_LIVE_WORK=\"1\";process.env.ANTHROPIC_API_KEY="+JSON.stringify(process.env.ANTHROPIC_API_KEY)+";\n")'
 cat
} | docker start -ai erp-e2e-runner-20261010
test "$(docker inspect erp-e2e-runner-20261010 --format '{{.State.ExitCode}}')" = 0
test "$(docker exec app-app-1 node -e 'process.stdout.write(process.env.ERP_PRIVATE_MODE || "")')" = true
curl -fsS https://erp.ameserp.kr/healthz >/dev/null
echo LIVE_WORK_CHAIN_VERIFIED_PRODUCTION_UNCHANGED
