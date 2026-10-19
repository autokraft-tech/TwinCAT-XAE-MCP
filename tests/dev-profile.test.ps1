$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('nexplc-profile-fixture-' + [guid]::NewGuid().ToString('N'))
$seed = Join-Path $fixture 'seed'
$dev = Join-Path $fixture 'dev'
$repoDir = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Path (Join-Path $seed 'MySPT_Machine') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $seed 'MySPT_Machine\MySPT_Machine.sln'), 'Synthetic profile fixture; never opened by XAE.')
& git -C $seed init -q
& git -C $seed add .
& git -C $seed -c user.name=Fixture -c user.email=fixture@invalid -c core.hooksPath=NUL commit -q -m fixture
& git -C $seed worktree add -q --detach $dev HEAD
if ($LASTEXITCODE) { throw 'Fixture worktree setup failed.' }
$plc = 'TIPC^MainPLC^MainPLC' + [char]0x9879 + [char]0x76EE
$roots = @("$plc^03_POUs^FB_Task", "$plc^03_POUs^FB_Other^M_Task", "$plc^01_DUTs^ST_Task", "$plc^01_DUTs^E_Task", "$plc^04_GVLs^GVL_Task")
$profileFile = Join-Path $fixture 'profile.json'
$parameters = @{
    Worktree=$dev; DaemonExe=$env:TE1000_DAEMON_EXE; Profile=$profileFile
    TaskName='NexPlcXae-Dev-Fixture'; Pipe='nexplc-p4-dev-fixture'; WriteRoots=$roots; WriteTypes=@(604,609,606,605,615)
}
$script = Join-Path $repoDir 'daemon\new-dev-profile.ps1'
& $script @parameters | Out-Null
$profile = [IO.File]::ReadAllText($profileFile) | ConvertFrom-Json
if ($profile.env.TE1000_WRITE_ROOTS -ne ($roots -join ';') -or $profile.env.TE1000_PLC_ROOT -ne $plc -or
    $profile.env.TE1000_DAEMON_AUTOSTART -ne '0' -or $profile.env.TE1000_OWNER_SESSION_ID -ne [string](Get-Process -Id $PID).SessionId) { throw 'Exact UTF-8 startup permissions were not preserved.' }
$textBefore = [IO.File]::ReadAllText($profileFile)
$rejected = $false
try { & $script @parameters | Out-Null } catch { $rejected=$true }
if (-not $rejected -or [IO.File]::ReadAllText($profileFile) -ne $textBefore) { throw 'Existing profile must not be overwritten.' }
$parameters.Profile = Join-Path $fixture 'alias.json'; $parameters.WriteTypes=@(623)
$rejected = $false
try { & $script @parameters | Out-Null } catch { $rejected=$true }
if (-not $rejected -or (Test-Path -LiteralPath $parameters.Profile)) { throw 'ALIAS profile must be refused.' }
$parameters.Profile = Join-Path $fixture 'broad.json'; $parameters.WriteTypes=@(604); $parameters.WriteRoots=@("$plc^03_POUs")
$rejected = $false
try { & $script @parameters | Out-Null } catch { $rejected=$true }
if (-not $rejected) { throw 'Broad folder scope must be refused.' }
$parameters.Profile = Join-Path $fixture 'dirty.json'; $parameters.WriteRoots=$roots
$parameters.Worktree=$seed
$rejected = $false
try { & $script @parameters | Out-Null } catch { $rejected=$true }
if (-not $rejected) { throw 'Primary checkout must be refused regardless of its machine path.' }
$parameters.Worktree=$dev
[IO.File]::AppendAllText((Join-Path $dev 'MySPT_Machine\MySPT_Machine.sln'), 'dirty')
$rejected = $false
try { & $script @parameters | Out-Null } catch { $rejected=$true }
if (-not $rejected) { throw 'Dirty worktree must be refused.' }
. (Join-Path $repoDir 'daemon\task-definition.ps1')
$hostScript = Join-Path $repoDir 'daemon\lifecycle.ps1'
$taskArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $hostScript + '" -Action host -Profile "' + $profileFile + '"'
$taskParameters = @{ActionCount=1; Executable="$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe";
    Arguments=$taskArgs; WorkingDirectory=$repoDir; ProfilePath=$profileFile; ScriptPath=$hostScript}
Assert-XaeTaskAction @taskParameters
foreach ($badField in @('ActionCount','Executable','Arguments','WorkingDirectory')) {
    $invalid = $taskParameters.Clone()
    if ($badField -eq 'ActionCount') { $invalid[$badField]=2 }
    elseif ($badField -eq 'Arguments') { $invalid[$badField]=$taskArgs.Replace($hostScript, (Join-Path $fixture 'other-host.ps1')) }
    else { $invalid[$badField]=Join-Path $fixture 'wrong' }
    $rejected=$false
    try { Assert-XaeTaskAction @invalid } catch { $rejected=$true }
    if (-not $rejected) { throw ('Tampered task field must be refused: ' + $badField) }
}
Write-Output 'Dev profile/task checks passed (exact object scope; UTF-8; no overwrite; ALIAS/broad/dirty refused; pinned task action; no scheduler/COM)'
# Retain this tiny synthetic fixture; no engineering files or journals are removed.
