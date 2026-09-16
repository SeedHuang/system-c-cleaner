# Task 8 Brief: Dashboard 提权引导提示 + 全量验证

项目：d:\Seed\system-c-cleaner（umi/max + antd5）。本任务为最后一个任务：概览页存在未扫描目录时展示「以管理员身份运行」引导提示，并做全量验证（后端测试 + 全量 tsc + 生产构建）。

## 环境注意（重要）

- **禁止 git**：跳过所有 commit 步骤。
- 验证：`npm test`、`npx tsc --noEmit --pretty`、`npm run build`。
- 禁止安装 npm 依赖（`npm run build` 只是构建，不 install）。
- 文件编辑用 Write/SearchReplace 工具。
- **同一文件只发一次 SearchReplace**。
- 不要派生子代理。

## Ruling（来自控制器，务必遵守）

Dashboard 的 antd import 行（第 2 行）与未扫描提示代码（约第 135 行）相距 130+ 行，无法在**同一次 SearchReplace** 内合并 import 与代码改动（违反用户「import 与代码同一次 SearchReplace」硬规则的几何前提）。裁定：**提示条改用内联样式 div（警告色）**，不动 import 行，全文件只发一次 SearchReplace 替换提示区域。样式对齐现有错误条模式（参考 src/layouts/index.tsx 中 error 提示 div），用 figmaColors.yellow `#FFCF26` 系警告色。

## Files

- Modify: `src/pages/Dashboard/index.tsx`（仅替换未扫描提示区域，一次 SearchReplace，不触碰 import）

## Interfaces

- Consumes: 现有 `useModel('scan')` 的 `data.topFolders`（`status === 'unscanned'` 数量）
- Produces: 概览页在 `unscannedCount > 0` 时展示「以管理员身份运行」引导警告条

## Steps

### Step 1: 修改 Dashboard（一次 SearchReplace）

**重要：先 Read `src/pages/Dashboard/index.tsx` 确认当前内容**，然后只发一次 SearchReplace，把：

```tsx
            {unscannedCount > 0 && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                {unscannedCount} 个目录因权限不足未扫描（不影响使用）
              </div>
            )}
```

替换为：

```tsx
            {unscannedCount > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'rgba(255,207,38,0.12)',
                  border: '1px solid rgba(255,207,38,0.35)',
                  color: '#FFD666',
                  fontSize: 13,
                }}
              >
                检测到 {unscannedCount} 个目录因权限不足未扫描，建议以管理员身份运行应用后重新扫描，可获得更完整数据。
              </div>
            )}
```

（若 Read 后发现该区域文本与上面 old_str 不完全一致，以实际内容为准构造唯一匹配的 old_str，但**只替换这一处**，其余一律不动。）

### Step 2: 验证三连

Run:
```bash
npm test
npx tsc --noEmit --pretty
npm run build
```

Expected：
- `npm test`：16 个用例全部通过
- `npx tsc --noEmit --pretty`：除已知预存错误（src/app.tsx、src/setup/theme.tsx）外无新错误
- `npm run build`：构建成功，生成 `dist/`（无需检查 dist 内容细节，exit 0 即可）

### Step 3: 提交（跳过）

本环境 git 不可用，**跳过 commit**。

## 报告契约

完成后在 `.superpowers/sdd/2026-09-16-growth-history/task-8-report.md` 写入完整报告（实现说明、三个验证命令各自的输出摘要、任何偏差或顾虑），然后返回：状态（DONE / DONE_WITH_CONCERNS / BLOCKED）、验证摘要一行、顾虑（如有）。不要派生子代理，不要运行 git，不要安装依赖。
