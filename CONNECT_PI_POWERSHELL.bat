@echo off
setlocal enabledelayedexpansion
title INTRAMOVE Raspberry Pi 4 - PowerShell SSH Bridge
cd /d "%~dp0"

echo ====================================================================
echo       INTRAMOVE AUTONOMOUS AGV - RASPBERRY PI SSH BRIDGE
echo ====================================================================
echo.

set RAW_INPUT=%~1
set PI_USER=%~2

if "%RAW_INPUT%"=="" (
    if exist .pi_ip (
        set /p RAW_INPUT=<.pi_ip
    )
)

if "%RAW_INPUT%"=="" (
    echo [PROMPT] Enter Raspberry Pi address (e.g. major@192.168.0.148 or 192.168.0.148):
    set /p RAW_INPUT="Raspberry Pi Host: "
)

if "%RAW_INPUT%"=="" (
    echo [ERROR] No IP address provided. Exiting.
    timeout /t 5
    exit /b 1
)

:: Parse user@ip if present
for /f "tokens=1,2 delims=@" %%A in ("%RAW_INPUT%") do (
    if "%%B"=="" (
        set PI_IP=%%A
    ) else (
        set PI_USER=%%A
        set PI_IP=%%B
    )
)

if "%PI_USER%"=="" (
    if exist .pi_user (
        set /p PI_USER=<.pi_user
    )
)
if "%PI_USER%"=="" set PI_USER=major

:: Save IP and User so future sessions use them
echo %PI_IP%>.pi_ip
echo %PI_USER%>.pi_user

echo.
echo ====================================================================
echo Target Raspberry Pi : %PI_USER%@%PI_IP%:22
echo Remote Project Dir  : /home/%PI_USER%/intramove (~/intramove)
echo ====================================================================
echo.
echo Launching Windows PowerShell SSH Session directly into ~/intramove...
echo.

powershell -NoExit -Command "Write-Host '==================================================' -ForegroundColor Cyan; Write-Host '  INTRAMOVE AGV - Connecting to %PI_USER%@%PI_IP%...' -ForegroundColor Cyan; Write-Host '  Auto-landing into: /home/%PI_USER%/intramove' -ForegroundColor Yellow; Write-Host '==================================================' -ForegroundColor Cyan; ssh -o StrictHostKeyChecking=no -p 22 %PI_USER%@%PI_IP% -t 'mkdir -p ~/intramove 2>/dev/null; cd ~/intramove 2>/dev/null || cd /home/%PI_USER%/intramove 2>/dev/null || cd ~; exec bash -l'"

