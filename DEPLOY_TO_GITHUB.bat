@echo off
title INTRAMOVE - 1-Click GitHub Live Deploy
color 0b
echo ========================================================
echo   INTRAMOVE AGV - 1-CLICK GITHUB ^& LIVE DEPLOY ENGINE
echo ========================================================
echo.
cd /d "%~dp0"
echo [1/3] Building production assets (Vite)...
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Build failed. Please check errors above.
  pause
  exit /b 1
)

echo.
echo [2/3] Adding and committing changes...
"C:\Users\Acer\AppData\Local\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe" add .
"C:\Users\Acer\AppData\Local\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe" commit -m "deploy: update live site and components"

echo.
echo [3/3] Pushing to GitHub (origin/main)...
"C:\Users\Acer\AppData\Local\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe" push origin main
if %ERRORLEVEL% EQU 0 (
  echo.
  echo ========================================================
  echo   SUCCESS! Pushed to GitHub successfully!
  echo   Live GitHub Pages URL:
  echo   https://katiyar12krish-sys.github.io/MAJOR-PROJECT-1/
  echo ========================================================
) else (
  echo.
  echo [NOTICE] Opening GitHub Desktop so you can click 'Push origin'...
  start "" "C:\Users\Acer\AppData\Local\GitHubDesktop\GitHubDesktop.exe"
)
echo.
pause
