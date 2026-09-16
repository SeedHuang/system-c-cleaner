import { useEffect } from 'react';
import { useModel } from '@umijs/max';
import { Button, Card, Empty, Spin, Tag } from 'antd';
import type { ScanItem } from '@/services/scan';
import { cleanupLevels } from '@/setup/theme';
import { formatGB } from '@/utils/format';

const order: (keyof typeof cleanupLevels)[] = ['safe', 'caution', 'keep', 'never'];

export default function CleanupPage() {
  const { data, loading, scanning, startScan } = useModel('scan');
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

  const items = data.items;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {order.map((lv) => {
        const level = cleanupLevels[lv];
        const group = items.filter((it) => it.level === lv);
        const total = group.reduce((s, it) => s + (it.sizeGB ?? 0), 0);
        const unscanned = group.filter((it) => it.status === 'unscanned').length;
        return (
          <Card key={lv} id={`group-${lv}`} bordered={false}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span
                style={{ width: 10, height: 10, borderRadius: '50%', background: level.color }}
              />
              <span style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{level.label}</span>
              <Tag style={{ background: `${level.color}22`, color: level.color, border: 'none' }}>
                约 {formatGB(total)}
              </Tag>
              {unscanned > 0 && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
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
                      background: '#1B1E2B',
                      borderRadius: 10,
                      padding: 14,
                      border: '1px solid rgba(255,255,255,0.06)',
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
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F0' }}>
                        {it.name}
                      </span>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: it.status === 'unscanned' ? 'rgba(255,255,255,0.4)' : level.color,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {it.status === 'unscanned' ? '未扫描' : formatGB(it.sizeGB)}
                      </span>
                    </div>
                    <div className="path-text" style={{ marginTop: 6 }}>
                      {it.path}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 13, color: '#B5C9DB', lineHeight: 1.6 }}>
                      {it.reason}
                    </div>
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
          </Card>
        );
      })}
    </div>
  );
}
