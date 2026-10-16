@echo off
title INTRAMOVE Launcher
cd /d "%~dp0"

:: Check if server is already running on port 5173
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
    echo [INTRAMOVE] Starting server in background...
    start /min "INTRAMOVE_SERVER" cmd.exe /c "npm run dev"
    ping -n 3 127.0.0.1 >nul
)

:: Open default browser to the web app
start "" "http://localhost:5173"
exit
