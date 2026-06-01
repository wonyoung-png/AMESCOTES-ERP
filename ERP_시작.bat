@echo off
chcp 65001 >nul
title AMESCOTES ERP Server
echo.
echo ========================================
echo   AMESCOTES ERP 서버 시작 중...
echo   접속: http://localhost:4000
echo   OCR 기능: 활성화 (Anthropic Vision)
echo ========================================
echo.

cd /d "%~dp0"
set PORT=4000
set ANTHROPIC_API_KEY=
node dist\index.js

echo.
echo 서버가 종료되었습니다.
pause
