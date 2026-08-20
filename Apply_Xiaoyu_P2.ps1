param(
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [Parameter(Mandatory = $true)][string]$WebRoot,
    [Parameter(Mandatory = $true)][string]$ComputeCenterUrl,
    [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$python = Get-Command py -ErrorAction SilentlyContinue
if ($python) {
    $runner = @("-3", (Join-Path $PSScriptRoot "tools\apply_toonflow_patch.py"))
} else {
    $python = Get-Command python -ErrorAction Stop
    $runner = @((Join-Path $PSScriptRoot "tools\apply_toonflow_patch.py"))
}
$argsList = $runner + @(
    "--app-root", (Resolve-Path $AppRoot).Path,
    "--web-root", (Resolve-Path $WebRoot).Path,
    "--compute-center-url", $ComputeCenterUrl
)
if ($DryRun) { $argsList += "--dry-run" }
& $python.Source @argsList
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
