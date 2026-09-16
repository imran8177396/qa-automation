# Start the in-repo fixture site for lightweight Jenkins jobs (Windows agents).
# Does not print credentials. Port comes from QA_FIXTURE_PORT (default 4173).
$ErrorActionPreference = 'Stop'

$port = if ($env:QA_FIXTURE_PORT) { $env:QA_FIXTURE_PORT } else { '4173' }
$env:PORT = $port

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'node'
$psi.Arguments = "--import tsx scripts/testing/serve-fixture-site.ts"
$psi.WorkingDirectory = (Get-Location).Path
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$started = [System.Diagnostics.Process]::Start($psi)
if (-not $started) {
  Write-Error 'Failed to start fixture site process'
  exit 1
}

for ($i = 0; $i -lt 30; $i++) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:${port}/index.html" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 1
    continue
  }
  Start-Sleep -Seconds 1
}

Write-Error "Fixture did not become ready on port ${port}"
exit 1
