param(
    [string]$Profile = "floci",
    [string]$Endpoint = "http://127.0.0.1:4566"
)

# Community needs no DynamoDB tables: it reaches identity only through the
# maintenance API (introspection), never the session tables directly.
$ErrorActionPreference = "Stop"

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

$roleName = "compound-community-lambda-role"
$policyName = "compound-community-runtime"
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
    "--policy-name", $policyName,
    "--policy-document", "file://$policyPath"
) | Out-Null

# The role must carry exactly one inline policy and no managed policies.
$inline = Invoke-Floci -CliArgs @("iam", "list-role-policies", "--role-name", $roleName)
$attached = Invoke-Floci -CliArgs @("iam", "list-attached-role-policies", "--role-name", $roleName)

if (@($inline.PolicyNames).Count -ne 1 -or $inline.PolicyNames[0] -ne $policyName -or
    @($attached.AttachedPolicies).Count -ne 0) {
    throw "Unexpected policies on $roleName. Review before continuing."
}

Write-Host "PASS: community execution role configured (logs only)."

$logGroupName = "/aws/lambda/compound-community"

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

Write-Host "PASS: community log group configured (14-day retention)."
Write-Host "Community foundation provisioning completed."
