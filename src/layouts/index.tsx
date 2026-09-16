import { Outlet, useLocation, useNavigate, useModel } from '@umijs/max';
import { Button, Input, Menu, message } from 'antd';
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

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data, scanning, error, startScan } = useModel('scan');

  const handleScan = async () => {
    try {
      await startScan();
      message.success('扫描完成，数据已更新');
      navigate('/dashboard');
    } catch {
      // 错误已由 model 记录
    }
  };

  const freeGB = data?.disk?.freeGB;
  const scannedAt = data?.scannedAt;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* 左侧导航（Figma 220px 深色侧边栏） */}
      <aside
        className="figma-sider"
        style={{
          width: 220,
          background: figmaColors.bgContainer,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '24px 20px 20px',
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'linear-gradient(90deg,#2697FF,#66B6FF)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 18,
            }}
          >
            <DatabaseOutlined />
          </div>
          <span style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>C盘分析</span>
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ flex: 1, border: 'none', background: 'transparent', paddingTop: 8 }}
        />

        {/* 底部安全提示卡（视觉对应 Figma 升级卡） */}
        <div
          style={{
            margin: '0 14px 20px',
            padding: '14px 12px',
            background: figmaColors.bgUpgrade,
            borderRadius: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: figmaColors.green,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <SafetyCertificateOutlined /> 安全模式
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              lineHeight: '18px',
              color: 'rgba(255,255,255,0.7)',
            }}
          >
            只读扫描，不会删除、移动或修改任何文件
          </div>
        </div>
      </aside>

      {/* 右侧主体 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 顶栏 */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '20px 28px',
            height: 88,
            flexShrink: 0,
          }}
        >
          <Input
            className="figma-search"
            prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />}
            placeholder="搜索目录或文件"
            style={{ maxWidth: 325, background: figmaColors.bgContainer, border: 'none' }}
            allowClear
          />
          <Button
            type="primary"
            icon={<DatabaseOutlined />}
            loading={scanning}
            onClick={handleScan}
          >
            {scanning ? '扫描中…' : data ? '重新扫描' : '开始扫描'}
          </Button>
          <div style={{ flex: 1 }} />
          {/* 可用空间卡片（视觉对应 Figma 用户卡） */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '6px 14px',
              background: figmaColors.bgContainer,
              borderRadius: 10,
              border: `1px solid ${figmaColors.borderWhite}`,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'rgba(38,151,255,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: figmaColors.primary,
              }}
            >
              <HddOutlined />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
                {freeGB != null ? `可用 ${formatGB(freeGB)}` : '可用 —'}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                {scannedAt ? `扫描于 ${scannedAt}` : '尚未扫描'}
              </div>
            </div>
          </div>
        </header>

        {/* 内容区 */}
        <main style={{ flex: 1, overflow: 'auto', padding: '0 28px 28px' }}>
          {error && (
            <div
              style={{
                marginBottom: 16,
                padding: '10px 14px',
                borderRadius: 10,
                background: 'rgba(238,39,39,0.12)',
                border: '1px solid rgba(238,39,39,0.3)',
                color: '#FF6B6B',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
