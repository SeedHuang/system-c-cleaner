import { CyberCard, SectionTitle } from '@/components/cyber';
import { cyberColors } from '@/setup/theme';

interface Guide {
  title: string;
  steps: string[];
  code?: string;
}

const guides: Guide[] = [
  {
    title: '1. Windows 磁盘清理（最安全，推荐先做）',
    steps: [
      '开始菜单搜索「磁盘清理」，选择 C 盘',
      '勾选「临时文件」「缩略图」「传递优化文件」「系统错误内存转储文件」',
      '点击「清理系统文件」再次扫描，可一并清理 Windows 更新缓存',
    ],
  },
  {
    title: '2. 用 DISM 压缩系统组件（WinSxS）',
    steps: [
      '右键开始菜单 → 终端(管理员) 或 命令提示符(管理员)',
      '粘贴命令回车，等待完成（可能需 10-30 分钟）',
    ],
    code: 'Dism.exe /Online /Cleanup-Image /StartComponentCleanup',
  },
  {
    title: '3. 关闭休眠释放 hiberfil.sys（约等于内存大小）',
    steps: [
      '管理员终端中运行下面命令（恢复休眠用 powercfg /h on）',
    ],
    code: 'powercfg /h off',
  },
  {
    title: '4. 管理系统还原点',
    steps: [
      '设置 → 系统 → 恢复 → 打开「系统还原」→ 配置',
      '删除旧还原点，保留最新 1 个即可',
    ],
  },
  {
    title: '5. 清理微信 / QQ 缓存',
    steps: [
      '微信：设置 → 存储空间 → 管理（聊天中的图片/视频删除后不可恢复）',
      'QQ：设置 → 文件管理 → 清理',
    ],
  },
  {
    title: '6. 清理浏览器缓存',
    steps: [
      'Edge/Chrome：设置 → 隐私搜索和服务 → 清除浏览数据 → 缓存的图片和文件',
    ],
  },
];

export default function GuidePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {guides.map((g) => (
        <CyberCard key={g.title}>
          <SectionTitle style={{ marginBottom: 12 }}>{g.title}</SectionTitle>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.steps.map((s, i) => (
              <li key={i} style={{ fontSize: 13, color: cyberColors.textSecondary, lineHeight: 1.7 }}>
                {s}
              </li>
            ))}
          </ol>
          {g.code && (
            <div style={{ marginTop: 12 }}>
              <div className="guide-code">{g.code}</div>
            </div>
          )}
        </CyberCard>
      ))}
      <CyberCard variant="red">
        <div style={{ fontSize: 13, color: cyberColors.textSecondary, lineHeight: 1.8 }}>
          ⚠️ 安全提醒：以上命令均为官方系统自带功能，但请务必一条条执行、看清说明。
          本工具只做分析，所有清理操作由你自己确认后执行。执行前建议先做系统还原点或备份重要文件。
        </div>
      </CyberCard>
    </div>
  );
}
