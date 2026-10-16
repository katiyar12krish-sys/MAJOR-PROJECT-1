@echo off
title Stop INTRAMOVE Server
cd /d "%~dp0"

echo [INTRAMOVE] Stopping server on port 5173...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo Server stopped successfully.
timeout /t 2 >nul
exit
