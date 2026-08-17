/**
 * 在线更新：electron-updater（GitHub Releases 更新源）。
 *
 * 更新源与校验信息由 electron-builder 打包时生成并内置：
 * - resources/app-update.yml —— 发布源配置（publish: github）；
 * - 每次发布随安装包一起上传 latest.yml 与 .blockmap（发布脚本负责）。
 *
 * 仅在打包产物中启用（开发模式跳过）。
 */
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { notify } from './notifications';

export interface UpdaterCallbacks {
  /** 实时读取通知开关 */
  notificationsEnabled(): boolean;
  /** 更新就绪状态变化（驱动托盘“重启并安装更新”菜单项），null = 无待装更新 */
  onUpdateReady(info: { version: string } | null): void;
  /** 下载进度 0-100（已节流） */
  onProgress(percent: number): void;
}

let readyVersion: string | null = null;
let lastProgressNotify = 0;

/** 启动时初始化：注册事件 + 延迟自动检查（受设置 autoUpdate 控制） */
export function initAutoUpdater(cb: UpdaterCallbacks, autoUpdateEnabled: boolean): void {
  if (!app.isPackaged) {
    console.log('[updater] 开发模式，跳过在线更新');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] 发现新版本 ${info.version}`);
    notify(cb.notificationsEnabled(), '发现新版本', `v${info.version} 正在后台下载…`);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] 已是最新版本');
  });

  autoUpdater.on('download-progress', (p) => {
    if (p.percent >= lastProgressNotify + 10) {
      lastProgressNotify = Math.floor(p.percent);
      cb.onProgress(p.percent);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version;
    cb.onUpdateReady({ version: info.version });
    notify(
      cb.notificationsEnabled(),
      '更新已就绪',
      `v${info.version} 已下载，退出应用时自动安装；也可从托盘「重启并安装更新」立即安装`,
    );
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] 更新检查失败:', err.message);
  });

  if (!autoUpdateEnabled) {
    console.log('[updater] 设置关闭了自动检查更新，仅保留手动检查');
    return;
  }
  // 启动 15s 后（dsh 已就绪时）后台检查
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error('[updater] 启动检查失败:', err.message);
    });
  }, 15_000);
}

/** 手动检查（托盘/菜单入口）；无更新时给出明确反馈 */
export async function checkForUpdatesNow(cb: Pick<UpdaterCallbacks, 'notificationsEnabled'>): Promise<void> {
  if (!app.isPackaged) {
    notify(cb.notificationsEnabled(), '开发模式', '在线更新仅在安装版中可用');
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result === null) {
      notify(cb.notificationsEnabled(), '已是最新版本', `当前 v${app.getVersion()}`);
    }
    // 有更新时走 update-available → update-downloaded 事件链
  } catch (err) {
    notify(cb.notificationsEnabled(), '检查更新失败', (err as Error).message);
  }
}

/** 立即重启并安装已下载的更新（无待装更新时为空操作） */
export function quitAndInstall(): void {
  if (readyVersion !== null) {
    autoUpdater.quitAndInstall();
  }
}

/** 已就绪的更新版本号（未就绪返回 null） */
export function getReadyVersion(): string | null {
  return readyVersion;
}
