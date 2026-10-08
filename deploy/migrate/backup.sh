#!/bin/bash
# 매일 백업 — DB 전체와 PMS·HR 파일을 우리 계정 S3 로.
#
# 옛 서버는 백업이 비그로우 계정 버킷으로 갔다. 서버를 옮겨도 그 덤프들은 거기 남는다.
# 여기서는 우리 계정 버킷으로만 보낸다. 버킷은 비공개·암호화·버전·90일 정리로 만들어 뒀다.
set -euo pipefail
cd /opt/app

STAMP=$(TZ=Asia/Seoul date +%F)
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="s3://amescotes-erp-backups-${ACCOUNT}"
REGION=ap-northeast-2

docker compose exec -T db pg_dump -U postgres erp | gzip \
  | aws s3 cp - "$BUCKET/backups/erp-${STAMP}.sql.gz" --region "$REGION" --only-show-errors

for n in daily hr; do
  f="/opt/app/${n}-data/${n}.db"
  [ -f "$f" ] && gzip -c "$f" \
    | aws s3 cp - "$BUCKET/backups/${n}-${STAMP}.db.gz" --region "$REGION" --only-show-errors
done

echo "[$(date '+%F %T')] 백업 완료 $STAMP"
