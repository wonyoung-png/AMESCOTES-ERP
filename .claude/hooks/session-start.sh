#!/bin/bash
# AMESCOTES ERP — 세션 시작 훅
# 클로드코드(오픈클로)가 열릴 때 자동으로 의존성 설치 + 서버 시작

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

# 2. AI 에이전트 API 서버 빌드 (포트 3001)
echo "[2/3] AI 에이전트 서버 빌드..."
npx esbuild server/agent-server.ts \
  --platform=node --packages=external --bundle --format=esm \
  --outdir=dist 2>/dev/null || true

# 3. 서버 시작
echo "[3/3] 서버 시작..."
pkill -f "dist/agent-server.js" 2>/dev/null || true
pkill -f "dist/index.js" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

if [ -f ".env" ]; then
  # AI 에이전트 API 서버 (포트 3001) — --use-env-proxy 필수 (Anthropic API 접근용)
  nohup node --use-env-proxy --env-file=.env dist/agent-server.js >> /tmp/agent-server.log 2>&1 &
  # Vite 개발 서버 (포트 3000) — /api 요청을 3001로 프록시
  nohup pnpm dev >> /tmp/vite-dev.log 2>&1 &
else
  nohup node --use-env-proxy dist/agent-server.js >> /tmp/agent-server.log 2>&1 &
  nohup pnpm dev >> /tmp/vite-dev.log 2>&1 &
fi

sleep 3
echo "=== Vite 개발서버(포트 3000) + AI 에이전트(포트 3001) 시작 완료 ==="
