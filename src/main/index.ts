/**
 * DeepSeek Harness Desktop —— Electron 薄壳主进程入口。
 *
 * 职责：
 * - 单实例锁、深链协议注册、系统通知 AUMID；
 * - 装配 DshManager（托管/接管 dsh web）并驱动窗口状态机；
 * - 托盘、应用菜单、开机自启、设置持久化、IPC 桥。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { WebFrameMain } from 'electron';
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { applyAutoStart } from './autostart';
import { createConfigStore } from './config';
import { PROTOCOL, findDeepLinkArg, handleDeepLinkUrl, registerDeepLink } from './deep-link';
import { DshManager } from './dsh';
import { installAppMenu } from './menu';
import { notify } from './notifications';
import { getUserDataDir } from './paths';
import { acquireSingleton, notifyPrimary } from './single-instance';
import { TrayController } from './tray';
import type { TrayOptions } from './tray';
import { checkForUpdatesNow, initAutoUpdater, quitAndInstall } from './updater';
import { MainWindow } from './window';
import { IPC, AppInfo } from '../shared/ipc';
import { DshStateInfo } from '../shared/types';

void main();

/** 诊断日志（文件式，不依赖控制台捕获；写 userData/logs，失败静默） */
function diag(msg: string): void {
  try {
    const dir = join(getUserDataDir(), 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'main-diag.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* 忽略 */
  }
}

process.on('uncaughtException', (err) => {
  diag(`uncaughtException: ${(err as Error).stack ?? String(err)}`);
});
process.on('unhandledRejection', (reason) => {
  diag(`unhandledRejection: ${String(reason)}`);
});

async function main(): Promise<void> {
  diag('main() 进入');

  const store = createConfigStore();
  const settings = store.get();
  const logsDir = join(getUserDataDir(), 'logs');
  mkdirSync(logsDir, { recursive: true });

  // 启动参数里的文件夹 = 本次会话的 workspace 根（dsh 工作目录）
  const sessionCwd = findFolderArg(process.argv) ?? settings.cwd;

  const manager = new DshManager({
    host: settings.host,
    port: settings.port,
    attachExisting: settings.attachExisting,
    extraArgs: settings.dshArgs,
    cwd: sessionCwd,
    dshBin: settings.dshBin,
    logFile: join(logsDir, 'dsh.log'),
    logger: (msg) => console.log(msg),
  });

  const mainWindow = new MainWindow({ minimizeToTray: settings.minimizeToTray });
  const tray = new TrayController();
  let hasTray = false;
  let updateVersion: string | null = null;

  // 单实例：回环 TCP 握手（替代 requestSingleInstanceLock，受限环境安全且可测试）
  const singleton = await acquireSingleton((payload) => {
    diag(`次级实例通知: ${payload.argv.join(' ')}`);
    mainWindow.show();
    const deepLink = findDeepLinkArg(payload.argv);
    if (deepLink) {
      const result = handleDeepLinkUrl(deepLink);
      if (result === 'focus') mainWindow.show();
      return;
    }
    const dir = findFolderArg(payload.argv);
    if (dir && dir !== sessionCwd) {
      notify(store.get().notifications, '已在其它工作区运行', `当前会话工作区: ${sessionCwd ?? '默认目录'}`);
    }
  });
  if (!singleton.isPrimary) {
    diag('检测到已有实例，转发请求后退出');
    await notifyPrimary(process.argv.slice(1));
    app.quit();
    return;
  }
  diag('已成为主实例');

  let quitting = false;
  let dshStopped = false;
  let readyNotified = false;
  let lastState: DshStateInfo = { state: 'idle', url: null, owned: false };

  // ------------------------------------------------------------------
  // dsh 状态机 → 窗口 / 托盘 / 通知 / 渲染进程广播
  // ------------------------------------------------------------------
  manager.on('state', (info: DshStateInfo) => {
    lastState = info;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.stateChanged, info);
    }
    switch (info.state) {
      case 'starting':
        tray.updateTooltip('DeepSeek Harness Desktop — 正在启动 dsh web');
        mainWindow.showState('starting');
        break;
      case 'attached':
        readyNotified = false;
        tray.updateTooltip(`DeepSeek Harness Desktop — 已接管 ${info.url ?? ''}`);
        if (info.url) mainWindow.loadDsh(info.url);
        break;
      case 'ready':
        if (!readyNotified) {
          notify(store.get().notifications, 'DeepSeek Harness 已就绪', info.url ?? '');
          readyNotified = true;
        }
        tray.updateTooltip(`DeepSeek Harness Desktop — 运行中 ${info.url ?? ''}`);
        if (info.url) mainWindow.loadDsh(info.url);
        break;
      case 'reconnecting':
        readyNotified = false;
        tray.updateTooltip('DeepSeek Harness Desktop — 连接断开，重试中');
        mainWindow.showState('reconnecting');
        break;
      case 'failed':
        readyNotified = false;
        tray.updateTooltip('DeepSeek Harness Desktop — 启动失败');
        mainWindow.showState('error');
        notify(store.get().notifications, 'DeepSeek Harness 启动失败', info.error ?? 'dsh web 反复崩溃，请检查日志');
        break;
      case 'idle':
        readyNotified = false;
        break;
    }
  });

  manager.on('log', (chunk: string) => {
    console.log(chunk);
  });

  // ------------------------------------------------------------------
  // IPC 桥（仅接受本地 dsh 页面 / 内置页面的调用）
  // ------------------------------------------------------------------
  function isTrustedSender(frame: WebFrameMain | null): boolean {
    if (!frame) return false;
    const url = frame.url;
    return (
      url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:') || url.startsWith('file:')
    );
  }

  ipcMain.on(IPC.openPath, (event, path: unknown) => {
    if (!isTrustedSender(event.senderFrame) || typeof path !== 'string' || path === '') return;
    void shell.openPath(path);
  });

  ipcMain.on(IPC.showItemInFolder, (event, path: unknown) => {
    if (!isTrustedSender(event.senderFrame) || typeof path !== 'string' || path === '') return;
    shell.showItemInFolder(path);
  });

  ipcMain.on(IPC.dropPaths, (event, paths: unknown) => {
    if (!isTrustedSender(event.senderFrame) || !Array.isArray(paths)) return;
    let opened = 0;
    for (const p of paths) {
      if (typeof p !== 'string' || p === '') continue;
      try {
        if (statSync(p).isDirectory()) {
          void shell.openPath(p);
        } else {
          shell.showItemInFolder(p);
        }
        opened += 1;
      } catch {
        /* 路径无效忽略 */
      }
    }
    if (opened > 0) notify(store.get().notifications, '已处理拖放', `已在系统界面打开 ${opened} 个路径`);
  });

  ipcMain.handle(IPC.pickDirectory, async (event) => {
    if (!isTrustedSender(event.senderFrame)) return null;
    const options: Electron.OpenDialogOptions = { title: '选择目录', properties: ['openDirectory'] };
    const win = mainWindow.get();
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(IPC.getStatus, () => lastState);

  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    return {
      appVersion: app.getVersion(),
      dshVersion: readDshVersion(),
      platform: process.platform,
    };
  });

  // ------------------------------------------------------------------
  // 退出流程：先回收自有 dsh 子进程（接管的外部实例不动）
  // ------------------------------------------------------------------
  function quitApp(): void {
    quitting = true;
    mainWindow.setQuitting(true);
    app.quit();
  }

  app.on('before-quit', (event) => {
    if (!dshStopped) {
      event.preventDefault();
      void manager.stop().finally(() => {
        dshStopped = true;
        app.quit();
      });
    }
  });

  app.on('window-all-closed', () => {
    // 有托盘时窗口关闭即驻留后台；托盘创建失败则按默认桌面习惯退出
    if (!hasTray) app.quit();
  });

  app.on('activate', () => {
    mainWindow.show();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    const result = handleDeepLinkUrl(url);
    if (result === 'focus') mainWindow.show();
  });

  // ------------------------------------------------------------------
  // 托盘 / 菜单 / 设置联动
  // ------------------------------------------------------------------
  const trayOpts: TrayOptions = {
    settings: () => store.get(),
    updateReady: () => updateVersion,
    cb: {
      onToggleWindow: () => mainWindow.toggle(),
      onSettings: (patch) => {
        store.update(patch);
        if (typeof patch.autoStart === 'boolean') applyAutoStart(patch.autoStart);
        if (typeof patch.minimizeToTray === 'boolean') mainWindow.setMinimizeToTray(patch.minimizeToTray);
        tray.rebuildMenu();
      },
      onQuit: quitApp,
      onReconnect: () => void manager.restart(),
      onCheckUpdate: () => void checkForUpdatesNow({ notificationsEnabled: () => store.get().notifications }),
      onQuitAndInstall: quitAndInstall,
    },
  };

  function showAbout(): void {
    void dialog.showMessageBox({
      type: 'info',
      title: '关于',
      message: `DeepSeek Harness Desktop v${app.getVersion()}`,
      detail: [
        `dsh: ${readDshVersion() ?? '未知（检查 @deepseek-ai/dsh 安装）'}`,
        `Electron: ${process.versions.electron}`,
        '',
        'DeepSeek Harness 桌面壳：以 Electron 托管/接管 dsh web 的薄封装。',
        '不改动 DSH 本体，可随上游版本升级；日志见托盘菜单“打开数据目录”。',
      ].join('\n'),
    });
  }

  await app.whenReady();
  diag('whenReady 完成');

  app.setAppUserModelId('com.dsh.desktop'); // Windows toast 通知需要
  installAppMenu({
    onQuit: quitApp,
    onReconnect: () => void manager.restart(),
    onCheckUpdate: () => void checkForUpdatesNow({ notificationsEnabled: () => store.get().notifications }),
    about: showAbout,
  });
  hasTray = tray.create(trayOpts);
  diag(`托盘创建: ${hasTray}`);
  applyAutoStart(store.get().autoStart);
  registerDeepLink();
  mainWindow.showState('starting');
  diag('窗口状态页已加载');
  if (!hasTray) console.warn('[main] 托盘创建失败，窗口关闭后将退出应用');

  // 在线更新（仅打包产物生效；启动 15s 后自动检查，受设置 autoUpdate 控制）
  initAutoUpdater(
    {
      notificationsEnabled: () => store.get().notifications,
      onUpdateReady: (info) => {
        updateVersion = info?.version ?? null;
        tray.rebuildMenu();
      },
      onProgress: (percent) => {
        tray.updateTooltip(`DeepSeek Harness Desktop — 正在下载更新 ${Math.floor(percent)}%`);
      },
    },
    store.get().autoUpdate,
  );

  // 首启（Windows 深链冷启动）参数处理
  const firstDeepLink = findDeepLinkArg(process.argv);
  if (firstDeepLink) {
    const result = handleDeepLinkUrl(firstDeepLink);
    if (result === 'focus') mainWindow.show();
  }

  void manager.start();
  diag('manager.start() 已发起');
}

// ----------------------------------------------------------------------
// 工具函数
// ----------------------------------------------------------------------

/** 从 argv 中找出首个已存在的目录（排除可执行文件与开发模式的应用根目录） */
function findFolderArg(argv: string[]): string | null {
  const excludes = new Set([process.execPath, app.getAppPath()].map((p) => pathResolve(p)));
  for (const raw of argv.slice(1)) {
    if (raw.startsWith('-')) continue;
    if (raw.includes('://')) continue;
    try {
      const resolved = pathResolve(raw);
      if (excludes.has(resolved)) continue;
      if (statSync(resolved).isDirectory()) return resolved;
    } catch {
      /* 不存在则忽略 */
    }
  }
  return null;
}

function readDshVersion(): string | null {
  try {
    const pkgPath = require.resolve('@deepseek-ai/dsh/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}
