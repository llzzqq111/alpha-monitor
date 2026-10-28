$ErrorActionPreference = "Stop"

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$cloudConfig = Join-Path $src "cloud-monitor.json"
if (Test-Path -LiteralPath $cloudConfig) {
  if ((Get-Content -LiteralPath $cloudConfig -Raw | ConvertFrom-Json).enabled) {
    throw "Cloud monitoring is active. Run node scripts/sync-from-cloud.mjs instead of publishing local data."
  }
}
$deployRoot = Join-Path $src ".deploy"
$deploy = Join-Path $deployRoot ("alpha-monitor-public-deploy-{0}" -f ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()))
$publicStartDate = (Get-Content (Join-Path $src "public-data-start.txt") -Raw).Trim()

Set-Location $src
New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null

$tokenText = $env:ALPHA_MONITOR_GITHUB_TOKEN
if (-not $tokenText -and (Test-Path "$src\github_token.txt")) {
  $tokenText = (Get-Content "$src\github_token.txt" -Raw)
}

if (-not $tokenText) {
  throw "Missing GitHub token. Set ALPHA_MONITOR_GITHUB_TOKEN or create github_token.txt."
}

$match = [regex]::Match($tokenText.Trim(), "(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+)")
if (-not $match.Success) {
  throw "Token looks invalid. It should start with github_pat_ or ghp_."
}

$token = $match.Value
$encodedToken = [System.Uri]::EscapeDataString($token)
$publicRepo = "https://github.com/llzzqq111/alpha-monitor.git"
$authRepo = "https://x-access-token:$encodedToken@github.com/llzzqq111/alpha-monitor.git"

git -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=60 clone --depth 1 --single-branch --branch main --progress $publicRepo $deploy
if ($LASTEXITCODE -ne 0) {
  Write-Host "Git clone failed; trying GitHub API publishing."
  node (Join-Path $src "scripts\publish-public-api.mjs")
  if ($LASTEXITCODE -ne 0) { throw "GitHub API publishing failed." }
  exit 0
}

Copy-Item index.html,app.js,styles.css,data.json,README.md -Destination $deploy -Force

$publicReportsDir = [System.IO.Path]::GetFullPath((Join-Path $deploy "reports"))
$deployPrefix = [System.IO.Path]::GetFullPath($deploy).TrimEnd('\') + '\'
if (-not $publicReportsDir.StartsWith($deployPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Public reports target must stay within the deployment directory."
}
if (Test-Path -LiteralPath $publicReportsDir) {
  Remove-Item -LiteralPath $publicReportsDir -Recurse -Force
}
New-Item -ItemType Directory -Path "$deploy\reports" -Force | Out-Null
if (Test-Path "$src\reports") {
  $publicReports = Get-ChildItem -Path "$src\reports" -File -Filter "*.md" | Where-Object {
    $date = [regex]::Match($_.Name, "\d{4}-\d{2}-\d{2}")
    $date.Success -and $date.Value -ge $publicStartDate
  }
  if ($publicReports) {
    $publicReports | Copy-Item -Destination "$deploy\reports" -Force
  }
}

Set-Location $deploy
git config user.name "llzzqq111"
git config user.email "llzzqq111@users.noreply.github.com"

git add .
$status = git status --short
if ($status) {
  git commit -m "Update dashboard data"
  git remote set-url origin $authRepo
  git -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=60 push origin main
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Git push failed; trying GitHub API publishing."
    node (Join-Path $src "scripts\publish-public-api.mjs")
    if ($LASTEXITCODE -ne 0) { throw "GitHub API publishing failed." }
    exit 0
  }
  Write-Host "Published dashboard."
} else {
  Write-Host "No dashboard changes."
}
