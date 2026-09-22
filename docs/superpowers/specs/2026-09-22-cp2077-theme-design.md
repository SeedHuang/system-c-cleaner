# CP2077 全站 UI 重构设计

日期：2026-09-22
状态：待用户审阅

## 1. 背景与目标

用户对现有 SaaS 深色风格（源自 "SaaS - File Management Dashboard (Dark)" 模板）不满意，要求改用 Figma 模板 **UI Kit - CP2077 (Community)** 全面重构 UI 风格。

- 参考稿：https://www.figma.com/design/4m3pOlCOGUKEadjXbVOT4u/UI-Kit---CP2077--Community-?node-id=1-2333
- 还原强度：**完整赛博朋克**（切角边框、Rajdhani 字体、红青撞色、扫描线纹理、发光效果、大写标题）
- 范围：**7 个页面 + 主布局 + 共享组件**（Dashboard / Cleanup / Folders / LargeFiles / History / Trends / Guide + layouts）
- 不在范围：桌面悬浮 Widget（`src/pages/Widget/`，自包含样式，独立窗口）

技术路线：**方案 A —— antd 深度换肤 + Cyber 原语层**。保留 antd 组件功能（表格/表单/弹窗），通过主题 token、原语组件、全局样式三层实现外观。

## 2. 从 Figma 提取的设计规范

### 2.1 颜色（Color Styles #1:2310）

| 用途 | 值 | Figma 名称 |
|------|------|------|
| 背景主色 | `#0E0E17` | Primary（近黑） |
| 对比灰 | `#D6D0D0` | Background / contrast（仅装饰，不用作底色） |
| 主红 | `#F75049` | Cyberpunk/Red |
| 主青 | `#5EF6FF` | Primary/Cian |
| 绿 | `#1DED83` | — |
| 蓝 | `#2570D4` | — |
| 紫 | `#9D2BF5` | — |
| 橙 | `#FB932E` | Secondary/Orange |
| 黄 | `#F0B537` | — |
| 卡片描边 | `rgba(94, 246, 255, 0.3)` | 青色 30% |
| 卡片底 | `rgba(94, 246, 255, 0.1)` | 青色 10% |
| 分隔线 | 红色 2px、opacity 0.3 | Separators #1:2333 |
| 卡片内分隔线 | 红色 1px、opacity 0.5 | Card #1:188 |

### 2.2 字体（Typography Settings #1:2331）

| 项 | 值 |
|------|------|
| 字体族 | Rajdhani（Google Fonts，OFL 开源，可打包） |
| 标题 | SemiBold 600、UPPER、letter-spacing -0.04em |
| 正文 | Medium 500、letter-spacing -0.04em |
| 发光标题 | 红色 + `filter: blur(14px)` 双层叠放 |
| 按钮字体 | Blender Pro Bold 24 大写 → **替代方案：Rajdhani Bold**（Blender Pro 为商业字体不可打包） |
| 中文字形 | Rajdhani 无中文字形，回退微软雅黑；大写/字距效果仅作用于数字与英文 |

### 2.3 组件特征

- **Card/Frame-M**：青 10% 底 + 青 30% 描边切角面板 + 左侧 5px 青 30% 竖条
- **Card（人物卡）**：`#0E0E17` 底切角面板、红色 1px 大写小标签、青色正文、红 50% 分隔线
- **Buttons/Web**：切角多边形、青描边、`rgba(0,0,0,0.5)` 底、白色大写文字
- **Separator/Normal**：红 2px 30% 分隔线，端点缺口造型
- **背景纹理**：menu_bg_texture（实现用 CSS 扫描线 `repeating-linear-gradient` 替代位图，避免打包大图）

## 3. 设计令牌（重写 `src/setup/theme.tsx`）

```text
bgLayout     #0E0E17   全局背景
bgContainer  #161616   卡片/面板底
bgElevated   #1A1A26   浮层/表头底
red          #F75049   主色（选中态、强调、never 分类）
cyan         #5EF6FF   数值/链接/次强调
green        #1DED83   safe 分类
yellow       #F0B537   caution 分类
orange       #FB932E   警告
```

- `cleanupLevels` 语义色映射更新：safe→green、caution→yellow、keep→cyan、never→red（标签文字不变）
- `figmaColors` 更名为 `cyberColors` 并删除旧导出；全部 10 个引用文件同步更新（均在本方案改造范围内，Widget 无依赖，已确认）
- antd token：`darkAlgorithm`、`borderRadius: 0`、`controlHeight: 36`、`fontFamily: Rajdhani + 回退栈`
- antd components 覆盖：Menu 选中态红色、Table 表头 `#1A1A26` + 方角、Modal/Popover/Tooltip 方角

## 4. 字体策略

1. 下载 Rajdhani（Light/Regular/Medium/SemiBold/Bold，woff2）到 `src/assets/fonts/`，`@font-face` 写入 `global.less`
2. 来源：google/fonts 官方仓库（OFL 许可，允许再分发打包）
3. 不使用 Google CDN（Electron 离线可用性）
4. `font-display: swap`；回退栈：`-apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif`

## 5. Cyber 原语层（新增 `src/components/cyber/index.tsx` + `cyber.less`）

| 组件 | 说明 |
|------|------|
| `CyberCard` | 切角面板。**双层法**：外层 clip-path 多边形 + 主色填充做"描边"，内层同 clip-path 内缩 1px 做底色。变体：cyan（默认）/ red；可选左侧竖条、可选扫描线纹理 |
| `CyberButton` | 切角轮廓按钮，复用双层法。变体：cyan 默认 / red 强调；基于 antd Button 包一层 className 实现（保留 loading / icon / disabled 原生语义），仅覆盖外观 |
| `SectionTitle` | Rajdhani SemiBold 大写 + 字距 -0.04em；`glow` 属性启用红色模糊发光双层 |
| `CyberDivider` | 红 2px 30% 分隔线 + 端点缺口（clip-path） |

切角 clip-path 统一常量：`polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)`（左上、右下双切角，对应 Figma 卡片造型）。

## 6. 全局样式（重写 `src/global.less`）

- body 底色 `#0E0E17`
- 扫描线覆盖层：`body::after` fixed 全屏 `repeating-linear-gradient(transparent 0 3px, rgba(255,255,255,0.015) 3px 4px)`，`pointer-events: none`，不遮挡交互
- 滚动条：8px 方形，thumb `#2A2A38`，hover `#F75049`
- antd 浮层方角覆盖：`.ant-modal`、`.ant-dropdown`、`.ant-select-dropdown`、`.ant-popover`、`.ant-message-notice` 等 `border-radius: 0 !important`
- antd Menu 深度覆盖：选中项红色切角背景（clip-path）、去圆角
- 删除全部旧 SaaS 风格残留（`.figma-sider`、`.figma-search` 等类名随之更名 `.cyber-*`）
- `.guide-code` 代码块：红 15% 描边方角 + `#0E0E17` 底

## 7. 布局改造（`src/layouts/index.tsx`）

- 侧边栏：`#0E0E17` 底 + 右侧红 30% 1px 分隔线；菜单选中态红色切角
- 品牌区：Roberta 视频头像保留，外框改切角；名字改 Rajdhani 大写
- 顶栏：底色 `#0E0E17`，下缘红色 CyberDivider；搜索框改方角 + 青 30% 描边聚焦态；扫描按钮改红色 CyberButton（强调变体）
- 可用空间卡改 CyberCard（cyan 变体）
- 侧边栏底部"安全模式"卡改 CyberCard，绿→青描边 + 大写标签
- 错误提示条：红 12% 底 + 红描边方角

## 8. 共享组件改造

| 文件 | 改动 |
|------|------|
| `components/StatCard.tsx` | 底改 `#161616` + 青描边切角（CyberCard 内核），数值改青色 Rajdhani，标签改红色大写小字（Figma 人物卡模式） |
| `components/BarList.tsx` | 条形改方形，颜色梯度改红青系（红→橙→黄→青），数值青色 |
| `components/StorageDonut.tsx` | 环形图换语义色（四分类新色），中心数字 Rajdhani 青色 |
| `components/TrendChart.tsx` | 线条改红/青双色，网格线 rgba(255,255,255,0.06)，tooltip 方角深底 |
| `components/PathLink.tsx` | hover 改青色，字体保持等宽 |

## 9. 页面改造

- **Dashboard**：四张 StatCard 即新样式；Card → CyberCard；"可安全清理预估"数字用 `SectionTitle glow`；未扫描警告条改黄描边方角；提权按钮改 CyberButton
- **Cleanup**：四组分类卡 → CyberCard，组头改 Figma 模式（红大写标签 + 青数值 Tag）；条目卡改 `#0E0E17` 底 + 红 50% 顶部分隔线；操作按钮 CyberButton cyan
- **Folders / LargeFiles**：表格方角 + `#1A1A26` 表头 + 红色选中/hover 态；数值列青色 Rajdhani
- **History / Trends**：图表组件换色后自动生效；页面标题改 SectionTitle
- **Guide**：标题 SectionTitle + 红发光；代码块用新 `.guide-code`；步骤卡片 CyberCard

所有页面标题统一 `SectionTitle`：Rajdhani SemiBold、大写（中文标题保持原文字，仅字体与字距生效）。

## 10. 错误处理与边界

- `cyberColors` 删除 `figmaColors` 后若有遗漏引用，`npx tsc --noEmit` 会捕获（按用户规则分级检查）
- clip-path 双层描边在 antd 浮层内不使用（浮层仅方角化，保持原生描边）
- 扫描线覆盖层 `pointer-events: none`，z-index 9999 但视觉透明度极低（0.015），不影响可读性
- 中文字符串不做 `text-transform` 破坏（CSS uppercase 对中文无效，天然安全）

## 11. 验证

1. 每次编辑后：`npx tsc --noEmit --pretty 2>&1 | grep "src/pages/<目录>"`（用户规则第一级）
2. 全部完成后：全量 `npx tsc --noEmit --pretty`（第二级；忽略既有错误：app.tsx / 404 / setup/theme.tsx 的 antd 类型报错）
3. `npm run dev` 启动，逐页目检：Dashboard、Cleanup、Folders、LargeFiles、History、Trends、Guide
4. 对照 Figma 检查：切角方向、红青描边、分隔线透明度、字体大写效果
5. Widget 页面打开验证无回归（未改动，仅确认编译与运行不受影响）

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| antd 深色算法与自定义红青配色局部对比度不足 | 数值/正文用青 `#5EF6FF` 与 `#F0F0F0`，标签用红 `#F75049`，均高于 WCAG 对比度基线 |
| Rajdhani 字体文件遗漏权重导致标题回退 | 打包 5 个权重全部 5 个文件，@font-face 逐一声明 |
| clip-path 在 Electron 低版本渲染异常 | 项目 Electron 版本较新（Chromium 支持 clip-path polygon 多年），低风险 |
| 大范围样式改动影响既有功能 | 方案 A 仅动外观层；所有交互逻辑（扫描、提权、打开文件夹）不触碰 |
