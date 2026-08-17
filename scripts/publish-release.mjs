/**
 * 发布 GitHub Release 并上传资产（幂等，可重试）。
 *
 * 用法（Windows PowerShell，凭据由 Git Credential Manager 提供）：
 *   $env:GH_TOKEN = (git credential fill 得到的 password)
 *   node scripts/publish-release.mjs v0.1.0 "release\DeepSeek Harness Desktop-Setup-0.1.0.exe" release\latest.yml ...
 *
 * 选项：
 *   --notes-file <path>  使用自定义发布说明（默认内置模板）
 *
 * 幂等性：tag 对应的 Release 已存在时复用并补传缺失资产；同名资产已存在则跳过。
 * 大文件用 node:https 流式上传（30 分钟超时），不受 fetch/undici 默认头超时限制。
 *
 * 在线更新（electron-updater）需要同时上传：安装包、latest.yml、安装包 .blockmap。
 */
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs';
import { request } from 'node:https';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const notesFileIdx = argv.indexOf('--notes-file');
let notesFile = null;
if (notesFileIdx >= 0) {
  notesFile = argv[notesFileIdx + 1];
  argv.splice(notesFileIdx, 2);
}
const [tag, ...assetArgs] = argv;
if (!tag || assetArgs.length === 0) {
  console.error('用法: node scripts/publish-release.mjs <tag> <资产文件...>');
  process.exit(2);
}
for (const f of assetArgs) {
  if (!existsSync(f)) {
    console.error(`资产不存在: ${f}`);
    process.exit(2);
  }
}

const token = process.env.GH_TOKEN;
if (!token) {
  console.error('缺少 GH_TOKEN 环境变量（可从 `git credential fill` 的 password 取得，或使用 gh CLI）');
  process.exit(2);
}

/** 从 origin 远程解析 owner/repo（仅支持 https/ssh 的 github.com 形式） */
function resolveRepo() {
  let url;
  try {
    url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

const repo = resolveRepo();
if (!repo) {
  console.error('无法从 git remote.origin.url 解析 GitHub 仓库');
  process.exit(2);
}

const apiHeaders = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'dsh-desktop-publish',
  'X-GitHub-Api-Version': '2022-11-28',
};

const DEFAULT_NOTES = [
  '## 安装',
  '',
  '运行安装包按向导安装（内置 dsh 依赖，无需另行安装 Node.js）。',
  '',
  '## 使用说明',
  '',
  '启动后应用会自动接管 127.0.0.1:3080 上已运行的 dsh web，或在默认端口自起新实例；',
  '设置文件位于 `%APPDATA%\\dsh-desktop\\settings.json`，日志位于同目录 `logs\\`。',
  '',
  '更多信息见仓库 README。',
].join('\n');

const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : DEFAULT_NOTES;

/** 通过 GitHub API 的 JSON 调用（小请求用 fetch 即可） */
async function apiJson(url, init) {
  const res = await fetch(url, { ...init, headers: { ...apiHeaders, ...(init?.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 1000)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** 流式上传资产（node:https，30 分钟超时） */
function uploadAsset(uploadUrl, filePath) {
  return new Promise((resolve, reject) => {
    const url = new URL(uploadUrl);
    const size = statSync(filePath).size;
    const req = request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': size,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'dsh-desktop-publish',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error(`上传响应解析失败: ${body.slice(0, 500)}`));
            }
          } else {
            reject(new Error(`上传失败 HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
          }
        });
      },
    );
    req.setTimeout(30 * 60_000, () => req.destroy(new Error('上传超时（30 分钟）')));
    req.on('error', reject);
    createReadStream(filePath).pipe(req);
  });
}

console.log(`发布目标: ${repo.owner}/${repo.repo} @ ${tag}（${assetArgs.length} 个资产）`);

// 幂等：已存在则复用，不存在才创建
let release = null;
try {
  release = await apiJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/tags/${tag}`);
  console.log(`Release 已存在，复用: ${release.html_url}`);
} catch (err) {
  if (!String(err.message).includes('HTTP 404')) throw err;
  release = await apiJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: `DeepSeek Harness Desktop ${tag}`,
      body: notes,
      draft: false,
      prerelease: false,
    }),
  });
  console.log(`Release 已创建: ${release.html_url}`);
}

const existing = (release.assets ?? []).map((a) => a.name);
for (const file of assetArgs) {
  const name = file.split(/[\\/]/).pop();
  if (existing.includes(name)) {
    console.log(`资产已存在，跳过: ${name}`);
    continue;
  }
  const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(name)}`);
  console.log(`上传 ${name}（${(statSync(file).size / 1024 / 1024).toFixed(1)} MB）…`);
  const asset = await uploadAsset(uploadUrl, file);
  console.log(`资产已上传: ${asset.browser_download_url}（${asset.size} 字节）`);
}
console.log('发布完成。');
