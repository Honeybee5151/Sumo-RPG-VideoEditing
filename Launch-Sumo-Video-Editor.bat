@echo off
title Sumo Brothers AI Video Editor Launcher
cd /d "%~dp0"
echo Starting Sumo Brothers AI Video Editor Desktop App...
start /b npm run dev
npx electron electron/main.cjs
