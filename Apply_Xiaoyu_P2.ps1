param(
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [Parameter(Mandatory = $true)][string]$WebRoot,
    [Parameter(Mandatory = $true)][string]$ComputeCenterUrl,
    [switch]$DryRun
)
Write-Warning 'P2 补丁已被 P4 生产补丁替代，正在执行 P4。'
$params = @{ AppRoot = $AppRoot; WebRoot = $WebRoot; ComputeCenterUrl = $ComputeCenterUrl }
if ($DryRun) { $params.DryRun = $true }
& (Join-Path $PSScriptRoot 'Apply_Xiaoyu_P4.ps1') @params
exit $LASTEXITCODE
