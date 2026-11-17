@echo off
rem Double-click launcher: serves the game and opens http://127.0.0.1:8000/web/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
