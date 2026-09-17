# C 盘空间分析工具 — Phase 2（托盘 + 窗口行为 + 开机自启）实施计划

日期：2026-09-17
Spec：`docs/superpowers/specs/2026-09-17-electron-phase2-design.md`
方式：TDD（先写测试 → 实现 → 验证），每步编辑后跑 tsc

## 任务分解

| # | 任务 | 交付物 | 验证 |
|---|---|---|---|
| T1 | 托盘图标 | `scripts/gen-tray-icon.js` + `electron/assets/tray.png` | 运行脚本生成 PNG，文件存在 |
| T2 | 开机自启模块 | `electron/autostart.js` + `electron/autostart.test.js` | node:test 通过 |
| T3 | 托盘模块 | `electron/tray.js` + `electron/tray.test.js` | node:test 通过 |
| T4 | 主进程集成 | `electron/main.js`（窗口行为/--hidden/托盘/自启/立即扫描） | tsc + 手工验收 |
| T5 | README + 回归 | `README.md` + 全量 `npx tsc --noEmit` + `npm test` | 无新错误 |
| T6 | 打包 + 手工验收 | NSIS 安装包 + 验收清单 | 8 项验收全过 |

## 关键实现要点

- **autostart.js**：`createAutostart({ app, log })` → `{ isEnabled, setEnabled }`；开发模式返回 false 并日志
- **tray.js**：`createTray({ icon, getMenuState, onShow, onScan, onToggleAutostart, onQuit, log })`；菜单 4 项；单击显示窗口
- **main.js**：`isQuitting` 标志；close→hide；`window-all-closed` 不再 quit；`--hidden` 不显示；`triggerScan()` fire-and-forget POST /api/scan；托盘退出置 isQuitting
- **图标**：Node 纯脚本 zlib 手写 PNG 32×32，深蓝 #2697FF 底 + 白色图案

## 验收

1. 打包运行关窗进托盘、单击恢复、菜单 4 项、立即扫描、自启开关（注册表 HKCU Run）、重启隐藏启动、托盘退出、日志完整
