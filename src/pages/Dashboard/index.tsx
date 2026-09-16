import { useCallback, useEffect, useState } from 'react';
import { useModel, useNavigate } from '@umijs/max';
import { Button, Card, Col, Empty, Row, Spin } from 'antd';
import {
  DatabaseOutlined,
  HddOutlined,
  PieChartOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import BarList from '@/components/BarList';
import StatCard from '@/components/StatCard';
import StorageDonut from '@/components/StorageDonut';
import { cleanupLevels, figmaColors } from '@/setup/theme';
import { formatGB } from '@/utils/format';
import { elevateRestart, getStatus } from '@/services/scan';

const barColors = [
  '#2697FF', '#3AA0FF', '#4FA9FF', '#63B2FF', '#79DFFF',
  '#8FD9FF', '#A6C8E8', '#B5C9DB',
];

const levelOrder = ['safe', 'caution', 'keep', 'never'] as const;

type ElevatePhase = 'idle' | 'requesting' | 'waiting' | 'restarting' | 'scanning' | 'done' | 'cancelled' | 'failed';

export default function DashboardPage() {
  const { data, loading, scanning, startScan, refresh } = useModel('scan');
  const navigate = useNavigate();
  const [elevate, setElevate] = useState<ElevatePhase>('idle');
  const [elevateMsg, setElevateMsg] = useState<string | null>(null);

  const handleElevate = useCallback(async () => {
    setElevate('requesting');
    setElevateMsg(null);
    try {
      await elevateRestart();
      setElevate('waiting');
      setElevateMsg('请在系统授权窗口点击「是」，应用将以管理员身份重启并自动重新扫描…');
    } catch {
      setElevate('failed');
      setElevateMsg('请求失败，请重试');
    }
  }, []);

  // 提权重启后轮询状态：旧服务退出 → 新服务扫描中 → 完成刷新
  useEffect(() => {
    if (elevate !== 'waiting' && elevate !== 'restarting' && elevate !== 'scanning') return;
    const timer = setInterval(async () => {
      try {
        const st = await getStatus();
        if (st.elevatedScan === 'cancelled') {
          setElevate('cancelled');
          setElevateMsg('授权被取消或超时，可重试，或手动以管理员身份运行');
        } else if (st.scanning) {
          setElevate('scanning');
          setElevateMsg('正在以管理员身份重新扫描（约 1~3 分钟），完成后自动更新数据…');
        } else if (elevate === 'scanning') {
          setElevate('done');
          setElevateMsg('提权重扫完成，数据已更新');
          refresh();
        }
      } catch {
        setElevate('restarting');
        setElevateMsg('应用正在以管理员身份重启…');
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [elevate, refresh]);

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
        <Empty description="还没有扫描数据">
          <Button
            type="primary"
            icon={<DatabaseOutlined />}
            loading={scanning}
            onClick={startScan}
          >
            {scanning ? '正在扫描，请稍候…' : '开始扫描 C 盘'}
          </Button>
          <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
            只读扫描，不会删除、移动或修改任何文件，预计 1~3 分钟
          </div>
        </Empty>
      </Card>
    );
  }

  const { disk, topFolders, items } = data;

  // 空间构成：按清理分类聚合
  const byLevel: Record<string, number> = { safe: 0, caution: 0, keep: 0, never: 0 };
  items.forEach((it) => {
    if (it.sizeGB != null) byLevel[it.level] += it.sizeGB;
  });
  const round1 = (n: number) => +n.toFixed(1);
  const segments = levelOrder.map((lv) => ({
    label: cleanupLevels[lv].label,
    value: round1(byLevel[lv]),
    color: cleanupLevels[lv].color,
    level: lv,
  }));

  // 顶层目录条形图（有数据的取前 10）
  const folders = topFolders
    .filter((f) => f.sizeGB != null)
    .sort((a, b) => (b.sizeGB ?? 0) - (a.sizeGB ?? 0))
    .slice(0, 10)
    .map((f, i) => ({
      name: f.name,
      path: f.path,
      sizeGB: f.sizeGB as number,
      color: barColors[i % barColors.length],
    }));

  const unscannedCount = topFolders.filter((f) => f.status === 'unscanned').length;

  return (
    <div>
      <Row gutter={20}>
        <Col span={6}>
          <StatCard
            title="总容量"
            value={formatGB(disk.totalGB)}
            sub="C盘"
            color={figmaColors.primary}
            icon={<DatabaseOutlined />}
          />
        </Col>
        <Col span={6}>
          <StatCard
            title="已使用"
            value={formatGB(disk.usedGB)}
            sub={`占 ${disk.totalGB ? ((disk.usedGB / disk.totalGB) * 100).toFixed(1) : 0}%`}
            color={figmaColors.orange}
            icon={<PieChartOutlined />}
          />
        </Col>
        <Col span={6}>
          <StatCard
            title="可用空间"
            value={formatGB(disk.freeGB)}
            sub="当前剩余"
            color={figmaColors.green}
            icon={<HddOutlined />}
          />
        </Col>
        <Col span={6}>
          <StatCard
            title="可安全清理预估"
            value={`${formatGB(byLevel.safe)}`}
            sub="不含谨慎项"
            color={figmaColors.cyan}
            icon={<ThunderboltOutlined />}
          />
        </Col>
      </Row>

      <Row gutter={20} style={{ marginTop: 20 }}>
        <Col span={16}>
          <Card title="顶层目录排行" bordered={false}>
            {folders.length ? (
              <BarList
                items={folders}
                onItemClick={(f) => navigate(`/folders?name=${encodeURIComponent(f.name)}`)}
              />
            ) : (
              <Empty description="暂无目录数据（可能需要管理员权限）" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
            {unscannedCount > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'rgba(255,207,38,0.12)',
                  border: '1px solid rgba(255,207,38,0.35)',
                  color: '#FFD666',
                  fontSize: 13,
                }}
              >
                <div>检测到 {unscannedCount} 个目录因权限不足未扫描，以管理员身份重新扫描可获得更完整数据。</div>
                <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    icon={<DatabaseOutlined />}
                    loading={elevate === 'requesting'}
                    disabled={elevate === 'waiting' || elevate === 'restarting' || elevate === 'scanning'}
                    onClick={handleElevate}
                  >
                    一键以管理员身份重扫
                  </Button>
                  {(elevate === 'waiting' || elevate === 'restarting' || elevate === 'scanning') && (
                    <Spin size="small" />
                  )}
                  {elevateMsg && <span style={{ color: 'rgba(255,255,255,0.75)' }}>{elevateMsg}</span>}
                </div>
              </div>
            )}
          </Card>
          <Card title="空间构成（按清理分类）" bordered={false} style={{ marginTop: 20 }}>
            <BarList
              items={segments.map((s) => ({ name: s.label, sizeGB: s.value, color: s.color, level: s.level }))}
              onItemClick={(it) => it.level && navigate(`/cleanup?level=${it.level}`)}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false}>
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>存储用量</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>已用空间构成</div>
            </div>
            <StorageDonut
              segments={segments}
              centerTitle={formatGB(disk.usedGB)}
              centerSub={`共 ${formatGB(disk.totalGB)}`}
              onSegmentClick={(seg) => seg.level && navigate(`/cleanup?level=${seg.level}`)}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
