# CDriveCleaner WDAC helper - one-click restore of CI policies
# Run as Administrator. Use -BackupDir to pick a specific backup, otherwise the latest is used.
param([string]$BackupDir = '')

$ErrorActionPreference = 'Stop'

# --- resolve backup dir ---
if (-not $BackupDir) {
    $backupRoot = Join-Path $PSScriptRoot '..\backup\wdac'
    $latest = Get-ChildItem $backupRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if (-not $latest) {
        Write-Host "[ERROR] no backup found under $backupRoot, run wdac-backup.ps1 first"
        exit 1
    }
    $BackupDir = $latest.FullName
}
if (-not (Test-Path $BackupDir)) {
    Write-Host "[ERROR] backup dir not found: $BackupDir"
    exit 1
}

# --- 1) remove the CDriveCleaner supplemental policy if it was deployed ---
# GUID is recorded in the deployment meta. Fallback: scan all backup dirs for
# any supplemental GUIDs recorded by wdac-deploy-supplement.ps1.
$suppGuid = (Get-Content (Join-Path $BackupDir 'meta.txt') -ErrorAction SilentlyContinue |
    Select-String 'supplemental_guid:').ToString().Replace('supplemental_guid:', '').Trim()

if (-not $suppGuid -or $suppGuid -eq 'NONE') {
    $backupRoot = Join-Path $PSScriptRoot '..\backup\wdac'
    $extra = Get-ChildItem $backupRoot -Filter meta.txt -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object {
            $line = Get-Content $_.FullName -ErrorAction SilentlyContinue | Select-String 'supplemental_guid:'
            if ($line) { $line.ToString().Replace('supplemental_guid:', '').Trim() }
        } | Where-Object { $_ -and $_ -ne 'NONE' } | Select-Object -Unique
    if ($extra) { $suppGuid = $extra | Select-Object -First 1 }
}

if ($suppGuid -and $suppGuid -ne 'NONE') {
    Write-Host "[*] removing supplemental policy $suppGuid ..."
    CiTool --remove-policy $suppGuid
    Write-Host "     exit code: $LASTEXITCODE"
} else {
    Write-Host "[i] no supplemental policy to remove (guid: $($suppGuid -or 'NONE'))"
}

# --- 2) redeploy every backed-up .cip (re-enables whatever was active at backup time) ---
$count = 0
$failed = 0
Get-ChildItem $BackupDir -Filter '*.cip' | ForEach-Object {
    Write-Host "[*] redeploying $($_.Name) ..."
    CiTool --update-policy $_.FullName
    if ($LASTEXITCODE -eq 0) { $count++ } else { $failed++ }
}

# --- 3) refresh ---
CiTool --refresh | Out-Null

Write-Host "[OK] restore finished: $count redeployed, $failed failed"
Write-Host "     NOTE: a reboot may be required for full effect."
if ($failed -gt 0) {
    Write-Host "     Some policies failed to redeploy - check the policy list before rebooting."
}
