# Task 9 Brief: 一键提权重启（UAC 弹窗）+ 自动重扫

项目：d:\Seed\system-c-cleaner。用户确认的新功能：概览页「未扫描目录」提示条加「一键以管理员身份重扫」按钮，点击触发系统 UAC 授权弹窗；用户确认后，旧服务退出，以管理员身份启动新服务并自动重新扫描；完成后页面自动刷新数据。**一次提权后，后续普通「重新扫描」都在管理员模式下执行，不再弹 UAC。**

## 架构（控制器已设计，按此实现）

提权交接用「标志文件」握手，避免端口冲突与死锁：

1. `POST /api/elevate-restart`（旧服务，非提权）→ `spawn powershell -Command "Start-Process powershell -Verb RunAs ... relaunch-admin.ps1 -OldPid <pid>"` → 触发 UAC 弹窗 → 立即返回 200 `{ ok, elevatedScan:'running' }`。
2. 旧服务每 1s 检查标志文件 `history/.elevated-launch.flag`：出现 → 1s 后 `process.exit(0)`；60s 内未出现（UAC 被取消）→ `elevatedScan='cancelled'`，保持服务。
3. 提权后的 `relaunch-admin.ps1`：先写标志文件（证明提权成功）→ 等旧进程退出（最多 30s，保证 8090 释放）→ `Start-Process node server/index.js --scan-on-start -WindowStyle Hidden`。
4. 新服务（提权）启动：删除标志文件 → 监听 8090 → `--scan-on-start` 触发 `scanOnce()`（自动 runScan + buildSnapshot，`scanning=true` 期间 `/api/status` 返回 `scanning:true`）。
5. 前端轮询 `/api/status`：旧服务消失（fetch 失败）→「重启中」；新服务 `scanning:true` →「扫描中」；`scanning:false` → 完成 → `refresh()` 拉新数据。

## 环境注意（重要）

- **禁止 git**：跳过所有 commit 步骤。
- 运行测试：`npm test`；前端：`npx tsc --noEmit --pretty`。
- 禁止安装 npm 依赖；不运行 npm install / postinstall。
- **不要在测试中触发 UAC**（`POST /api/elevate-restart` 会弹系统授权窗）；只测纯函数 `buildElevateCommand` 与 `/api/status` 字段。
- **不要编辑 `scripts/scan-c.ps1`**（UTF-8 BOM 保护，见项目约定）。
- 新 ps1 文件必须**纯 ASCII 内容**（无中文注释），避免 PowerShell 5.1 编码问题。
- 文件编辑用 Write/SearchReplace 工具；同一文件禁止并行 SearchReplace；本任务对 `server/index.js`、`src/pages/Dashboard/index.tsx` 用**整体 Write 覆盖**（避免多处非连续 SearchReplace 的合并问题）。
- 不要派生子代理。

## Files

- Create: `scripts/relaunch-admin.ps1`（纯 ASCII）
- Modify: `server/index.js`（整体覆盖，完整新内容见下）
- Modify: `src/services/scan.ts`（加字段 + 函数，一次 SearchReplace）
- Modify: `src/pages/Dashboard/index.tsx`（整体覆盖，完整新内容见下）
- Modify: `server/tests/api.test.js`（追加 2 个用例）
- Modify: `docs/superpowers/specs/2026-09-16-growth-history-design.md`（§1.1 表格行与 §6.3 更新为「一键提权重启」）

## Steps

### Step 1: 创建 scripts/relaunch-admin.ps1

**纯 ASCII 内容**（无中文，无 BOM 依赖）：

```powershell
# Relaunch the C-drive analyzer server with administrator privileges.
# Triggered via Start-Process -Verb RunAs (UAC prompt); runs hidden.
param([int]$OldPid)

$ErrorActionPreference = 'SilentlyContinue'
$root  = Split-Path $PSScriptRoot -Parent
$flag  = Join-Path $root 'history\.elevated-launch.flag'

# 1) Prove elevation succeeded: write the flag file (old server watches it).
New-Item -ItemType Directory -Force -Path (Split-Path $flag -Parent) | Out-Null
Set-Content -Path $flag -Value 'start' -Encoding ascii

# 2) Wait for the old server process to exit so port 8090 is free (max 30s).
for ($i = 0; $i -lt 60; $i++) {
    if (-not (Get-Process -Id $OldPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
}

# 3) Start the new (elevated) server; it will auto-scan once on startup.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'node' }
Start-Process -FilePath $node -ArgumentList 'server/index.js','--scan-on-start' -WorkingDirectory $root -WindowStyle Hidden
```

### Step 2: 写失败测试（追加到 server/tests/api.test.js 末尾）

```js
test('GET /api/status 包含 elevatedScan 字段', async () => {
  const res = await fetch(`${base}/api/status`);
  const body = await res.json();
  assert.strictEqual(body.elevatedScan, 'idle');
});

test('buildElevateCommand 构造 UAC 命令', () => {
  const { buildElevateCommand } = require('../index.js');
  const cmd = buildElevateCommand(12345);
  assert.ok(cmd.includes('-Verb RunAs'));
  assert.ok(cmd.includes("'-OldPid','12345'"));
});
```

Run: `node --test server/tests/api.test.js`
Expected: FAIL（`elevatedScan` undefined / `buildElevateCommand is not a function`）

### Step 3: 整体覆盖 server/index.js

完整新内容（在现有基础上新增：SCAN_ON_START、elevatedScan 状态、ELEVATE_SCRIPT/ELEVATE_FLAG、scanOnce、buildElevateCommand、POST /api/elevate-restart、/api/status 加 elevatedScan、startServer 删标志 + scan-on-start、main-guard 加提权看门狗、exports 加 buildElevateCommand）：

```js
/**
 * C 盘分析 - 本地 API 服务
 * 职责：
 *  - POST /api/scan  触发 PowerShell 只读扫描（防并发），成功后自动记录全树历史快照
 *  - GET  /api/scan  返回缓存结果
 *  - GET  /api/status 是否已有结果
 *  - GET  /api/history / DELETE /api/history  历史快照列表与删除
 *  - GET  /api/growth[/dir|/trend]  增长分析
 *  - POST /api/elevate-restart  一键以管理员身份重启（UAC）并自动重扫
 *  - 生产模式托管 dist/ 静态资源（SPA fallback）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const history = require('./history');

const PORT = process.env.PORT || 8090;
const ROOT = path.join(__dirname, '..');
const RESULT_FILE = path.join(ROOT, 'scan-result.json');
const PS_SCRIPT = path.join(ROOT, 'scripts', 'scan-c.ps1');
const DIST_DIR = path.join(ROOT, 'dist');
const ELEVATE_SCRIPT = path.join(ROOT, 'scripts', 'relaunch-admin.ps1');
const ELEVATE_FLAG = path.join(ROOT, 'history', '.elevated-launch.flag');

// 以管理员身份启动时自动重扫一次
const SCAN_ON_START = process.argv.includes('--scan-on-start');

let scanning = false;
let elevatedScan = 'idle'; // idle | running | cancelled
let elevateStartedAt = 0;

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    // PowerShell WriteAllText 可能写出 BOM，JSON.parse 前必须去掉
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** 调用 PowerShell 扫描脚本，返回 Promise */
function runScan() {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT],
      { cwd: ROOT, windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => (stdout += d.toString()));
    ps.stderr.on('data', (d) => (stderr += d.toString()));
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code === 0 && fs.existsSync(RESULT_FILE)) {
        resolve(readJson(RESULT_FILE));
      } else {
        reject(new Error(`扫描失败 (exit ${code}): ${stderr || stdout}`));
      }
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
  });
}

// ---- 静态资源 / SPA fallback（生产模式） ----
function serveStatic(req, res) {
  if (!fs.existsSync(DIST_DIR)) {
    sendJson(res, 404, { error: '未找到构建产物，开发模式请使用 max dev' });
    return;
  }
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.json': 'application/json; charset=utf-8',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(file).pipe(res);
    return;
  }
  // SPA fallback
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(path.join(DIST_DIR, 'index.html')).pipe(res);
}

/** 提权成功后自动重扫：--scan-on-start 启动时调用 */
function scanOnce() {
  if (scanning) return;
  scanning = true;
  console.log('[server] 管理员模式启动，自动重新扫描…');
  runScan()
    .then(async (data) => {
      let snapshotWarning = null;
      try {
        await history.buildSnapshot({ scannedAt: data.scannedAt, disk: data.disk });
      } catch (e) {
        snapshotWarning = `历史快照记录失败: ${e.message}`;
        console.warn('[history]', snapshotWarning);
      }
      console.log('[server] 自动扫描完成');
    })
    .catch((err) => console.error('[server] 自动扫描失败:', err.message))
    .finally(() => {
      scanning = false;
    });
}

/** 构造触发 UAC 提权的命令（纯函数，可单测） */
function buildElevateCommand(pid) {
  return `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${ELEVATE_SCRIPT}','-OldPid','${pid}'`;
}

// ---- 路由 ----
async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (req.method === 'GET' && p === '/api/status') {
      const data = readJson(RESULT_FILE);
      sendJson(res, 200, {
        hasResult: !!data,
        scanning,
        scannedAt: data?.scannedAt || null,
        disk: data?.disk || null,
        elevatedScan,
      });
      return;
    }

    if (req.method === 'GET' && p === '/api/scan') {
      const data = readJson(RESULT_FILE);
      if (!data) {
        sendJson(res, 404, { error: '尚无扫描结果，请先触发扫描', scanning });
        return;
      }
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && p === '/api/history') {
      sendJson(res, 200, history.listSnapshots());
      return;
    }

    if (req.method === 'DELETE' && p === '/api/history') {
      const filter = await readBody(req);
      sendJson(res, 200, history.deleteSnapshots(filter));
      return;
    }

    if (req.method === 'GET' && p === '/api/growth') {
      const window = url.searchParams.get('window') || '1m';
      const top = Math.min(Math.max(Number(url.searchParams.get('top')) || 20, 1), 100);
      sendJson(res, 200, await history.computeGrowthTop({ window, top }));
      return;
    }

    if (req.method === 'GET' && p === '/api/growth/dir') {
      const path_ = url.searchParams.get('path') || 'c:\\';
      const window = url.searchParams.get('window') || '1m';
      sendJson(res, 200, await history.computeGrowthDir({ path: path_, window }));
      return;
    }

    if (req.method === 'GET' && p === '/api/growth/trend') {
      const path_ = url.searchParams.get('path') || 'c:\\';
      const points = Math.min(Math.max(Number(url.searchParams.get('points')) || 60, 5), 120);
      sendJson(res, 200, await history.computeGrowthTrend({ path: path_, points }));
      return;
    }

    if (req.method === 'POST' && p === '/api/scan') {
      if (scanning) {
        sendJson(res, 409, { error: '扫描正在进行中，请稍候' });
        return;
      }
      scanning = true;
      runScan()
        .then(async (data) => {
          let snapshotWarning = null;
          try {
            await history.buildSnapshot({ scannedAt: data.scannedAt, disk: data.disk });
          } catch (e) {
            snapshotWarning = `历史快照记录失败: ${e.message}`;
            console.warn('[history]', snapshotWarning);
          }
          scanning = false;
          sendJson(res, 200, { ok: true, ...data, snapshotWarning });
        })
        .catch((err) => {
          scanning = false;
          sendJson(res, 500, { error: err.message });
        });
      return;
    }

    if (req.method === 'POST' && p === '/api/elevate-restart') {
      if (elevatedScan === 'running') {
        sendJson(res, 409, { error: '提权重启正在进行中，请稍候' });
        return;
      }
      if (fs.existsSync(ELEVATE_FLAG)) {
        try { fs.unlinkSync(ELEVATE_FLAG); } catch {}
      }
      elevatedScan = 'running';
      elevateStartedAt = Date.now();
      spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', buildElevateCommand(process.pid)],
        { windowsHide: true },
      );
      console.log('[server] 已请求以管理员身份重启，等待 UAC 授权…');
      sendJson(res, 200, { ok: true, elevatedScan });
      return;
    }

    if (p.startsWith('/api/')) {
      sendJson(res, 404, { error: `未知接口: ${p}` });
      return;
    }

    serveStatic(req, res);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}

function startServer(port = PORT) {
  if (fs.existsSync(ELEVATE_FLAG)) {
    try { fs.unlinkSync(ELEVATE_FLAG); } catch {}
  }
  const server = http.createServer(handle);
  server.listen(port, () => {
    console.log(`[server] C盘分析 API 服务已启动: http://localhost:${port}`);
    if (SCAN_ON_START) scanOnce();
  });
  return server;
}

if (require.main === module) {
  startServer(PORT);
  // 非提权模式下监控提权确认标志：确认后本服务退出，由提权服务接管 8090
  if (!SCAN_ON_START) {
    setInterval(() => {
      if (elevatedScan !== 'running') return;
      if (fs.existsSync(ELEVATE_FLAG)) {
        console.log('[server] 已确认提权，旧服务 1 秒后退出，由管理员服务接管');
        setTimeout(() => process.exit(0), 1000);
      } else if (Date.now() - elevateStartedAt > 60000) {
        elevatedScan = 'cancelled';
        console.log('[server] 提权未确认（UAC 可能被取消），保持当前服务');
      }
    }, 1000);
  }
} else {
  module.exports = { startServer, buildElevateCommand };
}
```

### Step 4: 修改 src/services/scan.ts（一次 SearchReplace）

把：

```ts
export interface ScanStatus {
  hasResult: boolean;
  scanning: boolean;
  scannedAt: string | null;
  disk: ScanResult['disk'] | null;
}
```

改为：

```ts
export interface ScanStatus {
  hasResult: boolean;
  scanning: boolean;
  scannedAt: string | null;
  disk: ScanResult['disk'] | null;
  elevatedScan?: 'idle' | 'running' | 'cancelled';
}
```

再在 `triggerScan` 函数后追加（第二次 SearchReplace，顺序执行）：

```ts
export function elevateRestart(): Promise<{ ok: boolean; elevatedScan: string }> {
  return request<{ ok: boolean; elevatedScan: string }>('/api/elevate-restart', { method: 'POST' });
}
```

### Step 5: 整体覆盖 src/pages/Dashboard/index.tsx

完整新内容（新增：`useState/useCallback/useEffect`、`getStatus/elevateRestart`、`refresh`、提权状态机与轮询、提示条加按钮）：

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useModel, useNavigate } from '@umijs/max';
import { Button, Card, Col, Empty, Row, Spin } from 'antd';
import {
  DatabaseOutlined,
  HddOutlined,
  PieChartOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import BarList from '@/components/BarList';
import StatCard from '@/components/StatCard';
import StorageDonut from '@/components/StorageDonut';
import { cleanupLevels, figmaColors } from '@/setup/theme';
import { formatGB } from '@/utils/format';
import { elevateRestart, getStatus } from '@/services/scan';

const barColors = [
  '#2697FF', '#3AA0FF', '#4FA9FF', '#63B2FF', '#79DFFF',
  '#8FD9FF', '#A6C8E8', '#B5C9DB',
];

const levelOrder = ['safe', 'caution', 'keep', 'never'] as const;

type ElevatePhase = 'idle' | 'requesting' | 'waiting' | 'restarting' | 'scanning' | 'done' | 'cancelled' | 'failed';

export default function DashboardPage() {
  const { data, loading, scanning, startScan, refresh } = useModel('scan');
  const navigate = useNavigate();
  const [elevate, setElevate] = useState<ElevatePhase>('idle');
  const [elevateMsg, setElevateMsg] = useState<string | null>(null);

  const handleElevate = useCallback(async () => {
    setElevate('requesting');
    setElevateMsg(null);
    try {
      await elevateRestart();
      setElevate('waiting');
      setElevateMsg('请在系统授权窗口点击「是」，应用将以管理员身份重启并自动重新扫描…');
    } catch {
      setElevate('failed');
      setElevateMsg('请求失败，请重试');
    }
  }, []);

  // 提权重启后轮询状态：旧服务退出 → 新服务扫描中 → 完成刷新
  useEffect(() => {
    if (elevate !== 'waiting' && elevate !== 'restarting' && elevate !== 'scanning') return;
    const timer = setInterval(async () => {
      try {
        const st = await getStatus();
        if (st.elevatedScan === 'cancelled') {
          setElevate('cancelled');
          setElevateMsg('授权被取消或超时，可重试，或手动以管理员身份运行');
        } else if (st.scanning) {
          setElevate('scanning');
          setElevateMsg('正在以管理员身份重新扫描（约 1~3 分钟），完成后自动更新数据…');
        } else if (elevate === 'scanning') {
          setElevate('done');
          setElevateMsg('提权重扫完成，数据已更新');
          refresh();
        }
      } catch {
        setElevate('restarting');
        setElevateMsg('应用正在以管理员身份重启…');
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [elevate, refresh]);

  if (loading) {
    return (
      <Card bordered={false} style={{ textAlign: 'center', padding: '60px 0' }}>
        <Spin tip="读取扫描结果…" />
      </Card>
    );
  }

  if (!data) {
    return (
      <Card bordered={false} style={{ marginTop: 60 }}>
        <Empty description="还没有扫描数据">
          <Button
            type="primary"
            icon={<DatabaseOutlined />}
            loading={scanning}
            onClick={startScan}
          >
            {scanning ? '正在扫描，请稍候…' : '开始扫描 C 盘'}
          </Button>
          <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
            只读扫描，不会删除、移动或修改任何文件，预计 1~3 分钟
          </div>
        </Empty>
      </Card>
    );
  }

  const { disk, topFolders, items } = data;

  // 空间构成：按清理分类聚合
  const byLevel: Record<string, number> = { safe: 0, caution: 0, keep: 0, never: 0 };
  items.forEach((it) => {
    if (it.sizeGB != null) byLevel[it.level] += it.sizeGB;
  });
  const round1 = (n: number) => +n.toFixed(1);
  const segments = levelOrder.map((lv) => ({
    label: cleanupLevels[lv].label,
    value: round1(byLevel[lv]),
    color: cleanupLevels[lv].color,
    level: lv,
  }));

  // 顶层目录条形图（有数据的取前 10）
  const folders = topFolders
    .filter((f) => f.sizeGB != null)
    .sort((a, b) => (b.sizeGB ?? 0) - (a.sizeGB ?? 0))
    .slice(0, 10)
    .map((f, i) => ({
      name: f.name,
      path: f.path,
      sizeGB: f.sizeGB as number,
      color: barColors[i % barColors.length],
    }));

  const unscannedCount = topFolders.filter((f) => f.status === 'unscanned').length;

  return (
    <div>
      <Row gutter={20}>
        <Col span={6}>
          <StatCard
            title="总容量"
            value={formatGB(disk.totalGB)}
            sub="C盘"
            color={figmaColors.primary}
            icon={<DatabaseOutlined />}
          />
        </Col>
        <Col span={6}>
          <StatCard
            title="已使用"
            value={formatGB(disk.usedGB)}
            sub={`占 ${disk.totalGB ? ((disk.usedGB / disk.totalGB) * 100).toFixed(1) : 0}%`}
            color={figmaColors.orange}
            icon={<PieChartOutlined />}
          />
        </Col>
        <Col span={6}>
          <StatCard
            title="可用空间"
            value={formatGB(disk.freeGB)}
            sub="当前剩余"
            color={figmaColors.green}
            icon={<HddOutlined />}
          />
        </Col>
        <Col span={6}>
          <StatCard
            title="可安全清理预估"
            value={`${formatGB(byLevel.safe)}`}
            sub="不含谨慎项"
            color={figmaColors.cyan}
            icon={<ThunderboltOutlined />}
          />
        </Col>
      </Row>

      <Row gutter={20} style={{ marginTop: 20 }}>
        <Col span={16}>
          <Card title="顶层目录排行" bordered={false}>
            {folders.length ? (
              <BarList
                items={folders}
                onItemClick={(f) => navigate(`/folders?name=${encodeURIComponent(f.name)}`)}
              />
            ) : (
              <Empty description="暂无目录数据（可能需要管理员权限）" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
            {unscannedCount > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'rgba(255,207,38,0.12)',
                  border: '1px solid rgba(255,207,38,0.35)',
                  color: '#FFD666',
                  fontSize: 13,
                }}
              >
                <div>检测到 {unscannedCount} 个目录因权限不足未扫描，以管理员身份重新扫描可获得更完整数据。</div>
                <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    icon={<DatabaseOutlined />}
                    loading={elevate === 'requesting'}
                    disabled={elevate === 'waiting' || elevate === 'restarting' || elevate === 'scanning'}
                    onClick={handleElevate}
                  >
                    一键以管理员身份重扫
                  </Button>
                  {elevateMsg && <span style={{ color: 'rgba(255,255,255,0.75)' }}>{elevateMsg}</span>}
                </div>
              </div>
            )}
          </Card>
          <Card title="空间构成（按清理分类）" bordered={false} style={{ marginTop: 20 }}>
            <BarList
              items={segments.map((s) => ({ name: s.label, sizeGB: s.value, color: s.color, level: s.level }))}
              onItemClick={(it) => it.level && navigate(`/cleanup?level=${it.level}`)}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false}>
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>存储用量</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>已用空间构成</div>
            </div>
            <StorageDonut
              segments={segments}
              centerTitle={formatGB(disk.usedGB)}
              centerSub={`共 ${formatGB(disk.totalGB)}`}
              onSegmentClick={(seg) => seg.level && navigate(`/cleanup?level=${seg.level}`)}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
```

### Step 6: 更新规格文档

`docs/superpowers/specs/2026-09-16-growth-history-design.md`：
- §1.1 表格行 `权限不足目录 | 保持"跳过+标注"，UI 提供**以管理员身份运行**的引导提示` 改为 `权限不足目录 | 保持"跳过+标注"，UI 提供**一键以管理员身份重启并自动重扫**（UAC 弹窗，一次性提权）`
- §6.3 整节替换为：

```markdown
### 6.3 一键提权重启（UAC）

概览页存在未扫描目录（`unscannedDirs > 0`）时，提示条提供「一键以管理员身份重扫」按钮：
- 点击触发系统 UAC 授权弹窗；确认后旧服务退出，以管理员身份启动新服务并自动重新扫描（`--scan-on-start`），完成后页面自动刷新数据
- 一次性提权：之后普通「重新扫描」均在管理员模式下执行，不再弹 UAC
- UAC 取消/超时（60s）：旧服务保持运行，提示「授权被取消」，可重试或手动以管理员身份运行
```

### Step 7: 验证

Run（依次）：
```bash
node --test server/tests/api.test.js
npm test
npx tsc --noEmit --pretty 2>&1 | Select-String "src/pages/Dashboard|src/services/scan"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$null = [scriptblock]::Create((Get-Content -Raw 'scripts\relaunch-admin.ps1'))"
```
Expected：
- api.test.js 5 用例通过；npm test 全部 18 用例通过（13 history + 5 api）
- tsc 无 Dashboard/services 相关错误
- ps1 语法校验无报错（仅验证语法，不执行）

**不要**运行 `POST /api/elevate-restart`（会弹 UAC）；**不要**运行 `npm run server -- --scan-on-start`（会触发真实全盘扫描）。

### Step 8: 提交（跳过）

本环境 git 不可用，**跳过 commit**。

## 报告契约

完成后在 `.superpowers/sdd/2026-09-16-growth-history/task-9-report.md` 写入完整报告（实现说明、各验证命令输出摘要、任何偏差或顾虑），然后返回：状态（DONE / DONE_WITH_CONCERNS / BLOCKED）、验证摘要一行、顾虑（如有）。不要派生子代理，不要运行 git，不要安装依赖，不要触发 UAC 或真实扫描。
