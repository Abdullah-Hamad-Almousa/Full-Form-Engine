param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile,

  [Parameter(Mandatory = $true)]
  [string]$TargetDatabase
)

$ErrorActionPreference = "Stop"

# Refuse a target database whose name is not clearly marked as test data.
# Mirrors the guard used by backend/src/test/setup.ts.
if ($TargetDatabase -notmatch '(^|[_-])test([_-]|$)') {
  throw "Refusing to restore into '$TargetDatabase': name is not clearly marked as test data."
}

if (-not (Test-Path -LiteralPath $InputFile -PathType Leaf)) {
  throw "Input file not found: $InputFile"
}

$inputItem = Get-Item -LiteralPath $InputFile
if ($inputItem.Length -le 0) {
  throw "Input file is empty: $InputFile"
}

# Pipe the SQL file into the database container, selecting the target database.
# POSTGRES_USER and POSTGRES_PASSWORD are read inside the container from its
# environment, so the host shell does not need to import .env and no password
# is printed. The target database must already exist.
$psqlCommand = "exec psql --username `"`$POSTGRES_USER`" --dbname `"$TargetDatabase`" --v ON_ERROR_STOP=1"

Get-Content -LiteralPath $InputFile -Raw | docker compose exec -T database sh -c $psqlCommand
if ($LASTEXITCODE -ne 0) {
  throw "Database restore failed for target '$TargetDatabase'."
}

Write-Host "Restore completed into '$TargetDatabase' from: $InputFile"
