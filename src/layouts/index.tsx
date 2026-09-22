import type React from 'react';
import { Outlet, useLocation, useNavigate, useModel } from '@umijs/max';
import { Input, Menu, message } from 'antd';
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
import { cyberColors } from '@/setup/theme';
import { CyberButton, CyberCard, CyberDivider } from '@/components/cyber';
import { formatGB } from '@/utils/format';
import robotAvatar from '../../assets/robot.mp4';

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
    <div className="cyber-app" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* 左侧导航（CP2077 近黑侧边栏 + 红色分隔线） */}
      <aside
        className="cyber-sider"
        style={{
          width: 220,
          background: cyberColors.bgLayout,
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
          <video
            src={robotAvatar}
            autoPlay
            loop
            muted
            playsInline
            style={{
              width: 34,
              height: 34,
              borderRadius: 0,
              objectFit: 'cover',
              background: 'rgba(247,80,73,0.15)',
              border: `1px solid ${cyberColors.borderRed}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: 18,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: '#fff',
            }}
          >
            Roberta
          </span>
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ flex: 1, border: 'none', background: 'transparent', paddingTop: 8 }}
        />

        {/* 底部安全提示卡 */}
        <CyberCard variant="cyan" stripe style={{ margin: '0 14px 20px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: cyberColors.cyan,
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            <SafetyCertificateOutlined /> 安全模式
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              lineHeight: '18px',
              color: cyberColors.textSecondary,
            }}
          >
            只读扫描，不会删除、移动或修改任何文件
          </div>
        </CyberCard>
      </aside>

      {/* 右侧主体 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 顶栏 + 底部红色分隔线（-webkit-app-region: drag 充当标题栏；交互元素需 no-drag） */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '20px 148px 20px 28px', /* 右侧留白避开原生窗口控制按钮 */
            height: 88,
            flexShrink: 0,
            WebkitAppRegion: 'drag',
          } as React.CSSProperties}
        >
          <Input
            className="cyber-search"
            prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />}
            placeholder="搜索目录或文件"
            style={{ maxWidth: 325, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            allowClear
          />
          <CyberButton
            variant="red"
            icon={<DatabaseOutlined />}
            loading={scanning}
            onClick={handleScan}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {scanning ? '扫描中…' : data ? '重新扫描' : '开始扫描'}
          </CyberButton>
          <div style={{ flex: 1 }} />
          {/* 可用空间卡 */}
          <CyberCard
            variant="cyan"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 0 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  background: 'rgba(94,246,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: cyberColors.cyan,
                }}
              >
                <HddOutlined />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#fff',
                    fontFamily: "'Rajdhani', sans-serif",
                  }}
                >
                  {freeGB != null ? `可用 ${formatGB(freeGB)}` : '可用 —'}
                </div>
                <div style={{ fontSize: 11, color: cyberColors.textMuted }}>
                  {scannedAt ? `扫描于 ${scannedAt}` : '尚未扫描'}
                </div>
              </div>
            </div>
          </CyberCard>
        </header>
        <CyberDivider style={{ margin: '0 28px' }} />

        {/* 内容区 */}
        <main style={{ flex: 1, overflow: 'auto', padding: '0 28px 28px' }}>
          {error && (
            <div
              style={{
                marginTop: 16,
                padding: '10px 14px',
                background: 'rgba(247,80,73,0.1)',
                border: `1px solid ${cyberColors.borderRed}`,
                color: cyberColors.red,
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
