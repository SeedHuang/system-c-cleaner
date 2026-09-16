import { theme } from 'antd';

/** Figma 参考稿提取的色板：SaaS - File Management Dashboard (Dark) */
export const figmaColors = {
  bgLayout: '#212332',
  bgContainer: '#2A2D3E',
  bgElevated: '#32364A',
  bgUpgrade: '#34384D',
  primary: '#2697FF',
  primaryDeep: '#377AFF',
  primaryLight: '#46A6FF',
  gradientEnd: '#66B6FF',
  red: '#EE2727',
  yellow: '#FFCF26',
  cyan: '#26E5FF',
  green: '#70CF12',
  orange: '#FFA113',
  text: '#FFFFFF',
  textPrimary: '#F0F0F0',
  textSecondary: '#B5C9DB',
  textMuted: 'rgba(255, 255, 255, 0.6)',
  borderPrimary: 'rgba(38, 151, 255, 0.15)',
  borderWhite: 'rgba(255, 255, 255, 0.1)',
} as const;

/** 四色清理分类 */
export const cleanupLevels = {
  safe: { label: '可安全清理', color: figmaColors.green },
  caution: { label: '谨慎清理', color: figmaColors.yellow },
  keep: { label: '建议保留', color: figmaColors.primary },
  never: { label: '绝对不要动', color: figmaColors.red },
} as const;

export type CleanupLevel = keyof typeof cleanupLevels;

/** antd v5 深色主题 token（对齐 Figma） */
export const figmaTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: figmaColors.primary,
    colorInfo: figmaColors.primary,
    colorLink: figmaColors.primary,
    colorBgLayout: figmaColors.bgLayout,
    colorBgContainer: figmaColors.bgContainer,
    colorBgElevated: figmaColors.bgElevated,
    colorBorder: figmaColors.borderPrimary,
    colorBorderSecondary: figmaColors.borderWhite,
    colorText: figmaColors.textPrimary,
    colorTextSecondary: figmaColors.textSecondary,
    colorTextTertiary: figmaColors.textMuted,
    borderRadius: 10,
    fontSize: 14,
    fontFamily:
      "'Poppins', -apple-system, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif",
    controlHeight: 38,
  },
  components: {
    Layout: {
      siderBg: figmaColors.bgContainer,
      headerBg: figmaColors.bgLayout,
      bodyBg: figmaColors.bgLayout,
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: figmaColors.primary,
      darkItemColor: figmaColors.textMuted,
      darkItemHoverColor: figmaColors.textPrimary,
      itemBorderRadius: 10,
    },
    Table: {
      headerBg: figmaColors.bgElevated,
      rowHoverBg: 'rgba(38, 151, 255, 0.06)',
    },
    Button: {
      primaryShadow: 'none',
    },
  },
};
