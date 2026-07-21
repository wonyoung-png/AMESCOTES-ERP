@echo off
setlocal EnableExtensions
title AMESCOTES ERP Server

echo.
echo ========================================
echo   AMESCOTES ERP Server Starting...
echo   Open: http://localhost:4000
echo ========================================
echo.

cd /d "%~dp0"
set PORT=4000

echo [0/2] Freeing port 4000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do (
  echo   - kill PID %%a
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [1/2] Building...
call npm run build
if errorlevel 1 (
  echo.
  echo BUILD FAILED. Server not started.
  pause
  exit /b 1
)
if not exist "dist\public\index.html" (
  echo.
  echo BUILD OUTPUT MISSING: dist\public\index.html
  echo Run npm run build again.
  pause
  exit /b 1
)

echo.
echo [2/2] Starting server...
set NODE_ENV=production
node dist\index.js

echo.
echo Server stopped.
pause
