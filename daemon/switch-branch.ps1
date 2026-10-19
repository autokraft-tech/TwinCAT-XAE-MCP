param(
    [Parameter(Mandatory=$true)][string]$Checkout,
    [Parameter(Mandatory=$true)][string]$Branch,
    [switch]$Create
)
$ErrorActionPreference = 'Stop'
$Checkout = (Resolve-Path -LiteralPath $Checkout).Path
$root = & git -C $Checkout rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath([string]$root) -ne $Checkout) { throw 'Use the exact fixed Git checkout root.' }
& git check-ref-format --branch $Branch | Out-Null
if ($LASTEXITCODE -ne 0 -or $Branch.StartsWith('-')) { throw 'Invalid branch name.' }
$state = & git -C $Checkout status --porcelain=v1 --untracked-files=all
if ($LASTEXITCODE -ne 0 -or $state) { throw 'Preserve/commit changes before switching branches.' }
# Deliberately conservative: do not inspect or close user-owned COM instances.
if (@(Get-Process -Name TcXaeShell,devenv -ErrorAction SilentlyContinue).Count) {
    throw 'Close XAE sessions normally after audited save, offline build and full diff review before switching. No session was closed.'
}
$solution = Join-Path $Checkout 'MySPT_Machine\MySPT_Machine.sln'
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $solutionKey = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($solution.ToUpperInvariant())))).Replace('-','')
    $auditKey = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes((Split-Path -Parent $solution).ToUpperInvariant())))).Replace('-','').ToLowerInvariant()
} finally { $sha.Dispose() }
$stateRoot = Join-Path $env:LOCALAPPDATA 'NexPlcXaeMcp'
$lease = Join-Path $stateRoot ($solutionKey + '.lease')
if (Test-Path -LiteralPath $lease) {
    $fields = [IO.File]::ReadAllLines($lease)
    if ($fields.Count -ne 7 -or $fields[5] -ne $solution -or $fields[6] -ne 'closed') { throw 'Unknown or unclosed XAE lease blocks switching; preserve and diagnose.' }
}
$history = Join-Path $stateRoot ('save-audits\' + $auditKey)
if ((Test-Path -LiteralPath $history) -and @(Get-ChildItem -LiteralPath $history -Filter pending.json -File -Recurse).Count) {
    throw 'Pending journal blocks switching; preserve all evidence.'
}
if ($Create) { & git -C $Checkout switch -c $Branch }
else { & git -C $Checkout switch -- $Branch }
if ($LASTEXITCODE -ne 0) { throw 'Git branch switch failed. No daemon was started; inspect the actual Git state.' }
& git -C $Checkout status --short --branch
if ($LASTEXITCODE -ne 0) { throw 'Post-switch Git verification failed. Do not start Dev.' }
Write-Output 'Branch switched. Generate a new exact-branch profile and reverify XAE/Solution identity before engineering operations.'
