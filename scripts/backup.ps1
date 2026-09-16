param(
  [string]$OutputDirectory = ".\backups"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$outputFile = Join-Path $OutputDirectory "field-app-$timestamp.sql"

$dumpCommand = @'
exec pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --clean --if-exists
'@

docker compose exec -T database sh -c $dumpCommand > $outputFile
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $outputFile -Force -ErrorAction SilentlyContinue
  throw "Database backup failed."
}

$backupFile = Get-Item -LiteralPath $outputFile
if ($backupFile.Length -le 0) {
  Remove-Item -LiteralPath $outputFile -Force
  throw "Database backup produced an empty file."
}

Write-Host "Backup created: $outputFile"
