import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mergeSettings } from './settings';
import { getUserDataDir } from './paths';
import { DesktopSettings } from '../shared/types';

/**
 * 设置持久化：userData/settings.json，原子写（临时文件 + rename）。
 */
export class ConfigStore {
  private readonly path: string;
  private settings: DesktopSettings;

  constructor(dir: string) {
    this.path = join(dir, 'settings.json');
    this.settings = this.read();
  }

  private read(): DesktopSettings {
    try {
      const text = readFileSync(this.path, 'utf8');
      return mergeSettings(JSON.parse(text));
    } catch {
      return mergeSettings(null);
    }
  }

  get(): DesktopSettings {
    return this.settings;
  }

  update(patch: Partial<DesktopSettings>): DesktopSettings {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    this.save();
    return this.settings;
  }

  save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = this.path + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
      renameSync(tmp, this.path);
    } catch (err) {
      console.error('[settings] 保存失败:', err);
    }
  }
}

/** Electron 入口处的便捷实例 */
export function createConfigStore(): ConfigStore {
  return new ConfigStore(getUserDataDir());
}
