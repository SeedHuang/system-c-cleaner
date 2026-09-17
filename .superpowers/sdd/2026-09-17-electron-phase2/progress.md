# Phase 2（托盘 + 窗口行为 + 开机自启）SDD 进度账本

日期：2026-09-17
Spec：`docs/superpowers/specs/2026-09-17-electron-phase2-design.md`
Plan：`docs/superpowers/plans/2026-09-17-electron-phase2.md`

## 状态：全部完成 ✅（含手工验收通过）

| 任务 | 交付物 | 状态 |
|---|---|---|
| T1 托盘图标 | `scripts/gen-tray-icon.js` + `electron/assets/tray.png`（32×32，程序化 PNG） | ✅ |
| T2 开机自启 | `electron/autostart.js` + 测试（5 例） | ✅ |
| T3 托盘模块 | `electron/tray.js` + 测试（6 例） | ✅ |
| T4 主进程集成 | `electron/main.js`：关窗→hide、`--hidden`、托盘、立即扫描、常驻 | ✅ |
| T5 README + 回归 | README 补 Phase 2、全量 43/43 测试、tsc 无错误 | ✅ |
| T6 打包 + 验收 | NSIS 安装包 106.6MB，8 项手工验收全过 | ✅ |

## Rulings / 偏差

| # | 内容 |
|---|---|
| R1 | **api.test.js 受真实数据污染**：Phase 1 验收扫描产生了真实 history/ 快照，导致「无历史 insufficient=true」测试失败。修复：测试启动前设置 `CLEANER_DATA_DIR` 指向独立临时目录（在 require server 之前），测试后清理。根因与 Phase 1 T1 同类，本次固化为测试隔离而非手动改名。 |
| R2 | **测试文件打进 asar**：`electron/**` 把 `*.test.js` 也打包了。修复：electron-builder.yml `files` 增加 `"!electron/*.test.js"`。 |
| R3 | **托盘图标无现成资源**：项目无任何图标。用 Node 纯脚本（zlib 手写 PNG）程序化生成 32×32 深蓝底 + 白色缺口圆环（C 形），无外部依赖。 |
| R4 | **立即扫描不引入 IPC**：按 spec 由主进程直接 `http.request POST /api/scan`（fire-and-forget），server 扫描完成后响应时刷新可见窗口。保持「前端零改动」。 |

## 验收结论（用户手工验收，8/8 通过）

关窗进托盘、单击恢复、菜单 4 项、立即扫描、开机自启（注册表 HKCU Run + --hidden）、重启隐藏启动、托盘退出、日志完整 —— 全部符合预期。

## 待办

- [ ] 提交并推送 Phase 2 代码（git 写操作需用户终端执行）
- [ ] 进入 Phase 3（桌面悬浮小部件）
