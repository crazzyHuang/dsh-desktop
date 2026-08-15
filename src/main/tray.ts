import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { join } from 'node:path';
import { getUserDataDir } from './paths';
import { DesktopSettings } from '../shared/types';

export interface TrayCallbacks {
  onToggleWindow(): void;
  onSettings(patch: Partial<DesktopSettings>): void;
  onQuit(): void;
  onReconnect(): void;
}

export interface TrayOptions {
  settings: () => DesktopSettings;
  cb: TrayCallbacks;
}

/** 托盘：常驻图标 + 快捷菜单（窗口、开关项、重连、退出） */
export class TrayController {
  private tray: Tray | null = null;
  private lastOpts: TrayOptions | null = null;

  create(opts: TrayOptions): boolean {
    this.lastOpts = opts;
    const iconPath = join(app.getAppPath(), 'build', 'icons', 'tray-32.png');
    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) {
      console.error('[tray] 托盘图标缺失:', iconPath);
      return false;
    }
    this.tray = new Tray(img);
    this.tray.setToolTip('DeepSeek Harness Desktop');
    this.tray.on('click', opts.cb.onToggleWindow);
    this.tray.on('double-click', opts.cb.onToggleWindow);
    this.rebuildMenu();
    return true;
  }

  rebuildMenu(): void {
    if (!this.tray || !this.lastOpts) return;
    const { settings, cb } = this.lastOpts;
    const s = settings();
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示 / 隐藏窗口', click: cb.onToggleWindow },
        { type: 'separator' },
        {
          label: '系统通知',
          type: 'checkbox',
          checked: s.notifications,
          click: (item) => cb.onSettings({ notifications: item.checked }),
        },
        {
          label: '关闭时最小化到托盘',
          type: 'checkbox',
          checked: s.minimizeToTray,
          click: (item) => cb.onSettings({ minimizeToTray: item.checked }),
        },
        {
          label: '开机自启',
          type: 'checkbox',
          checked: s.autoStart,
          click: (item) => cb.onSettings({ autoStart: item.checked }),
        },
        { type: 'separator' },
        { label: '重新连接 dsh web', click: cb.onReconnect },
        { label: '打开数据目录', click: () => void shell.openPath(getUserDataDir()) },
        { type: 'separator' },
        { label: '退出', click: cb.onQuit },
      ]),
    );
  }

  updateTooltip(text: string): void {
    this.tray?.setToolTip(text);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
