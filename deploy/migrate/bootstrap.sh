#!/bin/bash
# 새 서버 세우기 — 빈 리눅스 한 대를 받아 우리 스택이 도는 상태까지.
#
# 왜 이 파일이 있나: 지금 서버는 손으로 하나씩 쌓아 올린 것이라, 그걸 그대로 다시 만들
# 방법이 아무 데도 적혀 있지 않았다. 서버를 옮기려면 먼저 "다시 만들 수 있어야" 한다.
#
#   bash bootstrap.sh ameserp.kr
#
# 끝나면 빈 DB 로 돌아간다. 지금 데이터를 옮기는 건 cutover.sh 가 따로 한다.
set -euo pipefail

ROOT_DOMAIN="${1:-}"
[ -n "$ROOT_DOMAIN" ] || { echo "쓰는 법: bash bootstrap.sh ameserp.kr"; exit 1; }
ERP_HOST="erp.${ROOT_DOMAIN}"

APP=/opt/app
log() { echo "[$(date '+%F %T')] $*"; }

# ── 1. 도커
if ! command -v docker >/dev/null; then
  log "도커 설치"
  if command -v dnf >/dev/null; then
    dnf install -y docker git
    systemctl enable --now docker
  else
    apt-get update -qq && apt-get install -y -qq docker.io docker-compose-plugin git
    systemctl enable --now docker
  fi
fi
# Amazon Linux 2023 의 docker 패키지에는 compose 플러그인이 안 들어 있다. 직접 받는다
if ! docker compose version >/dev/null 2>&1; then
  log "docker compose 플러그인 설치"
  CV=v2.39.1
  ARCH=$(uname -m)   # aarch64 또는 x86_64
  mkdir -p /usr/libexec/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/${CV}/docker-compose-linux-${ARCH}" \
    -o /usr/libexec/docker/cli-plugins/docker-compose
  chmod +x /usr/libexec/docker/cli-plugins/docker-compose
fi
docker compose version >/dev/null || { echo "docker compose 설치 실패"; exit 1; }

# ── 2. 스왑 — 2GB 서버에서 빌드하다 서버가 통째로 멈춘 적이 있다 (2026-08-06).
# 스왑이 없으면 메모리를 다 쓴 순간 SSH 까지 끊긴다. 먼저 깔아 둔다.
if ! swapon --show | grep -q .; then
  log "스왑 2GB"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p "$APP"/{src,daily-data,hr-data,.ssh}
chmod 700 "$APP/.ssh"
# PMS·HR 컨테이너는 appuser(uid 1000) 로 돈다. root 소유로 두면 SQLite 가
# "unable to open database file" 로 죽고 컨테이너가 재시작만 반복한다
chown -R 1000:1000 "$APP/daily-data" "$APP/hr-data"
cd "$APP"

# ── 3. 배포키 — 레포가 비공개라 익명으로는 못 받는다.
# 깃허브 배포키는 레포 하나당 하나만 쓸 수 있다. 같은 키를 두 번째 레포에 넣으면
# "key is already in use" 로 막힌다. 그래서 레포마다 따로 만든다.
# 키는 여기서 만들고 여기서만 산다 — 만들어서 보내면 보낸 경로에 사본이 남는다.
NEED_KEYS=0
for n in erp daily hr; do
  [ -f "$APP/.ssh/deploy_$n" ] || { ssh-keygen -t ed25519 -N "" -C "ameserp-$n" -f "$APP/.ssh/deploy_$n" >/dev/null; NEED_KEYS=1; }
done
[ -f "$APP/.ssh/known_hosts" ] || ssh-keyscan -t ed25519 github.com > "$APP/.ssh/known_hosts" 2>/dev/null
chmod 600 "$APP"/.ssh/deploy_*

gitssh() { echo "ssh -i $APP/.ssh/deploy_$1 -o UserKnownHostsFile=$APP/.ssh/known_hosts -o IdentitiesOnly=yes"; }

# 레포마다 읽기 권한이 있는지 본다. 하나라도 막혀 있으면 공개키를 보여주고 멈춘다
BLOCKED=""
check() { GIT_SSH_COMMAND="$(gitssh "$1")" git ls-remote "git@github.com:wonyoung-png/$2.git" HEAD >/dev/null 2>&1 || BLOCKED="$BLOCKED $1:$2"; }
check erp   AMESCOTES-ERP
check daily atlm-daily-check
check hr    atlm-hr
if [ -n "$BLOCKED" ]; then
  echo
  echo "===== 아래 공개키를 각 레포에 '읽기 전용' 배포키로 넣어라 ====="
  for n in erp daily hr; do
    case $n in erp) R=AMESCOTES-ERP;; daily) R=atlm-daily-check;; hr) R=atlm-hr;; esac
    echo "--- wonyoung-png/$R"
    cat "$APP/.ssh/deploy_$n.pub"
  done
  echo "============================================================"
  echo "아직 안 붙은 것:$BLOCKED"
  echo "넣은 뒤 이 스크립트를 다시 실행해라."
  exit 0
fi

# ── 4. 소스 — 이미지를 받아오지 않고 직접 빌드한다 (ECR 은 비그로우 계정에 있다)
clone() {
  local name=$1 repo=$2 branch=$3
  export GIT_SSH_COMMAND="$(gitssh "$name")"
  if [ -d "$APP/src/$name/.git" ]; then
    git -C "$APP/src/$name" fetch -q origin "$branch" && git -C "$APP/src/$name" reset -q --hard "origin/$branch"
  else
    git clone -q -b "$branch" "git@github.com:wonyoung-png/$repo.git" "$APP/src/$name"
  fi
  log "$name $(git -C "$APP/src/$name" log --oneline -1)"
}
clone erp   AMESCOTES-ERP     aws-migration
clone daily atlm-daily-check  master
clone hr    atlm-hr           main
unset GIT_SSH_COMMAND

cp "$APP/src/erp/deploy/migrate/docker-compose.yml" "$APP/docker-compose.yml"
cp "$APP/src/erp/deploy/migrate/Caddyfile"          "$APP/Caddyfile"

# ── 5. 비밀값 — 옛 값을 가져오지 않는다.
# 지금 쓰는 값은 비그로우 서버의 .env 에 있던 것이고, 그 서버의 root 를 그쪽이 쥐고 있다.
# 그대로 들고 오면 서버만 바꾸고 열쇠는 그대로 주는 셈이다.
if [ ! -f "$APP/.env" ]; then
  log "비밀값 새로 생성"
  umask 077
  cat > "$APP/.env" <<EOF
ROOT_DOMAIN=$ROOT_DOMAIN
ERP_HOST=$ERP_HOST
POSTGRES_PASSWORD=$(openssl rand -hex 24)
PGRST_AUTHENTICATOR_PASSWORD=$(openssl rand -hex 24)
PGRST_JWT_SECRET=$(openssl rand -hex 32)

# ── 아래는 사람이 채운다 (옛 서버에서 가져오지 말고 전부 새로 발급) ──
ANTHROPIC_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SHARE_USER=atlm
SHARE_PASS=
EOF
  : > "$APP/daily.env"; : > "$APP/hr.env"; chmod 600 "$APP"/*.env
  echo
  echo "!! $APP/.env 의 빈 항목을 채우고 다시 실행해라. 전부 새로 발급한 값이어야 한다."
  echo "!! daily.env · hr.env 도 옛 서버 항목을 보고 새 값으로 채워라."
  exit 0
fi

# ── 6. 띄우기
log "빌드·기동 (처음이면 10분쯤 걸린다)"
docker compose build
docker compose up -d
sleep 20
docker compose ps

log "끝. 이제 DNS 를 이 서버로 돌리고, 데이터는 cutover.sh 로 옮긴다."
log "DNS: $ERP_HOST / ceo.$ROOT_DOMAIN / daily.$ROOT_DOMAIN / hr.$ROOT_DOMAIN / os.$ROOT_DOMAIN → 이 서버 IP (A 레코드)"
