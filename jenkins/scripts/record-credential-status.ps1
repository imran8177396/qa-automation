# Print configured / not configured for known env names. Never print values.
function Record-Status {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowNull()][string]$Value
  )
  if ([string]::IsNullOrEmpty($Value)) {
    Write-Output "$Name`: not configured (auth-dependent checks may be REQUIRES_CONFIGURATION / NOT_TESTED)"
  } else {
    Write-Output "$Name`: configured (value not printed)"
  }
}

Record-Status -Name 'QA_WEBSITE_URL' -Value $env:QA_WEBSITE_URL
Record-Status -Name 'QA_API_URL' -Value $env:QA_API_URL
Record-Status -Name 'QA_USERNAME' -Value $env:QA_USERNAME
Record-Status -Name 'QA_PASSWORD' -Value $env:QA_PASSWORD
Record-Status -Name 'QA_API_TOKEN' -Value $env:QA_API_TOKEN
Record-Status -Name 'QA_API_USERNAME' -Value $env:QA_API_USERNAME
Record-Status -Name 'QA_API_PASSWORD' -Value $env:QA_API_PASSWORD
