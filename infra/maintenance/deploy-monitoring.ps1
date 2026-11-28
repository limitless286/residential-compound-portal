$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Push-Location $projectRoot
try {
    if (-not (Test-Path ".deployment/monitor-environment.json")) {
        throw "Run configure-monitor.ps1 first."
    }
    & (Join-Path $PSScriptRoot "package.ps1")
    node (Join-Path $PSScriptRoot "deploy-monitoring.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Monitoring deployment failed." }
}
finally { Pop-Location }
