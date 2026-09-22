# Relaunch the C-drive analyzer with administrator privileges.
# Triggered via Start-Process -Verb RunAs (UAC prompt); runs hidden.
#
# IMPORTANT: an elevated process does NOT inherit the caller's environment
# variables (UAC creates it with a fresh logon token), so CLEANER_DATA_DIR and
# CLEANER_EXE_PATH are EMPTY here. The caller must pass -FlagPath and -ExePath
# explicitly; the env vars below are only a fallback for manual runs.
param([int]$OldPid, [string]$FlagPath, [string]$ExePath, [switch]$Hidden)

$ErrorActionPreference = 'SilentlyContinue'
$root  = Split-Path $PSScriptRoot -Parent

$flag  = $FlagPath
if (-not $flag) {
    $flag = Join-Path $root 'history\.elevated-launch.flag'
    if ($env:CLEANER_DATA_DIR) { $flag = Join-Path $env:CLEANER_DATA_DIR '.elevated-launch.flag' }
}

$logFile = Join-Path (Split-Path $flag -Parent) 'logs\elevate.log'

# Full-path logging: this script runs hidden, so every key step and every
# failure branch must be recorded or the flow fails silently.
function Write-Log {
    param([string]$Message)
    $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff') + '] ' + $Message
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path $logFile -Parent) | Out-Null
        Add-Content -Path $logFile -Value $line -Encoding utf8
    } catch { }
}

Write-Log "start: OldPid=$OldPid FlagPath=$flag ExePath=$ExePath"

# 1) Prove elevation succeeded: write the flag file (old server watches it).
try {
    New-Item -ItemType Directory -Force -Path (Split-Path $flag -Parent) | Out-Null
    Set-Content -Path $flag -Value 'start' -Encoding ascii
    Write-Log "flag written: $flag"
} catch {
    Write-Log "ERROR writing flag: $($_.Exception.Message)"
    exit 1
}

# 2) Wait for the old server process to exit so port 8090 is free (max 30s).
$waited = 0
for ($i = 0; $i -lt 60; $i++) {
    if (-not (Get-Process -Id $OldPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
    $waited += 500
}
$alive = 'no'
if (Get-Process -Id $OldPid -ErrorAction SilentlyContinue) { $alive = 'yes' }
Write-Log "old process wait done: waitedMs=$waited stillAlive=$alive"

# 3) Start the new (elevated) process; it will auto-scan once on startup.
$exe = $ExePath
if (-not $exe) { $exe = $env:CLEANER_EXE_PATH }
if ($exe) {
    Write-Log "starting elevated app: $exe --scan-on-start"
    # 正常启动需显示主窗口：不能无条件加 -WindowStyle Hidden，否则会隐藏应用窗口导致只剩托盘。
    # 自启/静默场景（原进程带 --hidden 触发提权）由调用方传 -Hidden，这里透传 --hidden 保持驻留托盘。
    $startArgs = @('--scan-on-start')
    if ($Hidden) { $startArgs += '--hidden' }
    Start-Process -FilePath $exe -ArgumentList $startArgs -WorkingDirectory $root
    Write-Log 'elevated app start issued'
} else {
    # Dev fallback: run the node server directly.
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = 'node' }
    Write-Log "no ExePath given, dev fallback: $node server/index.js --scan-on-start"
    Start-Process -FilePath $node -ArgumentList 'server/index.js','--scan-on-start' -WorkingDirectory $root -WindowStyle Hidden
    Write-Log 'dev server start issued'
}
