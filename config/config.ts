import { defineConfig } from '@umijs/max';

export default defineConfig({
  antd: {
    // 必须显式开启，umi 才会渲染 ConfigProvider，src/app.tsx 中的 theme 才会生效
    configProvider: {},
  },
  // 显式启用 model 插件（enableBy: config），useModel 才可用
  model: {},
  npmClient: 'npm',
  // 开发模式：/api 请求转发到本地 Node 服务
  proxy: {
    '/api': {
      target: 'http://localhost:8090',
      changeOrigin: true,
    },
  },
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: '概览', component: './Dashboard' },
    { path: '/folders', name: '目录排行', component: './Folders' },
    { path: '/trends', name: '趋势分析', component: './Trends' },
    { path: '/large-files', name: '大文件', component: './LargeFiles' },
    { path: '/cleanup', name: '清理建议', component: './Cleanup' },
    { path: '/guide', name: '操作手册', component: './Guide' },
    { path: '/history', name: '历史快照', component: './History' },
    // 桌面悬浮小组件页：无布局、不进主导航菜单
    { path: '/widget', component: './Widget', layout: false },
  ],
});
