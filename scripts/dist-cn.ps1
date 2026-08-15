# 使用国内镜像执行完整打包（解决 GitHub 直连超时问题）
# 用法（项目根目录）: npm run dist:cn
$ErrorActionPreference = 'Stop'

$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

Write-Host '[dist-cn] ELECTRON_MIRROR 与 ELECTRON_BUILDER_BINARIES_MIRROR 已指向 npmmirror'
npm run dist
