# 清理建议项 — 打开所在文件夹 设计文档

日期：2026-09-17
状态：待用户审阅
基于：Phase 1~4 已交付（含扫描、托盘、提权、调度、通知）；本阶段只做"建议项打开所在文件夹"的直达入口，不引入自动清理

## 1. 背景与目标

Cleanup 页面已能给每个清理建议项显示一段文字指引（例如"Win+R 输入 %temp% 回车，全选删除"）。但用户得自己切到资源管理器找到对应目录。本阶段目标：

- **打开所在文件夹**：每条 safe/caution 建议项旁出现一个按钮，点击直接在资源管理器中打开该项对应的文件夹
- **保持只读安全**：按钮永远只"打开文件夹"，不执行任何删除/清理
- **零新基础设施**：复用既有 `openInExplorer()`（`src/utils/shell.ts`）→ `shell:open-path` IPC → 主进程 `shell.openPath` 整条链路

### 1.1 需求确认结论（brainstorming）

| 决策点 | 结论 |
|---|---|
| 动作范围 | **仅"打开所在文件夹"** 一种动作（复用 `shell:open-path`） |
| 打开系统设置 / 启动 cleanmgr / 浏览器清理页 | **不做**（用户明确砍掉） |
| 自动执行清理命令（powercfg /h off 等） | **不做** |
| 显示条件 | `level ∈ {safe, caution}` 且 `path` 非空 |
| keep / never 分类 | **不显示按钮**（语义是"不要动"） |
| unscanned（无 path） | 不显示按钮（打不开） |
| 失败处理 | `openInExplorer` 已返回 `{ok, error}`；前端 `message.error` 提示 |

### 1.2 延续的核心约束

1. UI 风格冻结（暗色 #212332/#2A2D3E/#2697FF）：按钮沿用 antd `Button size="small"`，与现有卡片风格一致
2. 只读安全原则不变：不调用任何"删除/停服务/写注册表"命令
3. 浏览器开发模式降级：`window.desktopAPI` 不存在时 `openInExplorer` 返回失败，前端提示"请在桌面应用中使用此功能"（已有实现）

## 2. 架构总览

```
src/pages/Cleanup/index.tsx（修改，唯一改动文件）
  └─ 卡片渲染处：按条件显示「打开所在文件夹」按钮
       ├─ 条件：level ∈ {safe, caution} && path 非空
       └─ onClick → openInExplorer(it.path)（复用 src/utils/shell.ts）
            └─ window.desktopAPI.openPath → IPC shell:open-path → 主进程 shell.openPath

零新增：electron/main-preload.js、electron/main.js、typings、services 均不动
```

## 3. 关键设计

### 3.1 显示条件（纯逻辑，组件内联）

```ts
function shouldShowOpenButton(it: ScanItem): boolean {
  return (it.level === 'safe' || it.level === 'caution')
    && typeof it.path === 'string'
    && it.path.trim().length > 0;
}
```

- `keep` / `never`：不显示（用户不该去动）
- `unscanned` 且 `path` 为空：不显示
- 不做 id 白名单（所有 safe/caution 有路径的项都开放"打开所在文件夹"，本身无害）

### 3.2 UI（src/pages/Cleanup/index.tsx 修改）

在每个建议项卡片的 `it.reason` 下方、`it.action` 区块上方插入按钮区：

```tsx
{shouldShowOpenButton(it) && (
  <div style={{ marginTop: 10 }}>
    <Button
      size="small"
      icon={<FolderOpenOutlined />}
      loading={busyId === it.id}
      onClick={() => handleOpen(it)}
    >
      打开所在文件夹
    </Button>
  </div>
)}
```

`handleOpen`：

```tsx
const [busyId, setBusyId] = useState<string | null>(null);

async function handleOpen(it: ScanItem) {
  setBusyId(it.id);
  try {
    const r = await openInExplorer(it.path);
    if (!r.ok) message.error(r.error || '打开失败');
  } finally {
    setBusyId(null);
  }
}
```

### 3.3 新增 imports（一次 SearchReplace 合并进 `src/pages/Cleanup/index.tsx`）

- `useState` from `react`
- `Button` 已在 import（追加 `message`）
- `FolderOpenOutlined` from `@ant-design/icons`
- `openInExplorer` from `@/utils/shell`
- `ScanItem` 类型已在 import

## 4. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/pages/Cleanup/index.tsx` | 修改 | 卡片加"打开所在文件夹"按钮 + `busyId` + `message` 提示 |

不改动：`scan-c.ps1`、`server/index.js`、`electron/*`、`src/utils/shell.ts`、`typings.d.ts`、`src/services/*`

## 5. 边界情况

| 场景 | 处理 |
|---|---|
| `level=keep/never` | 不显示按钮 |
| `path` 为空 / 非字符串 | 不显示按钮 |
| 浏览器开发模式（无 desktopAPI） | `openInExplorer` 返回 `{ok:false, error:'请在桌面应用中使用此功能'}` → `message.error` 展示 |
| 路径不存在 / 权限不足 | 主进程 `shell.openPath` 返回错误字符串 → 前端 `message.error` |
| 连点同一按钮 | `busyId` 置灰防重 |
| 点按钮后无反应（Windows 未关联） | `openInExplorer` 异常路径返回错误 → 前端提示 |

## 6. 验证

- `npx tsc --noEmit`（编辑后先 grep `src/pages/Cleanup`，再全量，忽略已知清单）
- `npm test` 全量不回归（无新增测试文件）
- 手工验收：
  1. Cleanup 页面 safe/caution 项显示「打开所在文件夹」按钮
  2. keep/never 项无按钮
  3. 点击后资源管理器打开对应目录
  4. 浏览器开发模式点击 → 提示「请在桌面应用中使用此功能」

## 7. 排除项（本阶段不做）

- 打开系统设置页 / 启动磁盘清理 / 浏览器清理页（已砍）
- 自动执行清理命令（留待后续评估）
- 微信/QQ 应用内清理页拉起
- 动作历史记录 / 批量执行 / 设置开关
