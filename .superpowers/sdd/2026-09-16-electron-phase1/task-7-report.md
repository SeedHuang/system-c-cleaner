# Task 7 Report: scripts/*.ps1 改造（Write 全量重写，保留 UTF-8 BOM）

日期：2026-09-16
状态：DONE

## 1. 修改点（old → new）

### scripts/scan-c.ps1（Step 3）

old（第 17-18 行附近）：
```powershell
# ---------- config ----------
$resultPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'scan-result.json'
```
new：
```powershell
# ---------- config ----------
$resultPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'scan-result.json'
# 打包后由 Electron 主进程注入：结果写入 userData（安装目录可能不可写）
if ($env:CLEANER_RESULT_PATH) { $resultPath = $env:CLEANER_RESULT_PATH }
```

### scripts/relaunch-admin.ps1（Step 4）

修改点 1（第 6-7 行附近）：
old：
```powershell
$root  = Split-Path $PSScriptRoot -Parent
$flag  = Join-Path $root 'history\.elevated-launch.flag'
```
new：
```powershell
$root  = Split-Path $PSScriptRoot -Parent
$flag  = Join-Path $root 'history\.elevated-launch.flag'
if ($env:CLEANER_DATA_DIR) { $flag = Join-Path $env:CLEANER_DATA_DIR '.elevated-launch.flag' }
```

修改点 2（第 19-22 行附近）：
old：
```powershell
# 3) Start the new (elevated) server; it will auto-scan once on startup.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'node' }
Start-Process -FilePath $node -ArgumentList 'server/index.js','--scan-on-start' -WorkingDirectory $root -WindowStyle Hidden
```
new：
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

除以上修改点外，其余内容（中文注释、正则、函数体）与原文件逐字一致。已用 `Compare-Object` 对比 .bak 与新文件确认，差异行仅包含上述修改点。

## 2. BOM 字节验证输出（Step 5）

```
scan-c BOM: 239 187 191
scan-c byte3-5: 60 35 10   (即 `<#\n`，确认无双 BOM)
relaunch BOM: 239 187 191
```

两个文件前 3 字节均为 `EF BB BF`（239 187 191），且第 4-6 字节不是重复的 BOM 标记，无双 BOM 问题。

## 3. PowerShell 语法检查结果（Step 5）

```
scan-c errors: 0
relaunch errors: 0
```

使用 `[System.Management.Automation.PSParser]::Tokenize` 检查，两个文件语法错误数均为 0。

## 4. 备份确认（Step 6）

```
bak exists: True / True
```

- `scripts/scan-c.ps1.bak` ✓
- `scripts/relaunch-admin.ps1.bak` ✓

备份在重写前通过 `Copy-Item` 完成（PowerShell 全量复制，不改变编码）。

## 5. BOM 方式

**`\uFEFF` 直写**：Write 工具 content 首字符为 BOM 字符 `\uFEFF`（本报告无法显示该不可见字符，验证字节已确认生效）。未使用 PowerShell 转 BOM 的备选命令。

## 6. 偏差记录

1. **relaunch-admin.ps1 原始文件无 BOM**：简报声称"两个 .ps1 都是 UTF-8 带 BOM"，但实测 `relaunch-admin.ps1` 原始前 3 字节为 `35 32 82`（ASCII `# R`，即无 BOM）；仅 `scan-c.ps1` 原始带 BOM（239 187 191）。依据"以实际为准"原则并兼顾简报 Step 5 验证期望（两文件 BOM 均应为 239 187 191），最终 `relaunch-admin.ps1` 也写为带 BOM。该文件内容为纯 ASCII，加 BOM 对 PowerShell 5.1 解析无影响（且带 BOM 是推荐编码）。
2. **行尾格式**：两个文件原始均为 LF 行尾（CRLF 计数为 0），重写后保持 LF，未引入 CRLF 差异。
3. **未执行任何 git 命令**（遵守简报强制约束）。
