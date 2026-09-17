<#
.SYNOPSIS
  C disk space analyzer - read-only scan engine

.DESCRIPTION
  READ ONLY: never deletes / moves / modifies any file, folder or registry key.
  Folders without permission are skipped and marked, never force-accessed.
  Writes scan-result.json (UTF-8) consumed by the local web dashboard.
  NOTE: file must be saved as UTF-8 WITH BOM (single) for Windows PowerShell
  5.1 to parse CJK strings correctly. NEVER edit with SearchReplace tools
  that re-encode the file, or a double BOM will break parsing.
#>

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference   = 'SilentlyContinue'

# ---------- config ----------
$resultPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'scan-result.json'
$root       = 'C:\'
$bigFileMinMB = 100
$bigFileTop   = 50

# ---------- helpers ----------

# folder size via robocopy (/L list-only, never copies)
function Get-RobocopySize {
    param([string]$Path)
    $ret = @{ SizeBytes = [long]0; Ok = $true; Unscanned = $false }
    if (-not (Test-Path -LiteralPath $Path)) { return $ret }

    $out = & robocopy $Path NULL /L /E /XJ /BYTES /NFL /NDL /NJH /NP /NC /R:0 /W:0 2>$null
    $code = $LASTEXITCODE
    # exit code 8+ only means SOME files failed (e.g. access denied);
    # the Bytes summary is still valid, so never treat the whole dir as unscanned
    $found = $false
    $size = [long]0
    foreach ($line in $out) {
        # match summary line, zh-CN and en-US headers
        if ($line -match '^\s*(?:字节|Bytes)\s*:\s+([\d,]+)') {
            $size = [long]($matches[1] -replace ',', '')
            $found = $true
            break
        }
    }
    if ($found -and $size -gt 0) {
        $ret.SizeBytes = $size
        return $ret
    }
    if ($found -and $size -eq 0 -and $code -ge 8) {
        # truly empty AND robocopy failed -> likely no access at all
        $ret.Ok = $false
        $ret.Unscanned = $true
        return $ret
    }
    if (-not $found -and $code -ge 8) {
        # no summary parsed and robocopy failed -> unscanned
        $ret.Ok = $false
        $ret.Unscanned = $true
        return $ret
    }
    # parse failed -> .NET fallback
    $ret.SizeBytes = Get-DotNetSize -Path $Path
    return $ret
}

# .NET enumeration fallback (slow but reliable)
function Get-DotNetSize {
    param([string]$Path)
    try {
        $sum = [long]0
        Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
            ForEach-Object { $sum += $_.Length }
        return $sum
    } catch {
        return [long]0
    }
}

# single system file size (attribute readable, e.g. hiberfil.sys)
# NOTE: Test-Path returns False for protected files, so never rely on it here.
function Get-FileSizeGB {
    param([string]$Path)
    try {
        $it = Get-Item -LiteralPath $Path -Force
        if ($null -eq $it) { return @{ SizeGB = $null; Ok = $true; Unscanned = $false } }
        return @{ SizeGB = [math]::Round($it.Length / 1GB, 2); Ok = $true; Unscanned = $false }
    } catch {
        # protected / absent file: size may be backfilled from largeFiles later
        return @{ SizeGB = $null; Ok = $false; Unscanned = $true }
    }
}

# top-N big files on the whole disk (streaming parse of robocopy output)
function Get-LargeFiles {
    param([string]$Root, [int]$MinMB, [int]$Top)
    $files = New-Object System.Collections.Generic.List[object]
    $minBytes = [long]$MinMB * 1MB

    & robocopy $Root NULL /L /S /XJ /BYTES /FP /NDL /NJH /NP /NC /R:0 /W:0 2>$null | ForEach-Object {
        # file lines look like:  "<size>   <full path>" (spaces, not tabs)
        if ($_ -match '^\s*(\d[\d,]*)\s+(\S.*)$') {
            $size = [long]($matches[1] -replace ',', '')
            if ($size -ge $minBytes) {
                $p = $matches[2].Trim()
                if ($p.Length -gt 0) {
                    $files.Add([pscustomobject]@{
                        name   = [System.IO.Path]::GetFileName($p)
                        path   = $p
                        sizeGB = [math]::Round($size / 1GB, 2)
                    })
                }
            }
        }
    }
    return $files | Sort-Object -Property sizeGB -Descending | Select-Object -First $Top
}

# append a folder scan item to the list
function Add-FolderItem {
    param(
        [System.Collections.ArrayList]$List,
        [string]$Id,
        [string]$Name,
        [string]$Path,
        [string]$Level,
        [string]$Reason,
        [string]$Action = ''
    )
    $r = Get-RobocopySize -Path $Path
    $sz = $null
    if ($r.Ok) { $sz = [math]::Round($r.SizeBytes / 1GB, 2) }
    $st = 'ok'
    if ($r.Unscanned) { $st = 'unscanned' }
    $item = [ordered]@{
        id     = $Id
        name   = $Name
        path   = $Path
        sizeGB = $sz
        level  = $Level
        reason = $Reason
        status = $st
    }
    if ($Action) { $item.action = $Action }
    $null = $List.Add([pscustomobject]$item)
}

# append a system-file item; size may be backfilled from largeFiles later.
# Always adds the item so the backfill pass can match it by path.
function Add-FileItem {
    param(
        [System.Collections.ArrayList]$List,
        [string]$Id,
        [string]$Name,
        [string]$Path,
        [string]$Level,
        [string]$Reason,
        [string]$Action = ''
    )
    $r = Get-FileSizeGB -Path $Path
    $st = 'ok'
    if ($r.SizeGB -eq $null) { $st = 'na' }
    $item = [ordered]@{
        id     = $Id
        name   = $Name
        path   = $Path
        sizeGB = $r.SizeGB
        level  = $Level
        reason = $Reason
        status = $st
    }
    if ($Action) { $item.action = $Action }
    $null = $List.Add([pscustomobject]$item)
}

# ---------- scan: disk overview ----------
Write-Host '[1/5] disk overview' -ForegroundColor Cyan

$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$diskInfo = [ordered]@{
    totalGB = [math]::Round($disk.Size / 1GB, 1)
    usedGB  = [math]::Round(($disk.Size - $disk.FreeSpace) / 1GB, 1)
    freeGB  = [math]::Round($disk.FreeSpace / 1GB, 1)
}

# ---------- scan: top-level folders ----------
Write-Host '[2/5] top-level folders' -ForegroundColor Cyan

$topDirs = Get-ChildItem $root -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch '^\$' }
$topFolders = New-Object System.Collections.ArrayList

foreach ($d in $topDirs) {
    $r = Get-RobocopySize -Path $d.FullName
    $sz = $null
    if ($r.Ok) { $sz = [math]::Round($r.SizeBytes / 1GB, 2) }
    $st = 'ok'
    if ($r.Unscanned) { $st = 'unscanned' }
    $null = $topFolders.Add([pscustomobject]@{
        name   = $d.Name
        path   = $d.FullName
        sizeGB = $sz
        status = $st
    })
}

# ---------- scan: special locations ----------
Write-Host '[3/5] special locations' -ForegroundColor Cyan

$items = New-Object System.Collections.ArrayList

$userDir  = $env:USERPROFILE

# temp files
Add-FolderItem $items 'tmp-user'  '用户临时文件 %TEMP%'   (Join-Path $userDir 'AppData\Local\Temp') 'safe' '软件运行产生的临时文件，退出程序后即可安全删除。' "Win+R 输入 %temp% 回车，全选删除（占用中的文件跳过即可）"
Add-FolderItem $items 'tmp-win'   '系统临时文件'          'C:\Windows\Temp' 'safe' '系统运行临时文件，可安全清理。' '设置 → 系统 → 存储 → 临时文件 → 勾选后删除'
Add-FolderItem $items 'tmp-upd'   'Windows 更新缓存'      'C:\Windows\SoftwareDistribution\Download' 'safe' '已安装更新的下载缓存，删掉不影响系统。' '管理员 CMD：net stop wuauserv → 删除该目录内容 → net start wuauserv'
Add-FolderItem $items 'tmp-rec'   '回收站'                'C:\$Recycle.Bin' 'safe' '已删除文件的暂存区，清空后释放空间（不可恢复）。' '右键回收站图标 → 清空回收站'
Add-FolderItem $items 'tmp-thumb' '缩略图缓存'            (Join-Path $userDir 'AppData\Local\Microsoft\Windows\Explorer') 'safe' '文件夹缩略图缓存，删除后自动重建。' '磁盘清理工具中勾选「缩略图」'
Add-FolderItem $items 'tmp-crash' '崩溃转储文件'          'C:\Windows\Minidump' 'safe' '程序崩溃时的内存快照，非排查问题时可删除。' '磁盘清理中勾选「系统错误内存转储文件」'
Add-FolderItem $items 'tmp-inet'  '系统网络缓存 INetCache' (Join-Path $userDir 'AppData\Local\Microsoft\Windows\INetCache') 'safe' '旧版网络缓存，可安全清理。' '磁盘清理中勾选「临时 Internet 文件」'
Add-FolderItem $items 'tmp-d3d'   'DirectX 着色器缓存'    (Join-Path $userDir 'AppData\Local\D3DSCache') 'safe' '显卡着色器缓存，删除后自动重建。' '磁盘清理中勾选「DirectX 着色器缓存」'

# browser caches
$edgeCache = Join-Path $userDir 'AppData\Local\Microsoft\Edge\User Data\Default\Cache'
$chrCache  = Join-Path $userDir 'AppData\Local\Google\Chrome\User Data\Default\Cache'
$ffCache   = Join-Path $userDir 'AppData\Local\Mozilla\Firefox\Profiles'
Add-FolderItem $items 'browser-edge'   'Edge 浏览器缓存'  $edgeCache 'safe' '网页图片/脚本缓存，删除后仅需重新加载页面。' 'Edge 设置 → 隐私 → 清除浏览数据 → 缓存的图片和文件'
Add-FolderItem $items 'browser-chrome' 'Chrome 浏览器缓存' $chrCache 'safe' '网页图片/脚本缓存，删除后仅需重新加载页面。' 'Chrome 设置 → 隐私和安全 → 清除浏览数据 → 缓存的图片和文件'
Add-FolderItem $items 'browser-firefox' 'Firefox 浏览器缓存' $ffCache 'safe' '网页图片/脚本缓存，删除后仅需重新加载页面。' 'Firefox 设置 → 隐私与安全 → Cookie 和站点数据 → 清除'

# messenger caches (caution: not recoverable)
$wechat1 = Join-Path $userDir 'Documents\xwechat_files'
$wechat2 = Join-Path $userDir 'Documents\WeChat Files'
$qq      = Join-Path $userDir 'Documents\Tencent Files'
Add-FolderItem $items 'wechat'  '微信文件缓存'      $wechat1 'caution' '聊天中的图片/视频/文件，清理后不可恢复。' '微信 → 设置 → 存储空间 → 管理，按需清理'
Add-FolderItem $items 'wechat2' '微信文件缓存(旧版)' $wechat2 'caution' '聊天中的图片/视频/文件，清理后不可恢复。' '微信 → 设置 → 存储空间 → 管理，按需清理'
Add-FolderItem $items 'qq'      'QQ 文件缓存'       $qq 'caution' '聊天接收的图片/文件，清理后不可恢复。' 'QQ → 设置 → 文件管理 → 清理'

# system files (attribute only, backfilled from largeFiles if needed)
Add-FileItem $items 'sys-hiber' '休眠文件 hiberfil.sys' 'C:\hiberfil.sys' 'caution' '休眠功能的内存镜像。关闭休眠可释放（约等于内存大小），但会失去休眠功能。' '管理员 CMD：powercfg /h off（恢复用 powercfg /h on）'
Add-FileItem $items 'sys-page'  '虚拟内存 pagefile.sys' 'C:\pagefile.sys' 'never' '系统的虚拟内存交换文件，删除会导致系统不稳定甚至崩溃。'
Add-FileItem $items 'sys-swap'  '交换文件 swapfile.sys' 'C:\swapfile.sys' 'never' '系统交换文件，不要手动删除。'

# system core (never touch)
Add-FolderItem $items 'sys32'  '系统核心目录 System32' 'C:\Windows\System32' 'never' '系统运行核心库，删除任何内容都可能导致系统无法启动。'
Add-FolderItem $items 'sys-svi' '系统还原区'          'C:\System Volume Information' 'never' '系统保护/还原数据，不要手动删除，请通过还原点管理界面操作。'

# old system
Add-FolderItem $items 'winold' '旧系统 Windows.old' 'C:\Windows.old' 'caution' '旧系统备份，超过 30 天确认无需回滚后可删除。' '磁盘清理 → 清理系统文件 → 勾选「以前的 Windows 安装」'

# winsxs (caution: use DISM only)
Add-FolderItem $items 'winsxs' '系统组件存储 WinSxS' 'C:\Windows\WinSxS' 'caution' '系统组件备份，不能手动删除，必须用系统工具压缩。' '管理员 CMD：Dism.exe /Online /Cleanup-Image /StartComponentCleanup'

# dev caches
$nugetCache = Join-Path $userDir '.nuget\packages'
$npmCache   = Join-Path $userDir 'AppData\Local\npm-cache'
$pipCache   = Join-Path $userDir 'AppData\Local\pip\cache'
$yarnCache  = Join-Path $userDir 'AppData\Local\Yarn\Cache'
Add-FolderItem $items 'dev-nuget' 'NuGet 包缓存' $nugetCache 'safe' '开发包缓存，删除后重新构建时自动下载。' '可运行：dotnet nuget locals all --clear'
Add-FolderItem $items 'dev-npm'   'npm 缓存'    $npmCache   'safe' 'npm 包缓存，删除后不影响已安装项目。' '可运行：npm cache clean --force'
Add-FolderItem $items 'dev-pip'   'pip 缓存'    $pipCache   'safe' 'Python 包缓存，删除后不影响已安装包。' '可运行：pip cache purge'
Add-FolderItem $items 'dev-yarn'  'yarn 缓存'   $yarnCache  'safe' 'yarn 包缓存，删除后不影响已安装项目。' '可运行：yarn cache clean'

# memory dump
Add-FileItem $items 'sys-memdmp' '内存转储 MEMORY.DMP' 'C:\MEMORY.DMP' 'safe' '系统崩溃时的内存转储，非排查问题时可删除。' '磁盘清理中勾选「系统错误内存转储文件」'

# keep items (reuse topFolders sizes, no re-scan)
$tfMap = @{}
foreach ($t in $topFolders) { $tfMap[$t.name] = $t }
$keepDefs = @(
  @{ id='keep-win';   name='Windows 本体';        path='C:\Windows';             folder='Windows';             reason='操作系统核心，正常使用必需。' },
  @{ id='keep-pf';    name='已安装程序(64位)';    path='C:\Program Files';       folder='Program Files';       reason='已安装软件，卸载请用「设置 → 应用 → 卸载」。' },
  @{ id='keep-pfx';   name='已安装程序(32位)';    path='C:\Program Files (x86)'; folder='Program Files (x86)'; reason='已安装软件，卸载请用「设置 → 应用 → 卸载」。' },
  @{ id='keep-users'; name='用户数据(个人文件)';  path='C:\Users';               folder='Users';               reason='你的个人文件，请自行确认哪些不需要。' },
  @{ id='keep-pdata'; name='程序数据 ProgramData'; path='C:\ProgramData';        folder='ProgramData';         reason='软件共享配置/数据，不要随意删除。' }
)
foreach ($k in $keepDefs) {
  $tf = $tfMap[$k.folder]
  if ($tf -and $tf.sizeGB -ne $null) {
    $null = $items.Add([pscustomobject]@{ id=$k.id; name=$k.name; path=$k.path; sizeGB=$tf.sizeGB; level='keep'; reason=$k.reason; status='ok' })
  }
}

# ---------- scan: big files ----------
Write-Host '[4/5] big files (whole disk, may take a while)' -ForegroundColor Cyan
$largeFiles = @(Get-LargeFiles -Root $root -MinMB $bigFileMinMB -Top $bigFileTop)

# backfill protected system files from largeFiles (Test-Path can't see them)
$lfMap = @{}
foreach ($lf in $largeFiles) { $lfMap[$lf.path] = $lf }
foreach ($it in $items) {
  if ($it.id -in @('sys-hiber','sys-page','sys-swap','sys-memdmp') -and $it.sizeGB -eq $null) {
    $lf = $lfMap[$it.path]
    if ($lf) {
      $it.sizeGB = $lf.sizeGB
      $it.status = 'ok'
    }
  }
}

# ---------- output ----------
Write-Host '[5/5] writing result' -ForegroundColor Cyan

$result = [ordered]@{
    scannedAt  = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    disk       = $diskInfo
    topFolders = $topFolders
    items      = $items
    largeFiles = $largeFiles
}

$json = $result | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($resultPath, $json, [System.Text.Encoding]::UTF8)
Write-Host "scan done -> $resultPath" -ForegroundColor Green
