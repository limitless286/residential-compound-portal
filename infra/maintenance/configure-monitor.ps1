param(
    [string]$ExpectedEndpoint = "ep-holy-sound-b9pf6vdt",
    [switch]$UseServiceDatabase
)
$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Push-Location $projectRoot
try {
    git check-ignore --quiet -- .deployment/monitor-private-input.json
    if ($LASTEXITCODE -ne 0) { throw "Deployment files must be ignored by Git." }
    New-Item -ItemType Directory -Force ".deployment" | Out-Null
    if ($UseServiceDatabase) {
        # The Node preparer still verifies the actual endpoint and migration.
        $env:MONITOR_CONFIG_USE_SERVICE_DATABASE = "true"
        $inputObject = @{ expectedEndpoint = $ExpectedEndpoint; allowSharedDatabase = $true }
    }
    else {
        $secure = Read-Host "Paste the maintenance_app connection URL for community-testing (hidden input)" -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $url = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
            $inputObject = @{ databaseUrl = $url; expectedEndpoint = $ExpectedEndpoint; allowSharedDatabase = $false }
            $url = $null
        }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    }
    $path = Join-Path $projectRoot ".deployment/monitor-private-input.json"
    [IO.File]::WriteAllText($path, ($inputObject | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $inputObject = $null
    node (Join-Path $PSScriptRoot "prepare-monitoring.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Monitor preparation failed." }
}
finally {
    Remove-Item Env:MONITOR_CONFIG_USE_SERVICE_DATABASE -ErrorAction SilentlyContinue
    $inputPath = Join-Path $projectRoot ".deployment/monitor-private-input.json"
    if (Test-Path $inputPath) { Remove-Item -LiteralPath $inputPath }
    Pop-Location
}
