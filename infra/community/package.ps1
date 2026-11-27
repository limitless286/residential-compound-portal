$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$servicePath = Join-Path $projectRoot "services/community"
$outputDirectory = Join-Path $projectRoot ".deployment"
$packagePath = Join-Path $outputDirectory "community-linux.zip"

git -C $projectRoot check-ignore --quiet -- .deployment/community-linux.zip

if ($LASTEXITCODE -ne 0) {
    throw "The deployment directory must be ignored by Git."
}

# Production dependencies only. Tests and scripts are not packaged.
npm.cmd --prefix $servicePath ci --omit=dev

if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed."
}

New-Item -ItemType Directory -Force $outputDirectory | Out-Null

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$files = @(
    Get-Item (Join-Path $servicePath "package.json")
    Get-Item (Join-Path $servicePath "package-lock.json")
    Get-ChildItem -LiteralPath (Join-Path $servicePath "src") -Recurse -File -Force
    Get-ChildItem -LiteralPath (Join-Path $servicePath "node_modules") -Recurse -File -Force
)

foreach ($file in $files) {
    if ($file.Name -like ".env*") {
        throw "Environment file found in package inputs. Packaging stopped."
    }
}

if (Test-Path $packagePath) {
    Remove-Item -LiteralPath $packagePath
}

$archive = [System.IO.Compression.ZipFile]::Open(
    $packagePath,
    [System.IO.Compression.ZipArchiveMode]::Create
)

try {
    foreach ($file in $files) {
        # Forward slashes so the archive unpacks correctly on Linux.
        $entryName = $file.FullName.Substring(
            $servicePath.Length + 1
        ).Replace('\', '/')

        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive,
            $file.FullName,
            $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
}
finally {
    $archive.Dispose()
}

$verification = [System.IO.Compression.ZipFile]::OpenRead($packagePath)

try {
    foreach ($required in @(
        "src/lambda.js",
        "src/app.js",
        "package.json",
        "node_modules/serverless-http/package.json",
        "node_modules/pg/package.json",
        "node_modules/express/package.json"
    )) {
        if ($null -eq $verification.GetEntry($required)) {
            throw "Missing package entry: $required"
        }
    }

    foreach ($entry in $verification.Entries) {
        if ($entry.FullName.Contains('\')) {
            throw "A Windows-style archive path was found."
        }

        if ($entry.FullName -match '(^|/)\.env' -or
            $entry.FullName -match '^(tests|scripts)/') {
            throw "Unexpected file in package: $($entry.FullName)"
        }
    }
}
finally {
    $verification.Dispose()
}

Write-Host "PASS: community Lambda package created with Linux paths."
Get-Item $packagePath | Select-Object Name, Length
