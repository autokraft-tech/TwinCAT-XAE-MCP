param(
    [Parameter(Mandatory=$true)][Alias('Checkout')][string]$Worktree,
    [Parameter(Mandatory=$true)][string]$DaemonExe,
    [Parameter(Mandatory=$true)][string]$Profile,
    [Parameter(Mandatory=$true)][string]$TaskName,
    [Parameter(Mandatory=$true)][string]$Pipe,
    [Parameter(Mandatory=$true)][string[]]$WriteRoots,
    [int[]]$WriteTypes = @(604),
    [string]$AuthorizedBranch
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'write-root-validation.ps1')
. (Join-Path $PSScriptRoot 'git-checkout.ps1')
$Worktree = (Resolve-Path -LiteralPath $Worktree).Path
$DaemonExe = (Resolve-Path -LiteralPath $DaemonExe).Path
$Profile = [IO.Path]::GetFullPath($Profile)
$commonGit = & git -C $Worktree rev-parse --path-format=absolute --git-common-dir
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFileName([string]$commonGit) -ne '.git') { throw 'Cannot identify the protected primary checkout.' }
$production = Split-Path -Parent ([IO.Path]::GetFullPath([string]$commonGit))
$singleCheckout = $Worktree -eq $production
if ($singleCheckout) {
    $gitIdentity = Get-XaeGitIdentity $Worktree
    if (-not $AuthorizedBranch -or $gitIdentity.branch -cne $AuthorizedBranch) { throw 'Authorize the exact current non-main branch with -AuthorizedBranch.' }
} elseif ($Worktree.StartsWith($production + '\', [StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath (Join-Path $Worktree '.git') -PathType Leaf)) { throw 'Expected the fixed checkout or an explicitly authorized legacy linked worktree.' }
if ($DaemonExe -like '*\bin\Release\*') { throw 'Use a separate Dev build, never production Release.' }
if (Test-Path -LiteralPath $Profile) { throw 'Do not overwrite a startup profile. Review/create a new task.' }
$solution = Join-Path $Worktree 'MySPT_Machine\MySPT_Machine.sln'
if (-not (Test-Path -LiteralPath $solution)) { throw 'Expected NexPlc solution missing.' }
$gitState = & git -C $Worktree status --porcelain=v1 --untracked-files=all
if ($LASTEXITCODE -ne 0 -or $gitState) { throw 'New task requires a clean worktree. Preserve existing changes.' }
if ($TaskName -notmatch '^NexPlcXae-Dev-[A-Za-z0-9_-]+$' -or $Pipe -notmatch '^nexplc-p4-dev-[A-Za-z0-9_-]+$') { throw 'Invalid Dev task/pipe name.' }
# Unicode is expressed as codepoints so Windows PowerShell 5 can read this script without a BOM.
$plcRoot = 'TIPC^MainPLC^MainPLC' + [char]0x9879 + [char]0x76EE
foreach ($root in $WriteRoots) {
    Assert-XaeWriteRoot $root $plcRoot $solution
}
if (-not $WriteRoots.Count -or -not $WriteTypes.Count) { throw 'Explicit startup object and type scope required.' }
foreach ($type in $WriteTypes) { if ($type -notin @(604,609,606,605,615)) { throw 'Unsupported type; ALIAS remains disabled.' } }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$sessionId = (Get-Process -Id $PID).SessionId
if ($sessionId -eq 0) { throw 'Interactive user session required.' }
$profileData = [ordered]@{
    taskName=$TaskName; userSid=$sid; sessionId=$sessionId
    env=[ordered]@{
        TE1000_DAEMON_EXE=$DaemonExe; TE1000_DAEMON_PIPE=$Pipe; TE1000_DAEMON_AUTOSTART='0'
        TE1000_SESSION_MODE='createOnce'; TE1000_PROGID='TcXaeShell.DTE.17.0'; TE1000_XAE_VERSION='3.1.4026.20'
        TE1000_MCP_SOLUTION_PATH=$solution; TE1000_WRITE_SOLUTION_PATH=$solution
        TE1000_WRITE_ROOTS=($WriteRoots -join ';'); TE1000_PLC_WRITE_TYPES=($WriteTypes -join ';')
        TE1000_PROJECT_NAME='MySPT_Machine'; TE1000_PLC_ROOT=$plcRoot
        TE1000_OWNER_SID=$sid; TE1000_OWNER_SESSION_ID=[string]$sessionId; TE1000_DIALOG_AUTODISMISS='0'
        TE1000_DAEMON_LOG=([IO.Path]::ChangeExtension($Profile, '.daemon.log'))
    }
}
$parent = Split-Path -Parent $Profile
if ($singleCheckout) {
    $profileData.env.TE1000_GIT_WORKFLOW = 'single-checkout'
    $profileData.env.TE1000_GIT_CHECKOUT = $gitIdentity.root
    $profileData.env.TE1000_GIT_BRANCH = $gitIdentity.branch
    $profileData.env.TE1000_GIT_HEAD = $gitIdentity.head
}
if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
$json = $profileData | ConvertTo-Json -Depth 8
$bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
$stream = [IO.File]::Open($Profile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
[pscustomobject]@{profile=$Profile; task=$TaskName; solution=$solution; scope=$WriteRoots; types=$WriteTypes; installed=$false} | ConvertTo-Json -Depth 5
