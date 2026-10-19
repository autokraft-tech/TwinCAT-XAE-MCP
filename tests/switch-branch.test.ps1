$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('nexplc-switch-fixture-' + [guid]::NewGuid().ToString('N'))
$checkout = Join-Path $fixture 'checkout'
New-Item -ItemType Directory -Path (Join-Path $checkout 'MySPT_Machine') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $checkout 'MySPT_Machine\MySPT_Machine.sln'), 'Synthetic fixture, never opened by XAE.')
& git -C $checkout init -q -b main
& git -C $checkout add .
& git -C $checkout -c user.name=Fixture -c user.email=fixture@invalid -c core.hooksPath=NUL commit -q -m fixture
if ($LASTEXITCODE) { throw 'Switch fixture setup failed.' }
$script = Join-Path (Split-Path -Parent $PSScriptRoot) 'daemon\switch-branch.ps1'
# Mock process inspection only in this synthetic fixture; never stop a process.
function Get-Process { param($Name) }
function Reject-Switch([string]$Branch) {
    $before = & git -C $checkout symbolic-ref --short HEAD
    $rejected=$false
    try { & $script -Checkout $checkout -Branch $Branch | Out-Null } catch { $rejected=$true }
    if (-not $rejected -or (& git -C $checkout symbolic-ref --short HEAD) -ne $before) { throw 'Unsafe/failed switch must preserve the branch.' }
}
$savedLocalAppData = $env:LOCALAPPDATA
try {
    $env:LOCALAPPDATA = Join-Path $fixture 'state'
    & $script -Checkout $checkout -Branch fix/fixture -Create | Out-Null
    if ((& git -C $checkout symbolic-ref --short HEAD) -ne 'fix/fixture') { throw 'Clean closed checkout must allow a branch.' }
    function Get-Process { param($Name) [pscustomobject]@{Name='TcXaeShell';Id=-1} }
    Reject-Switch main
    function Get-Process { param($Name) }
    [IO.File]::WriteAllText((Join-Path $checkout 'dirty.txt'), 'Preserve me')
    Reject-Switch main
    & git -C $checkout add .
    & git -C $checkout -c user.name=Fixture -c user.email=fixture@invalid -c core.hooksPath=NUL commit -q -m preserve
    if ($LASTEXITCODE) { throw 'Fixture preservation commit failed.' }
    $solution=Join-Path $checkout 'MySPT_Machine\MySPT_Machine.sln'
    $sha=[Security.Cryptography.SHA256]::Create()
    try {
        $key=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes((Split-Path -Parent $solution).ToUpperInvariant())))).Replace('-','').ToLowerInvariant()
        $leaseKey=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($solution.ToUpperInvariant())))).Replace('-','')
    } finally { $sha.Dispose() }
    $stateRoot=Join-Path $env:LOCALAPPDATA 'NexPlcXaeMcp'
    $history=Join-Path $stateRoot ('save-audits\' + $key + '\sessions\older')
    New-Item -ItemType Directory -Path $history -Force | Out-Null
    $pending=Join-Path $history 'pending.json'
    [IO.File]::WriteAllText($pending, '{"state":"executing","synthetic":true}')
    Reject-Switch main
    if ([IO.File]::ReadAllText($pending) -ne '{"state":"executing","synthetic":true}') { throw 'Unknown journal must remain byte-identical.' }
    # Switch to a separate synthetic state root rather than clearing the failed evidence.
    $env:LOCALAPPDATA=Join-Path $fixture 'other-state'
    $otherRoot=Join-Path $env:LOCALAPPDATA 'NexPlcXaeMcp'
    New-Item -ItemType Directory -Path $otherRoot -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $otherRoot ($leaseKey + '.lease')), 'pending')
    Reject-Switch main
    $env:LOCALAPPDATA=Join-Path $fixture 'empty-state'
    Reject-Switch missing-fixture-branch
    & $script -Checkout $checkout -Branch main | Out-Null
    if ((& git -C $checkout symbolic-ref --short HEAD) -ne 'main') { throw 'Safe return to main must pass.' }
    Write-Output 'Branch switch checks passed (open XAE, dirty checkout, historical pending, unknown lease and Git failure preserve branch; no COM).'
} finally { $env:LOCALAPPDATA=$savedLocalAppData }
