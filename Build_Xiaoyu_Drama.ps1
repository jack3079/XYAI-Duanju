param(
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [Parameter(Mandatory = $true)][string]$WebRoot,
    [Parameter(Mandatory = $true)][string]$ComputeCenterUrl,
    [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$AppRoot = (Resolve-Path $AppRoot).Path
$WebRoot = (Resolve-Path $WebRoot).Path
$patcher = Join-Path $PSScriptRoot 'Apply_Xiaoyu_P2.ps1'
if (-not (Test-Path $patcher)) { throw "缺少补丁脚本：$patcher" }

$node = Get-Command node -ErrorAction SilentlyContinue
$yarn = Get-Command yarn -ErrorAction SilentlyContinue
if (-not $node) { throw '未安装 Node.js 22 x64 或未加入 PATH。' }
if (-not $yarn) { throw '未安装 Yarn 1.x。请先执行：npm install -g yarn@1.22.22' }
$nodeInfoRaw = & $node.Source -p "JSON.stringify({major:Number(process.versions.node.split('.')[0]),arch:process.arch})"
if ($LASTEXITCODE -ne 0) { throw '无法读取 Node.js 版本。' }
$nodeInfo = $nodeInfoRaw | ConvertFrom-Json
if ([int]$nodeInfo.major -lt 22 -or [string]$nodeInfo.arch -ne 'x64') {
    throw "需要 Node.js 22+ x64，当前主版本 $($nodeInfo.major)，架构 $($nodeInfo.arch)。"
}
$yarnVersion = (& $yarn.Source --version).Trim()
if ($LASTEXITCODE -ne 0 -or -not $yarnVersion.StartsWith('1.')) {
    throw "需要 Yarn 1.x，当前版本：$yarnVersion"
}

Write-Host '[1/6] 校验锁定版本并应用小鱼真实代码补丁' -ForegroundColor Cyan
& $patcher -AppRoot $AppRoot -WebRoot $WebRoot -ComputeCenterUrl $ComputeCenterUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '[2/6] 安装并检查前端依赖' -ForegroundColor Cyan
Push-Location $WebRoot
try {
    if (-not $SkipInstall) { & $yarn.Source install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
    & $yarn.Source type-check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host '[3/6] 构建小鱼专业工作台前端' -ForegroundColor Cyan
    & $yarn.Source build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $webDist = Join-Path $WebRoot 'dist'
    if (-not (Test-Path (Join-Path $webDist 'index.html'))) { throw '前端构建完成但 dist\index.html 不存在。' }
} finally { Pop-Location }

Write-Host '[4/6] 将前端产物写入桌面端资源目录' -ForegroundColor Cyan
$targetWeb = Join-Path $AppRoot 'data\web'
if (Test-Path $targetWeb) { Remove-Item $targetWeb -Recurse -Force }
New-Item $targetWeb -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $WebRoot 'dist\*') $targetWeb -Recurse -Force

Write-Host '[5/6] 安装、类型检查并构建桌面端' -ForegroundColor Cyan
Push-Location $AppRoot
try {
    if (-not $SkipInstall) { & $yarn.Source install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
    & $yarn.Source lint
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $yarn.Source build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host '[6/6] 生成 Windows 安装 EXE' -ForegroundColor Cyan
    & $yarn.Source electron-builder --win --x64
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }

$installers = Get-ChildItem (Join-Path $AppRoot 'dist') -Filter '*setup.exe' -File -ErrorAction SilentlyContinue
if (-not $installers) { throw '构建命令结束，但没有找到 Windows setup.exe。' }
Write-Host '构建成功：' -ForegroundColor Green
$installers | ForEach-Object { Write-Host $_.FullName -ForegroundColor Green }
