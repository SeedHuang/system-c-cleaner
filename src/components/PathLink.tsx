import { useCallback, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { Button, message, Tooltip } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { figmaColors } from '@/setup/theme';
import { openInExplorer } from '@/utils/shell';

type PathLinkProps = {
  /** 要打开的绝对路径（同时作为展示文案） */
  path: string;
  className?: string;
  style?: CSSProperties;
  /** 悬浮提示，默认「点击打开：<path>」 */
  title?: string;
  /** link（默认，可点击文本）| button（纯图标按钮，用于表格「操作」列） */
  variant?: 'link' | 'button';
};

/**
 * 可点击路径：点击后在资源管理器中打开
 * （目录 → 打开该文件夹；文件 → 打开所在文件夹并选中它）
 * 打开失败时统一用 message 提示，页面无需各自处理。
 */
export default function PathLink({ path, className, style, title, variant = 'link' }: PathLinkProps) {
  const [hover, setHover] = useState(false);

  const onClick = useCallback(
    async (e: MouseEvent<HTMLElement>) => {
      // 父级行可能有自己的点击行为（如趋势分析行点击下钻），此处阻断冒泡
      e.stopPropagation();
      const r = await openInExplorer(path);
      if (!r.ok) message.warning(r.error ?? '打开失败');
    },
    [path],
  );

  const tip = title ?? `点击打开：${path}`;

  if (variant === 'button') {
    return (
      <Tooltip title={tip}>
        <Button size="small" type="text" icon={<FolderOpenOutlined />} onClick={onClick} />
      </Tooltip>
    );
  }

  return (
    <span
      className={className}
      title={tip}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...style,
        cursor: 'pointer',
        color: hover ? figmaColors.primary : style?.color,
        textDecoration: hover ? 'underline' : style?.textDecoration,
        transition: 'color 0.15s',
      }}
    >
      {path}
    </span>
  );
}
