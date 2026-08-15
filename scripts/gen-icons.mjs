/**
 * 图标生成：build/icon.svg → build/icon.png(1024) 等 PNG 资产。
 * 运行：npm run icons
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
mkdirSync(join(root, 'build', 'icons'), { recursive: true });

const tasks = [
  ['icon.svg', 'icon.png', 1024],
  ['icon.svg', 'icons/icon-256.png', 256],
  ['tray.svg', 'icons/tray-16.png', 16],
  ['tray.svg', 'icons/tray-32.png', 32],
];

for (const [src, dst, size] of tasks) {
  await sharp(join(root, 'build', src)).resize(size, size).png().toFile(join(root, 'build', dst));
  console.log(`generated build/${dst} (${size}x${size})`);
}
