#!/bin/bash
# AMESCOTES ERP — 세션 시작 훅
# 클로드코드가 열릴 때 자동으로 의존성 설치 + 빌드 + 서버 시작

set -euo pipefail

# 원격 환경(오픈클로)에서만 실행
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "=== AMESCOTES ERP 시작 중 ==="

# 1. 의존성 설치
echo "[1/3] 패키지 설치..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# 2. 빌드
echo "[2/3] 빌드 중..."
pnpm build

# 3. 서버 시작 (백그라운드)
echo "[3/3] 서버 시작..."
pkill -f "dist/index.js" 2>/dev/null || true
sleep 1

if [ -f ".env" ]; then
  nohup node --env-file=.env dist/index.js >> /tmp/erp-server.log 2>&1 &
else
  nohup node dist/index.js >> /tmp/erp-server.log 2>&1 &
fi

sleep 2
echo "=== ERP 서버 시작 완료 (포트 3000) ==="
