@echo off
REM Boot launcher: serve existing build (no rebuild). Registered in Startup.
cd /d "%~dp0"
set PORT=4000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
node dist\index.js
