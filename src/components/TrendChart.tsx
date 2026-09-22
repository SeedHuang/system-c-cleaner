import { useMemo } from 'react';
import { formatSize } from '@/utils/format';
import { cyberColors } from '@/setup/theme';

export interface TrendPoint {
  t: string;
  size: number | null;
}

/** 自绘 SVG 折线趋势图（零依赖，离线可用） */
export default function TrendChart({ points, height = 160 }: { points: TrendPoint[]; height?: number }) {
  const view = useMemo(() => {
    const W = 600;
    const H = height;
    const pad = 8;
    const data = points.filter((p): p is { t: string; size: number } => p.size != null);
    if (data.length < 2) return { valid: false, poly: '', minLabel: '', maxLabel: '' };
    const sizes = data.map((d) => d.size);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    const span = max - min || 1;
    const poly = data
      .map((d, i) => {
        const x = pad + (i / (data.length - 1)) * (W - pad * 2);
        const y = H - pad - ((d.size - min) / span) * (H - pad * 2);
        return `${x},${y}`;
      })
      .join(' ');
    return { valid: true, poly, minLabel: formatSize(min), maxLabel: formatSize(max) };
  }, [points, height]);

  if (!view.valid) {
    return <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, padding: 12 }}>数据点不足，无法绘制趋势</div>;
  }
  return (
    <svg viewBox={`0 0 600 ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <polyline points={view.poly} fill="none" stroke={cyberColors.red} strokeWidth={2} />
      <text x={8} y={height - 4} fontSize={10} fill="rgba(255,255,255,0.5)">{view.minLabel}</text>
      <text x={8} y={12} fontSize={10} fill="rgba(255,255,255,0.5)">{view.maxLabel}</text>
    </svg>
  );
}
