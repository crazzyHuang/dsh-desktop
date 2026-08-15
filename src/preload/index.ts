/**
 * 预加载脚本（sandbox 模式）。
 * 注意：sandbox 预加载不能 require 本地模块，因此 IPC 通道名在此内联，
 * 与 src/shared/ipc.ts 保持一致，改动需同步。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';

const IPC = {
  dropPaths: 'desktop:drop-paths',
  openPath: 'desktop:open-path',
  showItemInFolder: 'desktop:show-item-in-folder',
  pickDirectory: 'desktop:pick-directory',
  stateChanged: 'desktop:state-changed',
  getStatus: 'desktop:get-status',
  appInfo: 'desktop:app-info',
} as const;

interface StateListener {
  (info: unknown): void;
}

const stateListeners = new Set<StateListener>();
ipcRenderer.on(IPC.stateChanged, (_event, info: unknown) => {
  for (const fn of stateListeners) {
    try {
      fn(info);
    } catch {
      /* 单个监听器异常不影响其它 */
    }
  }
});

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  /** 应用与 dsh 版本信息 */
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  /** 当前 dsh 状态快照 */
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  /** 订阅 dsh 状态变化，返回取消函数 */
  onStateChanged: (fn: StateListener): (() => void) => {
    stateListeners.add(fn);
    return () => stateListeners.delete(fn);
  },
  /** 用系统默认程序打开路径 */
  openPath: (path: string) => ipcRenderer.send(IPC.openPath, path),
  /** 在资源管理器中显示路径 */
  showItemInFolder: (path: string) => ipcRenderer.send(IPC.showItemInFolder, path),
  /** 弹出系统目录选择框（壳级备用 API；dsh web 自带原生目录选择） */
  pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory),
});

// 文件拖放：拦截 drop，把本地文件绝对路径交给主进程处理
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const dragEvent = event as DragEvent;
  const files = dragEvent.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const paths: string[] = [];
  for (const file of Array.from(files)) {
    try {
      const path = webUtils.getPathForFile(file);
      if (path) paths.push(path);
    } catch {
      /* 非本地文件忽略 */
    }
  }
  if (paths.length > 0) ipcRenderer.send(IPC.dropPaths, paths);
});
