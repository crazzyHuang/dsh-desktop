import { app, nativeImage, Notification } from 'electron';
import { join } from 'node:path';

/**
 * 系统通知（生命周期事件）。受设置 notifications 开关控制。
 * Windows 上需要 app.setAppUserModelId 生效后 toast 才会显示。
 */
export function notify(enabled: boolean, title: string, body: string): void {
  if (!enabled || !Notification.isSupported()) return;
  try {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icons', 'icon-256.png'));
    const n = new Notification({
      title,
      body,
      icon: icon.isEmpty() ? undefined : icon,
      silent: false,
    });
    n.show();
  } catch (err) {
    console.error('[notify] 通知发送失败:', err);
  }
}
