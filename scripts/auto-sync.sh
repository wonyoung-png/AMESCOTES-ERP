#!/bin/bash
# ERP 자동 동기화 스크립트
# GitHub에 새 커밋이 있으면 자동으로 pull + 재시작

ERP_DIR="/Users/leewonyoung/클로드/ERP/source/atlm-erp"
LOG_FILE="/tmp/erp-sync.log"

echo "$(date '+%Y-%m-%d %H:%M:%S') [AUTO-SYNC] 체크 중..." >> $LOG_FILE

cd $ERP_DIR

# 원격 최신 커밋 가져오기
git fetch origin main --quiet 2>/dev/null

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [AUTO-SYNC] 새 커밋 감지! 업데이트 중..." >> $LOG_FILE
    
    # 기존 서버 종료
    pkill -f "npm run dev" 2>/dev/null
    pkill -f "tsx server/agent-server" 2>/dev/null
    sleep 2
    
    # 코드 업데이트
    git pull origin main --quiet
    npm install --legacy-peer-deps --silent 2>/dev/null
    
    # 개발 서버 재시작
    npm run dev > /tmp/erp-dev.log 2>&1 &
    sleep 3
    
    # 에이전트 서버 재시작
    npx tsx server/agent-server.ts >> /tmp/erp-agent.log 2>&1 &
    
    echo "$(date '+%Y-%m-%d %H:%M:%S') [AUTO-SYNC] 업데이트 완료! 새 커밋: $REMOTE" >> $LOG_FILE
    
    # 텔레그램 알림 (올리브에게)
    curl -s "https://api.telegram.org/bot8587933478:AAHx-TISpm3F0HOUl8F5KTDTVo5kDZl6rvE/sendMessage" \
      -d "chat_id=6708085360&text=🔄 ERP 자동 업데이트 완료! GitHub 새 커밋 반영됨" > /dev/null 2>&1
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') [AUTO-SYNC] 최신 상태 유지 중" >> $LOG_FILE
fi
