import { useMemo } from 'react';
import { cyberColors, cyberFontStack } from '@/setup/theme';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
  level?: string;
}

interface Props {
  segments: DonutSegment[];
  centerTitle: string;
  centerSub: string;
  size?: number;
  onSegmentClick?: (seg: DonutSegment) => void;
}

/** Figma 风格的同心圆环存储用量图（每个圆环代表一个分类，点击下钻） */
export default function StorageDonut({
  segments,
  centerTitle,
  centerSub,
  size = 300,
  onSegmentClick,
}: Props) {
  const strokeWidth = 22;
  const gap = 8;

  const rings = useMemo(() => {
    const R = size / 2 - strokeWidth / 2;
    const totalValue = segments.reduce((s, seg) => s + seg.value, 0) || 1;
    return segments.map((seg, i) => {
      const r = R - i * (strokeWidth + gap);
      const circ = 2 * Math.PI * r;
      const pct = Math.max(0, Math.min(1, seg.value / totalValue));
      return { seg, r, circ, dash: pct * circ };
    });
  }, [segments, size, strokeWidth, gap]);

  const c = size / 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size}>
          {rings.map((ring) => (
            <g
              key={ring.seg.label}
              onClick={() => onSegmentClick?.(ring.seg)}
              style={{ cursor: onSegmentClick ? 'pointer' : 'default' }}
            >
              {/* 底环 */}
              <circle
                cx={c}
                cy={c}
                r={ring.r}
                fill="none"
                stroke="rgba(255,255,255,0.04)"
                strokeWidth={strokeWidth}
              />
              {/* 占比弧 */}
              <circle
                cx={c}
                cy={c}
                r={ring.r}
                fill="none"
                stroke={ring.seg.color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${ring.dash} ${ring.circ - ring.dash}`}
                transform={`rotate(-90 ${c} ${c})`}
              />
            </g>
          ))}
        </svg>
        {/* 中心文字 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: 34,
              fontWeight: 700,
              fontFamily: cyberFontStack,
              color: cyberColors.cyan,
              lineHeight: 1.1,
            }}
          >
            {centerTitle}
          </span>
          <span style={{ fontSize: 13, color: cyberColors.textSecondary, marginTop: 4 }}>
            {centerSub}
          </span>
        </div>
      </div>

      {/* 图例 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px 18px',
          marginTop: 18,
          width: '100%',
        }}
      >
        {segments.map((seg) => (
          <div
            key={seg.label}
            onClick={() => onSegmentClick?.(seg)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: onSegmentClick ? 'pointer' : 'default',
              padding: '2px 4px',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              if (onSegmentClick) e.currentTarget.style.background = cyberColors.hoverRed;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: seg.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, color: cyberColors.textSecondary, flex: 1 }}>
              {seg.label}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                fontFamily: cyberFontStack,
                color: cyberColors.cyan,
              }}
            >
              {seg.value.toFixed(1)} GB
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
