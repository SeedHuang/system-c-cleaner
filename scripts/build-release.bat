@echo off
setlocal
rem ============================================
rem  Roberta one-click release build
rem  Steps: close running app -> clean stale build output
rem         -> build frontend (max build)
rem         -> package NSIS installer (auto-retry on transient file locks)
rem         -> rename installer with build timestamp (YYYYMMDDHHmm)
rem         -> verify outputs
rem  Usage: npm run electron:release
rem ============================================
cd /d "%~dp0.."
set "ROOT=%CD%"

echo [0/6] Checking environment ...
if not exist "%ROOT%\node_modules\electron\dist\electron.exe" goto err_no_electron

echo [1/6] Closing running Roberta (avoid EPERM/EBUSY on locked files) ...
tasklist /FI "IMAGENAME eq Roberta.exe" 2>nul | find /i "Roberta.exe" >nul
if errorlevel 1 goto no_app_running
taskkill /F /IM Roberta.exe >nul 2>&1
if errorlevel 1 goto ask_elevate
goto after_close

:ask_elevate
echo   Normal close failed (app may run as admin). Requesting elevation, accept the UAC prompt...
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-Command','Stop-Process -Name Roberta -Force -ErrorAction SilentlyContinue'"
goto after_close

:no_app_running
echo   No running Roberta found, skipping
goto after_close

:after_close
rem 等句柄释放后兜底再杀一次：提权主进程死后，其子进程可能晚几秒才退出
rem 同时兼容清理旧名 CDriveCleaner.exe 的残留进程（改名前构建的版本）
ping -n 3 127.0.0.1 >nul
taskkill /F /IM Roberta.exe >nul 2>&1
taskkill /F /IM CDriveCleaner.exe >nul 2>&1
ping -n 3 127.0.0.1 >nul
tasklist /FI "IMAGENAME eq Roberta.exe" 2>nul | find /i "Roberta.exe" >nul
if errorlevel 1 goto clean_stale
echo [ERROR] Roberta is still running (elevated instance and UAC was declined?)
echo         Quit it from the tray icon (right-click - Exit), then rerun this script.
exit /b 1

:clean_stale
rem 上次失败的构建可能残留 win-unpacked / win-unpacked.tmp，
rem 会导致 electron-builder 清理时 EBUSY、或解压重命名时 EPERM，打包前先删掉
echo [2/6] Cleaning stale build output ...
if not exist "%ROOT%\dist_electron" mkdir "%ROOT%\dist_electron"
call :remove_dir "%ROOT%\dist_electron\win-unpacked"
call :remove_dir "%ROOT%\dist_electron\win-unpacked.tmp"
rem 同时清掉旧安装包：既避免产物堆积，也保证时间戳重命名时通配符只匹配到本次新构建
del /q "%ROOT%\dist_electron\Roberta-Setup-*.exe" >nul 2>&1
del /q "%ROOT%\dist_electron\Roberta-Setup-*.exe.blockmap" >nul 2>&1
del /q "%ROOT%\dist_electron\latest.yml" >nul 2>&1
goto build_start

:remove_dir
if not exist "%~1" exit /b 0
rmdir /s /q "%~1" >nul 2>&1
if not exist "%~1" ( echo   removed %~1 & exit /b 0 )
rem 删除失败可能只是句柄尚未释放，等 2 秒再试一次
ping -n 3 127.0.0.1 >nul
rmdir /s /q "%~1" >nul 2>&1
if exist "%~1" (
  echo   [WARN] cannot remove %~1 ^(still locked?^), packaging may fail on it
) else (
  echo   removed %~1
)
exit /b 0

:build_start
set "ELECTRON_BUILDER_CACHE=%ROOT%\.electron-builder-cache"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"

echo [3/6] Building frontend (max build) ...
call npm run build
if errorlevel 1 goto err_build

rem 打包最多尝试 3 次：EPERM/EBUSY 多为杀毒软件实时扫描刚解压的 exe 造成的瞬时锁，
rem 等待数秒后重试即可通过；其他错误（配置/代码问题）重试无意义，直接失败
set /a PKG_TRIES=0
:package_try
set /a PKG_ATTEMPT=PKG_TRIES+1
echo [4/6] Packaging NSIS installer (attempt %PKG_ATTEMPT%) ...
rem 输出实时上屏（Tee-Object）同时写入 package.log，供识别瞬时锁
powershell -NoProfile -Command "npx electron-builder --win --publish never 2>&1 | Tee-Object -FilePath 'dist_electron\package.log'; exit $LASTEXITCODE"
if not errorlevel 1 goto package_ok
powershell -NoProfile -Command "if (Select-String -Path 'dist_electron\package.log' -Pattern 'EPERM','EBUSY' -Quiet) { exit 0 } else { exit 1 }"
if errorlevel 1 goto err_package
set /a PKG_TRIES+=1
if %PKG_TRIES% geq 3 goto err_package
echo   Transient file lock detected (antivirus scanning?), retrying in 10s ...
ping -n 11 127.0.0.1 >nul
goto package_try

:package_ok
echo [5/6] Verifying outputs ...
if not exist "%ROOT%\dist_electron\win-unpacked\Roberta.exe" goto err_no_exe
if not exist "%ROOT%\dist_electron\Roberta-Setup-*.exe" goto err_no_setup

rem 安装包文件名追加构建时间戳（本地时间 YYYYMMDDHHmm），blockmap 同步改名
rem 注意 blockmap 的文件名是「exe 全名 + .blockmap」，exe 改名后 SETUP_SRC 仍保留原始名
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmm"') do set "BUILD_TS=%%i"
for %%f in ("%ROOT%\dist_electron\Roberta-Setup-*.exe") do set "SETUP_SRC=%%f"
set "SETUP_BASE=%SETUP_SRC:~0,-4%"
move /y "%SETUP_SRC%" "%SETUP_BASE%-%BUILD_TS%.exe" >nul
if exist "%SETUP_SRC%.blockmap" move /y "%SETUP_SRC%.blockmap" "%SETUP_BASE%-%BUILD_TS%.exe.blockmap" >nul

echo [6/6] Done, artifacts:
for %%f in ("%ROOT%\dist_electron\Roberta-Setup-*.exe") do echo   %%f
echo   Portable: dist_electron\win-unpacked\Roberta.exe
echo.
echo Release build complete. Distribute Roberta-Setup-*.exe.
goto end

:err_no_electron
echo [ERROR] electron binary missing, run npm install first
exit /b 1

:err_build
echo [ERROR] frontend build failed
exit /b 1

:err_package
echo [ERROR] packaging failed after retries, see dist_electron\package.log for details
exit /b 1

:err_no_exe
echo [ERROR] Roberta.exe not found
exit /b 1

:err_no_setup
echo [ERROR] NSIS installer not found
exit /b 1

:end
endlocal
