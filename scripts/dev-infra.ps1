# Startet die lokale Dev-Infrastruktur (PostgreSQL, Redis, MinIO) OHNE Docker.
# Fallback für Maschinen, auf denen Docker Desktop nicht installierbar ist –
# die maßgebliche Infra-Definition bleibt infra/docker-compose.yml.
#
# Erwartete portable Installationen (siehe PROGRESS.md, "Dev-Umgebung"):
#   %LOCALAPPDATA%\Programs\parley-infra\pgsql   – PostgreSQL 16 (EnterpriseDB-ZIP)
#   %LOCALAPPDATA%\Programs\parley-infra\redis   – Redis für Windows
#   %LOCALAPPDATA%\Programs\parley-infra\minio.exe
# Datenverzeichnisse: %LOCALAPPDATA%\parley-data\{pgdata,redis,minio}
#
# Aufruf:  powershell -ExecutionPolicy Bypass -File scripts\dev-infra.ps1

$ErrorActionPreference = 'Stop'
$infra = "$env:LOCALAPPDATA\Programs\parley-infra"
$data = "$env:LOCALAPPDATA\parley-data"

function Test-Port([int]$Port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $Port)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

# --- PostgreSQL (Port 5432) ---
if (Test-Port 5432) {
  Write-Host 'PostgreSQL läuft bereits (Port 5432)'
} elseif (Test-Path "$infra\pgsql\bin\pg_ctl.exe") {
  & "$infra\pgsql\bin\pg_ctl.exe" -D "$data\pgdata" -l "$data\pgdata.log" -w start | Out-Null
  Write-Host 'PostgreSQL gestartet'
} else {
  Write-Warning "PostgreSQL fehlt unter $infra\pgsql – siehe PROGRESS.md"
}

# --- Redis (Port 6379) ---
if (Test-Port 6379) {
  Write-Host 'Redis läuft bereits (Port 6379)'
} elseif (Test-Path "$infra\redis\redis-server.exe") {
  New-Item -ItemType Directory -Force "$data\redis" | Out-Null
  Start-Process -FilePath "$infra\redis\redis-server.exe" `
    -ArgumentList '--port', '6379', '--dir', "$data\redis" -WindowStyle Hidden
  Write-Host 'Redis gestartet'
} else {
  Write-Warning "Redis fehlt unter $infra\redis – siehe PROGRESS.md"
}

# --- MinIO (S3-API Port 9000, Konsole 9001) ---
if (Test-Port 9000) {
  Write-Host 'MinIO läuft bereits (Port 9000)'
} elseif (Test-Path "$infra\minio.exe") {
  New-Item -ItemType Directory -Force "$data\minio" | Out-Null
  # Zugangsdaten müssen zu .env passen (MINIO_ROOT_USER/-PASSWORD).
  $env:MINIO_ROOT_USER = 'parley'
  $env:MINIO_ROOT_PASSWORD = 'parley_dev_password'
  Start-Process -FilePath "$infra\minio.exe" `
    -ArgumentList 'server', "$data\minio", '--address', ':9000', '--console-address', ':9001' `
    -WindowStyle Hidden
  Write-Host 'MinIO gestartet'
} else {
  Write-Warning "MinIO fehlt unter $infra\minio.exe – siehe PROGRESS.md"
}
