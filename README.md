<p align="center">
  <img src="build/icon.png" width="128" alt="DeepSeek Harness Desktop" />
</p>

<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  <a href="https://github.com/crazzyHuang/dsh-desktop/releases"><img src="https://img.shields.io/github/v/release/crazzyHuang/dsh-desktop" alt="latest release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/crazzyHuang/dsh-desktop" alt="license"></a>
  <img src="https://img.shields.io/badge/Electron-37-47848F" alt="Electron 37">
  <img src="https://img.shields.io/badge/dsh-0.1.0--rc.6-4D6BFE" alt="dsh">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="platforms">
</p>

<p align="center">
  <b>将 DeepSeek Harness 的 Web GUI 封装为桌面客户端 —— 一个不改动 DSH 本体的 Electron 薄壳</b>
</p>

---

## ✨ 特性

**桌面原生体验**

- 🖥️ **托管 / 接管 `dsh web`**：**不依赖外部服务**——优先复用本机已运行的实例，否则自动拉起内置实例；外部实例关闭后自动在原端口自起，无需手动重启
- 📌 **托盘常驻**：显示/隐藏窗口、通知 / 托盘驻留 / 开机自启开关、重新连接、打开数据目录
- 🔔 **系统通知**：就绪、崩溃、失败等生命周期事件（可在托盘关闭）
- 🚀 **开机自启**（Windows / macOS）
- 🖱️ **文件拖放**：拖入文件/文件夹 → 资源管理器打开或定位
- 🔗 **深链协议** `dsh-desktop://`：跨应用聚焦窗口、打开目录
- 📁 **工作区参数**：以 `dsh-desktop.exe <文件夹>` 启动，该目录即成为 dsh 的 workspace 根

**可靠性与安全**

- 🛡️ **崩溃自愈**：子进程意外退出按指数退避（1s→30s）自动重启，120s 内崩溃超 5 次停止并通知；接管实例失联 45s 后原位自起
- 🧵 **单实例**：自实现 TCP 回环握手协议，替代 `requestSingleInstanceLock`（受限环境下后者会原生崩溃），跨平台行为一致
- 🔒 **安全默认**：`contextIsolation` + `sandbox` 渲染进程、IPC 调用来源白名单、外链一律转交系统浏览器
- 🔄 **在线更新**：electron-updater + GitHub Releases（latest.yml 差分更新），托盘「检查更新」、下载完成后「重启并安装更新」
- 📝 **日志文件**：dsh 子进程输出全量落盘（>5MB 自动轮转），主进程异常写入诊断日志

**工程化**

- 🧩 核心模块（`DshManager`）与 Electron 解耦，纯 Node 可独立测试
- ✅ 单元测试 12 项 + 真实 dsh 集成测试 2 项（`node:test`，无需 mock）
- 📦 electron-builder 三平台打包（NSIS / DMG / AppImage），内置 dsh 依赖，用户无需安装 Node.js

## 🎯 设计理念

**薄壳，而非 fork**：窗口加载的是官方 Web UI 原样，桌面壳只补上浏览器形态缺失的客户端能力。

这之所以可行，是因为 DSH 的架构天然支持：

- `dsh web` 支持 `--host/--port/--trusted-host`，就绪后打印 `dsh web: http://…` URL 行；
- UI 组合完全由宿主注入的 `window.__DSH_BOOT__` 决定，前端壳对宿主形态无感；
- 上游 `dsh-host-webserver` 文档明确预留了 Electron 形态（`file://` + IPC 桥）；
- `dsh-host-directory-picker-native` 在「回环绑定 + 本地显示器」下自动启用**系统原生目录选择器**——桌面壳恰好保证了这个启动条件。

因此：**上游升级零成本**（更新 `@deepseek-ai/dsh` 依赖即可），用户自定义插件（`dsh plugin add`）原样可用。

## 📦 安装

从 [Releases](https://github.com/crazzyHuang/dsh-desktop/releases) 下载对应平台的安装包：

| 平台 | 产物 | 说明 |
|---|---|---|
| Windows | `DeepSeek Harness Desktop-Setup-<版本>.exe` | NSIS 安装向导，内置 dsh 依赖 |

下载后建议校验 SHA256（每个 Release 的说明中附有校验值）：

```powershell
Get-FileHash .\DeepSeek.Harness.Desktop-Setup-0.1.0.exe -Algorithm SHA256
```

macOS / Linux 暂未发布预编译包，可本地打包（见[打包](#-打包与发布)）。

> **环境要求**：仅开发/打包需要 Node.js ≥ 20；安装包用户无需任何前置依赖。

## 🚀 快速开始（开发）

```sh
git clone https://github.com/crazzyHuang/dsh-desktop.git
cd dsh-desktop
npm install          # 安装依赖（含 @deepseek-ai/dsh 与 Electron）
npm run icons        # 由 SVG 生成 PNG 图标（首次或修改图标后）
npm start            # 编译 + 以 Electron 启动
```

> 国内网络下 npm / Electron 下载缓慢？见[受限环境参考](#-受限环境参考)。

## 📖 使用指南

### 启动与接管

- 应用启动后按顺序尝试：**接管** `127.0.0.1:<port>` 上已在运行的 dsh web（如浏览器里正开着的 `dsh web`）→ 无响应则**自起**内置实例。
- **外部服务关闭后自动自愈**：接管的实例失联后进入重连，约 15 秒后自动在原端口自起内置实例并恢复服务；外部实例若重新启动，应用会重新接管它。
- 退出应用时只回收**自有**实例，不会误杀外部运行的 dsh web。

### 托盘菜单

| 菜单项 | 行为 |
|---|---|
| 显示 / 隐藏窗口 | 切换主窗口 |
| 系统通知 / 关闭时最小化到托盘 / 开机自启 | 开关项，即时生效并持久化 |
| 检查更新 / 自动检查更新 | 手动检查（无更新时通知「已是最新版本」）/ 开关启动时自动检查 |
| 重启并安装更新 (v…) | 更新下载完成后出现，点击立即重启安装 |
| 重新连接 dsh web | 重置重启预算并重新启动/接管 |
| 打开数据目录 | 打开 `%APPDATA%\dsh-desktop`（含设置与日志） |

### 深链协议

| URL | 行为 |
|---|---|
| `dsh-desktop://focus` | 聚焦主窗口 |
| `dsh-desktop://open-folder?path=<目录>` | 用系统资源管理器打开目录 |

### 日志与诊断

| 文件 | 位置 | 内容 |
|---|---|---|
| `dsh.log` | `%APPDATA%\dsh-desktop\logs\` | dsh 子进程 stdout/stderr 全量（>5MB 自动轮转） |
| `main-diag.log` | 同上 | 主进程异常、单实例、关键里程碑 |

### 环境变量

| 变量 | 说明 |
|---|---|
| `DSH_DESKTOP_SINGLETON_PORT` | 覆盖单实例握手端口（默认 `43110`） |
| `DSH_HOME` | 透传给 dsh，指定 profile / 会话数据目录 |

## ⚙️ 配置参考

设置持久化于 `%APPDATA%\dsh-desktop\settings.json`（首启自动生成默认值）：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `host` | `127.0.0.1` | 监听地址（保持回环以启用原生目录选择器） |
| `port` | `3080` | 期望端口；`0` = 随机端口（仅自有实例） |
| `attachExisting` | `true` | 端口已有 dsh web 时优先接管（不杀外部实例） |
| `autoStart` | `false` | 登录时自动启动 |
| `minimizeToTray` | `true` | 关闭窗口时驻留托盘而非退出 |
| `notifications` | `true` | 生命周期系统通知 |
| `autoUpdate` | `true` | 启动后自动检查更新（electron-updater，GitHub Releases 源） |
| `dshArgs` | `[]` | 追加给 `dsh web` 的参数，如 `["--trusted-host", "192.168.1.0/24"]` |
| `cwd` | `null` | dsh 工作目录（workspace 根）；`null` = 启动目录 |
| `dshBin` | `null` | 自定义 dsh 可执行文件；默认使用内置 `@deepseek-ai/dsh`（Electron 以 `ELECTRON_RUN_AS_NODE` 执行自身运行时，无需系统 Node） |

修改 `port` / `host` / `dshBin` / `dshArgs` / `cwd` 后重启应用生效（托盘开关项即时生效）。

## 🏗️ 架构

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

| 模块 | 职责 |
|---|---|
| `src/main/dsh.ts` | dsh 子进程生命周期：spawn/接管、URL 解析、健康监控、退避重启、整树强杀（**纯 Node，无 Electron 依赖**） |
| `src/main/single-instance.ts` | TCP 回环单实例握手协议（主实例/次级实例/外来占用降级） |
| `src/main/index.ts` | 装配入口：状态机 → 窗口/托盘/通知/IPC/退出回收 |
| `src/main/window.ts` | 窗口与安全策略：外链与导航白名单、渲染进程崩溃兜底 |
| `src/main/tray.ts` / `notifications.ts` / `autostart.ts` / `deep-link.ts` / `menu.ts` | 桌面能力封装 |
| `src/main/settings.ts` / `config.ts` / `paths.ts` | 设置合并（纯函数）、持久化、数据目录 |
| `src/preload/index.ts` | contextBridge 桥（sandbox 模式）与文件拖放拦截 |
| `renderer/status.html` | 启动 / 重连 / 错误状态页 |

## 🧪 测试

```sh
npm test                # 单元测试（URL 解析、退避、设置合并、单实例协议）
npm run test:integration # 集成测试：真实启动 dsh web（随机端口 + 临时 DSH_HOME，不触碰现网实例）
```

- 集成测试覆盖：固定端口自起→就绪→停机→端口释放；随机端口下 URL 必须从日志行解析。
- 单实例测试覆盖：跨进程主/次级判定与通知送达、端口释放后可重新获取。

## 📦 打包与发布

| 命令 | 说明 |
|---|---|
| `npm run dist` | electron-builder 完整打包（图标嵌入 + 安装包） |
| `npm run dist:cn` | 走 npmmirror 国内镜像打包（GitHub 直连超时时使用） |
| `npm run dist:dir` | 免安装目录版（`release/win-unpacked`，快速验证） |
| `npm run publish:release -- <tag> <资产...>` | 调用幂等发布脚本创建 Release 并上传资产 |

### 🔄 发布新版本 / 跟随上游升级

上游 DeepSeek Harness 以 npm 发布（`@deepseek-ai/dsh`，各 `dsh-*` 包版本号锁步）。
跟进发版用内置的半自动脚本，一条命令完成「升级依赖 → 测试 → 打版本 → 打包 → 发布 → 推送」：

```powershell
# 上游发新版本时（--dsh latest 自动取 npm 上的最新版），并发布应用 0.2.0：
$env:GH_TOKEN = '从 git credential fill 获取的 password'
node scripts/release.mjs 0.2.0 --dsh latest --cn

# 只发版、不动 dsh 依赖：
node scripts/release.mjs 0.1.1 --cn

# 预览将执行的步骤（不实际执行）：
node scripts/release.mjs 0.2.0 --dsh latest --cn --dry-run
```

脚本步骤：查询上游最新版本 → `npm install @deepseek-ai/dsh@<目标>`（自动补 koffi 平台包）
→ 单元 + 集成测试 → 写入版本号并提交/打标签 → 打包 → 上传
**安装包 + latest.yml + blockmap**（在线更新所需）→ 推送 main 与标签。

> 发布后，已安装的用户启动应用即可收到在线更新（见下节），无需手动重装。

### ⚡ 在线更新（用户侧）

安装版内置 electron-updater，更新源为 GitHub Releases：

- **自动**：启动 15 秒后后台检查，发现新版本自动下载（托盘 tooltip 显示进度），下载完成通知，退出应用时自动安装；托盘「重启并安装更新 (v…)」可立即安装；
- **手动**：托盘或帮助菜单「检查更新」，无更新时明确提示「已是最新版本」；
- **开关**：托盘「自动检查更新」可关闭自动检查（设置项 `autoUpdate`）。

注意事项：

- 差分更新依赖 Release 中随安装包上传的 `latest.yml` 与 `.blockmap`（发布脚本已自动处理）；
- 应用未做代码签名，Windows SmartScreen 可能提示；更新安装由 electron-updater 静默完成，不受影响；
- 国内网络下载 GitHub 更新包可能较慢，失败会自动回退为「手动下载安装包覆盖安装」。

### 发布 Release

使用内置的幂等发布脚本（通过 Git Credential Manager 凭据调用 GitHub API，流式上传大文件）：

```powershell
$env:GH_TOKEN = '从 git credential fill 获取的 password'
node scripts/publish-release.mjs v0.1.0 "release\DeepSeek Harness Desktop-Setup-0.1.0.exe"
```

- 幂等：Release 已存在则复用、同名资产自动跳过，可安全重试；
- 或使用 `gh` CLI：`gh release create v0.1.0 "release\...exe" --title "..." --notes-file ...`

### 常见问题

**打包报 `connect ETIMEDOUT <github-ip>:443`？** electron-builder 需要从 GitHub releases 下载 `winCodeSign`（exe 图标/版本元数据嵌入）与 NSIS 工具链，直连超时（尤其国内网络）时：

```powershell
npm run dist:cn
# 等价于：
# $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
# $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
# npm run dist
```

## 🗺️ 路线图与已知限制

**已完成（v0.1.0）**

- [x] 托管/接管双模式 + 健康监控 + 崩溃自愈
- [x] 托盘、通知、自启、深链、拖放、单实例
- [x] 在线更新（electron-updater + GitHub Releases）
- [x] 单元 + 集成测试、三平台打包配置、国内镜像打包

**规划中**

- [ ] 拖入文件夹 → 以该目录为 workspace 重启自有 dsh 实例
- [ ] 多窗口 / 任务栏进度
- [ ] Linux 开机自启（`~/.config/autostart/*.desktop`）
- [ ] 进程内嵌入（路线 B：主进程直接 boot DSH 组合包，单进程形态）

**已知限制**

- 窗口级 UI 由官方 Web UI 承载，本项目不提供定制界面；
- koffi 原生目录选择器依赖平台预编译包（`@koromix/koffi-win32-x64`），缺失时回退 DSH 组合层的 browse 后端；
- 打包产物的原生插件 prebuilt 与 Electron 37 内嵌 Node 22.16 的 ABI 对齐，更换 Electron 版本时可用 `dshBin` 指向系统 Node 兜底。

## 🤝 贡献

欢迎 Issue 与 PR。约定：

- 使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 提交信息；
- 核心逻辑变更请补充 `node:test` 测试（`npm test` / `npm run test:integration`）；
- TypeScript 保持 `strict` 模式通过（`npm run build`）；
- 涉及 IPC 通道变更时，同步 `src/shared/ipc.ts` 与 `src/preload/index.ts`（sandbox 预加载内联了一份通道常量）。

## 🙏 相关项目

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) —— DSH 本体，本项目的上游
- 社区同类壳：[dsh-desktop-electron](https://github.com/Void0312Aurora/dsh-desktop-electron)、[deepseek-harness-desktop](https://github.com/cc1252/deepseek-harness-desktop)、[oh-dsh](https://github.com/hust-open-atom-club/oh-dsh)

本项目差异点：内置 dsh 依赖（安装即用）、接管/自起双模式 + 健康监控与崩溃自愈、日志文件化捕获、深链与工作区参数、完整 node:test 测试（含真实 dsh 集成测试）。

## 📄 License

[MIT](./LICENSE)

---

<details>
<summary>🔧 受限环境参考（沙箱 / CI / 受限网络）</summary>

以下流程在受限沙箱（禁止命名管道、仅 npm registry 出网）中验证过，普通环境无需关注。

### 安装

```powershell
$env:npm_config_cache = "$pwd\.npm-cache"        # npm 缓存落到项目内
$env:ELECTRON_CACHE   = "$pwd\.electron-cache"   # Electron 二进制缓存落到项目内
npm install --ignore-scripts --no-audit --no-fund
node node_modules\electron\install.js            # 手动补齐 Electron 二进制
```

`--ignore-scripts` 会跳过全部生命周期脚本（受限环境 spawn 管道被拦截）。Electron 靠
`install.js` 手动补齐；node-pty / sharp / koffi 的原生绑定以 npm 平台包形式随包分发。
koffi 平台包若未自动装齐：

```powershell
npm install --ignore-scripts --no-save @koromix/koffi-win32-x64@3.1.5
```

### 打包（完全离线，产出 win-unpacked）

```powershell
# 1) bun.lock 让 electron-builder 改用纯目录遍历采集器（跳过 npm ls spawn）
Rename-Item package-lock.json package-lock.json.bak
Set-Content bun.lock 'fake'
# 2) electronDist 指向本地已解包的 Electron；关闭 exe 元数据编辑（无需 winCodeSign）
node_modules\.bin\electron-builder --dir -c electron-builder.sandbox.yml
# 3) 还原锁文件
Rename-Item package-lock.json.bak package-lock.json
```

### 测试

`node:test` 默认以子进程运行测试文件（受限环境 spawn 被拦截），本仓库测试脚本已用
`--experimental-test-isolation=none` 改为进程内运行。

### 限制说明

受限沙箱会拦截 Chromium 初始化所需的系统调用（`whenReady` 前原生崩溃），
Electron GUI 冒烟需在正常桌面环境执行 `npm start`。受限环境已验证：
模块装配、TCP 单实例协议、主进程状态机装配、设置持久化、真实 dsh web 的
spawn/接管/就绪探测/停机回收（集成测试）。

</details>
