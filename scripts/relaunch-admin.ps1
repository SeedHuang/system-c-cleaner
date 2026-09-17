# Relaunch the C-drive analyzer server with administrator privileges.
# Triggered via Start-Process -Verb RunAs (UAC prompt); runs hidden.
param([int]$OldPid)

$ErrorActionPreference = 'SilentlyContinue'
$root  = Split-Path $PSScriptRoot -Parent
$flag  = Join-Path $root 'history\.elevated-launch.flag'
if ($env:CLEANER_DATA_DIR) { $flag = Join-Path $env:CLEANER_DATA_DIR '.elevated-launch.flag' }

# 1) Prove elevation succeeded: write the flag file (old server watches it).
New-Item -ItemType Directory -Force -Path (Split-Path $flag -Parent) | Out-Null
Set-Content -Path $flag -Value 'start' -Encoding ascii

# 2) Wait for the old server process to exit so port 8090 is free (max 30s).
for ($i = 0; $i -lt 60; $i++) {
    if (-not (Get-Process -Id $OldPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
}

# 3) Start the new (elevated) process; it will auto-scan once on startup.
$exe = $env:CLEANER_EXE_PATH
if ($exe) {
    # 打包后：以管理员身份启动 Electron 本体
    Start-Process -FilePath $exe -ArgumentList '--scan-on-start' -WorkingDirectory $root -WindowStyle Hidden
} else {
    # 开发模式回退：node server
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = 'node' }
    Start-Process -FilePath $node -ArgumentList 'server/index.js','--scan-on-start' -WorkingDirectory $root -WindowStyle Hidden
}
