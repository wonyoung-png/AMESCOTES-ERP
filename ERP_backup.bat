@echo off
REM Daily Supabase JSON backup (scheduled task, 21:00)
cd /d "%~dp0"
node scripts\backup-supabase.mjs
