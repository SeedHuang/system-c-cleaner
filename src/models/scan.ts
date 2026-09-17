import { useCallback, useEffect, useState } from 'react';
import { getScan, getStatus, triggerScan } from '@/services/scan';
import type { ScanResult } from '@/services/scan';

/** 全局扫描状态模型（umi model）：所有页面共享一份扫描结果 */
export default function useScanModel() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const d = await getScan();
      setData(d);
    } catch (e) {
      // 尚无结果：不视为错误，仅清空数据
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const startScan = useCallback(async () => {
    try {
      setScanning(true);
      setError(null);
      const d = await triggerScan();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : '扫描失败');
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 轮询 /api/status：托盘/后台触发的扫描，主窗口也能实时显示"扫描中"，
  // 并在扫描结束的那一刻自动拉取最新结果（否则页面仍显示旧数据）
  useEffect(() => {
    let cancelled = false;
    let wasScanning = false;
    const poll = async () => {
      try {
        const st = await getStatus();
        if (cancelled) return;
        const now = !!st.scanning;
        if (wasScanning && !now) refresh();
        wasScanning = now;
        setScanning(now);
      } catch {
        /* 网络异常忽略，下轮再试 */
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [refresh]);

  return { data, scanning, loading, error, refresh, startScan };
}
