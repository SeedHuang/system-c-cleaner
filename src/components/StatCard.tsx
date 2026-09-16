import type { ReactNode } from 'react';
import { figmaColors } from '@/setup/theme';

interface Props {
  title: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: ReactNode;
}

/** 概览统计卡片 */
export default function StatCard({ title, value, sub, color, icon }: Props) {
  return (
    <div
      style={{
        background: figmaColors.bgContainer,
        borderRadius: 10,
        padding: '18px 20px',
        border: `1px solid ${figmaColors.borderPrimary}`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      {icon && (
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: color ? `${color}1F` : 'rgba(38,151,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color || figmaColors.primary,
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: figmaColors.textSecondary }}>{title}</div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </div>
        {sub && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{sub}</div>
        )}
      </div>
    </div>
  );
}
