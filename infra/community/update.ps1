param(
    [string]$Profile = "floci",
    [string]$Endpoint = "http://127.0.0.1:4566"
)

# Redeploys community code only. Configuration changes (environment,
# identity URL) go through deploy-lambda.ps1.
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$deploymentDirectory = Join-Path $projectRoot ".deployment"
$packagePath = Join-Path $deploymentDirectory "community-linux.zip"
$eventPath = Join-Path $PSScriptRoot "health-event.json"
$responsePath = Join-Path $deploymentDirectory "community-health-response.json"

$awsOptions = @(
    "--profile", $Profile,
    "--endpoint-url", $Endpoint,
    "--region", "us-east-1",
    "--no-cli-pager"
)

& (Join-Path $PSScriptRoot "package.ps1")

if (-not (Test-Path $packagePath)) {
    throw "Lambda package was not created."
}

aws lambda update-function-code `
    --function-name compound-community `
    --zip-file "fileb://$packagePath" `
    --query "{Name:FunctionName,UpdateStatus:LastUpdateStatus}" `
    @awsOptions

if ($LASTEXITCODE -ne 0) {
    throw "Lambda code update failed."
}

aws lambda wait function-updated-v2 `
    --function-name compound-community `
    @awsOptions

if ($LASTEXITCODE -ne 0) {
    throw "Lambda update did not become ready."
}

$metadataText = aws lambda invoke `
    --function-name compound-community `
    --payload "fileb://$eventPath" `
    --cli-read-timeout 120 `
    --output json `
    @awsOptions `
    $responsePath

if ($LASTEXITCODE -ne 0) {
    throw "Lambda invocation failed."
}

$metadata = ($metadataText -join "`n") | ConvertFrom-Json

if ($metadata.FunctionError) {
    throw "Lambda execution failed. Inspect .deployment/community-health-response.json locally."
}

$response = Get-Content -Raw $responsePath | ConvertFrom-Json

if ($response.statusCode -ne 200) {
    throw "Lambda health endpoint did not return HTTP 200."
}

$body = $response.body | ConvertFrom-Json

if (
    $body.data.service -ne "community" -or
    $body.data.status -ne "ok"
) {
    throw "Unexpected Lambda health response."
}

Write-Host "PASS: community Lambda code updated and health check passed."

$apiIdPath = Join-Path $deploymentDirectory "community-api-id.txt"

if (Test-Path $apiIdPath) {
    $apiId = (Get-Content -Raw $apiIdPath).Trim()
    $healthUrl = "$Endpoint/restapis/$apiId/dev/_user_request_/api/v1/health"

    $gatewayHealth = Invoke-RestMethod `
        -Uri $healthUrl `
        -TimeoutSec 120 `
        -ErrorAction Stop

    if (
        $gatewayHealth.data.service -ne "community" -or
        $gatewayHealth.data.status -ne "ok"
    ) {
        throw "API Gateway health check failed."
    }

    Write-Host "PASS: community API Gateway health check passed."
}
else {
    Write-Host "API Gateway check skipped: local API ID file is missing."
}
