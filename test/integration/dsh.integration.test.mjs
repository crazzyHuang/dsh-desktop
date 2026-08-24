/**
 * 集成测试：用 DshManager 真实启动 @deepseek-ai/dsh 的 dsh web，
 * 验证就绪探测、URL 解析（固定端口 + 随机端口）、日志捕获与停机回收。
 *
 * 使用随机高位端口 + 独立 DSH_HOME（临时目录），不触碰现网 3080 实例。
 * 运行：npm run test:integration
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { DshManager, probeDshWeb } = require('../../dist/main/dsh.js');

const PORT = 32000 + Math.floor(Math.random() * 2000);

function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`等待超时: ${label}`));
      }
    }, 400);
  });
}

function makeManager(t, port) {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-desktop-it-'));
  const home = join(tmp, 'home');
  mkdirSync(home, { recursive: true });
  const logFile = join(tmp, 'dsh.log');
  const mgr = new DshManager({
    host: '127.0.0.1',
    port,
    attachExisting: false,
    logFile,
    env: { DSH_HOME: home },
    bootTimeoutMs: 150_000,
    healthIntervalMs: 5_000,
    logger: (m) => t.diagnostic(m),
  });
  return { mgr, logFile };
}

test('接管实例被杀后，应用自动在原端口自起内置实例（不依赖外部服务）', { timeout: 360_000 }, async (t) => {
  const tmpA = mkdtempSync(join(tmpdir(), 'dsh-desktop-itA-'));
  const tmpB = mkdtempSync(join(tmpdir(), 'dsh-desktop-itB-'));
  const homeA = join(tmpA, 'home');
  const homeB = join(tmpB, 'home');
  mkdirSync(homeA, { recursive: true });
  mkdirSync(homeB, { recursive: true });
  const PORT2 = 33000 + Math.floor(Math.random() * 2000);

  // 外部实例（模拟用户手动起的 dsh web 服务）
  const ext = new DshManager({
    host: '127.0.0.1',
    port: PORT2,
    attachExisting: false,
    logFile: join(tmpA, 'ext.log'),
    env: { DSH_HOME: homeA },
    bootTimeoutMs: 150_000,
    healthIntervalMs: 5_000,
    logger: (m) => t.diagnostic(m),
  });
  // 应用侧实例（接管模式）
  const app = new DshManager({
    host: '127.0.0.1',
    port: PORT2,
    attachExisting: true,
    logFile: join(tmpB, 'app.log'),
    env: { DSH_HOME: homeB },
    bootTimeoutMs: 150_000,
    healthIntervalMs: 1_500,
    attachRetryMs: 5_000,
    logger: (m) => t.diagnostic(m),
  });

  const states = [];
  app.on('state', (info) => states.push(info.state));

  try {
    await ext.start();
    await waitFor(() => ext.state === 'ready', 150_000, '外部实例就绪');

    await app.start();
    await waitFor(() => app.state === 'attached', 30_000, '应用接管外部实例');
    assert.equal(app.owned, false, '接管模式不应拥有子进程');

    // 关闭外部实例：模拟用户关掉本地 dsh 服务
    await ext.stop();
    t.diagnostic('外部实例已关闭，等待应用自愈…');

    await waitFor(() => app.state === 'reconnecting', 30_000, '应用进入重连状态');
    // 核心断言：attachRetryMs 后应用应自动自起内置实例并恢复就绪
    await waitFor(() => app.state === 'ready', 150_000, '应用自起内置实例并就绪');
    assert.equal(app.owned, true, '自愈后应用应拥有自己的子进程');
    assert.ok(await probeDshWeb(app.url + '/'), '自起实例应可访问且含 __DSH_BOOT__');
    assert.ok(states.includes('reconnecting') && states.includes('ready'), `状态序列异常: ${states.join(',')}`);
    t.diagnostic(`自愈成功：外部实例关闭后应用独立提供服务（${app.url}）`);
  } finally {
    await ext.stop();
    await app.stop();
  }
});

test('固定端口：自起真实 dsh web、就绪后干净停机并释放端口', { timeout: 240_000 }, async (t) => {
  const { mgr, logFile } = makeManager(t, PORT);

  const states = [];
  let logChunks = 0;
  mgr.on('state', (info) => states.push(info.state));
  mgr.on('log', () => {
    logChunks += 1;
  });

  try {
    await mgr.start();
    await waitFor(() => mgr.state === 'ready', 150_000, 'dsh web 就绪');

    assert.equal(mgr.owned, true);
    assert.match(mgr.url ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(await probeDshWeb(mgr.url + '/'), '就绪 URL 应返回含 __DSH_BOOT__ 的页面');
    assert.ok(states.includes('starting') && states.includes('ready'), `状态序列异常: ${states.join(',')}`);

    // URL 行可能在就绪探测之后才打印到日志，等待其到达
    await waitFor(() => logChunks > 0, 15_000, '子进程日志输出');
    const logText = readFileSync(logFile, 'utf8');
    assert.match(logText, /dsh\s+web:\s+http:/i, '日志文件应包含 dsh web URL 行');
  } finally {
    await mgr.stop();
  }

  assert.equal(mgr.state, 'idle', '停机后应回到 idle');
  const freed = await probeDshWeb(`http://127.0.0.1:${PORT}/`, 2000);
  assert.equal(freed, false, '停机后端口应已释放');
  t.diagnostic(`固定端口用例通过（端口 ${PORT}）`);
});

test('随机端口：URL 必须从日志行解析（port=0）', { timeout: 240_000 }, async (t) => {
  const { mgr } = makeManager(t, 0);

  const states = [];
  let logChunks = 0;
  mgr.on('state', (info) => states.push(info.state));
  mgr.on('log', () => {
    logChunks += 1;
  });

  try {
    await mgr.start();
    assert.equal(mgr.url, null, '随机端口模式下就绪前不应有候选 URL');
    await waitFor(() => mgr.state === 'ready', 150_000, '随机端口 dsh web 就绪');

    assert.match(mgr.url ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(logChunks > 0, 'port=0 时 URL 只能来自日志解析，日志输出应非空');
    assert.ok(await probeDshWeb(mgr.url + '/'), '解析出的 URL 应可访问且含 __DSH_BOOT__');
  } finally {
    await mgr.stop();
  }

  assert.equal(mgr.state, 'idle', '停机后应回到 idle');
  t.diagnostic(`随机端口用例通过（解析到 ${mgr.url}）`);
});
