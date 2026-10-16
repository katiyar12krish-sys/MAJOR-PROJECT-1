@echo off
title INTRAMOVE Phone View Launcher
cd /d "%~dp0"

:: Check if server is already running on port 5173
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
    echo [INTRAMOVE] Starting server in background...
    start /min "INTRAMOVE_SERVER" cmd.exe /c "npm run dev"
    ping -n 3 127.0.0.1 >nul
)

:: Try opening in a dedicated phone-sized app window for a realistic smartphone feel
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:5173/?view=mobile" --window-size=430,900
    exit
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:5173/?view=mobile" --window-size=430,900
    exit
)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app="http://localhost:5173/?view=mobile" --window-size=430,900
    exit
)

:: Fallback: Open in default browser
start "" "http://localhost:5173/?view=mobile"
exit
