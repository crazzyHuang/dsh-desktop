/**
 * 半自动发布脚本：跟随上游 @deepseek-ai/dsh 升级 → 测试 → 打版本 → 打包 → 发布 → 推送。
 *
 * 用法：
 *   node scripts/release.mjs <新应用版本> [选项]
 *
 * 选项：
 *   --dsh <version|latest|current>  将 @deepseek-ai/dsh 更新到指定版本（默认 current = 保持现状）
 *   --cn                             使用国内镜像打包（npm run dist:cn）
 *   --skip-tests                     跳过单元/集成测试（不推荐）
 *   --dry-run                        只打印将执行的步骤，不实际执行
 *
 * 示例（上游发了 rc.7，跟进并发布应用 0.2.0）：
 *   node scripts/release.mjs 0.2.0 --dsh latest --cn
 *
 * 前置条件：
 *   - 工作区干净（git status 无未提交变更，npm version 会生成提交与标签）
 *   - 环境变量 GH_TOKEN 已设置（Git Credential Manager 的 password，用于发布 Release）
 *   - git 已配置推送凭据
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const newVersion = argv[0];
if (!newVersion || newVersion.startsWith('--')) {
  console.error('用法: node scripts/release.mjs <新应用版本> [--dsh <version|latest|current>] [--cn] [--skip-tests] [--dry-run]');
  process.exit(2);
}
const flags = new Set(argv.slice(1));
const dshArg = argv.includes('--dsh') ? argv[argv.indexOf('--dsh') + 1] : 'current';
const useCn = flags.has('--cn');
const skipTests = flags.has('--skip-tests');
const dryRun = flags.has('--dry-run');

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const productName = pkg.productName ?? pkg.name;
const setupExe = `${productName}-Setup-${newVersion}.exe`;

/** 执行命令（Windows 上 npm 需要 shell 解析 .cmd） */
function run(cmd, args, label) {
  console.log(`\n▶ ${label}: ${cmd} ${args.join(' ')}`);
  if (dryRun) return;
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && cmd === 'npm',
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`✗ 步骤失败（exit ${r.status ?? 'signal'}）: ${label}`);
    process.exit(r.status ?? 1);
  }
}

/** 从 npm registry 查询上游最新版本（直接 fetch，不依赖子进程管道） */
async function upstreamLatest() {
  const res = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh/latest');
  if (!res.ok) throw new Error(`查询上游版本失败: HTTP ${res.status}`);
  const data = await res.json();
  return data.version;
}

const currentDshRaw = (pkg.dependencies ?? {})['@deepseek-ai/dsh'] ?? '未知';
const currentDsh = currentDshRaw.replace(/^[\^~]/, '');
let dshTarget = currentDsh;
let upstream = null;

console.log(`当前应用版本: ${pkg.version} → 目标: ${newVersion}`);
console.log(`当前 dsh 依赖: ${currentDsh}`);
try {
  upstream = await upstreamLatest();
  console.log(`上游最新 dsh: ${upstream}`);
} catch (err) {
  console.warn(`⚠ ${err.message}`);
}

if (dshArg === 'latest') {
  if (!upstream) throw new Error('--dsh latest 需要能访问 npm registry');
  dshTarget = upstream;
} else if (dshArg !== 'current') {
  dshTarget = dshArg;
}

if (dshTarget !== currentDsh) {
  if (dshTarget === upstream) {
    console.log(`\n✨ 上游有新版本（${upstream}），将更新依赖并跑测试`);
  } else {
    console.log(`\n🔧 将 @deepseek-ai/dsh 更新到 ${dshTarget}`);
  }
  run('npm', ['install', `@deepseek-ai/dsh@${dshTarget}`, '--no-audit', '--no-fund'], '更新 dsh 依赖');
  // 提醒同步安装 koffi 平台包（若 npm 未自动装齐）
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', '@koromix/koffi-win32-x64@3.1.5'], '补 koffi 平台包（幂等）');
} else {
  console.log('\nℹ 保持当前 dsh 版本不变');
}

if (!skipTests) {
  run('npm', ['test'], '单元测试');
  run('npm', ['run', 'test:integration'], '集成测试（真实 dsh web）');
} else {
  console.log('\n⚠ 已跳过测试（--skip-tests）');
}

run('npm', ['version', newVersion, '--no-git-tag-version'], '写入版本号');
// npm version 不自动提交（--no-git-tag-version），由下方显式提交 + 打标签，消息可控
run('git', ['add', 'package.json', 'package-lock.json'], '暂存版本变更');
run('git', ['commit', '-m', `chore: release v${newVersion}${dshTarget !== currentDsh ? `（dsh → ${dshTarget}）` : ''}`], '提交版本变更');
run('git', ['tag', '-a', `v${newVersion}`, '-m', `release v${newVersion}`], '打标签');

run('npm', ['run', useCn ? 'dist:cn' : 'dist'], useCn ? '国内镜像打包' : '打包');

const releaseDir = join(process.cwd(), 'release');
const assets = [setupExe, `${setupExe}.blockmap`, 'latest.yml'].map((f) => join(releaseDir, f));
if (!dryRun) {
  for (const a of assets) {
    if (!existsSync(a)) {
      console.error(`✗ 缺少产物: ${a}（${useCn ? '镜像' : '直连'}打包失败或产物名不符）`);
      process.exit(1);
    }
  }
}

if (!dryRun && !process.env.GH_TOKEN) {
  console.error('\n✗ 缺少 GH_TOKEN 环境变量（发布 Release 需要）');
  console.error('  从 Git Credential Manager 获取并设置后重跑发布步骤：');
  console.error(`  $env:GH_TOKEN = '…'; node scripts/publish-release.mjs v${newVersion} ${assets.map((a) => `"${a}"`).join(' ')}`);
  process.exit(1);
}

run('node', ['scripts/publish-release.mjs', `v${newVersion}`, ...assets], '发布 GitHub Release（含 latest.yml / blockmap）');
run('git', ['push', 'origin', 'main', '--tags'], '推送 main 与标签');

console.log(`\n🎉 发布完成: https://github.com/crazzyHuang/dsh-desktop/releases/tag/v${newVersion}`);
console.log('安装版用户将收到在线更新（latest.yml 已上传）。');
