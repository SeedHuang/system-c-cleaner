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

  return { data, scanning, loading, error, refresh, startScan };
}
