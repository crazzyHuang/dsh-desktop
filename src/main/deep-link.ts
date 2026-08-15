import { app, shell } from 'electron';

/** 深链协议名：dsh-desktop:// */
export const PROTOCOL = 'dsh-desktop';

/** 注册系统协议处理器 */
export function registerDeepLink(): void {
  try {
    if (process.defaultApp) {
      // 开发模式（electron .）：显式带上应用入口
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }
  } catch (err) {
    console.error('[deep-link] 协议注册失败:', err);
  }
}

/** 从命令行参数中找出深链（兼容整串与混杂参数） */
export function findDeepLinkArg(argv: string[]): string | null {
  for (const arg of argv) {
    if (typeof arg !== 'string') continue;
    if (arg.startsWith(PROTOCOL + '://')) return arg;
    const m = arg.match(/dsh-desktop:\/\/[^\s"'`<>]*/i);
    if (m) return m[0];
  }
  return null;
}

/**
 * 处理深链：
 * - dsh-desktop://focus → 'focus'（聚焦窗口）
 * - dsh-desktop://open-folder?path=<目录> → 用系统资源管理器打开，返回路径
 * - 其它 → null
 */
export function handleDeepLinkUrl(raw: string): string | null {
  const m = raw.match(/(dsh-desktop:\/\/[^\s"'`<>]*)/i);
  const text = m ? m[1] : raw;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'dsh-desktop:') return null;
  switch (url.hostname) {
    case 'open-folder': {
      const path = url.searchParams.get('path');
      if (path) {
        void shell.openPath(path);
        return path;
      }
      return null;
    }
    case 'focus':
    case 'open':
    default:
      return 'focus';
  }
}
