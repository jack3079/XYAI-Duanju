param(
    [Parameter(Mandatory = $true, Position = 0)][string]$ComputeCenterUrl,
    [string]$WorkRoot = (Join-Path $PSScriptRoot '_xiaoyu_build'),
    [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$git = Get-Command git -ErrorAction Stop
$WorkRoot = [System.IO.Path]::GetFullPath($WorkRoot)
New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
$AppCommit = 'bc61ec7a1b5df31293b286981a5f4ad4635464ee'
$WebCommit = '9c4cb0ec7d4f6b4067c7768e2df8cdc7f8587214'
$AppRoot = Join-Path $WorkRoot 'Toonflow-app'
$WebRoot = Join-Path $WorkRoot 'Toonflow-web'
function Initialize-LockedRepository([string]$Path, [string]$RemoteUrl, [string]$Commit) {
    if (Test-Path (Join-Path $Path '.git')) {
        $head = (& $git.Source -C $Path rev-parse HEAD).Trim()
        if ($head -ne $Commit) { throw "源码版本不匹配：$Path 当前 $head，要求 $Commit。" }
        return
    }
    if ((Test-Path $Path) -and (Get-ChildItem $Path -Force -ErrorAction SilentlyContinue)) { throw "目录非空且不是 Git 仓库：$Path" }
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    & $git.Source -C $Path init; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $git.Source -C $Path remote add origin $RemoteUrl; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $git.Source -C $Path fetch --depth 1 origin $Commit; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $git.Source -C $Path checkout --detach FETCH_HEAD; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ((& $git.Source -C $Path rev-parse HEAD).Trim() -ne $Commit) { throw "锁定源码检出失败：$Path" }
}
Initialize-LockedRepository $AppRoot 'https://github.com/HBAI-Ltd/Toonflow-app.git' $AppCommit
Initialize-LockedRepository $WebRoot 'https://github.com/HBAI-Ltd/Toonflow-web.git' $WebCommit
$params = @{ AppRoot = $AppRoot; WebRoot = $WebRoot; ComputeCenterUrl = $ComputeCenterUrl }
if ($SkipInstall) { $params.SkipInstall = $true }
& (Join-Path $PSScriptRoot 'Build_Xiaoyu_Drama.ps1') @params
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
