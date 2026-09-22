import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Popconfirm, Select, Spin, Table, Tag, Tooltip, message } from 'antd';
import { CyberCard, SectionTitle } from '@/components/cyber';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons';
import type { DeleteHistoryFilter, HistorySnapshot } from '@/services/history';
import { deleteHistory, getHistory } from '@/services/history';
import { formatGB, formatSize } from '@/utils/format';
import { openInExplorer } from '@/utils/shell';

const parseT = (s: string) => new Date(s.replace(' ', 'T'));

export default function HistoryPage() {
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [totalSizeMB, setTotalSizeMB] = useState(0);
  const [historyDir, setHistoryDir] = useState<string | null>(null);
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
      setHistoryDir(d.historyDir);
    } catch {
      setSnapshots([]);
      setTotalSizeMB(0);
      setHistoryDir(null);
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

  const openHistoryDir = useCallback(async () => {
    if (!historyDir) {
      message.warning('尚未定位到历史快照目录，请稍后再试');
      return;
    }
    const r = await openInExplorer(historyDir);
    if (!r.ok) message.warning(r.error ?? '打开失败');
  }, [historyDir]);

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
    <CyberCard>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <SectionTitle>历史快照</SectionTitle>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <Tooltip title={historyDir ? `打开历史快照目录：${historyDir}` : '尚未定位到历史快照目录'}>
            <Button
              size="small"
              type="text"
              icon={<FolderOpenOutlined />}
              onClick={openHistoryDir}
              disabled={!historyDir}
            >
              打开快照目录
            </Button>
          </Tooltip>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
            共 {snapshots.length} 个快照，占用 {formatSize(totalSizeMB * 1024 * 1024)}
          </span>
        </span>
      </div>
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
    </CyberCard>
  );
}
