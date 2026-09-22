import type { ReactNode } from 'react';
import { cyberColors } from '@/setup/theme';
import { CyberCard } from '@/components/cyber';

interface Props {
  title: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: ReactNode;
}

/** 概览统计卡片（CP2077：红大写标签 + 青色数值） */
export default function StatCard({ title, value, sub, color, icon }: Props) {
  const accent = color ?? cyberColors.cyan;
  return (
    <CyberCard variant="cyan" stripe>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {icon && (
          <div
            style={{
              width: 44,
              height: 44,
              background: `${accent}1F`,
              border: `1px solid ${accent}55`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: accent,
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: cyberColors.red,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              fontFamily: "'Rajdhani', sans-serif",
              color: cyberColors.cyan,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}
          >
            {value}
          </div>
          {sub && <div style={{ fontSize: 11, color: cyberColors.textMuted }}>{sub}</div>}
        </div>
      </div>
    </CyberCard>
  );
}
