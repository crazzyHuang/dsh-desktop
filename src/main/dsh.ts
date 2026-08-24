import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { closeSync, openSync, readSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DshState, DshStateInfo } from '../shared/types';

/** 终端 ANSI 转义 */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
/** dsh web 就绪时打印的 URL 行，例如 `dsh web: http://127.0.0.1:3080` */
const URL_LINE_RE = /dsh\s+web:\s+(https?:\/\/[^\s"'`<>]+)/i;
/** 兜底：日志里出现的任意回环地址 */
const FALLBACK_URL_RE = /https?:\/\/127\.0\.0\.1:\d+/i;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/**
 * 从 dsh web 启动日志中解析 URL。
 * 优先匹配官方 `dsh web:` 前缀行，其次回环地址。
 */
export function parseWebUrlLine(text: string): string | null {
  const clean = stripAnsi(text);
  const m = clean.match(URL_LINE_RE);
  if (m) return m[1];
  const f = clean.match(FALLBACK_URL_RE);
  return f ? f[0] : null;
}

/** 重启退避：1s、2s、4s…封顶 30s */
export function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30_000);
}

/** 当前运行时是否为 Electron 主进程 */
export function isElectronRuntime(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.electron === 'string';
}

/**
 * 探测 URL 是否为 dsh web：
 * HTTP 2xx 且 HTML 内含宿主注入的 `__DSH_BOOT__`（接入判定依据，避免误接管其它服务）。
 */
export async function probeDshWeb(url: string, timeoutMs = 3000, token = '__DSH_BOOT__'): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes(token);
  } catch {
    return false;
  }
}

/** 轮询直到谓词成立或超时 */
export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 400,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** 解析内置 @deepseek-ai/dsh 的 bin.js 绝对路径 */
export function resolveDshBinJs(): string {
  const pkgPath = require.resolve('@deepseek-ai/dsh/package.json');
  return join(dirname(pkgPath), 'lib', 'bin.js');
}

export interface DshManagerOptions {
  /** 期望监听地址 */
  host: string;
  /** 期望端口；0 = 随机端口（必须自起实例） */
  port: number;
  /** 端口上已有 dsh web 时直接接管 */
  attachExisting?: boolean;
  /** 追加给 `dsh web` 的额外参数 */
  extraArgs?: string[];
  /** dsh 工作目录（workspace 根） */
  cwd?: string | null;
  /** 自定义 dsh 可执行文件（覆盖内置解析） */
  dshBin?: string | null;
  /** 子进程输出日志文件绝对路径（stdout/stderr 均写入，避免管道） */
  logFile: string;
  /** 额外环境变量（合并进 process.env） */
  env?: NodeJS.ProcessEnv;
  /** 启动超时（默认 90s） */
  bootTimeoutMs?: number;
  /** 健康探测间隔（默认 8s） */
  healthIntervalMs?: number;
  /** 重启窗口内允许的最大重启次数（默认 5） */
  maxRestarts?: number;
  /** 重启计数窗口（默认 120s） */
  restartWindowMs?: number;
  /** 接管实例连续失联多久后自起新实例（默认 15s） */
  attachRetryMs?: number;
  logger?: (msg: string) => void;
}

/**
 * dsh web 子进程生命周期管理：
 * 接管已有实例（attach）或自起实例（spawn），解析就绪 URL，
 * 健康监控、崩溃自动重启（指数退避 + 预算封顶）、优雅停机（整树强杀）。
 *
 * 与 Electron 解耦：仅依赖 Node API，可在纯 Node 下做集成测试。
 * 子进程输出写入日志文件而非管道（避免受命名管道限制，且便于诊断）。
 */
export class DshManager extends EventEmitter {
  readonly opts: Required<Omit<DshManagerOptions, 'env' | 'dshBin'>> & {
    env: NodeJS.ProcessEnv;
    dshBin: string | null;
  };

  state: DshState = 'idle';
  url: string | null = null;
  owned = false;

  private child: ChildProcess | null = null;
  private logFd: number | null = null;
  private lastLogPos = 0;
  private logBuffer = '';
  private stopping = false;
  private childFinished = false;
  private restarts = 0;
  private restartWindowStart = Date.now();
  private healthFailures = 0;
  private attachDownSince = 0;
  private bootTimer: NodeJS.Timeout | null = null;
  private logPollTimer: NodeJS.Timeout | null = null;
  private probeTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private stopResolvers: Array<() => void> = [];

  constructor(opts: DshManagerOptions) {
    super();
    this.opts = {
      host: opts.host,
      port: opts.port,
      attachExisting: opts.attachExisting ?? true,
      extraArgs: opts.extraArgs ?? [],
      cwd: opts.cwd ?? null,
      logFile: opts.logFile,
      env: opts.env ?? {},
      dshBin: opts.dshBin ?? null,
      bootTimeoutMs: opts.bootTimeoutMs ?? 90_000,
      healthIntervalMs: opts.healthIntervalMs ?? 8_000,
      maxRestarts: opts.maxRestarts ?? 5,
      restartWindowMs: opts.restartWindowMs ?? 120_000,
      attachRetryMs: opts.attachRetryMs ?? 15_000,
      logger: opts.logger ?? (() => {}),
    };
  }

  on(event: 'state', listener: (info: DshStateInfo) => void): this;
  on(event: 'log', listener: (chunk: string) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  private log(msg: string): void {
    this.opts.logger(`[dsh] ${msg}`);
  }

  private emitState(state: DshState, error?: string): void {
    this.state = state;
    const info: DshStateInfo = { state, url: this.url, owned: this.owned, error };
    this.emit('state', info);
  }

  get candidateUrl(): string {
    return `http://${this.opts.host}:${this.opts.port}`;
  }

  /** 启动（或接管）dsh web。仅在 idle 状态生效。 */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.stopping = false;
    this.log(
      this.opts.port === 0
        ? '以随机端口自起 dsh web'
        : `目标 ${this.candidateUrl}（attachExisting=${this.opts.attachExisting}）`,
    );
    if (this.opts.port !== 0 && this.opts.attachExisting) {
      const ok = await probeDshWeb(this.candidateUrl + '/', 3000);
      if (ok) {
        this.url = this.candidateUrl;
        this.owned = false;
        this.log(`接管已运行的 dsh web 实例: ${this.candidateUrl}`);
        this.emitState('attached');
        this.startHealthMonitor();
        return;
      }
      this.log('目标端口无 dsh web 响应，自起实例');
    }
    await this.spawnOwn();
  }

  /** 停止：自有实例优雅终止，接管实例仅解除监控 */
  async stop(): Promise<void> {
    this.stopping = true;
    this.clearTimers();
    if (!this.child) {
      this.finishChild();
      this.url = null;
      this.emitState('idle');
      return;
    }
    await new Promise<void>((resolve) => {
      const child = this.child!;
      const killer = setTimeout(() => this.killTree(child), 3000);
      this.stopResolvers.push(() => {
        clearTimeout(killer);
        resolve();
      });
      this.log(`正在停止 dsh web（pid=${child.pid}）…`);
      try {
        child.kill(); // SIGTERM
      } catch {
        this.killTree(child);
      }
    });
  }

  /** 手动重连（重置重启预算并重新开始） */
  async restart(): Promise<void> {
    await this.stop();
    this.restarts = 0;
    this.restartWindowStart = Date.now();
    this.healthFailures = 0;
    this.attachDownSince = 0;
    this.stopping = false;
    await this.start();
  }

  // ------------------------------------------------------------------
  // 自起实例
  // ------------------------------------------------------------------

  private async spawnOwn(): Promise<void> {
    if (this.stopping) {
      this.emitState('idle');
      return;
    }
    this.owned = true;
    this.url = this.opts.port === 0 ? null : this.candidateUrl;
    this.emitState('starting');

    let command: string[];
    let env: NodeJS.ProcessEnv;
    let args: string[];
    try {
      ({ command, env } = this.resolveCommand());
      args = this.composeArgs();
    } catch (err) {
      this.emitState('failed', `无法解析 dsh 启动命令: ${(err as Error).message}`);
      return;
    }
    this.log(`启动: ${command.join(' ')} ${args.join(' ')}`);

    try {
      this.rotateLogIfHuge();
      this.logFd = openSync(this.opts.logFile, 'a');
      this.lastLogPos = 0;
      this.logBuffer = '';
      this.childFinished = false;
      this.child = spawn(command[0], [...command.slice(1), ...args], {
        cwd: this.opts.cwd ?? undefined,
        env,
        // stdout/stderr 走日志文件句柄：既绕开命名管道限制，也留下可诊断日志
        stdio: ['ignore', this.logFd, this.logFd],
        windowsHide: true,
      });
    } catch (err) {
      this.emitState('failed', `dsh 子进程启动失败: ${(err as Error).message}`);
      this.finishChild();
      return;
    }

    this.child.on('error', (err) => {
      this.log(`spawn error: ${err.message}`);
      if (!this.childFinished) this.onChildExit(null, null);
    });
    this.child.on('exit', (code, signal) => {
      this.log(`子进程 exit: code=${code} signal=${signal}`);
      if (!this.childFinished) this.onChildExit(code, signal);
    });

    this.bootTimer = setTimeout(() => {
      if (this.state === 'starting' && this.child) {
        // 启动超时：终止残留子进程，其 exit 事件会走 onChildExit 自动重启
        this.log('启动超时，终止残留子进程后重试');
        this.killTree(this.child);
      }
    }, this.opts.bootTimeoutMs);

    this.pollLogForUrl();
    this.probeUntilReady();
  }

  private composeArgs(): string[] {
    return [
      'web',
      '--host',
      this.opts.host,
      '--port',
      String(this.opts.port),
      ...this.opts.extraArgs,
    ];
  }

  /**
   * 解析 dsh 启动命令：
   * 1) 设置里的 dshBin（自定义 dsh 可执行文件）；
   * 2) 内置 @deepseek-ai/dsh/lib/bin.js —— Electron 下用自身运行时
   *    （ELECTRON_RUN_AS_NODE，Electron 37 内嵌 Node 22.16，与 npm 安装时的
   *    prebuilt 原生插件 ABI 一致），纯 Node 下用 process.execPath。
   * 若运行时环境 ABI 不匹配，通过设置 `dshBin` 指向系统 node/dsh 兜底。
   */
  private resolveCommand(): { command: string[]; env: NodeJS.ProcessEnv } {
    const env = { ...process.env, ...this.opts.env };
    if (this.opts.dshBin) return { command: [this.opts.dshBin], env };
    if (isElectronRuntime()) {
      env.ELECTRON_RUN_AS_NODE = '1';
      return { command: [process.execPath, resolveDshBinJs()], env };
    }
    return { command: [process.execPath, resolveDshBinJs()], env };
  }

  // ------------------------------------------------------------------
  // 日志尾部轮询：解析 URL 行，转发日志事件
  // ------------------------------------------------------------------

  private pollLogForUrl(): void {
    this.logPollTimer = setInterval(() => {
      if (this.logFd === null) return;
      try {
        const size = statSync(this.opts.logFile).size;
        if (size <= this.lastLogPos) return;
        const len = Math.min(size - this.lastLogPos, 256 * 1024);
        const buf = Buffer.alloc(len);
        const fd = openSync(this.opts.logFile, 'r');
        try {
          readSync(fd, buf, 0, len, this.lastLogPos);
        } finally {
          closeSync(fd);
        }
        this.lastLogPos += len;
        const text = buf.toString('utf8');
        this.logBuffer = (this.logBuffer + text).slice(-64 * 1024);
        this.emit('log', text);
        if (this.url === null) {
          const found = parseWebUrlLine(this.logBuffer);
          if (found) {
            this.url = found;
            this.log(`解析到 URL: ${found}`);
          }
        }
      } catch {
        /* 文件尚未就绪等瞬时错误忽略 */
      }
    }, 500);
  }

  private rotateLogIfHuge(): void {
    try {
      const size = statSync(this.opts.logFile).size;
      if (size > 5 * 1024 * 1024) renameSync(this.opts.logFile, this.opts.logFile + '.1');
    } catch {
      /* 文件不存在等忽略 */
    }
  }

  // ------------------------------------------------------------------
  // 就绪探测与健康监控
  // ------------------------------------------------------------------

  private probeUntilReady(): void {
    this.probeTimer = setInterval(async () => {
      const target = this.url;
      if (!target) return; // port=0 时等待日志解析出 URL
      const ok = await probeDshWeb(target + '/', 4000);
      if (!ok || this.state !== 'starting') return;
      if (this.bootTimer) clearTimeout(this.bootTimer);
      if (this.probeTimer) clearInterval(this.probeTimer);
      this.probeTimer = null;
      this.log(`dsh web 就绪: ${target}`);
      this.emitState('ready');
      this.startHealthMonitor();
    }, 700);
  }

  private startHealthMonitor(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(async () => {
      const url = this.url;
      const st = this.stateNow();
      // 就绪 / 接管 / 重连三种状态下持续探测：
      // - ready/attached：正常健康监控；
      // - reconnecting：接管实例失联后的自起判定、外部实例恢复检测都在此驱动，
      //   若此处提前返回，接管自起将永远无法执行（历史 bug）。
      if (this.stopping || !url || (st !== 'ready' && st !== 'attached' && st !== 'reconnecting')) return;

      const ok = await probeDshWeb(url + '/', 4000);
      if (ok) {
        this.healthFailures = 0;
        this.attachDownSince = 0;
        if (this.stateNow() === 'reconnecting') {
          this.log('dsh web 恢复响应');
          this.emitState(this.owned ? 'ready' : 'attached');
        }
        return;
      }

      this.healthFailures += 1;
      if (this.healthFailures === 1) {
        this.log('健康探测失败（首次）');
      }
      if (this.healthFailures >= 3) {
        if (this.stateNow() !== 'reconnecting') {
          this.log('dsh web 连续失联，进入重连状态');
          this.emitState('reconnecting', 'dsh web 无响应');
        }
        // 接管实例失联：attachRetryMs 后原位自起内置实例（不依赖外部服务）
        if (!this.owned) {
          const action = shouldTakeoverAttach(
            this.healthFailures,
            this.attachDownSince,
            Date.now(),
            this.opts.attachRetryMs,
            this.child !== null,
          );
          if (action === 'init') this.attachDownSince = Date.now();
          else if (action === 'takeover') {
            this.log('接管实例长时间失联，在原端口自起内置 dsh web 实例');
            this.attachDownSince = 0;
            void this.spawnOwn();
          }
        } else if (this.healthFailures >= 6 && this.child) {
          // 自有实例进程存活但服务无响应：强杀触发 onChildExit 重启
          this.log('自有实例挂死（进程存活但无响应），强杀重启');
          this.killTree(this.child);
        }
      }
    }, this.opts.healthIntervalMs);
  }

  /** 读取当前状态（函数调用形式，避免 TS 对可变属性的过时窄化） */
  private stateNow(): DshState {
    return this.state;
  }

  // ------------------------------------------------------------------
  // 退出与重启
  // ------------------------------------------------------------------

  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.childFinished = true;
    this.finishChild();
    this.child = null;
    this.stopResolvers.splice(0).forEach((resolve) => resolve());
    if (this.stopping) {
      this.log('dsh web 已退出');
      this.url = null;
      this.emitState('idle');
      return;
    }
    const now = Date.now();
    if (now - this.restartWindowStart > this.opts.restartWindowMs) {
      this.restarts = 0;
      this.restartWindowStart = now;
    }
    this.restarts += 1;
    this.log(`dsh web 意外退出（code=${code} signal=${signal}），第 ${this.restarts} 次重启`);
    if (this.restarts > this.opts.maxRestarts) {
      this.emitState('failed', `dsh web 在 ${Math.round(this.opts.restartWindowMs / 1000)}s 内崩溃 ${this.restarts} 次，已停止自动重启`);
      return;
    }
    this.scheduleRestart(`dsh web 已退出（code=${code} signal=${signal}）`);
  }

  private scheduleRestart(reason: string): void {
    const delay = backoffDelay(this.restarts);
    this.log(`${reason}，${delay}ms 后重启`);
    this.emitState('reconnecting', reason);
    this.restartTimer = setTimeout(() => {
      if (!this.stopping) void this.spawnOwn();
    }, delay);
  }

  /** 清理子进程相关资源（log fd、定时器） */
  private finishChild(): void {
    if (this.logFd !== null) {
      try {
        closeSync(this.logFd);
      } catch {
        /* 忽略 */
      }
      this.logFd = null;
    }
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.logPollTimer) clearInterval(this.logPollTimer);
    if (this.probeTimer) clearInterval(this.probeTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.bootTimer = null;
    this.logPollTimer = null;
    this.probeTimer = null;
    this.restartTimer = null;
  }

  private clearTimers(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  /** 强杀整棵进程树（Windows 用 taskkill /T，POSIX 用 SIGKILL） */
  private killTree(child: ChildProcess): void {
    try {
      if (child.pid !== undefined && process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      /* 进程可能已退出 */
    }
    this.stopResolvers.splice(0).forEach((resolve) => resolve());
  }
}

/**
 * 接管实例失联后的自起判定（纯函数，可单测）：
 * - `init`：失联计时尚未开始，调用方应记录 attachDownSince；
 * - `takeover`：失联超过 attachRetryMs，调用方应原位自起内置实例；
 * - `wait`：继续等待。
 */
export type AttachAction = 'init' | 'takeover' | 'wait';

export function shouldTakeoverAttach(
  healthFailures: number,
  attachDownSince: number,
  now: number,
  attachRetryMs: number,
  hasOwnChild: boolean,
): AttachAction {
  if (healthFailures < 3 || hasOwnChild) return 'wait';
  if (attachDownSince === 0) return 'init';
  return now - attachDownSince >= attachRetryMs ? 'takeover' : 'wait';
}
