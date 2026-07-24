param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ServiceName = "SkillWebHub",
  [string]$NodePath = "C:\Program Files\nodejs\node.exe"
)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an elevated PowerShell session."
}

$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$entryPoint = Join-Path $resolvedRoot "dist\server.js"
if (-not (Test-Path -LiteralPath $NodePath)) { throw "Node executable was not found: $NodePath" }
if (-not (Test-Path -LiteralPath $entryPoint)) { throw "Build the project first: npm.cmd run build" }
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { throw "Service already exists: $ServiceName" }

$binaryPath = '"{0}" "{1}"' -f $NodePath, $entryPoint
New-Service -Name $ServiceName -BinaryPathName $binaryPath -DisplayName "Skill Web Hub" -Description "LAN-accessible OpenCode Skill Web Hub" -StartupType Automatic
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
Start-Service -Name $ServiceName
Write-Output "Installed and started $ServiceName."
