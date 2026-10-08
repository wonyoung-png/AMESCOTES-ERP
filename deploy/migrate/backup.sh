#!/bin/bash
# 매일 백업 — DB 전체와 PMS·HR 파일을 우리 계정 S3 로.
#
# 옛 서버는 백업이 비그로우 계정 버킷으로 갔다. 서버를 옮겨도 그 덤프들은 거기 남는다.
# 여기서는 우리 계정 버킷으로만 보낸다. 버킷은 비공개·암호화·버전·90일 정리로 만들어 뒀다.
set -euo pipefail
cd /opt/app

FAILED=0
STAMP=$(TZ=Asia/Seoul date +%F)
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="s3://amescotes-erp-backups-${ACCOUNT}"
REGION=ap-northeast-2

docker compose exec -T db pg_dump -U postgres erp | gzip \
  | aws s3 cp - "$BUCKET/backups/erp-${STAMP}.sql.gz" --region "$REGION" --only-show-errors

# SQLite 는 쓰는 중에 파일을 그냥 복사하면 깨진 사본이 나온다. WAL 에만 있고 본체에
# 아직 안 내려간 내용도 빠진다. sqlite3 가 직접 일관된 사본을 뜨게 한다 (코덱스 지적)
for n in daily hr; do
  f="/opt/app/${n}-data/${n}.db"
  [ -f "$f" ] || continue
  tmp="/tmp/${n}-backup.db"; rm -f "$tmp"
  # 지난번 실패로 컨테이너 안에 남아 있으면 VACUUM INTO 가 계속 거부한다 (코덱스 지적)
  docker compose exec -T "$n" rm -f "/tmp/${n}-backup.db" >/dev/null 2>&1 || true
  if docker compose exec -T "$n" sqlite3 "/app/data/${n}.db" "VACUUM INTO '/tmp/${n}-backup.db'" >/dev/null 2>&1 \
     && docker compose cp "${n}:/tmp/${n}-backup.db" "$tmp" >/dev/null 2>&1; then
    gzip -c "$tmp" | aws s3 cp - "$BUCKET/backups/${n}-${STAMP}.db.gz" --region "$REGION" --only-show-errors
    docker compose exec -T "$n" rm -f "/tmp/${n}-backup.db" >/dev/null 2>&1 || true
    rm -f "$tmp"
  else
    # 쓰는 중인 파일을 그냥 복사하면 깨진 사본이 나온다. 그걸 올려 두고 "백업 완료"라고
    # 하면 정작 필요할 때 못 쓴다 — 올리지 않고 실패로 끝낸다 (코덱스 지적)
    echo "[$(date '+%F %T')] $n: VACUUM INTO 실패 — 이 날짜 백업 없음. sqlite3 가 컨테이너에 있는지 봐라" >&2
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "[$(date '+%F %T')] 백업 일부 실패 $STAMP" >&2
  exit 1
fi
echo "[$(date '+%F %T')] 백업 완료 $STAMP"
