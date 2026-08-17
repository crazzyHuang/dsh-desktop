/**
 * 桌面壳设置（持久化于 userData/settings.json）。
 * 与 Electron 无关的纯类型，供主进程与测试共用。
 */
export interface DesktopSettings {
  /** 监听地址，默认 127.0.0.1 */
  host: string;
  /** 期望端口；0 = 由 dsh 随机分配（仅自有实例） */
  port: number;
  /** 端口已被 dsh web 占用时直接接管，不再自启实例 */
  attachExisting: boolean;
  /** 登录时自动启动 */
  autoStart: boolean;
  /** 关闭窗口时最小化到托盘而不是退出 */
  minimizeToTray: boolean;
  /** 允许系统通知（生命周期事件） */
  notifications: boolean;
  /** 启动后自动检查更新（electron-updater，GitHub Releases 源） */
  autoUpdate: boolean;
  /** 追加给 `dsh web` 的额外参数 */
  dshArgs: string[];
  /** dsh 工作目录（workspace 根）；null = 使用启动目录 */
  cwd: string | null;
  /** 自定义 dsh 可执行文件；null = 使用内置 @deepseek-ai/dsh */
  dshBin: string | null;
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  host: '127.0.0.1',
  port: 3080,
  attachExisting: true,
  autoStart: false,
  minimizeToTray: true,
  notifications: true,
  autoUpdate: true,
  dshArgs: [],
  cwd: null,
  dshBin: null,
};

/** dsh 生命周期状态 */
export type DshState =
  | 'idle' // 未启动 / 已停止
  | 'starting' // 自有实例启动中
  | 'attached' // 已接管外部运行的 dsh web
  | 'ready' // 自有实例已就绪
  | 'reconnecting' // 连接断开，正在重试
  | 'failed'; // 反复崩溃，已放弃自动重启

/** DshManager 状态事件负载 */
export interface DshStateInfo {
  state: DshState;
  /** 已解析出的 dsh web URL（可能为 null） */
  url: string | null;
  /** 当前实例是否由本壳进程拥有（false = 接管的外部实例） */
  owned: boolean;
  /** 可选错误说明 */
  error?: string;
}
