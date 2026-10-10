#!/bin/bash
# Exact test targets only. Do not prune Docker or touch production volumes.
set -euo pipefail
net=erp-e2e-20261010
targets=(erp-e2e-runner-20261010 erp-e2e-api-20261010 erp-e2e-db-20261010)
for target in "${targets[@]}"; do
  if ! docker inspect "$target" >/dev/null 2>&1; then continue; fi
  test "$(docker inspect --format '{{.Name}}|{{index .Config.Labels "codex.e2e"}}|{{.HostConfig.NetworkMode}}' "$target")" = "/$target|20261010|$net"
  test -z "$(docker inspect --format '{{range .Mounts}}{{if ne .Type "tmpfs"}}UNSAFE{{end}}{{end}}' "$target")"
  test -z "$(docker port "$target")"
done
if docker network inspect "$net" >/dev/null 2>&1; then
  test "$(docker network inspect --format '{{.Internal}}|{{index .Labels "codex.e2e"}}' "$net")" = 'true|20261010'
  for member in $(docker network inspect --format '{{range .Containers}}{{.Name}} {{end}}' "$net"); do
    case "$member" in erp-e2e-runner-20261010|erp-e2e-api-20261010|erp-e2e-db-20261010) ;; *) echo 'Unexpected network member; cleanup refused'; exit 1 ;; esac
  done
fi
for target in "${targets[@]}"; do
  if ! docker inspect "$target" >/dev/null 2>&1; then continue; fi
  docker stop -t 10 "$target" >/dev/null
  docker rm "$target" >/dev/null
done
if docker network inspect "$net" >/dev/null 2>&1; then docker network rm "$net" >/dev/null; fi
printf 'ISOLATED_SYNTHETIC_STACK_REMOVED\n'
