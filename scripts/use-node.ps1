# Adds portable Node to PATH for this PowerShell session (no admin required).
$nodeDir = Join-Path $env:LOCALAPPDATA "nodejs-portable\node-v22.14.0-win-x64"
if (-not (Test-Path (Join-Path $nodeDir "node.exe"))) {
  Write-Error "Portable Node not found at $nodeDir. Re-run setup or install Node.js."
  exit 1
}
$env:PATH = "$nodeDir;$env:PATH"
Write-Host "Node $(node -v) / npm $(npm -v)"
