param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

if (-not (Test-Path $OutputDirectory)) {
  New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputFile = Join-Path $OutputDirectory "nerd-clearance-$timestamp.sql"
$databaseName = if ($env:DB_NAME) { $env:DB_NAME } else { "nerd_clearance_portal" }
$arguments = @(
  "-h", ($env:DB_HOST ?? "127.0.0.1"),
  "-P", ($env:DB_PORT ?? "3306"),
  "-u", $env:DB_USER,
  "--routines",
  "--triggers",
  "--single-transaction",
  "--result-file=$outputFile",
  $databaseName
)

if ($env:DB_PASSWORD) {
  $arguments += "--password=$($env:DB_PASSWORD)"
}

& mysqldump @arguments
if ($LASTEXITCODE -ne 0) {
  throw "MySQL backup failed."
}
Write-Output "Database backup created: $outputFile"
