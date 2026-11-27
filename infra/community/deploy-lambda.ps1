param(
    [string]$Profile = "floci",
    [string]$Endpoint = "http://127.0.0.1:4566"
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$outputDirectory = Join-Path $projectRoot ".deployment"
$packagePath = Join-Path $outputDirectory "community-linux.zip"
$environmentPath = Join-Path $outputDirectory "community-environment.json"
$responsePath = Join-Path $outputDirectory "community-health-response.json"
$eventPath = Join-Path $PSScriptRoot "health-event.json"
$functionName = "compound-community"
$roleArn = "arn:aws:iam::000000000000:role/compound-community-lambda-role"

$awsOptions = @(
    "--profile", $Profile,
    "--endpoint-url", $Endpoint,
    "--region", "us-east-1",
    "--output", "json",
    "--no-cli-pager"
)

function Invoke-Floci {
    param([string[]]$CliArgs)

    $result = & aws @CliArgs @awsOptions

    if ($LASTEXITCODE -ne 0) {
        throw "Floci command failed: $($CliArgs[0]) $($CliArgs[1])"
    }

    $text = $result -join "`n"

    if (-not [string]::IsNullOrWhiteSpace($text)) {
        return ($text | ConvertFrom-Json)
    }
}

node (Join-Path $PSScriptRoot "prepare-environment.mjs")

if ($LASTEXITCODE -ne 0) {
    throw "Private environment preparation failed."
}

& (Join-Path $PSScriptRoot "package.ps1")

$functionNames = Invoke-Floci -CliArgs @(
    "lambda", "list-functions",
    "--query", "Functions[].FunctionName"
)

if (@($functionNames) -notcontains $functionName) {
    Invoke-Floci -CliArgs @(
        "lambda", "create-function",
        "--function-name", $functionName,
        "--runtime", "nodejs24.x",
        "--handler", "src/lambda.handler",
        "--role", $roleArn,
        "--zip-file", "fileb://$packagePath",
        "--environment", "file://$environmentPath",
        "--timeout", "30",
        "--memory-size", "512",
        "--architectures", "x86_64",
        "--query", "FunctionName"
    ) | Out-Null

    Invoke-Floci -CliArgs @(
        "lambda", "wait", "function-active-v2",
        "--function-name", $functionName
    ) | Out-Null
}
else {
    Invoke-Floci -CliArgs @(
        "lambda", "update-function-configuration",
        "--function-name", $functionName,
        "--runtime", "nodejs24.x",
        "--handler", "src/lambda.handler",
        "--role", $roleArn,
        "--environment", "file://$environmentPath",
        "--timeout", "30",
        "--memory-size", "512",
        "--query", "FunctionName"
    ) | Out-Null

    Invoke-Floci -CliArgs @(
        "lambda", "wait", "function-updated-v2",
        "--function-name", $functionName
    ) | Out-Null

    Invoke-Floci -CliArgs @(
        "lambda", "update-function-code",
        "--function-name", $functionName,
        "--zip-file", "fileb://$packagePath",
        "--query", "FunctionName"
    ) | Out-Null

    Invoke-Floci -CliArgs @(
        "lambda", "wait", "function-updated-v2",
        "--function-name", $functionName
    ) | Out-Null
}

$metadata = Invoke-Floci -CliArgs @(
    "lambda", "invoke",
    "--function-name", $functionName,
    "--payload", "fileb://$eventPath",
    "--cli-read-timeout", "120",
    $responsePath
)

if ($metadata.FunctionError) {
    throw "Lambda execution failed. Inspect the private community-health-response.json file."
}

$response = Get-Content -Raw $responsePath | ConvertFrom-Json

if ($response.statusCode -ne 200) {
    throw "Lambda health check did not return HTTP 200."
}

$body = $response.body | ConvertFrom-Json

if (
    $body.data.service -ne "community" -or
    $body.data.status -ne "ok"
) {
    throw "Unexpected Lambda health response."
}

Write-Host "PASS: community Lambda deployed and health check passed."
