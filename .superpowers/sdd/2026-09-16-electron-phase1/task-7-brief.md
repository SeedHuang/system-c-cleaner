# Task 7 Brief: scripts/*.ps1 改造（Write 全量重写，保留 UTF-8 BOM）

项目：d:\Seed\system-c-cleaner —— C 盘空间分析工具，正在改造为 Electron 桌面应用。本任务改造两个 PowerShell 脚本，使打包后扫描结果写入 userData、提权后启动 Electron exe。

⚠️ **BOM 保护是本任务最高优先级**：`scan-c.ps1` 和 `relaunch-admin.ps1` 都是 **UTF-8 带 BOM**（PowerShell 5.1 解析中文必需）。**只允许用 Write 全量重写并保留 BOM，禁止 SearchReplace。** 写入前必须先备份 `.bak`。

## 本任务目标

1. 备份两个 .ps1 为 `.bak`
2. `scan-c.ps1`：结果路径支持 `$env:CLEANER_RESULT_PATH` 覆盖
3. `relaunch-admin.ps1`：flag 路径支持 `$env:CLEANER_DATA_DIR`；启动目标支持 `$env:CLEANER_EXE_PATH`（electron）回退 node
4. 验证 BOM（前 3 字节 EF BB BF）+ PowerShell 语法零错误

## 强制约束（必须遵守）

- **禁止 git commit**（用户规则 + 沙箱拦截）。完成验证后不执行任何 git 写命令。
- **禁止 SearchReplace 编辑这两个文件**（会破坏 BOM）。
- **必须保留 UTF-8 BOM**：Write 工具写入时，content 字符串的第一个字符必须是 BOM 字符 `\uFEFF`（文件开头带 BOM 标记）。
- 除指定修改点外，其余内容与现有文件**逐字一致**（中文注释、正则、函数体都不能变）。
- 若直接写 `\uFEFF` 有困难，可用 Write 写不带 BOM 的完整内容，再用 PowerShell 命令转换为带 BOM：
  ```powershell
  $c = Get-Content -Raw -Encoding UTF8 'scripts\scan-c.ps1'
  [System.IO.File]::WriteAllText("$PWD\scripts\scan-c.ps1", $c, (New-Object System.Text.UTF8Encoding($true)))
  ```
  （对两个文件各执行一次；此命令把文件重写为带 BOM 的 UTF-8，内容不变。）

## Step 1: 备份现有脚本

Run:
```powershell
Copy-Item scripts/scan-c.ps1 scripts/scan-c.ps1.bak
Copy-Item scripts/relaunch-admin.ps1 scripts/relaunch-admin.ps1.bak
```
Expected: 两个 .bak 文件存在

## Step 2: 先 Read 两个 .ps1 全文

Read `scripts/scan-c.ps1` 与 `scripts/relaunch-admin.ps1`（注意：Read 显示时 BOM 可能不可见，文件内容以 Read 结果为准）。这两个文件的内容就是 Write 的基础，除指定修改点外逐字保留。

## Step 3: 重写 scan-c.ps1（保留 BOM）

修改点（其余内容逐字不变）：

第 17-18 行附近：
```powershell
# ---------- config ----------
$resultPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'scan-result.json'
```
改为：
```powershell
# ---------- config ----------
$resultPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'scan-result.json'
# 打包后由 Electron 主进程注入：结果写入 userData（安装目录可能不可写）
if ($env:CLEANER_RESULT_PATH) { $resultPath = $env:CLEANER_RESULT_PATH }
```

## Step 4: 重写 relaunch-admin.ps1（保留 BOM）

修改点（其余内容逐字不变）：

第 6-7 行附近：
```powershell
$root  = Split-Path $PSScriptRoot -Parent
$flag  = Join-Path $root 'history\.elevated-launch.flag'
```
改为：
```powershell
$root  = Split-Path $PSScriptRoot -Parent
$flag  = Join-Path $root 'history\.elevated-launch.flag'
if ($env:CLEANER_DATA_DIR) { $flag = Join-Path $env:CLEANER_DATA_DIR '.elevated-launch.flag' }
```

第 19-22 行附近：
```powershell
# 3) Start the new (elevated) server; it will auto-scan once on startup.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'node' }
Start-Process -FilePath $node -ArgumentList 'server/index.js','--scan-on-start' -WorkingDirectory $root -WindowStyle Hidden
```
改为：
```powershell
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
```

## Step 5: 验证 BOM 与 PowerShell 语法

Run（PowerShell 中逐条）：
```powershell
$bytes = [System.IO.File]::ReadAllBytes("$PWD\scripts\scan-c.ps1")
"scan-c BOM: $($bytes[0]) $($bytes[1]) $($bytes[2])"
$errs = $null
[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw "$PWD\scripts\scan-c.ps1"), [ref]$errs) | Out-Null
"scan-c errors: $($errs.Count)"
$bytes2 = [System.IO.File]::ReadAllBytes("$PWD\scripts\relaunch-admin.ps1")
"relaunch BOM: $($bytes2[0]) $($bytes2[1]) $($bytes2[2])"
$errs2 = $null
[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw "$PWD\scripts\relaunch-admin.ps1"), [ref]$errs2) | Out-Null
"relaunch errors: $($errs2.Count)"
```
Expected: 两个文件 BOM 均为 `239 187 191`；errors 均为 0

## Step 6: 确认备份存在

Run: `Test-Path scripts/scan-c.ps1.bak; Test-Path scripts/relaunch-admin.ps1.bak`
Expected: True / True

## 报告

完成后在报告中写明：
- 两个文件的修改点（old → new 片段）
- BOM 字节验证输出（应为 239 187 191）
- PowerShell 语法检查结果（errors 应为 0）
- 备份文件确认
- 是否用了 `\uFEFF` 直写还是 PowerShell 转 BOM 方式
- 任何偏差
