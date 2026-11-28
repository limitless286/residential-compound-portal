$ErrorActionPreference = "Stop"

$parameterName = "/compound/maintenance/overdue-monitor"
$configPath = Join-Path $PSScriptRoot "overdue-monitor-defaults.json"

$awsOptions = @(
    "--profile", "floci",
    "--endpoint-url", "http://127.0.0.1:4566",
    "--region", "us-east-1",
    "--output", "json",
    "--no-cli-pager"
)

$existingText = aws ssm describe-parameters `
    --parameter-filters "Key=Name,Option=Equals,Values=$parameterName" `
    @awsOptions

if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect the SSM parameter."
}

$existing = ($existingText -join "`n") | ConvertFrom-Json

if (@($existing.Parameters).Count -eq 0) {
    aws ssm put-parameter `
        --name $parameterName `
        --description "Maintenance overdue monitoring configuration" `
        --type String `
        --value "file://$configPath" `
        @awsOptions | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the SSM parameter."
    }

    Write-Host "PASS: overdue monitor parameter created."
}
else {
    Write-Host "PASS: existing parameter preserved."
}

$resultText = aws ssm get-parameter `
    --name $parameterName `
    @awsOptions

if ($LASTEXITCODE -ne 0) {
    throw "Could not read the SSM parameter."
}

$result = ($resultText -join "`n") | ConvertFrom-Json

if ($result.Parameter.Type -ne "String") {
    throw "Unexpected parameter type."
}

$config = $result.Parameter.Value | ConvertFrom-Json

if ($config.enabled -isnot [bool] -or
    $config.batchSize -isnot [ValueType] -or
    $config.batchSize -lt 1 -or
    $config.batchSize -gt 100 -or
    $config.batchSize -ne [math]::Floor($config.batchSize) -or
    $config.repeatAfterHours -isnot [ValueType] -or
    $config.repeatAfterHours -lt 1 -or
    $config.repeatAfterHours -gt 168 -or
    $config.repeatAfterHours -ne [math]::Floor($config.repeatAfterHours)) {
    throw "Invalid overdue monitor configuration."
}

Write-Host "PASS: SSM configuration read back successfully."
$config | Format-List enabled, batchSize, repeatAfterHours
