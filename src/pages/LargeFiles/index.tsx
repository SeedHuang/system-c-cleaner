import { useModel } from '@umijs/max';
import { Button, Card, Empty, Spin, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { LargeFile } from '@/services/scan';
import { formatGB } from '@/utils/format';

const columns: ColumnsType<LargeFile> = [
  { title: '文件名', dataIndex: 'name', key: 'name', width: 280 },
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
    sorter: (a, b) => a.sizeGB - b.sizeGB,
    defaultSortOrder: 'descend',
    render: (v: number) => formatGB(v),
  },
];

export default function LargeFilesPage() {
  const { data, loading, scanning, startScan } = useModel('scan');

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
    <Card title={`全盘大文件 Top ${data.largeFiles.length}`} bordered={false}>
      {data.largeFiles.length ? (
        <Table<LargeFile>
          rowKey={(r) => r.path}
          columns={columns}
          dataSource={data.largeFiles}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 个文件` }}
        />
      ) : (
        <Empty description="未发现超过 100MB 的大文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Card>
  );
}
