param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$source = $env:PRIVATE_STORAGE_ROOT
if (-not $source) {
  $source = Resolve-Path (Join-Path $PSScriptRoot "..\storage\private") -ErrorAction Stop
}
if (-not (Test-Path $OutputDirectory)) {
  New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
}
$outputFile = Join-Path $OutputDirectory "nerd-private-files-$timestamp.zip"
Compress-Archive -Path (Join-Path $source "*") -DestinationPath $outputFile -Force
Write-Output "Private file backup created: $outputFile"
