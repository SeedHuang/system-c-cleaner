@echo off
cd /d "%~dp0"
echo ============================================
echo   C-Drive Analyzer - starting local server
echo   打开后点击右上角"重新扫描"获取最新数据
echo ============================================
start "" cmd /c "node server\index.js"
timeout /t 3 /nobreak >nul
start "" http://localhost:8090
