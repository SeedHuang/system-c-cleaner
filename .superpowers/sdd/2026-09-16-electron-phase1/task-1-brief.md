# Task 1 Brief: 依赖与基础配置（package.json / .npmrc / electron-builder.yml）

项目：d:\Seed\system-c-cleaner —— C 盘空间分析工具（umi/max + antd5 前端 + Node http 服务 + PowerShell 扫描），正在改造为 Electron 桌面应用（Phase 1 外壳 + 一键安装包）。

## 本任务目标

配置 Electron 开发与打包基础：修改 package.json（新增 Electron 相关字段、把前端构建依赖移入 devDependencies）、创建国内镜像 .npmrc、创建 electron-builder 打包配置、更新 .gitignore，并安装依赖。

## 强制约束（必须遵守）

- **禁止 git commit**（用户规则 + 本环境沙箱拦截 git 写对象）。完成验证后不执行任何 git 命令。
- 本任务不写测试（纯配置任务），但完成后必须跑 `npm run tsc` 验证无新增类型错误。
- 前端依赖（@umijs/max、antd、react 等）必须从 `dependencies` 移入 `devDependencies`——这是为了让 electron-builder 打包时 node_modules 为空（server 仅用 Node 内置模块），避免包体膨胀。
- 若同一文件需要多处修改，合并为一次编辑，禁止并行 SearchReplace。

## Step 1: 修改 package.json

现有 package.json 完整内容：

```json
{
  "name": "c-drive-cleaner",
  "version": "0.1.0",
  "private": true,
  "description": "C 盘空间分析仪表盘（umi/max + antd5，Figma Dark 风格）",
  "scripts": {
    "dev": "max dev",
    "build": "max build",
    "postinstall": "max setup",
    "setup": "max setup",
    "tsc": "tsc --noEmit",
    "server": "node server/index.js",
    "test": "node --test \"server/tests/*.test.js\""
  },
  "dependencies": {
    "@ant-design/icons": "^5.5.1",
    "@umijs/max": "^4.3.29",
    "antd": "^5.21.6",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.5.4"
  }
}
```

改为（main 字段、scripts、dependencies 置空、devDependencies 合并并新增 electron 三件套）：

```json
{
  "name": "c-drive-cleaner",
  "version": "0.1.0",
  "private": true,
  "description": "C 盘空间分析仪表盘（umi/max + antd5，Figma Dark 风格）",
  "main": "electron/main.js",
  "scripts": {
    "dev": "max dev",
    "build": "max build",
    "postinstall": "max setup",
    "setup": "max setup",
    "tsc": "tsc --noEmit",
    "server": "node server/index.js",
    "test": "node --test \"server/tests/*.test.js\"",
    "electron": "electron .",
    "electron:dev": "concurrently -k \"npm:dev\" \"npm:electron\"",
    "electron:build": "npm run build && electron-builder --win"
  },
  "dependencies": {},
  "devDependencies": {
    "@ant-design/icons": "^5.5.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@umijs/max": "^4.3.29",
    "antd": "^5.21.6",
    "concurrently": "^9.1.0",
    "electron": "^44.0.0",
    "electron-builder": "^26.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.5.4"
  }
}
```

注意：`electron/main.js` 在本计划后续任务才会创建，现在只是配置字段，不影响 npm install。

## Step 2: 创建 .npmrc（项目根）

内容（国内镜像，加速 electron 二进制下载）：

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

## Step 3: 创建 electron-builder.yml（项目根）

内容：

```yaml
appId: com.seed.cdrivecleaner
productName: CDriveCleaner
directories:
  output: dist_electron
files:
  - dist/**
  - server/**
  - "!server/tests/**"
  - package.json
extraResources:
  - from: scripts
    to: scripts
win:
  target:
    - nsis
nsis:
  oneClick: true
  perMachine: false
  artifactName: CDriveCleaner-Setup-${version}.exe
```

## Step 4: 修改 .gitignore（追加两行）

现有 .gitignore 内容：

```
node_modules
dist
src/.umi
src/.umi-production
scan-result.json
.history
.DS_Store
*.local
history/
```

追加：

```
logs/
dist_electron/
```

## Step 5: 安装依赖

Run: `npm install`
- electron 二进制下载可能耗时（~100MB）；`.npmrc` 镜像应已生效
- 若安装失败，将完整错误输出报告，不要反复重试超过 2 次
- 若 electron postinstall 下载失败，尝试：`npm config set electron_mirror https://npmmirror.com/mirrors/electron/` 后 `npm install electron --force` 重试

## Step 6: 验证

1. Run: `npm ls electron electron-builder concurrently` → 三个包均在 devDependencies 树中
2. Run: `npm run tsc` → 仅输出已知预存错误（src/app.tsx 的 location、src/pages/404 的 back、src/setup/theme.tsx 的 token，共 3 类），不得有新增错误
3. Run: `npm test` → 全部通过（现有 4+5 个用例）

## 报告

完成后在报告中写明：
- 每个文件的实际改动摘要
- `npm ls` 输出摘要（三个包版本）
- `npm run tsc` 输出（确认仅已知错误）
- `npm test` 结果
- 任何偏差或未决问题（如 electron 下载重试、版本号实际解析值）
