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
. (Join-Path $repoDir 'daemon\write-root-validation.ps1')
# Synthetic XML is a parser fixture only; never opened in XAE.
$pouDir = Join-Path $dev 'MySPT_Machine\MainPLC\03_POUs\02_Components'
New-Item -ItemType Directory -Path $pouDir -Force | Out-Null
$pouFile = Join-Path $pouDir 'FB_Test.TcPOU'
[IO.File]::WriteAllText($pouFile, '<TcPlcObject><POU Name="FB_Test"><Declaration>FUNCTION_BLOCK FB_Test</Declaration><Folder Name="I_Test"/><Folder Name="Inner" FolderPath="I_Test\"/><Method Name="M_Test" FolderPath="I_Test\Inner\"/></POU></TcPlcObject>')
$nestedRoot = "$plc^03_POUs^02_Components^FB_Test^I_Test^Inner^M_Test"
Assert-XaeWriteRoot $nestedRoot $plc (Join-Path $dev 'MySPT_Machine\MySPT_Machine.sln')
foreach ($bad in @("$plc^03_POUs^02_Components", "$plc^03_POUs^02_Components^FB_Test^I_Test", ($nestedRoot + '^Child'), $nestedRoot.Replace('Inner','Other'), $nestedRoot.Replace('FB_Test','OtherFB'), $nestedRoot.Replace('I_Test','..'))) {
    $rejected = $false
    try { Assert-XaeWriteRoot $bad $plc (Join-Path $dev 'MySPT_Machine\MySPT_Machine.sln') } catch { $rejected = $true }
    if (-not $rejected) { throw ('Invalid deep scope must be refused: ' + $bad) }
}
& git -C $dev add .
& git -C $dev -c user.name=Fixture -c user.email=fixture@invalid -c core.hooksPath=NUL commit -q -m parser-fixture
$roots = @("$plc^03_POUs^FB_Task", "$plc^03_POUs^FB_Other^M_Task", "$plc^01_DUTs^ST_Task", "$plc^01_DUTs^E_Task", "$plc^04_GVLs^GVL_Task", $nestedRoot)
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
$parameters.WriteTypes=@(604,609,606,605,615)
$parameters.WriteRoots=@($roots | Where-Object { $_ -ne $nestedRoot })
& git -C $seed switch -q -c fix/profile-fixture
if ($LASTEXITCODE) { throw 'Fixture branch setup failed.' }
$parameters.Profile = Join-Path $fixture 'single.json'
$parameters.AuthorizedBranch = 'fix/profile-fixture'
& $script @parameters | Out-Null
$single = [IO.File]::ReadAllText($parameters.Profile) | ConvertFrom-Json
if ($single.env.TE1000_GIT_BRANCH -cne 'fix/profile-fixture' -or $single.env.TE1000_GIT_CHECKOUT -ne $seed -or
    $single.env.TE1000_GIT_WORKFLOW -ne 'single-checkout' -or -not $single.env.TE1000_GIT_HEAD) { throw 'Single checkout branch identity was not pinned.' }
. (Join-Path $repoDir 'daemon\git-checkout.ps1')
$singleMap=@{}; foreach ($entry in $single.env.PSObject.Properties) { $singleMap[$entry.Name]=[string]$entry.Value }
Assert-XaeGitProfile $singleMap
& git -C $seed switch -q -c fix/other-fixture
if ($LASTEXITCODE) { throw 'Fixture branch drift setup failed.' }
$rejected=$false
try { Assert-XaeGitProfile $singleMap } catch { $rejected=$true }
if (-not $rejected) { throw 'Branch drift must be rejected even when HEAD commit is identical.' }
$parameters.Profile=Join-Path $fixture 'wrong-branch.json'
$rejected=$false
try { & $script @parameters | Out-Null } catch { $rejected=$true }
if (-not $rejected) { throw 'Wrong branch authorization must fail.' }
$parameters.Remove('AuthorizedBranch')
$parameters.WriteRoots=$roots
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
