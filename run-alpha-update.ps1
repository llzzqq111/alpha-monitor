$ErrorActionPreference = "Continue"

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$logs = Join-Path $src "logs"
$lock = Join-Path $logs "alpha-update.lock"
$stdout = Join-Path $logs "alpha-update.stdout.tmp"
$stderr = Join-Path $logs "alpha-update.stderr.tmp"
$log = Join-Path $logs "alpha-update.log"
$maxMinutes = 8

Set-Location $src
New-Item -ItemType Directory -Force $logs | Out-Null

if (Test-Path $lock) {
  $lockAge = (Get-Date) - (Get-Item $lock).LastWriteTime
  if ($lockAge.TotalMinutes -lt 15) {
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] skip previous-run-active age=$([math]::Round($lockAge.TotalMinutes, 1))m" | Add-Content $log
    exit 0
  }
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] stale lock removed age=$([math]::Round($lockAge.TotalMinutes, 1))m" | Add-Content $log
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}

"pid=$PID started=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Set-Content $lock

try {
  Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] start" | Add-Content $log

  $node = "D:\node.exe"
  if (-not (Test-Path $node)) {
    $node = "node.exe"
  }

  $job = Start-Job -ScriptBlock {
    param($workdir, $nodePath)
    Set-Location $workdir
    & $nodePath scripts\update-all.mjs *>&1
    "__ALPHA_EXIT_CODE=$LASTEXITCODE"
  } -ArgumentList $src, $node

  $finished = Wait-Job $job -Timeout ($maxMinutes * 60)
  if (-not $finished) {
    Stop-Job $job -Force -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] timeout killed job=$($job.Id) limit=${maxMinutes}m" | Add-Content $log
    exit 124
  }

  $output = Receive-Job $job
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  if ($output) {
    $output | Add-Content $log
  }

  $exitLine = $output | Where-Object { $_ -like "__ALPHA_EXIT_CODE=*" } | Select-Object -Last 1
  $exitCode = 1
  if ($exitLine) {
    $exitCode = [int]($exitLine -replace "__ALPHA_EXIT_CODE=", "")
  }

  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] end exit=$exitCode" | Add-Content $log
  exit $exitCode
}
finally {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
