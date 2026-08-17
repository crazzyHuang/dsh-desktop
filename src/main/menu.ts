import { BrowserWindow, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

export interface MenuCallbacks {
  onQuit(): void;
  onReconnect(): void;
  onCheckUpdate(): void;
  about(): void;
}

/** 安装应用菜单（macOS 沿用系统默认菜单，不覆盖） */
export function installAppMenu(cb: MenuCallbacks): void {
  if (process.platform === 'darwin') return;
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [{ label: '退出', accelerator: 'Alt+F4', click: cb.onQuit }],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: (_item, win) => (win as BrowserWindow | undefined)?.webContents.reload(),
        },
        { label: '重新连接 dsh web', click: cb.onReconnect },
        { type: 'separator' },
        {
          label: '开发者工具',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: (_item, win) => (win as BrowserWindow | undefined)?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新', click: cb.onCheckUpdate },
        { label: '关于', click: cb.about },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
