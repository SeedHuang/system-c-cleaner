<#
Roberta WDAC helper - deploy a supplemental CI policy that whitelists
the unsigned Electron build so NSIS packaging / app launch is not blocked.

Run as Administrator.

Strategy:
- Generate a minimal XML supplemental policy that FilePath-rules the Electron
  build directory (no signing required).
- Compile it to .cip via ConvertFrom-CIPolicy.
- Deploy via CiTool --update-policy.
- Record deployment GUID + timestamp in backup meta so wdac-restore.ps1
  can remove it cleanly.
- Backup of pre-deployment state is captured via wdac-backup.ps1 (idempotent).

Restore: scripts/wdac-restore.ps1 -BackupDir <latest>
#>
[CmdletBinding()]
param(
    [string]$TargetDir = 'D:\Seed\system-c-cleaner\dist_electron\win-unpacked',
    [string]$BackupRoot = ''
)

$ErrorActionPreference = 'Stop'

# --- 0) sanity checks ---
if (-not (Test-Path $TargetDir)) {
    Write-Host "[ERROR] target dir not found: $TargetDir"
    exit 1
}
$policyDir = 'C:\Windows\System32\CodeIntegrity\CIPolicies\Active'
if (-not (Test-Path $policyDir)) {
    Write-Host "[ERROR] CIPolicies\Active not accessible. Are you running as Administrator?"
    exit 1
}

# --- 1) resolve backup root ---
if (-not $BackupRoot) {
    $BackupRoot = Join-Path $PSScriptRoot '..\backup\wdac'
}
if (-not (Test-Path $BackupRoot)) {
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stampRoot = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force -Path $stampRoot | Out-Null
Write-Host "[*] deployment backup dir: $stampRoot"

# --- 2) generate a stable GUID for this supplemental policy ---
# Stable so multiple deployments update the same .cip rather than accumulating.
$guid = '{C1D21E5A-7A4B-4D9F-9E3A-CDRI4C3E8EE1}'
$suppPath = Join-Path $stampRoot ('supplemental_' + $guid + '.xml')
$cipPath  = Join-Path $stampRoot ('supplemental_' + $guid + '.cip')

# WDAC FilePath rule: keep literal backslashes (XML does not require escaping \)
$escapedDir = $TargetDir

$xml = @"
<?xml version="1.0" encoding="utf-8"?>
<SiPolicy xmlns="urn:schemas-microsoft-com:sipolicy" PolicyType="Supplemental Policy">
  <VersionEx>1.0</VersionEx>
  <PlatformID>{2E07F7E4-194C-4D20-B7C9-1F33D8410000}</PlatformID>
  <Rules>
    <Rule>
      <Option>Enabled:Unsigned System Integrity Policy</Option>
    </Rule>
    <Rule>
      <Option>Enabled:Allow Supplemental Policies</Option>
    </Rule>
  </Rules>
  <EKUs />
  <FileRules>
    <Allow FilePath="$escapedDir\*" />
    <Allow FilePath="$escapedDir" />
  </FileRules>
  <Signers />
  <SigningScenarios />
  <UpdatePolicySigners />
  <CiSigners />
  <HvciOptions>0</HvciOptions>
  <Settings />
  <BasePolicyID>$guid</BasePolicyID>
  <PolicyID>$guid</PolicyID>
</SiPolicy>
"@

[System.IO.File]::WriteAllText($suppPath, $xml, [System.Text.UTF8Encoding]::new($true))
Write-Host "[*] policy XML written: $suppPath"

# --- 3) compile to .cip ---
ConvertFrom-CIPolicy -XmlFilePath $suppPath -BinaryFilePath $cipPath | Out-Null
if (-not (Test-Path $cipPath)) {
    Write-Host "[ERROR] ConvertFrom-CIPolicy failed - is the CiTools module installed?"
    exit 1
}
Write-Host "[*] compiled .cip: $cipPath"

# --- 4) deploy ---
Write-Host "[*] deploying supplemental policy ..."
$deployOut = CiTool --update-policy $cipPath 2>&1
Write-Host "     $deployOut"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] CiTool --update-policy failed (exit=$LASTEXITCODE)"
    exit 1
}

# Refresh policy cache so the kernel picks it up immediately (no reboot for path rules)
CiTool --refresh 2>&1 | Out-Null
Write-Host "[*] CiTool --refresh done"

# --- 5) update backup meta so restore knows about the supplemental GUID ---
$metaFile = Join-Path $stampRoot 'meta.txt'
$meta = @"
backup_time: $stamp
source_dir: $policyDir
target_dir: $TargetDir
supplemental_guid: $guid
supplemental_xml: $suppPath
supplemental_cip: $cipPath
restore_cmd: powershell -ExecutionPolicy Bypass -File "$($PSScriptRoot | Split-Path -Parent)\wdac-restore.ps1" -BackupDir "$stampRoot"
"@
[System.IO.File]::WriteAllText($metaFile, $meta, [System.Text.UTF8Encoding]::new($true))

# Update the most-recent meta.txt in backup/wdac so wdac-restore.ps1 (auto-latest)
# also picks up this supplemental GUID.
$latest = Get-ChildItem $BackupRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
if ($latest) {
    Copy-Item $metaFile (Join-Path $latest.FullName 'meta.txt') -Force
}

Write-Host ""
Write-Host "[OK] supplemental policy deployed"
Write-Host "     GUID:        $guid"
Write-Host "     Whitelist:   $TargetDir"
Write-Host "     Backup meta: $metaFile"
Write-Host "     Restore:     powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\wdac-restore.ps1`" -BackupDir `"$stampRoot`""
Write-Host ""
Write-Host "Test: try launching dist_electron\win-unpacked\Roberta.exe"