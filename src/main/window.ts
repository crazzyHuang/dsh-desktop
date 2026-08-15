import { app, BrowserWindow, nativeImage, shell } from 'electron';
import { join } from 'node:path';

type PageKind = 'status' | 'dsh';

/**
 * 主窗口管理：加载内置状态页（starting/reconnecting/error）或 dsh web URL，
 * 关闭行为（托盘驻留）、外链与新窗口安全策略、渲染进程崩溃兜底。
 */
export class MainWindow {
  private win: BrowserWindow | null = null;
  private kind: PageKind = 'status';
  private dshUrl: string | null = null;
  private quitting = false;
  private minimizeToTray: boolean;

  constructor(opts: { minimizeToTray: boolean }) {
    this.minimizeToTray = opts.minimizeToTray;
  }

  setMinimizeToTray(v: boolean): void {
    this.minimizeToTray = v;
  }

  ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icons', 'icon-256.png'));
    this.win = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 900,
      minHeight: 600,
      title: 'DeepSeek Harness Desktop',
      icon: icon.isEmpty() ? undefined : icon,
      show: false,
      backgroundColor: '#101320',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, 'preload', 'index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    this.win.once('ready-to-show', () => {
      if (!this.quitting) this.win?.show();
    });
    this.win.on('close', (event) => {
      if (!this.quitting && this.minimizeToTray) {
        event.preventDefault();
        this.win?.hide();
      }
    });
    // 新窗口一律拒掉，http(s) 转交系统浏览器
    this.win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    // 页面内导航只允许本地服务器与 file:，其余转交系统浏览器
    this.win.webContents.on('will-navigate', (event, url) => {
      if (!this.isTrusted(url)) {
        event.preventDefault();
        if (/^https?:/i.test(url)) void shell.openExternal(url);
      }
    });
    this.win.webContents.on('render-process-gone', () => {
      this.showState('error');
    });
    return this.win;
  }

  private isTrusted(url: string): boolean {
    return (
      url.startsWith('http://127.0.0.1:') ||
      url.startsWith('http://localhost:') ||
      url.startsWith('file:')
    );
  }

  /** 显示内置状态页 */
  showState(state: 'starting' | 'reconnecting' | 'error'): void {
    this.kind = 'status';
    const win = this.ensure();
    if (win.isDestroyed()) return;
    const page = join(app.getAppPath(), 'renderer', 'status.html');
    void win.loadFile(page, { query: { state } }).catch(() => {});
  }

  /** 加载 dsh web；已在同一 URL 且未加载中时跳过（避免健康恢复时反复刷新） */
  loadDsh(url: string): void {
    if (
      this.kind === 'dsh' &&
      this.dshUrl === url &&
      this.win &&
      !this.win.isDestroyed() &&
      !this.win.webContents.isLoading()
    ) {
      return;
    }
    this.kind = 'dsh';
    this.dshUrl = url;
    const win = this.ensure();
    if (!win.isDestroyed()) void win.loadURL(url).catch(() => {});
  }

  isOnDsh(): boolean {
    return this.kind === 'dsh';
  }

  show(): void {
    const win = this.ensure();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  toggle(): void {
    const win = this.ensure();
    if (win.isVisible() && win.isFocused()) win.hide();
    else this.show();
  }

  setQuitting(v: boolean): void {
    this.quitting = v;
  }

  get(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }
}
