param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

if (-not (Test-Path $OutputDirectory)) {
  New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
}

$connectionUri = $null
if (-not [Uri]::TryCreate($env:DATABASE_URL, [UriKind]::Absolute, [ref]$connectionUri) -or
    $connectionUri.Scheme -notin @("mysql", "mysql2")) {
  throw "DATABASE_URL must be a MySQL connection URL."
}

$userInfo = $connectionUri.UserInfo.Split(":", 2)
$databaseName = [Uri]::UnescapeDataString($connectionUri.AbsolutePath.TrimStart("/"))
$databaseUser = [Uri]::UnescapeDataString($userInfo[0])
$databasePassword = if ($userInfo.Length -gt 1) {
  [Uri]::UnescapeDataString($userInfo[1])
} else {
  ""
}
$databasePort = if ($connectionUri.Port -gt 0) { $connectionUri.Port } else { 3306 }
if (-not $databaseUser -or -not $connectionUri.Host -or -not $databaseName) {
  throw "DATABASE_URL must include a username, host, and database name."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputFile = Join-Path $OutputDirectory "nerd-clearance-$timestamp.sql"
$arguments = @(
  "-h", $connectionUri.Host,
  "-P", "$databasePort",
  "-u", $databaseUser,
  "--routines",
  "--triggers",
  "--single-transaction",
  "--result-file=$outputFile",
  $databaseName
)
$previousMysqlPassword = $env:MYSQL_PWD

try {
  $env:MYSQL_PWD = $databasePassword
  & mysqldump @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "MySQL backup failed."
  }
} finally {
  if ($null -eq $previousMysqlPassword) {
    Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
  } else {
    $env:MYSQL_PWD = $previousMysqlPassword
  }
}

Write-Output "Database backup created: $outputFile"
