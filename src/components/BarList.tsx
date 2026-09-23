import { formatGB } from '@/utils/format';
import { cyberColors, cyberFontStack } from '@/setup/theme';

export interface BarItem {
  name: string;
  path?: string;
  sizeGB: number;
  color?: string;
  level?: string;
}

interface Props {
  items: BarItem[];
  onItemClick?: (item: BarItem) => void;
}

/** 横向条形图列表，支持点击下钻 */
export default function BarList({ items, onItemClick }: Props) {
  const max = Math.max(...items.map((i) => i.sizeGB), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {items.map((it) => (
        <div
          key={it.path || it.name}
          onClick={() => onItemClick?.(it)}
          style={{
            cursor: onItemClick ? 'pointer' : 'default',
            padding: '2px 4px',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => {
            if (onItemClick) e.currentTarget.style.background = cyberColors.hoverRed;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 6,
              alignItems: 'baseline',
            }}
          >
            <span style={{ fontSize: 13, color: '#F0F0F0' }}>{it.name}</span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                fontFamily: cyberFontStack,
                color: cyberColors.cyan,
              }}
            >
              {formatGB(it.sizeGB)}
            </span>
          </div>
          <div
            style={{
              height: 8,
              background: 'rgba(255,255,255,0.06)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${(it.sizeGB / max) * 100}%`,
                height: '100%',
                background: it.color || cyberColors.red,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
