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
set -uo pipefail

APP=/opt/app
LOG=$APP/deploy.log
STATE=$APP/.deployed            # 앱별로 "실제로 띄우는 데 성공한" 커밋을 적어 둔다
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

mkdir -p "$STATE"
cd "$APP" || exit 1

# 둘이 겹쳐 돌면 컨테이너 이름이 엉켜 사이트가 내려간다 (옛 서버에서 실제로 겪었다).
# cutover.sh 도 같은 자물쇠를 잡는다 — 데이터를 넣는 중에 컨테이너가 바뀌면 안 된다
exec 9>"$APP/.deploy.lock"
flock -n 9 || exit 0

repo_of() { case $1 in erp) echo AMESCOTES-ERP;; daily) echo atlm-daily-check;; hr) echo atlm-hr;; esac; }
branch_of() { case $1 in erp) echo aws-migration;; daily) echo master;; hr) echo main;; esac; }
svc_of() { case $1 in erp) echo app;; daily) echo daily;; hr) echo hr;; esac; }
# 서비스별로 살아 있는지 보는 법. ERP 는 Caddy 를 거쳐 /healthz, 나머지는 컨테이너 상태로 본다
healthy() {
  case $1 in
    erp) curl -sf --max-time 15 http://localhost/healthz >/dev/null ;;
    *)   [ "$(docker inspect -f '{{.State.Running}}' "app-$(svc_of "$1")-1" 2>/dev/null)" = "true" ] &&
         [ "$(docker inspect -f '{{.RestartCount}}' "app-$(svc_of "$1")-1" 2>/dev/null)" -lt 3 ] ;;
  esac
}

CHANGED=""
for n in erp daily hr; do
  BR=$(branch_of "$n")
  export GIT_SSH_COMMAND="ssh -i $APP/.ssh/deploy_$n -o UserKnownHostsFile=$APP/.ssh/known_hosts -o IdentitiesOnly=yes"
  git -C "$APP/src/$n" fetch -q origin "$BR" 2>/dev/null || { log "$n 원격 조회 실패"; continue; }
  AFTER=$(git -C "$APP/src/$n" rev-parse "origin/$BR")
  # 띄우는 데 성공한 커밋과 비교한다. HEAD 와 비교하면 빌드가 한 번 깨진 뒤
  # 다음 실행이 "바뀐 것 없음" 으로 보고 영원히 배포되지 않는다 (코덱스 지적)
  DONE=$(cat "$STATE/$n" 2>/dev/null || echo none)
  [ "$DONE" = "$AFTER" ] && continue
  git -C "$APP/src/$n" reset -q --hard "$AFTER"
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

FAILED=""
for n in $CHANGED; do
  SVC=$(svc_of "$n")
  # fetch 때 고정한 커밋. HEAD 를 다시 읽으면 그 사이 또 당겨졌을 수 있다
  AFTER_SHA=$(git -C "$APP/src/$n" rev-parse HEAD)
  IMG=$(docker compose config --images "$SVC" 2>/dev/null | head -1)
  # 되돌릴 자리를 먼저 만들어 둔다. 지금 돌던 이미지에 :prev 딱지를 붙인다
  [ -n "$IMG" ] && docker tag "$IMG" "${SVC}-prev:latest" 2>/dev/null || true

  # 빌드가 깨지면 새 이미지가 안 생기고, 안 생기면 교체도 없다 — 돌던 것이 계속 돈다
  if ! docker compose build "$SVC" >>"$LOG" 2>&1; then
    log "$SVC 빌드 실패 — 돌던 버전 그대로 둔다"
    FAILED="$FAILED $n"
    continue
  fi
  # up 이 실패해도 옛 컨테이너가 그대로 돌고 있으면 healthy 를 통과한다.
  # 그러면 "배포됐다"고 적어 버려서 새 커밋이 영영 안 올라간다 (코덱스 지적)
  if ! docker compose up -d "$SVC" >>"$LOG" 2>&1; then
    log "$SVC 기동 실패 — 돌던 버전 그대로 둔다"
    FAILED="$FAILED $n"
    continue
  fi
  sleep 12

  if healthy "$n"; then
    echo "$AFTER_SHA" > "$STATE/$n"
    log "$SVC 교체 완료"
  else
    log "$SVC 헬스체크 실패 — 직전 버전으로 되돌린다"
    if docker image inspect "${SVC}-prev:latest" >/dev/null 2>&1; then
      docker tag "${SVC}-prev:latest" "$IMG" && docker compose up -d "$SVC" >>"$LOG" 2>&1
      sleep 10
      healthy "$n" && log "$SVC 되돌림 성공" || log "$SVC 되돌려도 안 산다 — 사람이 봐야 한다"
    else
      log "$SVC 되돌릴 이미지가 없다 — 사람이 봐야 한다"
    fi
    FAILED="$FAILED $n"
  fi
done

if echo "$CHANGED" | grep -q erp; then
  docker compose up -d caddy >>"$LOG" 2>&1 || true
  # PostgREST 는 시작할 때 읽은 스키마만 안다. 새 테이블·함수를 만들어도 다시 읽히지
  # 않으면 "그런 함수 없다"며 404 를 돌려준다 — 접수함 승인이 이걸로 한 번 막혔다
  docker kill -s SIGUSR1 app-postgrest-1 >/dev/null 2>&1 \
    && log "PostgREST 스키마 다시 읽음" || true
fi

docker image prune -f >/dev/null 2>&1 || true
if [ -n "$FAILED" ]; then
  log "실패:$FAILED (다음 실행에서 다시 시도한다)"
  exit 1
fi
log "배포 완료$CHANGED"
