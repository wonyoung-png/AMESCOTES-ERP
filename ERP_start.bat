@echo off
REM ASCII-only launcher (use if ERP_시작.bat has encoding errors)
cd /d "%~dp0"
set PORT=4000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
call npm run build
if errorlevel 1 pause & exit /b 1
node dist\index.js
pause
