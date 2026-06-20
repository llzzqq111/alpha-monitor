$ErrorActionPreference = "Stop"

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$deploy = Join-Path $src ".deploy\alpha-monitor-public-deploy"

Set-Location $src

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

Remove-Item -Recurse -Force $deploy -ErrorAction SilentlyContinue
git clone $publicRepo $deploy
if ($LASTEXITCODE -ne 0) {
  throw "git clone failed."
}

Copy-Item index.html,app.js,styles.css,data.json,README.md -Destination $deploy -Force

if (Test-Path "$deploy\reports") {
  Remove-Item -Recurse -Force "$deploy\reports"
}
New-Item -ItemType Directory -Path "$deploy\reports" -Force | Out-Null
if (Test-Path "$src\reports") {
  Copy-Item -Path "$src\reports\*" -Destination "$deploy\reports" -Recurse -Force
}

Set-Location $deploy
git config user.name "llzzqq111"
git config user.email "llzzqq111@users.noreply.github.com"

git add .
$status = git status --short
if ($status) {
  git commit -m "Update dashboard data"
  git remote set-url origin $authRepo
  git push origin main
  if ($LASTEXITCODE -ne 0) {
    throw "git push failed."
  }
  Write-Host "Published dashboard."
} else {
  Write-Host "No dashboard changes."
}
