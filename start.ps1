# Serve the game locally and open it in the browser.
# usage: .\start.ps1 [-Port 8000] [-NoBrowser]
param([int]$Port = 8000, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path 'export\world.json')) {
    Write-Warning "export\ has no assets yet. Run ./export_all.sh first (see README), or the game will show 'assets not found'."
}

$py = if ($env:PYTHON) { $env:PYTHON } elseif (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { 'py' }
$url = "http://127.0.0.1:$Port/web/"
Write-Host "Serving $PSScriptRoot at $url  (Ctrl+C to stop)"
if (-not $NoBrowser) { Start-Job { Start-Sleep 1; Start-Process $using:url } | Out-Null }
& $py -m http.server $Port --bind 127.0.0.1
