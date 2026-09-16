import { formatGB } from '@/utils/format';

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
            borderRadius: 8,
            padding: '2px 4px',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => {
            if (onItemClick) e.currentTarget.style.background = 'rgba(38,151,255,0.06)';
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
            <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
              {formatGB(it.sizeGB)}
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${(it.sizeGB / max) * 100}%`,
                height: '100%',
                borderRadius: 4,
                background: it.color || '#2697FF',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
