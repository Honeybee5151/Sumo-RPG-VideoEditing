@echo off
title Sumo VideoEditor
cd /d "%~dp0"
netstat -ano | findstr ":3000.*LISTENING" >nul
if %errorlevel% neq 0 (
  start /b npm run dev >nul 2>&1
)
start "" "node_modules\electron\dist\electron.exe" "electron\main.cjs"
