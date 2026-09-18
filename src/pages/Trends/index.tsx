import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Breadcrumb, Button, Card, Col, DatePicker, Empty, InputNumber, Row, Segmented, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { FolderOutlined } from '@ant-design/icons';
import PathLink from '@/components/PathLink';
import TrendChart from '@/components/TrendChart';
import type { GrowthDirEntry, GrowthDirResult, GrowthTopResult, GrowthTier } from '@/services/growth';
import { getGrowth, getGrowthDir, getGrowthTrend } from '@/services/growth';
import { figmaColors } from '@/setup/theme';
import { formatSize } from '@/utils/format';
import { parentOf } from '@/utils/path';

const WINDOW_OPTIONS = [
  { label: '1天', value: '1d' },
  { label: '2天', value: '2d' },
  { label: '5天', value: '5d' },
  { label: '10天', value: '10d' },
  { label: '15天', value: '15d' },
  { label: '1月', value: '1m' },
  { label: '6月', value: '6m' },
  { label: '1年', value: '1y' },
];

const tierColor: Record<GrowthTier, string> = {
  extreme: figmaColors.red,
  high: figmaColors.orange,
  medium: figmaColors.yellow,
  low: figmaColors.green,
};
const tierLabel: Record<GrowthTier, string> = {
  extreme: '极高',
  high: '高',
  medium: '中',
  low: '低',
};

export default function TrendsPage() {
  const [windowLabel, setWindowLabel] = useState('1m');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [customHours, setCustomHours] = useState<number | null>(24);
  const [topData, setTopData] = useState<GrowthTopResult | null>(null);
  const [loadingTop, setLoadingTop] = useState(false);
  const [drillPath, setDrillPath] = useState<string | null>(null);
  const [dirData, setDirData] = useState<GrowthDirResult | null>(null);
  const [loadingDir, setLoadingDir] = useState(false);
  const [trend, setTrend] = useState<{ t: string; size: number | null }[]>([]);

  // 区间优先：选了起止时刻就用区间，否则用预设窗口（二选一）
  const from = range ? range[0].format('YYYY-MM-DD HH:mm') : undefined;
  const to = range ? range[1].format('YYYY-MM-DD HH:mm') : undefined;
  const rangeParams = useMemo(() => ({ window: windowLabel, from, to }), [windowLabel, from, to]);
  // 区间模式的展示文案（null = 未选区间，用预设窗口）
  const rangeText = from && to ? `${from} ~ ${to}` : null;
  // 「今天」快捷方式：开始 00:00:00.000、结束 23:59:59.999（endOf('day') 即当天最后一刻）
  const todayPresets = useMemo(
    () => [{ label: '今天', value: [dayjs().startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] }],
    [],
  );

  const loadTop = useCallback(async () => {
    setLoadingTop(true);
    try {
      setTopData(await getGrowth({ ...rangeParams, top: 20 }));
    } catch {
      setTopData(null);
    } finally {
      setLoadingTop(false);
    }
  }, [rangeParams]);

  useEffect(() => {
    loadTop();
  }, [loadTop]);

  /** 下钻：只切换目录 + 拉该目录历史趋势；子目录增长由下方 effect 按当前时间范围拉取 */
  const openDir = useCallback(async (path: string) => {
    setDrillPath(path);
    try {
      const t = await getGrowthTrend({ path, points: 60 });
      setTrend(t.points);
    } catch {
      setTrend([]);
    }
  }, []);

  // 下钻目录或时间范围变化时重新拉取子目录增长（否则会一直显示旧范围的数据）
  useEffect(() => {
    if (!drillPath) return;
    let alive = true;
    (async () => {
      setLoadingDir(true);
      try {
        const d = await getGrowthDir({ path: drillPath, ...rangeParams });
        if (alive) setDirData(d);
      } catch {
        if (alive) setDirData(null);
      } finally {
        if (alive) setLoadingDir(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [drillPath, rangeParams]);

  const crumbs = useMemo(() => (drillPath ? drillPath.split('\\').filter(Boolean) : []), [drillPath]);

  const columns: ColumnsType<GrowthDirEntry> = [
    { title: '目录', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: '上级目录',
      key: 'parent',
      ellipsis: true,
      render: (_, r) => <PathLink path={parentOf(r.path)} className="path-text" />,
    },
    {
      title: '当前大小',
      dataIndex: 'size',
      key: 'size',
      width: 110,
      align: 'right',
      render: (v: number | null) => (v == null ? '未扫描' : formatSize(v)),
    },
    {
      title: '增长量',
      dataIndex: 'growth',
      key: 'growth',
      width: 110,
      align: 'right',
      render: (v: number) => (
        <span style={{ color: v >= 0 ? figmaColors.green : figmaColors.red, fontWeight: 600 }}>
          {v >= 0 ? '+' : ''}{formatSize(v)}
        </span>
      ),
    },
    {
      title: '活跃程度',
      dataIndex: 'tier',
      key: 'tier',
      width: 90,
      render: (t: GrowthTier) => <span style={{ color: tierColor[t] }}>{tierLabel[t]}</span>,
    },
    {
      title: '标记',
      dataIndex: 'sustained',
      key: 'sustained',
      width: 90,
      render: (v: boolean) => (v ? <Tag color="gold">持续膨胀</Tag> : null),
    },
    {
      title: '下钻',
      key: 'drill',
      width: 80,
      render: (_, r) =>
        r.hasChildren ? (
          <Button
            size="small"
            icon={<FolderOutlined />}
            onClick={(e) => {
              e.stopPropagation(); // 行点击已负责下钻，避免重复请求
              openDir(r.path);
            }}
          >
            进入
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <Card title="增长趋势" bordered={false} style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Segmented
            options={WINDOW_OPTIONS}
            value={range ? undefined : windowLabel}
            onChange={(v) => setWindowLabel(String(v))}
          />
          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <InputNumber
              min={1}
              max={24 * 365}
              value={customHours}
              onChange={(v) => setCustomHours(v)}
              placeholder="小时"
              style={{ width: 90 }}
            />
            <Button size="small" onClick={() => customHours && setWindowLabel(`${customHours}h`)}>
              自定义
            </Button>
          </div>
          <DatePicker.RangePicker
            value={range}
            onChange={(v) => {
              const [s, e] = v ?? [];
              setRange(s && e ? [s, e] : null);
            }}
            showTime={{ format: 'HH:mm' }}
            format="YYYY-MM-DD HH:mm"
            presets={todayPresets}
            allowClear
            placeholder={['开始时间', '结束时间']}
            style={{ width: 330 }}
          />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
            {range ? '按所选时间区间查看' : '按预设窗口查看'}
          </span>
        </div>
      </Card>

      {topData?.insufficient && (
        <Card bordered={false}>
          <Empty description="历史数据不足（至少需要 2 次扫描）——每次点击「重新扫描」都会自动记录一次快照，积累后即可分析增长趋势。" />
        </Card>
      )}

      {!topData?.insufficient && (topData?.unscannedDirs ?? 0) > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 20 }}
          message={`检测到 ${topData?.unscannedDirs} 个目录因权限不足未扫描，建议以管理员身份运行应用后重新扫描，可获得更完整数据。`}
        />
      )}

      {!drillPath ? (
        <Card
          title={`增长排行 Top 20${
            rangeText ? `（区间 ${rangeText}）` : topData?.compareAt ? `（对比 ${topData.compareAt}）` : ''
          }`}
          bordered={false}
        >
          {loadingTop ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
            </div>
          ) : topData && topData.entries.length === 0 ? (
            <Empty description="暂无增长数据" />
          ) : (
            <div>
              {topData?.entries.map((e) => {
                const depth = Math.max(0, e.path.split('\\').length - 2);
                const base = e.path.split('\\').pop() || e.path;
                return (
                  <div
                    key={e.path}
                    onClick={() => openDir(e.path)}
                    title={e.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 4px',
                      borderBottom: `1px solid ${figmaColors.borderWhite}`,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ width: 14 * depth, flexShrink: 0 }} />
                    <span style={{ width: 24, flexShrink: 0, color: figmaColors.primary }}>
                      <FolderOutlined />
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden' }}>
                      {/* 名称整体仍是下钻（由行 onClick 处理），仅下方路径可点击打开文件夹 */}
                      <span
                        style={{
                          display: 'block',
                          color: '#fff',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {base}
                      </span>
                      <PathLink
                        path={parentOf(e.path)}
                        className="path-text"
                        style={{
                          display: 'block',
                          fontSize: 11,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      />
                    </span>
                    <span style={{ width: 90, textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>
                      {e.size == null ? '未扫描' : formatSize(e.size)}
                    </span>
                    <span style={{ width: 90, textAlign: 'right', fontWeight: 600, color: e.growth >= 0 ? figmaColors.green : figmaColors.red }}>
                      {e.growth >= 0 ? '+' : ''}{formatSize(e.growth)}
                    </span>
                    <span style={{ width: 56, textAlign: 'center', color: tierColor[e.tier] }}>{tierLabel[e.tier]}</span>
                    <span style={{ width: 80, textAlign: 'center' }}>
                      {e.sustained ? <Tag color="gold">持续膨胀</Tag> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <div>
          <Card bordered={false} style={{ marginBottom: 20 }}>
            <Breadcrumb
              items={crumbs.map((_, i) => {
                const p = crumbs.slice(0, i + 1).join('\\');
                return {
                  title: <a onClick={() => openDir(p === 'c:' ? 'c:\\' : p)}>{crumbs[i]}</a>,
                };
              })}
            />
          </Card>
          <Row gutter={20}>
            <Col span={16}>
              <Card
                bordered={false}
                title={
                  // 整段「图标 + 标题文字」都触发打开当前目录（hover 时整段变蓝色下划线）
                  <PathLink
                    path={drillPath}
                    leadingIcon
                    title={`打开当前目录：${drillPath}`}
                    style={{ fontSize: 16, fontWeight: 600 }}
                  >
                    {`${drillPath} 子目录增长（${rangeText ?? windowLabel}）`}
                  </PathLink>
                }
              >
                {loadingDir ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Spin />
                  </div>
                ) : dirData && dirData.entries.length === 0 ? (
                  <Empty description="无子目录数据" />
                ) : (
                  <Table<GrowthDirEntry>
                    rowKey="path"
                    columns={columns}
                    dataSource={dirData?.entries ?? []}
                    pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 项` }}
                    onRow={(r) => ({
                      // 整行下钻（「上级目录」列的路径点击已阻断冒泡，仍为打开文件夹）
                      onClick: () => {
                        if (r.hasChildren) openDir(r.path);
                      },
                      style: { cursor: r.hasChildren ? 'pointer' : 'default' },
                    })}
                  />
                )}
              </Card>
            </Col>
            <Col span={8}>
              <Card
                bordered={false}
                title={
                  <PathLink
                    path={drillPath}
                    leadingIcon
                    title={`打开当前目录：${drillPath}`}
                    style={{ fontSize: 16, fontWeight: 600 }}
                  >
                    {`${drillPath} 历史大小趋势`}
                  </PathLink>
                }
              >
                {trend.length >= 2 ? (
                  <TrendChart points={trend} />
                ) : (
                  <Empty description="历史数据不足，暂无趋势" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Card>
            </Col>
          </Row>
          <Button style={{ marginTop: 16 }} onClick={() => setDrillPath(null)}>
            返回排行
          </Button>
        </div>
      )}
    </div>
  );
}
