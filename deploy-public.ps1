$ErrorActionPreference = "Stop"

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$deploy = "C:\tmp\alpha-monitor-public-deploy"

Set-Location $src
node scripts\build-site.mjs

$null = Read-Host "Copy your GitHub token first, then press Enter here"
$tokenText = (Get-Clipboard -Raw).Trim()

$match = [regex]::Match($tokenText, "(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+)")
if (-not $match.Success) {
  throw "Token looks invalid. Copy the full token from GitHub. It should start with github_pat_ or ghp_."
}

$token = $match.Value

if (-not ($token.StartsWith("github_pat_") -or $token.StartsWith("ghp_"))) {
  throw "Token looks invalid. It should start with github_pat_ or ghp_."
}

$encodedToken = [System.Uri]::EscapeDataString($token)
$publicRepo = "https://github.com/llzzqq111/alpha-monitor.git"
$authRepo = "https://x-access-token:$encodedToken@github.com/llzzqq111/alpha-monitor.git"

Remove-Item -Recurse -Force $deploy -ErrorAction SilentlyContinue
git clone $publicRepo $deploy
if ($LASTEXITCODE -ne 0) {
  throw "git clone failed. Check network access and that the repository exists: llzzqq111/alpha-monitor."
}

Copy-Item index.html,app.js,styles.css,data.json,README.md -Destination $deploy -Force

if (Test-Path "$deploy\reports") {
  Remove-Item -Recurse -Force "$deploy\reports"
}
New-Item -ItemType Directory -Path "$deploy\reports" -Force | Out-Null
Copy-Item -Path "reports\*" -Destination "$deploy\reports" -Recurse -Force

Set-Location $deploy
git config user.name "llzzqq111"
git config user.email "llzzqq111@users.noreply.github.com"

git add .
$status = git status --short
if ($status) {
  git commit -m "Update filtered dashboard data"
  git remote set-url origin $authRepo
  git push origin main
  if ($LASTEXITCODE -ne 0) {
    throw "git push failed. If this is a fine-grained token, select repository llzzqq111/alpha-monitor and set Contents: Read and write. If it still fails, create a classic token with repo scope."
  }
  Write-Host "Published. Wait 1-2 minutes, then hard refresh GitHub Pages."
} else {
  Write-Host "No changes to publish."
}
