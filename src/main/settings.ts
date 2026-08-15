import { DEFAULT_SETTINGS, DesktopSettings } from '../shared/types';

/**
 * 合并设置：对未知/非法字段宽容处理，缺省回落默认值。
 * 纯函数，无 Electron 依赖，可单测。
 */
export function mergeSettings(raw: unknown): DesktopSettings {
  const out: DesktopSettings = { ...DEFAULT_SETTINGS, dshArgs: [] };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;

  if (typeof r.host === 'string' && r.host.trim() !== '') out.host = r.host.trim();
  if (
    typeof r.port === 'number' &&
    Number.isInteger(r.port) &&
    r.port >= 0 &&
    r.port <= 65535
  ) {
    out.port = r.port;
  }
  if (typeof r.attachExisting === 'boolean') out.attachExisting = r.attachExisting;
  if (typeof r.autoStart === 'boolean') out.autoStart = r.autoStart;
  if (typeof r.minimizeToTray === 'boolean') out.minimizeToTray = r.minimizeToTray;
  if (typeof r.notifications === 'boolean') out.notifications = r.notifications;
  if (Array.isArray(r.dshArgs)) {
    out.dshArgs = r.dshArgs.filter((v): v is string => typeof v === 'string');
  }
  if (typeof r.cwd === 'string' && r.cwd !== '') out.cwd = r.cwd;
  else if (r.cwd === null) out.cwd = null;
  if (typeof r.dshBin === 'string' && r.dshBin !== '') out.dshBin = r.dshBin;
  else if (r.dshBin === null) out.dshBin = null;
  return out;
}
