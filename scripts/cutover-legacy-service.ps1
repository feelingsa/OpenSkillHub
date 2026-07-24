param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ServiceName = "SkillWebHub",
  [int]$ProductionPort = 5177,
  [int]$LegacyProcessId = 0,
  [switch]$Apply
)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an elevated PowerShell session."
}

$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$entryPoint = Join-Path $resolvedRoot "dist\server.js"
if (-not (Test-Path -LiteralPath $entryPoint)) { throw "Build the Node Hub first: npm.cmd run build" }
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) { throw "Install the Node Hub service first: scripts\install-hub-service.ps1" }

function Get-HubHealth([int]$Port) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
    return $response.Content | ConvertFrom-Json
  } catch {
    return $null
  }
}

$currentHealth = Get-HubHealth $ProductionPort
if ($currentHealth -and $currentHealth.service -eq "skill-web-hub") {
  Write-Output "Node Hub is already active on port $ProductionPort. No legacy shutdown is needed."
  exit 0
}

if (-not $Apply) {
  Write-Output "Dry run only. Existing port $ProductionPort does not report the Node Hub."
  Write-Output "After completing the canary checklist in docs\migration-m7.md, rerun with -Apply -LegacyProcessId <PID>."
  exit 0
}

if ($LegacyProcessId -lt 1) { throw "Apply mode requires the explicit -LegacyProcessId of the legacy server.js process." }
$legacy = Get-CimInstance Win32_Process -Filter "ProcessId = $LegacyProcessId" -ErrorAction Stop
if ($legacy.Name -notmatch "node" -or $legacy.CommandLine -notmatch "server\.js") {
  throw "PID $LegacyProcessId is not a Node server.js process. Refusing to stop it."
}

Write-Output "Stopping verified legacy process $LegacyProcessId."
Stop-Process -Id $LegacyProcessId -ErrorAction Stop
Start-Service -Name $ServiceName -ErrorAction Stop
Start-Sleep -Seconds 2
$newHealth = Get-HubHealth $ProductionPort
if (-not $newHealth -or $newHealth.service -ne "skill-web-hub") {
  throw "The Node Hub did not become healthy on port $ProductionPort. The legacy process was not deleted; restore it using its recorded start command."
}
Write-Output "Cutover complete. Node Hub is healthy on port $ProductionPort at $($newHealth.time)."
