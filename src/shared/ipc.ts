/**
 * 主进程 ⇄ 预加载脚本的 IPC 通道名。
 * 注意：预加载脚本运行在 sandbox 模式，不能 require 本文件，
 * 因此 src/preload/index.ts 内联了一份同样的常量，改动时需同步。
 */
export const IPC = {
  /** 渲染进程 → 主进程：拖放的文件绝对路径 */
  dropPaths: 'desktop:drop-paths',
  /** 渲染进程 → 主进程：用系统默认程序打开路径 */
  openPath: 'desktop:open-path',
  /** 渲染进程 → 主进程：在资源管理器中显示路径 */
  showItemInFolder: 'desktop:show-item-in-folder',
  /** 渲染进程 → 主进程 (invoke)：弹出目录选择框，返回路径或 null */
  pickDirectory: 'desktop:pick-directory',
  /** 主进程 → 渲染进程：dsh 状态变化广播 */
  stateChanged: 'desktop:state-changed',
  /** 渲染进程 → 主进程 (invoke)：读取当前状态 */
  getStatus: 'desktop:get-status',
  /** 渲染进程 → 主进程 (invoke)：应用与 dsh 版本信息 */
  appInfo: 'desktop:app-info',
} as const;

export interface AppInfo {
  appVersion: string;
  dshVersion: string | null;
  platform: string;
}
