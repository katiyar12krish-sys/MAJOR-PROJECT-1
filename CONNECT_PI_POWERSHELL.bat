@echo off
title INTRAMOVE Raspberry Pi 4 - PowerShell SSH Bridge
cd /d "%~dp0"

echo ====================================================================
echo       INTRAMOVE AUTONOMOUS AGV - RASPBERRY PI 4 SSH BRIDGE
echo ====================================================================
echo Target Host: pi@10.215.209.29 (or 192.168.1.100)
echo Remote Folder: ~/intramove
echo.
echo Launching Windows PowerShell SSH Session...
echo.

powershell -NoExit -Command "Write-Host 'Connecting to INTRAMOVE Raspberry Pi 4...' -ForegroundColor Cyan; Write-Host 'ssh -p 22 pi@10.215.209.29' -ForegroundColor Green; ssh -o StrictHostKeyChecking=no -p 22 pi@10.215.209.29"
