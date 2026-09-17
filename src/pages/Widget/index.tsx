import React, { useCallback, useEffect, useState } from 'react';
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
    widgetAPI?: { openMain?: () => void };
  }
}

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

  const disk = data?.disk;
  const usedPct =
    disk && disk.totalGB > 0 ? Math.min(100, Math.round((disk.usedGB / disk.totalGB) * 100)) : 0;
  const top = (data?.topFolders || []).slice(0, 3);

  return (
    <div className="widget-card" onClick={openMain} title="点击打开主窗口">
      <div className="widget-title">C 盘空间</div>
      {!hasResult ? (
        <div className="widget-empty">暂无数据，点击打开主窗口扫描</div>
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
