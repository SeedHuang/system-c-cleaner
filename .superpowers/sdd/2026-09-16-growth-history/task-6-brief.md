# Task 6 Brief: 趋势分析页（Trends + TrendChart + 路由导航）

项目：d:\Seed\system-c-cleaner（umi/max + antd5，Figma 深色主题）。本任务新增「趋势分析」页面 `/trends`：时间窗口切换、增长排行 Top 20、逐层下钻表格 + 面包屑、右侧趋势折线图（自绘 SVG）、数据不足与提权引导提示。Task 5 已提供 `getGrowth/getGrowthDir/getGrowthTrend` 服务。

## 环境注意（重要）

- **禁止 git**：跳过所有 commit 步骤。
- 验证：每次编辑 .tsx 后运行 `npx tsc --noEmit --pretty 2>&1 | Select-String "src/pages/Trends"`（无输出为通过）；全部完成后再跑 `npx tsc --noEmit --pretty`（预存错误 src/app.tsx、src/setup/theme.tsx 可忽略）。
- 禁止安装 npm 依赖（趋势图用自绘 SVG，不引图表库）。
- 文件编辑用 Write/SearchReplace 工具。
- **同一文件只发一次 SearchReplace，import 变更与代码变更合并进同一次**（本任务对 layouts/index.tsx 和 config/config.ts 各只发一次 SearchReplace，见 Step 3 的精确 old_str/new_str）。
- 不要派生子代理。

## Files

- Create: `src/components/TrendChart.tsx`
- Create: `src/pages/Trends/index.tsx`
- Modify: `config/config.ts`（routes 加 `/trends`）
- Modify: `src/layouts/index.tsx`（menuItems 加「趋势分析」+ import 加 `LineChartOutlined`）

## Interfaces

- Consumes: Task 5 的 `getGrowth/getGrowthDir/getGrowthTrend` 与类型、`@/setup/theme` 的 `figmaColors`、`@/utils/format` 的 `formatSize`
- Produces: `/trends` 页面（路由 + 侧边栏导航项「趋势分析」）

## Steps

### Step 1: 创建 src/components/TrendChart.tsx

```tsx
import { useMemo } from 'react';
import { formatSize } from '@/utils/format';

export interface TrendPoint {
  t: string;
  size: number | null;
}

/** 自绘 SVG 折线趋势图（零依赖，离线可用） */
export default function TrendChart({ points, height = 160 }: { points: TrendPoint[]; height?: number }) {
  const view = useMemo(() => {
    const W = 600;
    const H = height;
    const pad = 8;
    const data = points.filter((p): p is { t: string; size: number } => p.size != null);
    if (data.length < 2) return { valid: false, poly: '', minLabel: '', maxLabel: '' };
    const sizes = data.map((d) => d.size);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    const span = max - min || 1;
    const poly = data
      .map((d, i) => {
        const x = pad + (i / (data.length - 1)) * (W - pad * 2);
        const y = H - pad - ((d.size - min) / span) * (H - pad * 2);
        return `${x},${y}`;
      })
      .join(' ');
    return { valid: true, poly, minLabel: formatSize(min), maxLabel: formatSize(max) };
  }, [points, height]);

  if (!view.valid) {
    return <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, padding: 12 }}>数据点不足，无法绘制趋势</div>;
  }
  return (
    <svg viewBox={`0 0 600 ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <polyline points={view.poly} fill="none" stroke="#2697FF" strokeWidth={2} />
      <text x={8} y={height - 4} fontSize={10} fill="rgba(255,255,255,0.5)">{view.minLabel}</text>
      <text x={8} y={12} fontSize={10} fill="rgba(255,255,255,0.5)">{view.maxLabel}</text>
    </svg>
  );
}
```

### Step 2: 创建 src/pages/Trends/index.tsx

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Breadcrumb, Button, Card, Col, Empty, InputNumber, Row, Segmented, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FolderOutlined } from '@ant-design/icons';
import TrendChart from '@/components/TrendChart';
import type { GrowthDirEntry, GrowthDirResult, GrowthTopResult, GrowthTier } from '@/services/growth';
import { getGrowth, getGrowthDir, getGrowthTrend } from '@/services/growth';
import { figmaColors } from '@/setup/theme';
import { formatSize } from '@/utils/format';

const WINDOW_OPTIONS = [
  { label: '1天', value: '1d' },
  { label: '2天', value: '2d' },
  { label: '5天', value: '5d' },
  { label: '10天', value: '10d' },
  { label: '15天', value: '15d' },
  { label: '1月', value: '1m' },
  { label: '6月', value: '6m' },
  { label: '1年', value: '1y' },
];

const tierColor: Record<GrowthTier, string> = {
  extreme: figmaColors.red,
  high: figmaColors.orange,
  medium: figmaColors.yellow,
  low: figmaColors.green,
};
const tierLabel: Record<GrowthTier, string> = {
  extreme: '极高',
  high: '高',
  medium: '中',
  low: '低',
};

export default function TrendsPage() {
  const [windowLabel, setWindowLabel] = useState('1m');
  const [customHours, setCustomHours] = useState<number | null>(24);
  const [topData, setTopData] = useState<GrowthTopResult | null>(null);
  const [loadingTop, setLoadingTop] = useState(false);
  const [drillPath, setDrillPath] = useState<string | null>(null);
  const [dirData, setDirData] = useState<GrowthDirResult | null>(null);
  const [loadingDir, setLoadingDir] = useState(false);
  const [trend, setTrend] = useState<{ t: string; size: number | null }[]>([]);

  const loadTop = useCallback(async (window: string) => {
    setLoadingTop(true);
    try {
      setTopData(await getGrowth({ window, top: 20 }));
    } catch {
      setTopData(null);
    } finally {
      setLoadingTop(false);
    }
  }, []);

  useEffect(() => {
    loadTop(windowLabel);
  }, [windowLabel, loadTop]);

  const openDir = useCallback(
    async (path: string) => {
      setDrillPath(path);
      setLoadingDir(true);
      try {
        setDirData(await getGrowthDir({ path, window: windowLabel }));
      } catch {
        setDirData(null);
      } finally {
        setLoadingDir(false);
      }
      try {
        const t = await getGrowthTrend({ path, points: 60 });
        setTrend(t.points);
      } catch {
        setTrend([]);
      }
    },
    [windowLabel],
  );

  const crumbs = useMemo(() => (drillPath ? drillPath.split('\\').filter(Boolean) : []), [drillPath]);

  const columns: ColumnsType<GrowthDirEntry> = [
    { title: '目录', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: '当前大小',
      dataIndex: 'size',
      key: 'size',
      width: 110,
      align: 'right',
      render: (v: number | null) => (v == null ? '未扫描' : formatSize(v)),
    },
    {
      title: '增长量',
      dataIndex: 'growth',
      key: 'growth',
      width: 110,
      align: 'right',
      render: (v: number) => (
        <span style={{ color: v >= 0 ? figmaColors.green : figmaColors.red, fontWeight: 600 }}>
          {v >= 0 ? '+' : ''}{formatSize(v)}
        </span>
      ),
    },
    {
      title: '活跃程度',
      dataIndex: 'tier',
      key: 'tier',
      width: 90,
      render: (t: GrowthTier) => <span style={{ color: tierColor[t] }}>{tierLabel[t]}</span>,
    },
    {
      title: '标记',
      dataIndex: 'sustained',
      key: 'sustained',
      width: 90,
      render: (v: boolean) => (v ? <Tag color="gold">持续膨胀</Tag> : null),
    },
    {
      title: '下钻',
      key: 'drill',
      width: 80,
      render: (_, r) =>
        r.hasChildren ? (
          <Button size="small" icon={<FolderOutlined />} onClick={() => openDir(r.path)}>
            进入
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <Card title="增长趋势" bordered={false} style={{ marginBottom: 20 }}>
        <Segmented options={WINDOW_OPTIONS} value={windowLabel} onChange={(v) => setWindowLabel(String(v))} />
        <div style={{ display: 'inline-flex', gap: 8, marginLeft: 16, alignItems: 'center' }}>
          <InputNumber
            min={1}
            max={24 * 365}
            value={customHours}
            onChange={(v) => setCustomHours(v)}
            placeholder="小时"
            style={{ width: 90 }}
          />
          <Button size="small" onClick={() => customHours && setWindowLabel(`${customHours}h`)}>
            自定义
          </Button>
        </div>
      </Card>

      {topData?.insufficient && (
        <Card bordered={false}>
          <Empty description="历史数据不足（至少需要 2 次扫描）——每次点击「重新扫描」都会自动记录一次快照，积累后即可分析增长趋势。" />
        </Card>
      )}

      {!topData?.insufficient && (topData?.unscannedDirs ?? 0) > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 20 }}
          message={`检测到 ${topData?.unscannedDirs} 个目录因权限不足未扫描，建议以管理员身份运行应用后重新扫描，可获得更完整数据。`}
        />
      )}

      {!drillPath ? (
        <Card
          title={`增长排行 Top 20${topData?.compareAt ? `（对比 ${topData.compareAt}）` : ''}`}
          bordered={false}
        >
          {loadingTop ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
            </div>
          ) : topData && topData.entries.length === 0 ? (
            <Empty description="暂无增长数据" />
          ) : (
            <div>
              {topData?.entries.map((e) => {
                const depth = Math.max(0, e.path.split('\\').length - 2);
                const base = e.path.split('\\').pop() || e.path;
                return (
                  <div
                    key={e.path}
                    onClick={() => openDir(e.path)}
                    title={e.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 4px',
                      borderBottom: `1px solid ${figmaColors.borderWhite}`,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ width: 14 * depth, flexShrink: 0 }} />
                    <span style={{ width: 24, flexShrink: 0, color: figmaColors.primary }}>
                      <FolderOutlined />
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#fff' }}>
                      {base}
                    </span>
                    <span style={{ width: 90, textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>
                      {e.size == null ? '未扫描' : formatSize(e.size)}
                    </span>
                    <span style={{ width: 90, textAlign: 'right', fontWeight: 600, color: e.growth >= 0 ? figmaColors.green : figmaColors.red }}>
                      {e.growth >= 0 ? '+' : ''}{formatSize(e.growth)}
                    </span>
                    <span style={{ width: 56, textAlign: 'center', color: tierColor[e.tier] }}>{tierLabel[e.tier]}</span>
                    <span style={{ width: 80, textAlign: 'center' }}>
                      {e.sustained ? <Tag color="gold">持续膨胀</Tag> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <div>
          <Card bordered={false} style={{ marginBottom: 20 }}>
            <Breadcrumb
              items={crumbs.map((_, i) => {
                const p = crumbs.slice(0, i + 1).join('\\');
                return {
                  title: <a onClick={() => openDir(p === 'c:' ? 'c:\\' : p)}>{crumbs[i]}</a>,
                };
              })}
            />
          </Card>
          <Row gutter={20}>
            <Col span={16}>
              <Card title={`${drillPath} 子目录增长（${windowLabel}）`} bordered={false}>
                {loadingDir ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Spin />
                  </div>
                ) : dirData && dirData.entries.length === 0 ? (
                  <Empty description="无子目录数据" />
                ) : (
                  <Table<GrowthDirEntry>
                    rowKey="path"
                    columns={columns}
                    dataSource={dirData?.entries ?? []}
                    pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 项` }}
                  />
                )}
              </Card>
            </Col>
            <Col span={8}>
              <Card title={`${drillPath} 历史大小趋势`} bordered={false}>
                {trend.length >= 2 ? (
                  <TrendChart points={trend} />
                ) : (
                  <Empty description="历史数据不足，暂无趋势" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Card>
            </Col>
          </Row>
          <Button style={{ marginTop: 16 }} onClick={() => setDrillPath(null)}>
            返回排行
          </Button>
        </div>
      )}
    </div>
  );
}
```

### Step 3: 加路由与导航（每个文件一次 SearchReplace）

**config/config.ts**（一次 SearchReplace）：把

```ts
    { path: '/dashboard', name: '概览', component: './Dashboard' },
    { path: '/folders', name: '目录排行', component: './Folders' },
```

改为

```ts
    { path: '/dashboard', name: '概览', component: './Dashboard' },
    { path: '/folders', name: '目录排行', component: './Folders' },
    { path: '/trends', name: '趋势分析', component: './Trends' },
```

**src/layouts/index.tsx**（**只发一次 SearchReplace**，old_str 从 import 行一直覆盖到 menuItems 数组结尾，import 与代码合并）：把

```tsx
import {
  DashboardOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  HddOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { figmaColors } from '@/setup/theme';
import { formatGB } from '@/utils/format';

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '概览' },
  { key: '/folders', icon: <FolderOpenOutlined />, label: '目录排行' },
  { key: '/large-files', icon: <HddOutlined />, label: '大文件' },
  { key: '/cleanup', icon: <SafetyCertificateOutlined />, label: '清理建议' },
  { key: '/guide', icon: <ReadOutlined />, label: '操作手册' },
];
```

改为

```tsx
import {
  DashboardOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  HddOutlined,
  LineChartOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { figmaColors } from '@/setup/theme';
import { formatGB } from '@/utils/format';

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '概览' },
  { key: '/folders', icon: <FolderOpenOutlined />, label: '目录排行' },
  { key: '/trends', icon: <LineChartOutlined />, label: '趋势分析' },
  { key: '/large-files', icon: <HddOutlined />, label: '大文件' },
  { key: '/cleanup', icon: <SafetyCertificateOutlined />, label: '清理建议' },
  { key: '/guide', icon: <ReadOutlined />, label: '操作手册' },
];
```

### Step 4: tsc 验证

Run: `npx tsc --noEmit --pretty 2>&1 | Select-String "src/pages/Trends"`
Expected: 无输出（零错误）。再跑一次全量 `npx tsc --noEmit --pretty 2>&1` 确认除已知预存错误外无新错误。

### Step 5: 提交（跳过）

本环境 git 不可用，**跳过 commit**。

## 报告契约

完成后在 `.superpowers/sdd/2026-09-16-growth-history/task-6-report.md` 写入完整报告（实现说明、验证命令与输出、任何偏差或顾虑），然后返回：状态（DONE / DONE_WITH_CONCERNS / BLOCKED）、验证摘要一行、顾虑（如有）。不要派生子代理，不要运行 git，不要安装依赖。
