param(
    [Parameter(Mandatory = $true, Position = 0)][string]$ComputeCenterUrl,
    [string]$WorkRoot = (Join-Path $PSScriptRoot '_xiaoyu_build'),
    [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { throw '未安装 Git 或未加入 PATH。' }
$WorkRoot = [System.IO.Path]::GetFullPath($WorkRoot)
New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null

$AppCommit = 'bc61ec7a1b5df31293b286981a5f4ad4635464ee'
$WebCommit = '9c4cb0ec7d4f6b4067c7768e2df8cdc7f8587214'
$AppRoot = Join-Path $WorkRoot 'Toonflow-app'
$WebRoot = Join-Path $WorkRoot 'Toonflow-web'

function Initialize-LockedRepository {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$RemoteUrl,
        [Parameter(Mandatory = $true)][string]$Commit
    )
    if (Test-Path (Join-Path $Path '.git')) {
        $head = (& $git.Source -C $Path rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or $head -ne $Commit) {
            throw "源码版本不匹配：$Path 当前 $head，要求 $Commit。"
        }
        return
    }
    if ((Test-Path $Path) -and (Get-ChildItem $Path -Force -ErrorAction SilentlyContinue)) {
        throw "目录非空且不是 Git 仓库：$Path"
    }
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    & $git.Source -C $Path init
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $git.Source -C $Path remote add origin $RemoteUrl
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $git.Source -C $Path fetch --depth 1 origin $Commit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $git.Source -C $Path checkout --detach FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $head = (& $git.Source -C $Path rev-parse HEAD).Trim()
    if ($head -ne $Commit) { throw "锁定源码检出失败：$Path" }
}

Write-Host '[准备] 获取锁定版本 ToonFlow 后端/桌面端源码' -ForegroundColor Cyan
Initialize-LockedRepository -Path $AppRoot -RemoteUrl 'https://github.com/HBAI-Ltd/Toonflow-app.git' -Commit $AppCommit
Write-Host '[准备] 获取锁定版本 ToonFlow Web 源码' -ForegroundColor Cyan
Initialize-LockedRepository -Path $WebRoot -RemoteUrl 'https://github.com/HBAI-Ltd/Toonflow-web.git' -Commit $WebCommit

$builder = Join-Path $PSScriptRoot 'Build_Xiaoyu_Drama.ps1'
$params = @{
    AppRoot = $AppRoot
    WebRoot = $WebRoot
    ComputeCenterUrl = $ComputeCenterUrl
}
if ($SkipInstall) { $params.SkipInstall = $true }
& $builder @params
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
