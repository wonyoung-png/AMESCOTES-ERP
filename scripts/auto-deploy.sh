#!/bin/bash
# ERP 자동 배포 — aws-migration에 새 커밋이 올라오면 서버가 스스로 빌드·교체한다.
#
# 손으로 배포하던 때, 코드는 들어왔는데 배포를 안 해 이틀 동안 픽셀 API가
# 죽어 있었다. 아무도 몰랐다. 그래서 서버가 직접 물어오게 했다.
#
# 빌드가 깨지면 이미지가 안 올라가고, 안 올라가면 교체도 없다. 그게 안전망이다.
# 헬스체크까지 통과해야 "배포됨"으로 기록해서, 실패하면 다음 주기에 다시 시도한다.
#
# 설치: systemd 타이머가 2분마다 실행 (scripts/auto-deploy.timer)
# 로그: /opt/app/deploy.log · journalctl -u erp-auto-deploy
set -euo pipefail

REPO_URL=https://github.com/wonyoung-png/AMESCOTES-ERP.git
BRANCH=aws-migration
ECR=858695669700.dkr.ecr.ap-northeast-2.amazonaws.com/amescotes-erp:latest
REGION=ap-northeast-2
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
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ECR%%/*}" >/dev/null

if ! docker buildx build --platform linux/arm64 \
      --build-arg VITE_SUPABASE_URL=https://54-116-241-64.sslip.io \
      --build-arg VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
      -t "$ECR" --push /tmp/erp-auto >>"$LOG" 2>&1; then
  log "빌드 실패 — 돌던 버전 그대로 둔다"
  exit 1
fi

cd /opt/app && docker compose pull -q app && docker compose up -d app
sleep 8
if curl -sf --max-time 10 http://localhost:4000/api/agent/health >/dev/null; then
  echo "$REMOTE" > "$STATE"
  log "배포 완료 ${REMOTE:0:7}"
else
  log "헬스체크 실패 — 교체는 됐으나 서버가 안 뜬다. 확인 필요"
  exit 1
fi
docker image prune -f >/dev/null 2>&1 || true
