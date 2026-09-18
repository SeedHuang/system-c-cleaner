@echo off
setlocal
rem ============================================
rem  Roberta build helper: build frontend,
rem  package NSIS installer, then launch app.
rem  Usage: npm run electron:build-run
rem ============================================
cd /d "%~dp0.."

if not exist "%~dp0..\node_modules\electron\dist\electron.exe" (
  echo [ERROR] electron binary missing, run npm install first
  exit /b 1
)

set "ELECTRON_BUILDER_CACHE=%~dp0..\.electron-builder-cache"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"

echo [0/4] Building frontend (max build) ...
call npm run build
if errorlevel 1 (
  echo [ERROR] frontend build failed
  exit /b 1
)

echo [1/4] Packaging NSIS installer (electron-builder --win) ...
call npx electron-builder --win --publish never
if errorlevel 1 (
  echo [ERROR] packaging failed
  exit /b 1
)

echo [2/4] Verifying outputs ...
if not exist "%~dp0..\dist_electron\win-unpacked\Roberta.exe" (
  echo [ERROR] Roberta.exe not found
  exit /b 1
)
if not exist "%~dp0..\dist_electron\Roberta-Setup-*.exe" (
  echo [ERROR] NSIS installer not found
  exit /b 1
)

echo [3/4] Installer ready:
for %%f in ("%~dp0..\dist_electron\Roberta-Setup-*.exe") do echo   %%f

echo [4/4] Launching app ...
start "" "%~dp0..\dist_electron\win-unpacked\Roberta.exe"
endlocal
