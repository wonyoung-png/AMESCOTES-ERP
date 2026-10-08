#!/bin/bash
# 데이터 옮기기 — 옛 서버에서 받은 덤프를 새 서버에 넣는다.
#
# 새 서버에서 실행한다. 옛 서버의 덤프 파일 3개를 먼저 올려 둬야 한다.
#   erp.sql.gz      PostgreSQL 전체
#   daily.db        PMS (SQLite)
#   hr.db           HR  (SQLite)
#
#   bash cutover.sh /root/dump
#
# 일 안 할 때 하는 게 맞다. 넣는 동안 앱을 내린다 — 반쯤 들어간 상태로 누가 쓰면
# 그 입력이 덮어써져 사라진다.
set -euo pipefail

SRC="${1:-}"
[ -d "$SRC" ] || { echo "쓰는 법: bash cutover.sh /덤프가-있는-폴더"; exit 1; }
APP=/opt/app
cd "$APP"
log() { echo "[$(date '+%F %T')] $*"; }

# 자동배포와 같은 자물쇠를 잡는다. 데이터를 넣는 중에 타이머가 컨테이너를 바꾸면
# 반쯤 들어간 DB 위에서 앱이 뜬다 (코덱스 지적)
exec 9>"$APP/.deploy.lock"
flock -w 600 9 || { echo "자동배포가 돌고 있다. 끝나면 다시 해라"; exit 1; }

# 앱을 내려놓고 일하는 중이라, 어디서 멈추든 앱은 다시 올려야 한다.
# 실패할 수 있는 줄마다 if 로 감싸면 빠뜨리는 데가 생긴다 — 나가는 길을 하나로 묶는다 (코덱스 지적)
STOPPED=0
on_exit() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$STOPPED" -eq 1 ]; then
    echo "[$(date '+%F %T')] 중간에 멈췄다 — 앱을 다시 올린다 (DB 상태는 위 로그를 봐라)"
    docker compose up -d || true
  fi
  exit $rc
}
trap on_exit EXIT

for f in erp.sql.gz daily.db hr.db; do
  [ -f "$SRC/$f" ] || { echo "없다: $SRC/$f"; exit 1; }
done

log "앱 내림 (DB 만 켜 둔다)"
# PostgREST 도 내려야 한다. erp 에 붙어 있으면 이름을 못 바꾼다 (코덱스 지적)
# 내리기 전에 켠다. 내리는 중에 실패하면 일부만 내려간 채로 끝나는데,
# 그때도 trap 이 다시 올려야 한다 (코덱스 지적)
STOPPED=1
docker compose stop app daily hr postgrest

# ── PostgreSQL
# 덤프에 CREATE 가 들어 있어서 빈 스키마 위에 부으면 "이미 있다"로 절반이 튕긴다.
# 그래서 통째로 갈아야 하는데, 지금 것을 먼저 지우면 복원이 깨졌을 때 빈 DB 만 남는다.
# 옆에 새 DB 를 만들어 다 부은 뒤, 성공했을 때만 이름을 바꾼다 (코덱스 지적).
#
# 덤프에 erp_server 역할이 섞여 있다 (접수함 승인이 쓰는 역할).
# 새 DB 초기화 스크립트는 anon·authenticator 만 만들어서, 없으면 복원이 통째로 멈춘다
log "빠진 역할 만들기"
docker compose exec -T db psql -U postgres -d postgres -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='erp_server') then
     create role erp_server nologin; grant anon to erp_server; grant erp_server to authenticator;
   end if; end \$\$;"

log "임시 DB 에 덤프 넣기"
docker compose exec -T db psql -U postgres -d postgres -q \
  -c "drop database if exists erp_new with (force);" -c "create database erp_new;"
if ! gunzip -c "$SRC/erp.sql.gz" | docker compose exec -T db psql -U postgres -d erp_new -q -v ON_ERROR_STOP=1; then
  log "복원 실패 — 쓰던 DB 는 그대로 두고 멈춘다. 임시 DB(erp_new) 를 보고 원인을 찾아라"
  exit 1
fi

log "이름 바꾸기 (쓰던 것은 erp_old 로 남긴다)"
# ALTER DATABASE … RENAME 은 트랜잭션 안에서 못 돈다 (실측 확인).
# 그래서 두 번을 묶을 수가 없다 — 가운데서 멈추면 erp 라는 이름이 사라진다.
# 두 번째가 실패하면 첫 번째를 되돌려 쓰던 DB 를 제자리에 놓는다.
psql_() { docker compose exec -T db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 "$@"; }
# 지난번 되돌리기용 DB 를 바로 지우면, 이번 이름 바꾸기가 실패했을 때
# 돌아갈 자리가 아예 없어진다. 한 세대 옆으로 밀어 두고 맨 끝에 지운다 (코덱스 지적)
psql_ -c "drop database if exists erp_old_prev with (force);"
psql_ -c "alter database erp_old rename to erp_old_prev;" 2>/dev/null || true
# set -e 때문에 여기서 실패하면 앱이 내려간 채로 스크립트가 끝난다 — 앱부터 올리고 나간다
if ! psql_ -c "alter database erp rename to erp_old;"; then
  log "쓰던 DB 이름을 못 바꿨다 — 그대로 둔다"
  exit 1
fi
if ! psql_ -c "alter database erp_new rename to erp;"; then
  log "이름 바꾸기 중간에 실패 — 쓰던 DB 를 제자리로 되돌린다"
  psql_ -c "alter database erp_old rename to erp;" || log "되돌리기도 실패. erp_old 를 손으로 erp 로 바꿔라"
  exit 1
fi

# 덤프에는 authenticator·erp_server 역할의 비밀번호가 옛 값으로 들어 있다.
# 새 서버의 .env 값으로 맞춰 준다 — 안 맞으면 PostgREST 가 DB 에 못 붙는다.
log "DB 역할 비밀번호를 새 값으로"
PW=$(grep '^PGRST_AUTHENTICATOR_PASSWORD=' .env | cut -d= -f2-)
docker compose exec -T db psql -U postgres -d erp -q \
  -c "alter role authenticator with password '$PW';"

# ── SQLite 두 개
log "PMS·HR 데이터 넣기"
cp "$SRC/daily.db" "$APP/daily-data/daily.db"
cp "$SRC/hr.db"    "$APP/hr-data/hr.db"

# 여기까지 왔으면 이번 것이 자리를 잡았다. 한 세대 전 것은 이제 지워도 된다
psql_ -c "drop database if exists erp_old_prev with (force);" 2>/dev/null || true

log "앱 올림"
docker compose up -d
sleep 20

# ── 확인
log "확인"
docker compose exec -T db psql -U postgres -d erp -tAc \
  "select 'items '||count(*) from items union all select 'boms '||count(*) from boms
   union all select 'vendors '||count(*) from vendors
   union all select 'production_orders '||count(*) from production_orders
   union all select 'trade_statements '||count(*) from trade_statements"
curl -sf -o /dev/null -w "healthz=%{http_code}\n" http://localhost/healthz || echo "healthz 실패"

cat <<'EOF'

다음 (사람이 한다):
  1. 로그인해서 품목·BOM·발주가 보이는지 눈으로 확인
  2. DNS 를 새 서버 IP 로 — 바꾸는 순간부터 사람들이 새 서버로 들어온다
  3. 옛 서버의 자동배포 타이머를 끈다 (systemctl disable --now erp-auto-deploy.timer)
     안 끄면 옛 서버가 계속 돌면서 양쪽에 글이 쌓인다
  4. 하루 지켜본 뒤 옛 서버 정리 요청

되돌리려면 (옮기기 전 DB 는 erp_old 로 남아 있다):
  docker compose stop app daily hr postgrest   # postgrest 가 붙어 있으면 이름을 못 바꾼다
  docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "alter database erp rename to erp_bad;"
  docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "alter database erp_old rename to erp;"   # 이 줄이 실패하면 erp_bad 를 erp 로 되돌려라
  docker compose up -d
EOF
