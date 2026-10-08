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

for f in erp.sql.gz daily.db hr.db; do
  [ -f "$SRC/$f" ] || { echo "없다: $SRC/$f"; exit 1; }
done

log "앱 내림 (DB 는 켜 둔다)"
docker compose stop app daily hr

# ── PostgreSQL
# 통째로 지우고 다시 넣는다. 덤프에 CREATE 가 들어 있어서 빈 스키마 위에 부으면
# "이미 있다"로 절반이 튕긴다. 그 절반이 어디인지는 아무도 모른다.
# 덤프에 erp_server 역할이 섞여 있다 (접수함 승인이 쓰는 역할).
# 새 DB 초기화 스크립트는 anon·authenticator 만 만들어서, 없으면 복원이 통째로 멈춘다
log "빠진 역할 만들기"
docker compose exec -T db psql -U postgres -d postgres -q -c   "do \$\$ begin if not exists (select 1 from pg_roles where rolname='erp_server') then
     create role erp_server nologin; grant anon to erp_server; grant erp_server to authenticator;
   end if; end \$\$;"

log "DB 비우고 덤프 넣기"
docker compose exec -T db psql -U postgres -d postgres -q \
  -c "drop database if exists erp with (force);" -c "create database erp;"
gunzip -c "$SRC/erp.sql.gz" | docker compose exec -T db psql -U postgres -d erp -q -v ON_ERROR_STOP=1

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
EOF
