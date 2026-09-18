// 视频资源（robot.mp4 动画头像）走 webpack asset/resource
// 注意：通配符模块声明必须放在全局脚本文件（无 import/export），放在含 import 的 typings.d.ts 中会失效
declare module '*.mp4';
