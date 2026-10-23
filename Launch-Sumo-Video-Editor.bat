@echo off
title ChromaCut AI Studio Launcher
cd /d "%~dp0"
netstat -ano | findstr ":3000.*LISTENING" >nul
if %errorlevel% neq 0 (
  echo Starting ChromaCut AI local server on port 3000...
  start /b npm run dev
)
start "" "node_modules\electron\dist\electron.exe" "electron\main.cjs"
