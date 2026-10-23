@echo off
cd /d "%~dp0"
if exist "node_modules\electron\dist\Sumo VideoEditor.exe" (
  start "" "node_modules\electron\dist\Sumo VideoEditor.exe"
) else (
  start "" "node_modules\electron\dist\electron.exe" "electron\main.cjs"
)
