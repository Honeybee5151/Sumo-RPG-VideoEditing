@echo off
title ChromaCut Studio Desktop App Launcher
cd /d "%~dp0"
echo Starting ChromaCut Studio Desktop App...
start /b npm run dev
timeout /t 2 /nobreak >nul
start msedge --app=http://localhost:3000 --window-size=1440,900
