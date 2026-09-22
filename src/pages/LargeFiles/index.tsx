import { useModel } from '@umijs/max';
import { Empty, Spin, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PathLink from '@/components/PathLink';
import { CyberButton, CyberCard, SectionTitle } from '@/components/cyber';
import { cyberColors } from '@/setup/theme';
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
    render: (v: number) => (
      <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, color: cyberColors.cyan }}>
        {formatGB(v)}
      </span>
    ),
  },
  {
    title: '操作',
    key: 'action',
    width: 60,
    align: 'center',
    render: (_, r) => <PathLink path={r.path} variant="button" title={`打开所在文件夹：${r.path}`} />,
  },
];

export default function LargeFilesPage() {
  const { data, loading, scanning, startScan } = useModel('scan');

  if (loading) {
    return (
      <CyberCard contentStyle={{ textAlign: 'center', padding: '60px 0' }}>
        <Spin tip="读取扫描结果…" />
      </CyberCard>
    );
  }

  if (!data) {
    return (
      <CyberCard style={{ marginTop: 60 }}>
        <Empty description="还没有扫描数据，请先执行扫描">
          <CyberButton variant="red" loading={scanning} onClick={startScan}>
            开始扫描
          </CyberButton>
        </Empty>
      </CyberCard>
    );
  }

  return (
    <CyberCard>
      <SectionTitle style={{ marginBottom: 16 }}>{`全盘大文件 Top ${data.largeFiles.length}`}</SectionTitle>
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
    </CyberCard>
  );
}
