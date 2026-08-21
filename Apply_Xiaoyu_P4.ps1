param(
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [Parameter(Mandatory = $true)][string]$WebRoot,
    [Parameter(Mandatory = $true)][string]$ComputeCenterUrl,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$python = Get-Command py -ErrorAction SilentlyContinue
if ($python) { $command = $python.Source; $argsList = @('-3', (Join-Path $PSScriptRoot 'tools\apply_toonflow_patch.py')) }
else { $python = Get-Command python -ErrorAction Stop; $command = $python.Source; $argsList = @((Join-Path $PSScriptRoot 'tools\apply_toonflow_patch.py')) }
$argsList += @('--app-root', (Resolve-Path $AppRoot).Path, '--web-root', (Resolve-Path $WebRoot).Path, '--compute-center-url', $ComputeCenterUrl)
if ($DryRun) { $argsList += '--dry-run' }
& $command @argsList
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
