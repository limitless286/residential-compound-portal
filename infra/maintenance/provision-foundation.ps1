param(
    [string]$Profile = "floci",
    [string]$Endpoint = "http://127.0.0.1:4566"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path

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

$tableSpecs = @(
    @{
        Name = "compound-sessions"
        Key = "tokenHash"
    },
    @{
        Name = "compound-login-limits"
        Key = "key"
    }
)

$existingTables = Invoke-Floci -CliArgs @(
    "dynamodb", "list-tables"
)

foreach ($spec in $tableSpecs) {
    if ($existingTables.TableNames -notcontains $spec.Name) {
        Invoke-Floci -CliArgs @(
            "dynamodb", "create-table",
            "--table-name", $spec.Name,
            "--attribute-definitions",
            "AttributeName=$($spec.Key),AttributeType=S",
            "--key-schema",
            "AttributeName=$($spec.Key),KeyType=HASH",
            "--billing-mode", "PAY_PER_REQUEST"
        ) | Out-Null
    }

    Invoke-Floci -CliArgs @(
        "dynamodb", "wait", "table-exists",
        "--table-name", $spec.Name
    ) | Out-Null

    $description = Invoke-Floci -CliArgs @(
        "dynamodb", "describe-table",
        "--table-name", $spec.Name
    )

    $schema = @($description.Table.KeySchema)
    $attributes = @($description.Table.AttributeDefinitions)

    if (
        $schema.Count -ne 1 -or
        $schema[0].AttributeName -ne $spec.Key -or
        $schema[0].KeyType -ne "HASH" -or
        $attributes.Count -ne 1 -or
        $attributes[0].AttributeName -ne $spec.Key -or
        $attributes[0].AttributeType -ne "S"
    ) {
        throw "Unexpected table schema: $($spec.Name)"
    }

    $ttl = Invoke-Floci -CliArgs @(
        "dynamodb", "describe-time-to-live",
        "--table-name", $spec.Name
    )

    $ttlState = $ttl.TimeToLiveDescription.TimeToLiveStatus

    if ($ttlState -eq "DISABLED") {
        Invoke-Floci -CliArgs @(
            "dynamodb", "update-time-to-live",
            "--table-name", $spec.Name,
            "--time-to-live-specification",
            "Enabled=true,AttributeName=expiresAt"
        ) | Out-Null
    }
    elseif (
        $ttlState -notin @("ENABLED", "ENABLING") -or
        $ttl.TimeToLiveDescription.AttributeName -ne "expiresAt"
    ) {
        throw "Unexpected TTL configuration: $($spec.Name)"
    }

    Write-Host "PASS: $($spec.Name) schema and TTL configured."
}

$roleName = "compound-maintenance-lambda-role"
$trustPath = Join-Path $PSScriptRoot "trust-policy.json"
$policyPath = Join-Path $PSScriptRoot "runtime-policy.json"

$roles = Invoke-Floci -CliArgs @("iam", "list-roles")

if (@($roles.Roles.RoleName) -notcontains $roleName) {
    Invoke-Floci -CliArgs @(
        "iam", "create-role",
        "--role-name", $roleName,
        "--assume-role-policy-document", "file://$trustPath"
    ) | Out-Null
}
else {
    Invoke-Floci -CliArgs @(
        "iam", "update-assume-role-policy",
        "--role-name", $roleName,
        "--policy-document", "file://$trustPath"
    ) | Out-Null
}

Invoke-Floci -CliArgs @(
    "iam", "put-role-policy",
    "--role-name", $roleName,
    "--policy-name", "compound-maintenance-runtime",
    "--policy-document", "file://$policyPath"
) | Out-Null

Write-Host "PASS: maintenance execution role configured."

$logGroupName = "/aws/lambda/compound-maintenance"

$groups = Invoke-Floci -CliArgs @(
    "logs", "describe-log-groups",
    "--log-group-name-prefix", $logGroupName
)

if (@($groups.logGroups.logGroupName) -notcontains $logGroupName) {
    Invoke-Floci -CliArgs @(
        "logs", "create-log-group",
        "--log-group-name", $logGroupName
    ) | Out-Null
}

Invoke-Floci -CliArgs @(
    "logs", "put-retention-policy",
    "--log-group-name", $logGroupName,
    "--retention-in-days", "14"
) | Out-Null

Write-Host "PASS: maintenance log group configured."
Write-Host "Foundation provisioning completed."
