import { connect, createServer } from 'node:net';
import type { Server, Socket } from 'node:net';

/**
 * 自实现单实例锁（TCP 回环握手），替代 Electron 的 requestSingleInstanceLock。
 *
 * 原因：requestSingleInstanceLock 依赖 Chromium 的命名管道单例机制，
 * 在受限环境（命名管道被拦截的沙箱）下会原生崩溃且不可捕获；
 * 回环 TCP 在普通环境与受限环境行为一致，且可测试。
 *
 * 协议（换行分隔的 JSON）：
 * - 主实例监听 127.0.0.1:port；
 * - 次级实例连接后发送 `{"type":"second-instance","argv":[...]}`，
 *   收到主实例回执 `ok\n` 后退出；
 * - 端口被外来程序占用时握手失败，降级为无锁启动（不误杀自己）。
 */

const DEFAULT_PORT = 43110;

export interface SecondInstancePayload {
  type: 'second-instance';
  argv: string[];
}

export interface Singleton {
  isPrimary: boolean;
  /** 仅主实例持有；应用退出时自动随进程释放 */
  close(): void;
}

/**
 * 尝试成为主实例。
 * @param onSecondInstance 主实例收到次级实例消息时的回调（携带其 argv）
 */
export function acquireSingleton(
  onSecondInstance: (payload: SecondInstancePayload) => void,
  port = resolveSingletonPort(),
): Promise<Singleton> {
  return new Promise((resolve) => {
    const server: Server = createServer((socket: Socket) => {
      let buf = '';
      socket.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line === '') continue;
          // 先回执再处理：保证次级实例能及时退出，主实例回调异常不影响协议
          socket.write('ok\n');
          try {
            const payload = JSON.parse(line) as SecondInstancePayload;
            if (payload.type === 'second-instance') onSecondInstance(payload);
          } catch {
            /* 外来数据忽略 */
          }
        }
      });
    });

    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code !== 'EADDRINUSE') {
        // 端口策略失败：降级为无锁启动
        resolve({ isPrimary: true, close: () => {} });
        return;
      }
      // 端口被占用：与占用者握手确认是否为同应用的实例
      handshake(port).then((isOurs) => {
        if (isOurs) {
          resolve({ isPrimary: false, close: () => {} });
        } else {
          // 外来程序占用：不拦截自己，降级启动
          resolve({ isPrimary: true, close: () => {} });
        }
      });
    };

    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      server.on('error', () => {
        /* 运行期错误忽略，单实例语义由端口占用自然保证 */
      });
      resolve({
        isPrimary: true,
        close: () => {
          try {
            server.close();
          } catch {
            /* 忽略 */
          }
        },
      });
    });
  });
}

/** 连接已有实例：发送次级实例通知并等待回执 */
export function notifyPrimary(argv: string[], port = resolveSingletonPort()): Promise<void> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: '127.0.0.1', port }, () => {
      socket.write(JSON.stringify({ type: 'second-instance', argv }).slice(0, 64 * 1024) + '\n');
      setTimeout(() => {
        socket.destroy();
        resolvePromise();
      }, 400);
    });
    socket.on('error', () => resolvePromise());
  });
}

/** 握手：探测占用端口的是否为本应用实例（发送 ping，期待 ok 回执） */
function handshake(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: '127.0.0.1', port }, () => {
      socket.write('{"type":"second-instance","argv":[]}\n');
      const timer = setTimeout(() => {
        socket.destroy();
        resolvePromise(false);
      }, 800);
      let gotOk = false;
      socket.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes('ok')) gotOk = true;
      });
      socket.on('close', () => {
        clearTimeout(timer);
        resolvePromise(gotOk);
      });
    });
    socket.on('error', () => resolvePromise(false));
  });
}

export function resolveSingletonPort(): number {
  const env = Number(process.env.DSH_DESKTOP_SINGLETON_PORT);
  return Number.isInteger(env) && env > 0 && env <= 65535 ? env : DEFAULT_PORT;
}
