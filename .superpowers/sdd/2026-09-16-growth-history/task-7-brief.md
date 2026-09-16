# Task 7 Brief: 历史快照管理页（History + 路由导航）

项目：d:\Seed\system-c-cleaner（umi/max + antd5，Figma 深色主题）。本任务新增「历史快照」页面 `/history`：年/月/日/时组合筛选、快照表格、单条删除（Popconfirm）、批量「删除筛选结果」（至少一个筛选条件才启用）、快照总占用。Task 5 已提供 `getHistory/deleteHistory`。

## 环境注意（重要）

- **禁止 git**：跳过所有 commit 步骤。
- 验证：每次编辑 .tsx 后运行 `npx tsc --noEmit --pretty 2>&1 | Select-String "src/pages/History"`（无输出为通过）。
- 禁止安装 npm 依赖。
- 文件编辑用 Write/SearchReplace 工具。
- **同一文件只发一次 SearchReplace，import 变更与代码变更合并进同一次**（本任务对 layouts/index.tsx 和 config/config.ts 各只发一次 SearchReplace，见 Step 2 的精确 old_str/new_str）。
- 不要派生子代理。

## Files

- Create: `src/pages/History/index.tsx`
- Modify: `config/config.ts`（routes 加 `/history`）
- Modify: `src/layouts/index.tsx`（menuItems 加「历史快照」+ import 加 `HistoryOutlined`）

## Interfaces

- Consumes: Task 5 的 `getHistory/deleteHistory` 与类型、`@/utils/format` 的 `formatGB/formatSize`
- Produces: `/history` 页面（路由 + 侧边栏导航项「历史快照」）

## Steps

### Step 1: 创建 src/pages/History/index.tsx

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Popconfirm, Select, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined } from '@ant-design/icons';
import type { DeleteHistoryFilter, HistorySnapshot } from '@/services/history';
import { deleteHistory, getHistory } from '@/services/history';
import { formatGB, formatSize } from '@/utils/format';

const parseT = (s: string) => new Date(s.replace(' ', 'T'));

export default function HistoryPage() {
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [totalSizeMB, setTotalSizeMB] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [year, setYear] = useState<number | undefined>();
  const [month, setMonth] = useState<number | undefined>();
  const [day, setDay] = useState<number | undefined>();
  const [hour, setHour] = useState<number | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getHistory();
      setSnapshots(d.snapshots);
      setTotalSizeMB(d.totalSizeMB);
    } catch {
      setSnapshots([]);
      setTotalSizeMB(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const years = useMemo(
    () => [...new Set(snapshots.map((s) => parseT(s.scannedAt).getFullYear()))].sort(),
    [snapshots],
  );
  const months = useMemo(
    () =>
      year == null
        ? []
        : [...new Set(snapshots.filter((s) => parseT(s.scannedAt).getFullYear() === year).map((s) => parseT(s.scannedAt).getMonth() + 1))].sort((a, b) => a - b),
    [snapshots, year],
  );
  const days = useMemo(
    () =>
      month == null
        ? []
        : [...new Set(snapshots.filter((s) => parseT(s.scannedAt).getFullYear() === year && parseT(s.scannedAt).getMonth() + 1 === month).map((s) => parseT(s.scannedAt).getDate()))].sort((a, b) => a - b),
    [snapshots, year, month],
  );
  const hours = useMemo(
    () =>
      day == null
        ? []
        : [...new Set(snapshots.filter((s) => parseT(s.scannedAt).getFullYear() === year && parseT(s.scannedAt).getMonth() + 1 === month && parseT(s.scannedAt).getDate() === day).map((s) => parseT(s.scannedAt).getHours()))].sort((a, b) => a - b),
    [snapshots, year, month, day],
  );

  const filtered = useMemo(
    () =>
      snapshots.filter((s) => {
        const t = parseT(s.scannedAt);
        if (year != null && t.getFullYear() !== year) return false;
        if (month != null && t.getMonth() + 1 !== month) return false;
        if (day != null && t.getDate() !== day) return false;
        if (hour != null && t.getHours() !== hour) return false;
        return true;
      }),
    [snapshots, year, month, day, hour],
  );

  const hasAnyFilter = year != null || month != null || day != null || hour != null;

  const del = useCallback(
    async (filter: DeleteHistoryFilter, label: string) => {
      try {
        const r = await deleteHistory(filter);
        setMsg(`已删除 ${r.deleted} 个快照${label}`);
        await load();
      } catch (e) {
        setMsg(`删除失败：${e instanceof Error ? e.message : '未知错误'}`);
      }
    },
    [load],
  );

  const columns: ColumnsType<HistorySnapshot> = [
    { title: '快照时间', dataIndex: 'scannedAt', key: 'scannedAt', width: 180 },
    {
      title: '磁盘已用',
      dataIndex: 'disk',
      key: 'disk',
      width: 110,
      align: 'right',
      render: (d: HistorySnapshot['disk']) => formatGB(d?.usedGB),
    },
    {
      title: '目录数',
      dataIndex: 'dirCount',
      key: 'dirCount',
      width: 110,
      align: 'right',
      render: (v: number) => v?.toLocaleString() ?? '—',
    },
    {
      title: '文件数',
      dataIndex: 'fileCount',
      key: 'fileCount',
      width: 120,
      align: 'right',
      render: (v: number) => v?.toLocaleString() ?? '—',
    },
    {
      title: '快照大小',
      dataIndex: 'fileSizeMB',
      key: 'fileSizeMB',
      width: 100,
      align: 'right',
      render: (v: number) => formatSize((v || 0) * 1024 * 1024),
    },
    {
      title: '未扫描',
      dataIndex: 'unscannedDirs',
      key: 'unscannedDirs',
      width: 80,
      align: 'right',
      render: (v: number) => (v > 0 ? <Tag color="orange">{v}</Tag> : '—'),
    },
    {
      title: '操作',
      key: 'op',
      width: 90,
      render: (_, r) => (
        <Popconfirm
          title="确认删除该快照？"
          description="删除后无法恢复，趋势分析将不再使用该时间点。"
          onConfirm={() => del({ ids: [r.id] }, '')}
        >
          <Button size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Card
      title="历史快照"
      bordered={false}
      extra={
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
          共 {snapshots.length} 个快照，占用 {formatSize(totalSizeMB * 1024 * 1024)}
        </span>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="每次扫描都会自动记录一次全盘快照，可按年/月/日/时筛选并删除，释放磁盘空间。"
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <Select
          placeholder="年份"
          allowClear
          style={{ width: 110 }}
          value={year}
          options={years.map((y) => ({ value: y, label: `${y} 年` }))}
          onChange={setYear}
        />
        <Select
          placeholder="月份"
          allowClear
          style={{ width: 100 }}
          value={month}
          disabled={year == null || months.length === 0}
          options={months.map((m) => ({ value: m, label: `${m} 月` }))}
          onChange={setMonth}
        />
        <Select
          placeholder="日期"
          allowClear
          style={{ width: 100 }}
          value={day}
          disabled={month == null || days.length === 0}
          options={days.map((d) => ({ value: d, label: `${d} 日` }))}
          onChange={setDay}
        />
        <Select
          placeholder="小时"
          allowClear
          style={{ width: 100 }}
          value={hour}
          disabled={day == null || hours.length === 0}
          options={hours.map((h) => ({ value: h, label: `${h} 时` }))}
          onChange={setHour}
        />
        <Popconfirm
          title={`确认删除筛选出的 ${filtered.length} 个快照？`}
          description="删除后无法恢复。"
          disabled={filtered.length === 0 || !hasAnyFilter}
          onConfirm={() => del({ year, month, day, hour }, `（筛选 ${filtered.length} 条）`)}
        >
          <Button danger icon={<DeleteOutlined />} disabled={filtered.length === 0 || !hasAnyFilter}>
            删除筛选结果
          </Button>
        </Popconfirm>
        {msg && <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>{msg}</span>}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <Table<HistorySnapshot>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 12, showTotal: (t) => `共 ${t} 条` }}
        />
      )}
    </Card>
  );
}
```

### Step 2: 加路由与导航（每个文件一次 SearchReplace）

**config/config.ts**（一次 SearchReplace）：把

```ts
    { path: '/guide', name: '操作手册', component: './Guide' },
```

改为

```ts
    { path: '/guide', name: '操作手册', component: './Guide' },
    { path: '/history', name: '历史快照', component: './History' },
```

**src/layouts/index.tsx**（**只发一次 SearchReplace**，old_str 从 import 行一直覆盖到 menuItems 数组结尾，import 与代码合并。注意：Task 6 已加过 `LineChartOutlined` 和 `/trends` 项，下面的 old_str 是当前真实内容）：把

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

改为

```tsx
import {
  DashboardOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  HddOutlined,
  HistoryOutlined,
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
  { key: '/history', icon: <HistoryOutlined />, label: '历史快照' },
];
```

### Step 3: tsc 验证

Run: `npx tsc --noEmit --pretty 2>&1 | Select-String "src/pages/History"`
Expected: 无输出（零错误）。

### Step 4: 提交（跳过）

本环境 git 不可用，**跳过 commit**。

## 报告契约

完成后在 `.superpowers/sdd/2026-09-16-growth-history/task-7-report.md` 写入完整报告（实现说明、验证命令与输出、任何偏差或顾虑），然后返回：状态（DONE / DONE_WITH_CONCERNS / BLOCKED）、验证摘要一行、顾虑（如有）。不要派生子代理，不要运行 git，不要安装依赖。
