# Stop ProfilesNext, pull the GitHub checkout, rebuild, start the service.
# IIS keeps proxying; this script updates the Node app folder, not the IIS site folder.
#Requires -RunAsAdministrator

param(
  [string]$AppDir = "",
  [string]$ServiceName = "ProfilesNext"
)

$ErrorActionPreference = "Stop"

if (-not $AppDir) {
  $AppDir = Split-Path -Parent $PSScriptRoot
}

function Fail([string]$Message, [switch]$StartAgain) {
  Write-Host $Message
  if ($StartAgain) {
    Write-Host "Starting $ServiceName again."
    Start-Service -Name $ServiceName
  }
  exit 1
}

Set-Location $AppDir

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "git is not installed. Install Git for Windows, then run this script again."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  Fail "npm.cmd is not on PATH. Install Node.js 24 and open a new PowerShell window."
}
if (-not (Test-Path (Join-Path $AppDir ".git"))) {
  Fail "No git checkout in $AppDir. Clone the repository first."
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
  Fail "Service $ServiceName is not installed. Create it once, see docs/deploy-iis.md."
}

$envFile = Join-Path $AppDir ".env.local"
if (-not (Test-Path $envFile)) {
  Fail "Missing $envFile. The update does not create server passwords."
}

$dirty = @(git status --porcelain)
if ($LASTEXITCODE -ne 0) {
  Fail "git status failed."
}
if ($dirty.Count -gt 0) {
  Fail "Local edits in $AppDir. On the server the code must match GitHub. Do not continue."
}

Write-Host "Stopping $ServiceName"
Stop-Service -Name $ServiceName -Force
(Get-Service -Name $ServiceName).WaitForStatus("Stopped", "00:00:40")

$before = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
  Fail "git rev-parse failed." -StartAgain
}

Write-Host "Pulling origin/main"
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) {
  Fail "git pull failed. Fix the checkout, then run this script again." -StartAgain
}

$after = (git rev-parse HEAD).Trim()
$changed = @()
if ($before -ne $after) {
  $changed = @(git diff --name-only $before $after)
  if ($LASTEXITCODE -ne 0) {
    Fail "git diff failed. Service stays stopped."
  }
}

$needCi = -not (Test-Path (Join-Path $AppDir "node_modules"))
$needBuild = $needCi -or -not (Test-Path (Join-Path $AppDir ".next"))
foreach ($name in $changed) {
  if (-not $name) { continue }
  $needBuild = $true
  if ($name -eq "package.json" -or $name -eq "package-lock.json") {
    $needCi = $true
  }
}

if ($changed.Count -eq 0 -and -not $needBuild) {
  Write-Host "Already matches origin/main. No rebuild."
} else {
  if ($changed.Count -gt 0) {
    Write-Host "Updated files:"
    $changed | ForEach-Object { Write-Host "  $_" }
  }
  if ($needCi) {
    Write-Host "npm ci"
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) {
      Fail "npm ci failed. Service stays stopped. node_modules may be incomplete."
    }
  }
  if ($needBuild) {
    Write-Host "npm run build"
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
      Fail "Build failed. Service stays stopped."
    }
  }
}

if (-not (Test-Path $envFile)) {
  Fail ".env.local disappeared. Restore it before starting the service."
}

Write-Host "Starting $ServiceName"
Start-Service -Name $ServiceName
(Get-Service -Name $ServiceName).WaitForStatus("Running", "00:00:40")
Write-Host "Service $ServiceName is running. Open the site and refresh with Ctrl+F5."
