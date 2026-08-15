# dsh-desktop

DeepSeek Harness 桌面壳：以 **Electron 薄壳** 托管 / 接管 `dsh web` 的客户端封装。

不改动 DSH 本体，不 fork 前端源码——桌面壳只是提供一个「本地客户端形态的宿主环境」：
窗口加载的仍是官方 web UI，但补上了浏览器模式下缺失的客户端能力
（托盘常驻、系统通知、开机自启、文件拖放、深链协议、崩溃自愈、独立进程生命周期管理）。

```
┌─────────────────────────────────────────────────────────────┐
│                    DeepSeek Harness Desktop                  │
│  ┌───────────────────┐      ┌─────────────────────────────┐ │
│  │   Electron 主进程  │ spawn │      dsh web 子进程         │ │
│  │  ┌─────────────┐  │─────▶│  (@deepseek-ai/dsh，内置)    │ │
│  │  │ DshManager  │  │ 接管 │  · Web 宿主 + API 代理        │ │
│  │  └─────────────┘  │◀─────│  · 前端静态服务(含 __DSH_BOOT__)│ │
│  │  窗口/托盘/通知    │ HTTP  │  · 原生目录选择器宿主         │ │
│  │  自启/深链/拖放    │◀────▶│  · 会话存储/工作区            │ │
│  └───────────────────┘      └─────────────────────────────┘ │
│   BrowserWindow ── 加载 http://127.0.0.1:<port>（官方 Web UI）│
└─────────────────────────────────────────────────────────────┘
```

## 为什么可以这样做（架构依据）

- `dsh web` 支持 `--host/--port/--trusted-host`，就绪后会打印 `dsh web: http://...` URL 行；
- UI 组合完全由宿主注入的 `window.__DSH_BOOT__` 决定，前端壳对宿主形态无感；
- 上游 `dsh-host-webserver` 文档明确预留了 Electron 形态（`file://` + IPC 桥）；
- `dsh-host-directory-picker-native` 在「回环绑定 + 本地显示器」时自动启用系统原生目录选择器，
  桌面壳恰好保证这个启动条件。

## 功能

- **托管 / 接管**：默认优先接管端口上已运行的 dsh web（如浏览器里已 `dsh web`），否则自起实例；
  随机端口（`port: 0`）强制自起
- **崩溃自愈**：子进程意外退出按指数退避（1s→30s 封顶）自动重启，120s 内崩溃超 5 次停止并通知；
  接管实例失联 45s 后自动在原端口自起新实例
- **托盘常驻**：显示/隐藏窗口、通知/托盘驻留/自启开关、重新连接、打开数据目录、退出
- **系统通知**：就绪 / 失败 / 崩溃等生命周期事件（可关）
- **开机自启**（Windows/macOS）
- **文件拖放**：拖入文件/文件夹 → 资源管理器打开或定位（扩展点见下文）
- **深链协议** `dsh-desktop://`：`focus` 聚焦窗口，`open-folder?path=<目录>` 用系统资源管理器打开
- **工作区根目录**：以 `dsh-desktop.exe <文件夹>` 启动时，该文件夹成为 dsh 的 workspace 根
- **单实例锁**（自实现 TCP 回环握手协议，替代 Electron `requestSingleInstanceLock`：
  后者依赖 Chromium 命名管道，在受限沙箱中会原生崩溃且不可捕获；
  回环 TCP 跨平台行为一致且可测试，端口占用被外来程序抢占时自动降级为无锁启动）、
  外链一律转交系统浏览器、渲染进程崩溃自动回退状态页
- **日志文件**：子进程 stdout/stderr 全量写入 `%APPDATA%/dsh-desktop/logs/dsh.log`（>5MB 自动轮转）；
  主进程诊断写入同目录 `main-diag.log`（异常、单实例、关键里程碑）

## 快速开始

要求：Node.js ≥ 20（开发/打包），Windows 10+ / macOS / Linux。

```sh
npm install          # 安装依赖（含 @deepseek-ai/dsh 与 Electron）
npm run icons        # 由 SVG 生成 PNG 图标（首次/改图标后）
npm start            # 编译 + 以 Electron 启动
```

### 受限环境安装（沙箱/企业代理/无全局缓存写入权限）

本仓库在受限沙箱中验证过如下安装路径：

```powershell
$env:npm_config_cache = "$pwd\.npm-cache"        # npm 缓存落到项目内
$env:ELECTRON_CACHE   = "$pwd\.electron-cache"   # Electron 二进制缓存落到项目内
npm install --ignore-scripts --no-audit --no-fund
node node_modules\electron\install.js            # 手动补齐 Electron 二进制（install.js 不 spawn 管道）
```

说明：`--ignore-scripts` 会跳过全部生命周期脚本（受限环境下 spawn 管道会被拦截）；
其中 Electron 靠上面的 `install.js` 手动补齐，其余包（node-pty、sharp、koffi）
的原生绑定以 npm 平台包/prebuilt 形式随包分发，无需脚本。
**koffi 例外**：其原生绑定由可选依赖 `@koromix/koffi-win32-x64` 提供
（Node-API 8，跨运行时 ABI 稳定，Electron run-as-node 下同样可用）；
若 npm 未自动装齐，手动补一条：

```powershell
npm install --ignore-scripts --no-save @koromix/koffi-win32-x64@3.1.5
```

（macOS/Linux 对应 `@koromix/koffi-darwin-*` / `@koromix/koffi-linux-*`。）
缺失时仅影响 dsh 的 Windows 原生目录选择器（koffi 驱动 IFileOpenDialog），
其余功能不受影响；dsh 组合层可用 browse 后端兜底。

### 受限环境的打包

electron-builder 需要从 GitHub 下载 `winCodeSign`（exe 图标/版本元数据嵌入）与 NSIS 工具，
且默认用 `npm ls` 收集依赖树（受限环境 spawn 管道会被拦截）。
以下「完全离线」流程已验证可产出 `release/win-unpacked`：

```powershell
# 1) 用 bun.lock 让 electron-builder 改用纯目录遍历采集器（跳过 npm ls spawn）
Rename-Item package-lock.json package-lock.json.bak
Set-Content bun.lock 'fake'
# 2) electronDist 指向本地已解包的 Electron，跳过下载；关闭 exe 元数据编辑（无需 winCodeSign）
node_modules\.bin\electron-builder --dir -c electron-builder.sandbox.yml
# 3) 还原锁文件
Rename-Item package-lock.json.bak package-lock.json
```

正常桌面环境直接 `npm run dist`（完整流程：图标嵌入 + NSIS 安装包）。

### 打包报 `connect ETIMEDOUT <github-ip>:443`？

electron-builder 除了 Electron 本体，还要从 **GitHub releases** 下载辅助工具链
（`winCodeSign` 用于 exe 图标/版本元数据嵌入，`nsis`/`nsis-resources` 用于生成安装包）。
GitHub 直连超时（尤其国内网络）时，用国内镜像一键打包：

```powershell
npm run dist:cn
```

等价于手动设置两个镜像环境变量后执行 `npm run dist`：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run dist
```

可用浏览器打开 https://npmmirror.com/mirrors/electron-builder-binaries/ 先确认镜像可达。
若镜像也不可达，仍可用上面的「受限环境离线流程」产出免安装版（`win-unpacked`）。

常用命令：

| 命令 | 说明 |
|---|---|
| `npm run build` | tsc 编译主进程/预加载脚本到 dist/ |
| `npm test` | 单元测试（URL 行解析、退避、设置合并） |
| `npm run test:integration` | 集成测试：真实启动 dsh web（随机端口+临时 DSH_HOME，不触碰现网实例） |
| `npm run dist` | electron-builder 打包（NSIS/DMG/AppImage） |
| `npm run dist:cn` | 走 npmmirror 国内镜像打包（GitHub 直连超时时使用） |
| `npm run dist:dir` | 免安装目录版（快速验证打包产物） |

## 设置

持久化于 `%APPDATA%/dsh-desktop/settings.json`（首启自动生成默认值）：

```json
{
  "host": "127.0.0.1",
  "port": 3080,
  "attachExisting": true,
  "autoStart": false,
  "minimizeToTray": true,
  "notifications": true,
  "dshArgs": [],
  "cwd": null,
  "dshBin": null
}
```

- `port`：期望端口；`0` = 随机端口（仅自有实例）
- `attachExisting`：端口上已有 dsh web 时直接接管（**不会**杀掉外部实例）
- `dshArgs`：追加给 `dsh web` 的参数（如 `["--trusted-host", "192.168.1.0/24"]`）
- `cwd`：dsh 工作目录（workspace 根）；`null` = 启动目录
- `dshBin`：自定义 dsh 可执行文件。默认用内置 `@deepseek-ai/dsh`：
  Electron 下以自身运行时（`ELECTRON_RUN_AS_NODE`，Electron 37 内嵌 Node 22.16，
  与 npm 安装的 prebuilt 原生插件 ABI 一致）执行；若遇到原生插件 ABI 不匹配，
  将 `dshBin` 指向系统 Node（如 `"C:\\Program Files\\nodejs\\node.exe"`）即可兜底

修改 port/host/dshBin/dshArgs/cwd 后重启应用生效（托盘开关项即时生效）。

## 目录结构

```
src/
  main/
    index.ts        主入口：单实例、状态机装配、IPC、退出回收
    dsh.ts          dsh 子进程生命周期（纯 Node，无 Electron 依赖，可独立测试）
    window.ts       窗口与安全策略（外链/导航白名单、崩溃兜底）
    tray.ts         托盘
    notifications.ts 系统通知
    autostart.ts    开机自启
    deep-link.ts    深链协议
    menu.ts         应用菜单
    settings.ts     设置合并（纯函数）
    config.ts       设置持久化
  preload/index.ts  contextBridge 桥（sandbox 模式，通道名与 shared/ipc.ts 同步）
  shared/           共享类型与 IPC 通道
renderer/status.html 启动/重连/错误状态页
test/unit/ test/integration/  node:test 测试
build/             SVG 源与生成的 PNG 图标
scripts/gen-icons.mjs 图标生成
```

## 已知限制与后续路线

- **Linux 开机自启**未实现（需写 `~/.config/autostart/*.desktop`）
- **拖放语义**目前是「在系统界面打开/定位」；将来可扩展为
  「拖入文件夹 → 以该目录为 workspace 重启自有 dsh 实例」
- **多窗口 / 任务栏进度**未实现（窗口级 UI 由官方 web 壳承载）
- **进程内嵌入（路线 B）**：若未来需要单进程形态，可将 `DshManager` 替换为
  直接 boot DSH 组合包（`dsh-app-boot`/`dsh-web-app`）+ `file://` 加载 dist +
  IPC fetch 桥（上游文档预留的接缝）。本项目的状态机/托盘/通知层无需改动。
- **打包产物**依赖内置 dsh 的原生插件 prebuilt 与 Electron 内嵌 Node ABI 一致
  （Electron 37 ↔ Node 22.16）；如需其它 Electron 版本，用 `dshBin` 指到系统 Node 兜底。
- **koffi 原生目录选择器**依赖平台预编译包 `@koromix/koffi-win32-x64`
  （见上「受限环境安装」）；缺失时 DSH 目录选择器交互会给出失败对话框，
  可在组合层改用 browse 后端兜底。
- **受限环境运行测试**：node:test 默认以子进程运行测试文件（受限环境 spawn 会被拦截），
  本仓库测试脚本已用 `--experimental-test-isolation=none` 改为进程内运行。
- **受限环境的 Electron GUI 验证**：受限沙箱会拦截 Chromium 初始化所需的系统调用
  （`whenReady` 之前必然原生崩溃），GUI 冒烟需在正常桌面环境执行 `npm start`。
  本仓库在受限环境已验证：模块装配、TCP 单实例协议、主进程状态机装配、设置持久化、
  真实 dsh web 的 spawn/接管/就绪探测/停机回收（集成测试）。

## 与社区同类项目

社区已有若干 Electron 壳（如 dsh-desktop-electron、deepseek-harness-desktop 等）。
本项目的差异点：内置 dsh 依赖（安装即用，无需另行配置）、接管/自起双模式 +
健康监控与崩溃自愈、日志文件化捕获（兼容受限环境）、深链与工作区参数、
完整的 node:test 测试（含真实 dsh 集成测试）。

## License

MIT
