# CDriveCleaner WDAC helper - backup active CI policies before any change
# Run as Administrator. Restores via wdac-restore.ps1.
$ErrorActionPreference = 'Stop'

$src = 'C:\Windows\System32\CodeIntegrity\CIPolicies\Active'
$backupRoot = Join-Path $PSScriptRoot '..\backup\wdac'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest = Join-Path $backupRoot $stamp

if (-not (Test-Path $src)) {
    Write-Host "[ERROR] policy dir not found: $src"
    exit 1
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null

# 1) copy active policy files (.cip) - this is the core of the backup
$cip = Get-ChildItem (Join-Path $src '*.cip') -ErrorAction SilentlyContinue
if (-not $cip) {
    Write-Host "[WARN] no .cip files in Active dir"
}
foreach ($f in $cip) {
    Copy-Item $f.FullName $dest -Force
}

# 2) meta (reference only; .cip files are what restore actually needs)
$meta = @"
backup_time: $stamp
source_dir: $src
policy_count: $($cip.Count)
restore_cmd: powershell -ExecutionPolicy Bypass -File "$(Join-Path $PSScriptRoot 'wdac-restore.ps1')" -BackupDir "$dest"
"@
$meta | Set-Content (Join-Path $dest 'meta.txt') -Encoding utf8

Write-Host "[OK] WDAC policies backed up to: $dest"
Write-Host "     .cip files: $($cip.Count)"
Write-Host "     restore:   $dest\meta.txt"
