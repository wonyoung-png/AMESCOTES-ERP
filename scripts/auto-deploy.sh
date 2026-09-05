#!/bin/bash
# ERP 자동 배포 — aws-migration에 새 커밋이 올라오면 서버가 스스로 빌드·교체한다.
#
# 손으로 배포하던 때, 코드는 들어왔는데 배포를 안 해 이틀 동안 픽셀 API가
# 죽어 있었다. 아무도 몰랐다. 그래서 서버가 직접 물어오게 했다.
#
# 빌드하는 서버와 돌리는 서버가 같으므로 ECR을 거치지 않는다. 로컬 태그로 끝낸다.
# (인스턴스 역할에 ecr:PutImage 권한도 없다)
#
# 안전망 셋:
#   1. 빌드가 깨지면 새 이미지가 안 생기고, 안 생기면 교체도 없다
#   2. 헬스체크를 통과해야 배포 성공으로 기록한다
#   3. 헬스체크가 실패하면 직전 이미지(:prev)로 스스로 되돌린다
#
# 설치: systemd 타이머가 2분마다 실행 (scripts/erp-auto-deploy.timer)
# 로그: /opt/app/deploy.log · journalctl -u erp-auto-deploy
set -euo pipefail

REPO_URL=https://github.com/wonyoung-png/AMESCOTES-ERP.git
BRANCH=aws-migration
# compose가 이 태그를 보고 있다. 이름만 ECR일 뿐 로컬 이미지다
IMAGE=858695669700.dkr.ecr.ap-northeast-2.amazonaws.com/amescotes-erp:latest
PREV=amescotes-erp:prev
STATE=/opt/app/.deployed-sha
LOG=/opt/app/deploy.log

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

REMOTE=$(git ls-remote "$REPO_URL" "refs/heads/$BRANCH" | cut -f1)
[ -n "$REMOTE" ] || { log "원격 조회 실패"; exit 1; }
[ "$REMOTE" = "$(cat "$STATE" 2>/dev/null || true)" ] && exit 0

log "새 커밋 ${REMOTE:0:7} — 배포 시작"
rm -rf /tmp/erp-auto
git clone -q -b "$BRANCH" --depth 1 "$REPO_URL" /tmp/erp-auto
log "$(cd /tmp/erp-auto && git log --oneline -1)"

ANON_KEY=$(grep '^PGRST_JWT_SECRET=' /opt/app/.env | cut -d= -f2-)

# 지금 돌던 이미지를 되돌리기용으로 남긴다
docker tag "$IMAGE" "$PREV" 2>/dev/null || true

if ! docker buildx build --platform linux/arm64 --load \
      --build-arg VITE_SUPABASE_URL=https://54-116-241-64.sslip.io \
      --build-arg VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
      -t "$IMAGE" /tmp/erp-auto >>"$LOG" 2>&1; then
  log "빌드 실패 — 돌던 버전 그대로 둔다"
  exit 1
fi

cd /opt/app && docker compose up -d app
sleep 8

# 4000 포트는 호스트에 열려 있지 않다(Caddy가 도커 네트워크로 붙는다).
# 컨테이너 IP를 찾아 직접 두드린다 — 바깥 DNS에 기대지 않는다
CIP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' app-app-1 2>/dev/null | head -1)
if [ -n "$CIP" ] && curl -sf --max-time 10 "http://$CIP:4000/api/agent/health" >/dev/null; then
  echo "$REMOTE" > "$STATE"
  log "배포 완료 ${REMOTE:0:7}"
  docker image prune -f >/dev/null 2>&1 || true
else
  log "헬스체크 실패 — 직전 버전으로 되돌린다"
  docker tag "$PREV" "$IMAGE" && docker compose up -d app
  exit 1
fi
