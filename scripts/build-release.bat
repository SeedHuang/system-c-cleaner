@echo off
setlocal
rem ============================================
rem  CDriveCleaner one-click release build
rem  Steps: close running app -> build frontend (max build)
rem         -> package NSIS installer -> verify outputs
rem  Usage: npm run electron:release
rem ============================================
cd /d "%~dp0.."

echo [0/5] Checking environment ...
if not exist "%~dp0..\node_modules\electron\dist\electron.exe" goto err_no_electron

echo [1/5] Closing running CDriveCleaner (avoid EPERM on locked files) ...
tasklist /FI "IMAGENAME eq CDriveCleaner.exe" 2>nul | find /i "CDriveCleaner.exe" >nul
if errorlevel 1 goto no_app_running
taskkill /F /IM CDriveCleaner.exe >nul 2>&1
if errorlevel 1 goto ask_elevate
goto after_close

:ask_elevate
echo   Normal close failed (app may run as admin). Requesting elevation, accept the UAC prompt...
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-Command','Stop-Process -Name CDriveCleaner -Force -ErrorAction SilentlyContinue'"
goto after_close

:no_app_running
echo   No running CDriveCleaner found, skipping
goto after_close

:after_close
ping -n 3 127.0.0.1 >nul
tasklist /FI "IMAGENAME eq CDriveCleaner.exe" 2>nul | find /i "CDriveCleaner.exe" >nul
if errorlevel 1 goto build_start
echo [WARN] CDriveCleaner is still running. Packaging may fail on locked files.
echo        Close the app manually, or press any key to continue anyway...
pause >nul

:build_start
set "ELECTRON_BUILDER_CACHE=%~dp0..\.electron-builder-cache"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"

echo [2/5] Building frontend (max build) ...
call npm run build
if errorlevel 1 goto err_build

echo [3/5] Packaging NSIS installer (electron-builder --win) ...
call npx electron-builder --win --publish never
if errorlevel 1 goto err_package

echo [4/5] Verifying outputs ...
if not exist "%~dp0..\dist_electron\win-unpacked\CDriveCleaner.exe" goto err_no_exe
if not exist "%~dp0..\dist_electron\CDriveCleaner-Setup-*.exe" goto err_no_setup

echo [5/5] Done, artifacts:
for %%f in ("%~dp0..\dist_electron\CDriveCleaner-Setup-*.exe") do echo   %%f
echo   Portable: dist_electron\win-unpacked\CDriveCleaner.exe
echo.
echo Release build complete. Distribute CDriveCleaner-Setup-*.exe.
goto end

:err_no_electron
echo [ERROR] electron binary missing, run npm install first
exit /b 1

:err_build
echo [ERROR] frontend build failed
exit /b 1

:err_package
echo [ERROR] packaging failed, check logs above
exit /b 1

:err_no_exe
echo [ERROR] CDriveCleaner.exe not found
exit /b 1

:err_no_setup
echo [ERROR] NSIS installer not found
exit /b 1

:end
endlocal
