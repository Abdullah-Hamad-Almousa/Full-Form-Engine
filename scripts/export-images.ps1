param(
  [string]$OutputFile = ".\field-app-images-1.0.0.tar"
)

$ErrorActionPreference = "Stop"

# Pull the approved PostgreSQL base image so the offline package is self-contained.
docker pull postgres:16-alpine
if ($LASTEXITCODE -ne 0) {
  throw "Failed to pull postgres:16-alpine."
}

# Save the built application images plus the PostgreSQL base image into a
# single offline archive. Pin full tested base-image tags before producing a
# release archive (see Docker-Template section 28).
docker save `
  field-app-frontend:1.0.0 `
  field-app-backend:1.0.0 `
  field-app-tools:1.0.0 `
  postgres:16-alpine `
  -o $OutputFile
if ($LASTEXITCODE -ne 0) {
  throw "docker save failed."
}

$archive = Get-Item -LiteralPath $OutputFile
if ($archive.Length -le 0) {
  Remove-Item -LiteralPath $OutputFile -Force
  throw "Image export produced an empty file."
}

Write-Host "Offline image archive created: $OutputFile"
