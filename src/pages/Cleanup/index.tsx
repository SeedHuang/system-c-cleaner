import { useEffect, useState } from 'react';
import { useModel } from '@umijs/max';
import { Empty, message, Spin, Tag } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import type { ScanItem } from '@/services/scan';
import { cleanupLevels, cyberColors } from '@/setup/theme';
import { CyberButton, CyberCard, SectionTitle } from '@/components/cyber';
import { formatGB } from '@/utils/format';
import { openInExplorer } from '@/utils/shell';

const order: (keyof typeof cleanupLevels)[] = ['safe', 'caution', 'keep', 'never'];

/** 仅 safe/caution 且有路径的项显示「打开所在文件夹」；keep/never/unscanned 不显示 */
function shouldShowOpenButton(it: ScanItem): boolean {
  return (
    (it.level === 'safe' || it.level === 'caution') &&
    typeof it.path === 'string' &&
    it.path.trim().length > 0
  );
}

export default function CleanupPage() {
  const { data, loading, scanning, startScan } = useModel('scan');
  // 按钮级 loading：同一时刻只允许一个按钮在请求中，防止连点
  const [busyId, setBusyId] = useState<string | null>(null);
  // 从概览下钻进来时，滚动到对应分类分组（用原生 URL，不依赖路由 hook）
  const levelFromQuery =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('level')
      : null;

  useEffect(() => {
    if (levelFromQuery && data) {
      const el = document.getElementById(`group-${levelFromQuery}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // 滚动发生在 main 容器内，额外兜底
        const main = document.querySelector('main');
        if (main) main.scrollTo({ top: el.offsetTop - 24, behavior: 'smooth' });
      }
    }
  }, [levelFromQuery, data]);

  if (loading) {
    return (
      <CyberCard style={{ textAlign: 'center', padding: '60px 0' }}>
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

  const items = data.items;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {order.map((lv) => {
        const level = cleanupLevels[lv];
        const group = items.filter((it) => it.level === lv);
        const total = group.reduce((s, it) => s + (it.sizeGB ?? 0), 0);
        const unscanned = group.filter((it) => it.status === 'unscanned').length;
        return (
          <CyberCard key={lv} id={`group-${lv}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <SectionTitle style={{ fontSize: 16, color: cyberColors.red }}>{level.label}</SectionTitle>
              <Tag
                style={{
                  background: 'rgba(94,246,255,0.1)',
                  color: cyberColors.cyan,
                  border: `1px solid ${cyberColors.borderCyan}`,
                  borderRadius: 0,
                  fontFamily: "'Rajdhani', sans-serif",
                  fontWeight: 600,
                }}
              >
                约 {formatGB(total)}
              </Tag>
              {unscanned > 0 && (
                <span style={{ fontSize: 12, color: cyberColors.textMuted }}>
                  {unscanned} 项因权限不足未扫描
                </span>
              )}
            </div>
            {group.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {group.map((it: ScanItem) => (
                  <div
                    key={it.id}
                    style={{
                      background: cyberColors.bgLayout,
                      padding: 14,
                      borderTop: `1px solid rgba(247,80,73,0.5)`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          fontFamily: "'Rajdhani', sans-serif",
                          color: cyberColors.textPrimary,
                        }}
                      >
                        {it.name}
                      </span>
                      <span
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          fontFamily: "'Rajdhani', sans-serif",
                          color: it.status === 'unscanned' ? cyberColors.textMuted : cyberColors.cyan,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {it.status === 'unscanned' ? '未扫描' : formatGB(it.sizeGB)}
                      </span>
                    </div>
                    <div className="path-text" style={{ marginTop: 6 }}>
                      {it.path}
                    </div>
                    <div
                      style={{
                        marginTop: 10,
                        fontSize: 13,
                        color: cyberColors.textSecondary,
                        lineHeight: 1.6,
                      }}
                    >
                      {it.reason}
                    </div>
                    {shouldShowOpenButton(it) && (
                      <div style={{ marginTop: 10 }}>
                        <CyberButton
                          icon={<FolderOpenOutlined />}
                          loading={busyId === it.id}
                          onClick={async () => {
                            setBusyId(it.id);
                            try {
                              const r = await openInExplorer(it.path);
                              if (!r.ok) message.error(r.error || '打开失败');
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          打开所在文件夹
                        </CyberButton>
                      </div>
                    )}
                    {it.action && (
                      <div style={{ marginTop: 10 }}>
                        <div
                          style={{
                            fontSize: 12,
                            color: 'rgba(255,255,255,0.45)',
                            marginBottom: 6,
                          }}
                        >
                          建议操作（请自行执行）：
                        </div>
                        <div className="guide-code">{it.action}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="暂无此项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </CyberCard>
        );
      })}
    </div>
  );
}
