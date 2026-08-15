import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 计算应用数据目录（Electron userData 的默认约定）。
 *
 * 注意：不使用 app.getPath('userData') —— 该 API 在受限环境
 * （命名管道/注册表被拦截的沙箱）下会触发 Chromium 原生崩溃且不可捕获，
 * 手算路径行为等价且更健壮。
 */
export function getUserDataDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(base, 'dsh-desktop');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'dsh-desktop');
  }
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'dsh-desktop');
}
