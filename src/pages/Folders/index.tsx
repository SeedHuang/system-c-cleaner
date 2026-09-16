import { useMemo, useState } from 'react';
import { useModel } from '@umijs/max';
import { Button, Card, Empty, Input, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import type { ScanItem } from '@/services/scan';
import { cleanupLevels } from '@/setup/theme';
import { formatGB } from '@/utils/format';

const tagColor: Record<string, string> = {
  safe: 'green',
  caution: 'gold',
  keep: 'blue',
  never: 'red',
};

export default function FoldersPage() {
  const { data, loading, scanning, startScan } = useModel('scan');
  // 从概览下钻进来时，用 query.name 初始化搜索关键词（用原生 URL，不依赖路由 hook）
  const initKeyword =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('name') ?? ''
      : '';
  const [keyword, setKeyword] = useState(initKeyword);

  const columns: ColumnsType<ScanItem> = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 220 },
    {
      title: '路径',
      dataIndex: 'path',
      key: 'path',
      ellipsis: true,
      render: (v: string) => <span className="path-text">{v}</span>,
    },
    {
      title: '大小',
      dataIndex: 'sizeGB',
      key: 'sizeGB',
      width: 110,
      align: 'right',
      sorter: (a, b) => (a.sizeGB ?? -1) - (b.sizeGB ?? -1),
      render: (v: number | null, r) =>
        v == null ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>{r.status === 'unscanned' ? '未扫描' : '—'}</span> : formatGB(v),
    },
    {
      title: '分类',
      dataIndex: 'level',
      key: 'level',
      width: 120,
      render: (l: keyof typeof cleanupLevels) => (
        <Tag color={tagColor[l]}>{cleanupLevels[l].label}</Tag>
      ),
    },
    { title: '说明', dataIndex: 'reason', key: 'reason', ellipsis: true },
  ];

  // 顶层目录也并入表格，保证概览下钻能搜到（如 Windows / Users / Program Files）
  const rows: ScanItem[] = useMemo(() => {
    const extra: ScanItem[] = (data?.topFolders ?? []).map((tf) => ({
      id: `tf-${tf.name}`,
      name: tf.name,
      path: tf.path,
      sizeGB: tf.sizeGB,
      level: 'keep',
      reason: tf.status === 'unscanned' ? '无权限读取，未扫描' : '',
      status: tf.status === 'unscanned' ? 'unscanned' : 'ok',
    }));
    return [...extra, ...(data?.items ?? [])];
  }, [data]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter(
      (it) => it.name.toLowerCase().includes(kw) || it.path.toLowerCase().includes(kw),
    );
  }, [keyword, rows]);

  if (loading) {
    return (
      <Card bordered={false} style={{ textAlign: 'center', padding: '60px 0' }}>
        <Spin tip="读取扫描结果…" />
      </Card>
    );
  }

  if (!data) {
    return (
      <Card bordered={false} style={{ marginTop: 60 }}>
        <Empty description="还没有扫描数据，请先执行扫描">
          <Button type="primary" loading={scanning} onClick={startScan}>
            开始扫描
          </Button>
        </Empty>
      </Card>
    );
  }

  return (
    <Card
      title="目录排行"
      bordered={false}
      extra={
        <Input
          prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />}
          placeholder="搜索名称或路径"
          allowClear
          value={keyword}
          style={{ width: 240 }}
          onChange={(e) => setKeyword(e.target.value)}
        />
      }
    >
      <Table<ScanItem>
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        pagination={{ pageSize: 12, showTotal: (t) => `共 ${t} 项` }}
      />
    </Card>
  );
}
