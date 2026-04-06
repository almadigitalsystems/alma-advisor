<#
.SYNOPSIS
  Installs the Alma Advisor Monitor as a Windows Task Scheduler task.
  Run this script once as Administrator.

.USAGE
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  .\setup-windows.ps1
#>

$TaskName = "AlmaAdvisorMonitor"
$NodePath  = (Get-Command node -ErrorAction Stop).Path
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptPath = Join-Path $ScriptDir "monitor\index.js"
$EnvFile   = Join-Path $ScriptDir ".env"

if (-not (Test-Path $EnvFile)) {
  Write-Error ".env file not found at $EnvFile. Copy .env.example to .env and fill in your credentials."
  exit 1
}

# Build the action: node monitor/index.js
$Action = New-ScheduledTaskAction `
  -Execute $NodePath `
  -Argument "`"$ScriptPath`"" `
  -WorkingDirectory $ScriptDir

# Trigger: at logon, repeat indefinitely
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -StartWhenAvailable

# Remove existing task if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed existing task: $TaskName"
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -RunLevel Highest `
  -Description "Alma Digital Designs — AI Advisor Monitor (polls Paperclip every 60s)"

Write-Host "Task '$TaskName' registered successfully."
Write-Host "Starting task now..."
Start-ScheduledTask -TaskName $TaskName
Write-Host "Monitor is running. Check health at http://127.0.0.1:3099/health"
