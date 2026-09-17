# Task 1 Report: 依赖与基础配置（package.json / .npmrc / electron-builder.yml）

日期：2026-09-16
状态：DONE_WITH_CONCERNS（npm test 环境残留数据导致 1 个用例失败，与本次改动无关，详见下文）

## 1. 每个文件的实际改动摘要

### d:\Seed\system-c-cleaner\package.json
- 新增 `"main": "electron/main.js"`（electron/main.js 本计划后续任务创建，现在仅为配置字段，不影响 npm install）
- scripts 新增 3 条：`electron`（electron .）、`electron:dev`（concurrently -k "npm:dev" "npm:electron"）、`electron:build`（npm run build && electron-builder --win）
- `dependencies` 置空为 `{}`
- `devDependencies` 合并原 dependencies（@ant-design/icons、@umijs/max、antd、react、react-dom）与原有项（@types/react、@types/react-dom、typescript），并新增 electron@^44.0.0、electron-builder@^26.0.0、concurrently@^9.1.0

### d:\Seed\system-c-cleaner\.npmrc（新建）
```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

### d:\Seed\system-c-cleaner\electron-builder.yml（新建）
appId: com.seed.cdrivecleaner / productName: CDriveCleaner / output: dist_electron / files: dist/**, server/**（排除 server/tests/**）、package.json / extraResources: scripts → scripts / win nsis 安装包，artifactName: CDriveCleaner-Setup-${version}.exe。与简报逐字一致。

### d:\Seed\system-c-cleaner\.gitignore
- 追加 2 行：`logs/`、`dist_electron/`（置于文件末尾）

### package-lock.json
- 由 npm install 自动更新（新增 electron/electron-builder/concurrently 及其依赖树）

## 2. npm install 结果
- 成功（exit code 0），耗时约 2 分钟，`added 185 packages, audited 1663 packages`，无失败/重试
- electron 二进制经 npmmirror 镜像下载成功（.npmrc 生效），postinstall `max setup` 正常执行
- 警告（均为预存问题，非本次引入）：
  - 多条 `ERESOLVE overriding peer dependency`（@umijs/plugins 内部嵌套 react 16/17 与顶层 react 18 的 peer 冲突，npm 自动 override 解决）
  - 46 vulnerabilities（10 low / 18 moderate / 17 high / 1 critical，来自 umi 生态老依赖链）

## 3. npm ls 输出摘要（三个包实际解析版本）
```
c-drive-cleaner@0.1.0 D:\Seed\system-c-cleaner
├── concurrently@9.2.4        (^9.1.0)
├── electron-builder@26.15.3  (^26.0.0)
└── electron@44.4.1           (^44.0.0)
```
三个包均位于 devDependencies 依赖树中，无缺失/无效。

## 4. npm run tsc 输出结论
- exit code 0，**零错误输出**（无任何类型错误）
- 比简报预期更好：简报预期仅有 3 类已知预存错误（src/app.tsx location、src/pages/404 back、src/setup/theme.tsx token），实际当前代码中这些错误已不存在，输出完全干净。无新增错误目标达成。

## 5. npm test 结果
- 直接运行：18 个用例，17 通过 / 1 失败（api.test.js 第 3 个用例 `GET /api/growth 无历史时 insufficient=true`，期望 true 实际 false）
- **根因（已确凿验证）**：`history/` 目录存在 2 条开发期真实扫描快照（2026-09-16T18-34-49、2026-09-16T18-37-08，C 盘真实数据 dirCount≈97693），`computeGrowthTop` 据此找到对比快照返回 `insufficient: false`，破坏测试"无历史"前提
- **验证方法**：临时将 history/ 改名移走后重跑 → 18/18 全部通过（exit code 0，duration 112ms）；随后已恢复 history/ 目录原状
- 结论：失败完全由测试环境残留数据导致，与本次 Electron 配置改动（package.json/.npmrc/electron-builder.yml/.gitignore）无关，未触碰任何 server 代码

## 6. 偏差与未决问题
1. **用例数偏差**：简报 Step 6 称"现有 4+5 个用例"（9 个），实际 18 个（api.test.js 5 + history.test.js 13），以实际为准
2. **tsc 已知错误清单偏差**：简报预期 3 类已知预存错误，实际为 0（相关文件当前无类型错误）
3. **npm test 环境偏差**：直接运行有 1 个失败（残留 history 数据所致，非代码缺陷）；已用"移走→重跑→恢复"证明 18/18 可全部通过。若后续 CI 或其他任务运行 npm test，需注意 history/ 目录须为空（或该测试用例改为不依赖环境）
4. **依赖版本解析值**：electron 44.4.1 / electron-builder 26.15.3 / concurrently 9.2.4（与简报声明范围一致）
5. 未执行任何 git 写操作（遵守约束）；未删除/修改 history/ 下任何用户扫描数据
