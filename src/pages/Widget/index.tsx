import React, { useCallback, useEffect, useRef, useState } from 'react';
import './index.css';

interface DiskInfo {
  totalGB: number;
  usedGB: number;
  freeGB: number;
}
interface FolderInfo {
  name: string;
  sizeGB: number;
}
interface ScanResult {
  scannedAt?: string;
  disk?: DiskInfo;
  topFolders?: FolderInfo[];
}

const fmtGB = (gb: number) =>
  gb >= 1024 ? `${(gb / 1024).toFixed(1)} TB` : `${gb.toFixed(0)} GB`;

declare global {
  interface Window {
    widgetAPI?: {
      openMain?: () => void;
      dragStart?: (screenX: number, screenY: number) => void;
      dragMove?: (screenX: number, screenY: number) => void;
      dragEnd?: () => void;
    };
  }
}

// 死区：3px 内的按下 + 释放 = 双击候选；超过 3px 进入拖拽模式（屏蔽双击）。
// 太小（<2）容易误触拖拽，太大（>5）双击需要刻意放慢。
const DRAG_DEADZONE_PX = 3;

export default function WidgetPage() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [hasResult, setHasResult] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/scan');
      if (!res.ok) {
        setData(null);
        setHasResult(false);
        return;
      }
      const body: ScanResult = await res.json();
      setData(body);
      setHasResult(true);
    } catch {
      setData(null);
      setHasResult(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // 每 60s 轮询
    return () => clearInterval(t);
  }, [load]);

  const openMain = () => window.widgetAPI?.openMain?.();

  // 拖拽状态：用 ref 而非 state，避免 React 重渲染影响 pointer 事件流。
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  // 刚结束拖拽的时间戳：拖拽松手产生的 click 会与下一次快速点击凑成 dblclick。
  // 不能用 dragRef.current?.dragging 判断——handlePointerEnd 在 dblclick 前的 pointerup
  // 就已清空 dragRef，那个守卫永远不可达（code review 发现）。
  const lastDragEndRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 只响应鼠标左键（button===0）/ 主指针。注意 isPrimary 对鼠标不区分按键（右键也是 true），
    // 必须额外检查 button，否则按住右键移动会拖着窗口跑。
    if (!e.isPrimary || e.button !== 0) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.screenX,
      startY: e.screenY,
      dragging: false,
    };
    // 捕获在稳定的卡片容器上（而非会随 60s 轮询重渲染卸载的子节点 e.target），
    // 否则捕获节点 unmount 会隐式释放捕获，pointerup 丢失导致拖拽状态卡死
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointerId 已失效（理论少见）：忽略，后续事件仍会派发到卡片
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.screenX - s.startX;
    const dy = e.screenY - s.startY;
    if (!s.dragging) {
      // 死区：未超过 DRAG_DEADZONE_PX 视作点击候选（保持 dblclick 可触发）
      if (Math.abs(dx) < DRAG_DEADZONE_PX && Math.abs(dy) < DRAG_DEADZONE_PX) return;
      s.dragging = true;
      window.widgetAPI?.dragStart?.(s.startX, s.startY);
    }
    window.widgetAPI?.dragMove?.(e.screenX, e.screenY);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    if (s.dragging) {
      window.widgetAPI?.dragEnd?.();
      lastDragEndRef.current = Date.now();
    }
    dragRef.current = null;
  };

  const handleDoubleClick = () => {
    // 拖拽刚结束时其松手 click 会与后续快速点击凑成 dblclick，400ms 内忽略
    if (Date.now() - lastDragEndRef.current < 400) return;
    openMain();
  };

  const disk = data?.disk;
  const usedPct =
    disk && disk.totalGB > 0 ? Math.min(100, Math.round((disk.usedGB / disk.totalGB) * 100)) : 0;
  const top = (data?.topFolders || []).slice(0, 3);

  return (
    <div
      className="widget-card"
      title="双击打开主窗口，按住拖拽移动"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onDoubleClick={handleDoubleClick}
    >
      <div className="widget-title">C 盘空间</div>
      {!hasResult ? (
        <div className="widget-empty">暂无数据，双击打开主窗口扫描</div>
      ) : disk ? (
        <>
          <div className="widget-bar-row">
            <div className="widget-bar">
              <div className="widget-bar-fill" style={{ width: `${usedPct}%` }} />
            </div>
            <div className="widget-pct">{usedPct}%</div>
          </div>
          <div className="widget-stats">
            <span>已用 {fmtGB(disk.usedGB)}</span>
            <span>剩余 {fmtGB(disk.freeGB)}</span>
          </div>
          {top.length > 0 && (
            <div className="widget-tops">
              {top.map((f, i) => (
                <div className="widget-top" key={i}>
                  <span className="widget-top-name">{f.name}</span>
                  <span className="widget-top-size">{fmtGB(f.sizeGB ?? 0)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="widget-empty">加载中…</div>
      )}
    </div>
  );
}
