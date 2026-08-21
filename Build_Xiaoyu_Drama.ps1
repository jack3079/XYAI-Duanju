param(
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [Parameter(Mandatory = $true)][string]$WebRoot,
    [Parameter(Mandatory = $true)][string]$ComputeCenterUrl,
    [switch]$SkipInstall,
    [switch]$SkipFfmpegDownload
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$AppRoot = (Resolve-Path $AppRoot).Path
$WebRoot = (Resolve-Path $WebRoot).Path
$node = Get-Command node -ErrorAction Stop
$yarn = Get-Command yarn -ErrorAction Stop
$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python -ErrorAction Stop }
$nodeInfo = (& $node.Source -p "JSON.stringify({major:Number(process.versions.node.split('.')[0]),arch:process.arch})") | ConvertFrom-Json
if ([int]$nodeInfo.major -lt 22 -or [string]$nodeInfo.arch -ne 'x64') { throw '需要 Node.js 22+ x64。' }
if (-not ((& $yarn.Source --version).Trim().StartsWith('1.'))) { throw '需要 Yarn 1.x。执行：npm install -g yarn@1.22.22' }

Write-Host '[1/8] 应用小鱼 P4 生产补丁' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'Apply_Xiaoyu_P4.ps1') -AppRoot $AppRoot -WebRoot $WebRoot -ComputeCenterUrl $ComputeCenterUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$runtimeDir = Join-Path $AppRoot 'data\runtime\ffmpeg'
$ffmpeg = Join-Path $runtimeDir 'ffmpeg.exe'
$ffprobe = Join-Path $runtimeDir 'ffprobe.exe'
if (-not ((Test-Path $ffmpeg) -and (Test-Path $ffprobe))) {
    if ($SkipFfmpegDownload) { throw '缺少 ffmpeg.exe/ffprobe.exe，且已要求跳过下载。' }
    Write-Host '[2/8] 下载并校验 Windows FFmpeg 运行时' -ForegroundColor Cyan
    $cache = Join-Path $PSScriptRoot '.cache\ffmpeg'
    $zip = Join-Path $cache 'ffmpeg-win64-gpl.zip'
    $extract = Join-Path $cache 'extract'
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    if (-not (Test-Path $zip)) {
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' -OutFile $zip
    }
    if ((Get-Item $zip).Length -lt 50000000) { throw 'FFmpeg 下载文件异常小，拒绝继续构建。' }
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $sourceFfmpeg = Get-ChildItem $extract -Recurse -Filter 'ffmpeg.exe' -File | Select-Object -First 1
    $sourceFfprobe = Get-ChildItem $extract -Recurse -Filter 'ffprobe.exe' -File | Select-Object -First 1
    if (-not $sourceFfmpeg -or -not $sourceFfprobe) { throw '下载包中未找到 ffmpeg.exe 或 ffprobe.exe。' }
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    Copy-Item $sourceFfmpeg.FullName $ffmpeg -Force
    Copy-Item $sourceFfprobe.FullName $ffprobe -Force
}
& $ffmpeg -version | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'ffmpeg.exe 无法运行。' }
& $ffprobe -version | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'ffprobe.exe 无法运行。' }

Write-Host '[3/8] 验证补丁完整性' -ForegroundColor Cyan
$verifyScript = Join-Path $PSScriptRoot 'tools\verify_toonflow_patch.py'
if ($python.Name -eq 'py.exe' -or $python.Name -eq 'py') { & $python.Source -3 $verifyScript --app-root $AppRoot --web-root $WebRoot --require-ffmpeg }
else { & $python.Source $verifyScript --app-root $AppRoot --web-root $WebRoot --require-ffmpeg }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '[4/8] 前端依赖与类型检查' -ForegroundColor Cyan
Push-Location $WebRoot
try {
    if (-not $SkipInstall) { & $yarn.Source install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
    & $yarn.Source type-check; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host '[5/8] 构建专业工作台' -ForegroundColor Cyan
    & $yarn.Source build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if (-not (Test-Path (Join-Path $WebRoot 'dist\index.html'))) { throw '前端构建产物缺失。' }
} finally { Pop-Location }

Write-Host '[6/8] 写入桌面端 Web 资源' -ForegroundColor Cyan
$targetWeb = Join-Path $AppRoot 'data\web'
if (Test-Path $targetWeb) { Remove-Item $targetWeb -Recurse -Force }
New-Item $targetWeb -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $WebRoot 'dist\*') $targetWeb -Recurse -Force

Write-Host '[7/8] 后端类型检查与构建' -ForegroundColor Cyan
Push-Location $AppRoot
try {
    if (-not $SkipInstall) { & $yarn.Source install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
    & $yarn.Source lint; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $yarn.Source build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host '[8/8] 生成 Windows x64 安装程序' -ForegroundColor Cyan
    & $yarn.Source electron-builder --win --x64; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
$installers = Get-ChildItem (Join-Path $AppRoot 'dist') -Filter '*setup.exe' -File -ErrorAction SilentlyContinue
if (-not $installers) { throw '构建结束但没有找到 setup.exe。' }
$installers | ForEach-Object { Write-Host "构建成功：$($_.FullName)" -ForegroundColor Green }
