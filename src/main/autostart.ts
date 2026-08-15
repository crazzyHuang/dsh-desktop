import { app } from 'electron';

/**
 * 开机自启（Windows/macOS）。Linux 需 .desktop 文件，v1 未实现。
 */
export function applyAutoStart(enabled: boolean): void {
  if (process.platform === 'linux') return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [] });
  } catch (err) {
    console.error('[autostart] 设置失败:', err);
  }
}

export function isAutoStartEnabled(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}
