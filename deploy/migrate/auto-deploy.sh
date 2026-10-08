#!/bin/bash
# 자동 배포 — 레포에 새 커밋이 올라오면 서버가 스스로 받아서 다시 세운다.
#
# 손으로 배포하던 때, 코드는 들어왔는데 배포를 안 해 이틀 동안 픽셀 API 가 죽어 있었다.
# 아무도 몰랐다. 그래서 서버가 직접 물어오게 했다.
#
# 옛 서버와 다른 점: ECR 에서 이미지를 받지 않는다. 레지스트리가 비그로우 계정에 있었다.
# 여기서는 소스에서 직접 빌드한다. 앱이 셋이라 바뀐 것만 다시 세운다.
#
# 설치: systemd 타이머가 2분마다 실행
set -euo pipefail

APP=/opt/app
LOG=$APP/deploy.log
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

cd "$APP"
# 둘이 겹쳐 돌면 컨테이너 이름이 엉켜 사이트가 내려간다 (옛 서버에서 실제로 겪었다)
exec 9>"$APP/.deploy.lock"
flock -n 9 || exit 0

CHANGED=""
for n in erp daily hr; do
  case $n in
    erp)   REPO=AMESCOTES-ERP;    BR=aws-migration ;;
    daily) REPO=atlm-daily-check; BR=master ;;
    hr)    REPO=atlm-hr;          BR=main ;;
  esac
  export GIT_SSH_COMMAND="ssh -i $APP/.ssh/deploy_$n -o UserKnownHostsFile=$APP/.ssh/known_hosts -o IdentitiesOnly=yes"
  BEFORE=$(git -C "$APP/src/$n" rev-parse HEAD 2>/dev/null || echo none)
  git -C "$APP/src/$n" fetch -q origin "$BR" 2>/dev/null || { log "$n 원격 조회 실패"; continue; }
  AFTER=$(git -C "$APP/src/$n" rev-parse "origin/$BR")
  [ "$BEFORE" = "$AFTER" ] && continue
  git -C "$APP/src/$n" reset -q --hard "origin/$BR"
  log "$n 새 커밋 ${AFTER:0:7} — $(git -C "$APP/src/$n" log --oneline -1)"
  CHANGED="$CHANGED $n"
done
unset GIT_SSH_COMMAND
[ -n "$CHANGED" ] || exit 0

# ERP 소스가 바뀌었으면 compose·Caddyfile 도 같이 따라온다
if echo "$CHANGED" | grep -q erp; then
  cp "$APP/src/erp/deploy/migrate/docker-compose.yml" "$APP/docker-compose.yml"
  cp "$APP/src/erp/deploy/migrate/Caddyfile"          "$APP/Caddyfile"
fi

for n in $CHANGED; do
  case $n in erp) SVC=app ;; daily) SVC=daily ;; hr) SVC=hr ;; esac
  # 빌드가 깨지면 새 이미지가 안 생기고, 안 생기면 교체도 없다 — 돌던 것이 계속 돈다
  if ! docker compose build "$SVC" >>"$LOG" 2>&1; then
    log "$SVC 빌드 실패 — 돌던 버전 그대로 둔다"
    continue
  fi
  docker compose up -d "$SVC" >>"$LOG" 2>&1
  log "$SVC 교체함"
done

if echo "$CHANGED" | grep -q erp; then
  docker compose up -d caddy >>"$LOG" 2>&1 || true
  # PostgREST 는 시작할 때 읽은 스키마만 안다. 새 테이블·함수를 만들어도 다시 읽히지
  # 않으면 "그런 함수 없다"며 404 를 돌려준다 — 접수함 승인이 이걸로 한 번 막혔다
  docker kill -s SIGUSR1 app-postgrest-1 >/dev/null 2>&1 \
    && log "PostgREST 스키마 다시 읽음" || true
fi

sleep 10
if curl -sf --max-time 15 http://localhost/healthz >/dev/null; then
  log "배포 완료$CHANGED"
  docker image prune -f >/dev/null 2>&1 || true
else
  log "헬스체크 실패 — 사람이 봐야 한다$CHANGED"
  exit 1
fi
