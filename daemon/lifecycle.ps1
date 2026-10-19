param(
    [Parameter(Mandatory=$true)][ValidateSet('install','start','status','stop','diagnose','host')][string]$Action,
    [Parameter(Mandatory=$true)][string]$Profile,
    [switch]$AtLogon
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'task-definition.ps1')
. (Join-Path $PSScriptRoot 'write-root-validation.ps1')
. (Join-Path $PSScriptRoot 'git-checkout.ps1')
$Profile = (Resolve-Path -LiteralPath $Profile).Path
$settings = Get-Content -LiteralPath $Profile -Raw -Encoding UTF8 | ConvertFrom-Json
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$currentSession = (Get-Process -Id $PID).SessionId
if ($settings.userSid -ne $currentSid -or $settings.sessionId -ne $currentSession -or $currentSession -eq 0) {
    throw 'Profile belongs to another Windows user/session. No daemon or XAE was started.'
}
if ($settings.taskName -notmatch '^NexPlcXae-Dev-[A-Za-z0-9_-]+$') { throw 'Invalid development task name.' }
$envMap = @{}
foreach ($entry in $settings.env.PSObject.Properties) {
    if ($entry.Name -notmatch '^TE1000_[A-Z_]+$') { throw 'Profile may contain only TE1000 startup environment keys.' }
    $envMap[$entry.Name] = [string]$entry.Value
}
$solution = [IO.Path]::GetFullPath($envMap.TE1000_MCP_SOLUTION_PATH)
$binary = [IO.Path]::GetFullPath($envMap.TE1000_DAEMON_EXE)
$pipeName = $envMap.TE1000_DAEMON_PIPE
if ($pipeName -notmatch '^nexplc-p4-dev-[A-Za-z0-9_-]+$' -or $envMap.TE1000_SESSION_MODE -ne 'createOnce' -or
    $solution -ne $envMap.TE1000_WRITE_SOLUTION_PATH -or -not (Test-Path -LiteralPath $solution) -or
    -not (Test-Path -LiteralPath $binary) -or $envMap.TE1000_OWNER_SID -ne $currentSid -or
    $envMap.TE1000_OWNER_SESSION_ID -ne [string]$currentSession) { throw 'Invalid pinned Dev configuration.' }
$commonGit = & git -C ([IO.Path]::GetDirectoryName($solution)) rev-parse --path-format=absolute --git-common-dir
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFileName([string]$commonGit) -ne '.git') { throw 'Cannot identify the protected primary checkout.' }
$productionRoot = Split-Path -Parent ([IO.Path]::GetFullPath([string]$commonGit))
$production = Join-Path $productionRoot 'MySPT_Machine\MySPT_Machine.sln'
if ($binary -like '*\bin\Release\*') { throw 'Lifecycle commands cannot manage production binaries.' }
if ($envMap.TE1000_GIT_WORKFLOW) {
    if ($Action -notin @('status','diagnose')) { Assert-XaeGitProfile $envMap }
}
elseif ($solution -eq $production) { throw 'The primary checkout requires explicit single-checkout branch authorization.' }
foreach ($root in $envMap.TE1000_WRITE_ROOTS.Split(';')) {
    Assert-XaeWriteRoot $root $envMap.TE1000_PLC_ROOT $solution
}
if ($envMap.TE1000_PLC_WRITE_TYPES -notmatch '^(604|609|605|606|615)(;(604|609|605|606|615))*$') { throw 'Unsupported startup write type.' }
function Get-Sha([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
$policyText = ''
foreach ($key in @('TE1000_MCP_SOLUTION_PATH','TE1000_WRITE_SOLUTION_PATH','TE1000_WRITE_ROOTS','TE1000_PLC_WRITE_TYPES','TE1000_SESSION_MODE','TE1000_PROGID','TE1000_XAE_VERSION','TE1000_PROJECT_NAME','TE1000_PLC_ROOT')) {
    $policyText += $key + '=' + $envMap[$key] + "`n"
}
if ($envMap.TE1000_GIT_WORKFLOW) {
    foreach ($key in @('TE1000_GIT_WORKFLOW','TE1000_GIT_CHECKOUT','TE1000_GIT_BRANCH','TE1000_GIT_HEAD')) { $policyText += $key + '=' + $envMap[$key] + "`n" }
}
$policyHash = Get-Sha $policyText
$journalDir = Join-Path $env:LOCALAPPDATA ('NexPlcXaeMcp\save-audits\' + (Get-Sha ([IO.Path]::GetDirectoryName($solution).ToUpperInvariant())))
$journalHistory = $journalDir
if ($envMap.TE1000_GIT_WORKFLOW) { $journalDir = Join-Path $journalDir ('sessions\' + $policyHash) }
function Assert-NoPendingHistory {
    if (Test-Path -LiteralPath $journalHistory) {
        if (@(Get-ChildItem -LiteralPath $journalHistory -Filter pending.json -File -Recurse).Count) { throw 'Pending journal in solution history blocks startup. Preserve and diagnose.' }
    }
}
$lease = Join-Path $env:LOCALAPPDATA ('NexPlcXaeMcp\' + (Get-Sha ($solution.ToUpperInvariant())).ToUpperInvariant() + '.lease')
function Invoke-Rpc([string]$Name, $Payload = @{}, [int]$TimeoutMs = 20000) {
    $socket = New-Object IO.Pipes.NamedPipeClientStream('.', $pipeName, [IO.Pipes.PipeDirection]::InOut)
    try {
        $socket.Connect(2000)
        $reader = New-Object IO.StreamReader($socket, [Text.UTF8Encoding]::new($false), $false, 65536, $true)
        $writer = New-Object IO.StreamWriter($socket, [Text.UTF8Encoding]::new($false), 65536, $true)
        try {
            $writer.WriteLine((@{id='lifecycle'; action=$Name; payload=$Payload} | ConvertTo-Json -Depth 12 -Compress)); $writer.Flush()
            $read = $reader.ReadLineAsync()
            if (-not $read.Wait($TimeoutMs)) { throw 'Pipe outcome unknown; do not retry writes or stop. Diagnose first.' }
            if ($null -eq $read.Result) { throw 'Pipe disconnected; outcome unknown. No replay.' }
            $response = $read.Result | ConvertFrom-Json
            if (-not $response.ok) { throw $response.error }
            return $response.result
        } finally { $writer.Dispose(); $reader.Dispose() }
    } finally { $socket.Dispose() }
}
function Assert-Identity {
    $identity = Invoke-Rpc 'daemon_identity'
    $process = Get-Process -Id $identity.daemonPid
    if ($identity.userSid -ne $currentSid -or $identity.sessionId -ne $currentSession -or
        $identity.pipe -ne $pipeName -or $identity.solution -ne $solution -or $identity.policyHash -ne $policyHash -or
        $identity.executable -ne $binary -or $process.Path -ne $binary -or
        $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $identity.daemonStartTicks -or $process.SessionId -ne $currentSession) {
        throw 'Daemon identity mismatch. No lifecycle operation performed.'
    }
    return $identity
}
function Assert-Lease($Status) {
    $fields = [IO.File]::ReadAllLines($lease)
    $process = Get-Process -Id $Status.session.xaePid
    if ($fields.Count -ne 7 -or $fields[0] -ne [string]$process.Id -or $fields[1] -ne $process.StartTime.ToUniversalTime().Ticks.ToString() -or
        $fields[2] -ne [string]$currentSession -or $fields[3] -ne $currentSid -or $fields[4] -ne $pipeName -or
        $fields[5] -ne $solution -or $fields[6] -ne 'owned' -or $process.SessionId -ne $currentSession -or
        $Status.solution.fullName -ne $solution -or -not $Status.session.owned) { throw 'XAE ownership lease mismatch.' }
}
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$folder = $scheduler.GetFolder('\')
if ($Action -eq 'install') {
    $existing = @($folder.GetTasks(1) | Where-Object { $_.Name -eq $settings.taskName })
    if ($existing.Count) { throw 'Task already exists; inspect it rather than overwriting configuration.' }
    $task = $scheduler.NewTask(0)
    $task.RegistrationInfo.Description = 'NexPlc isolated offline development daemon; no automatic failure restart.'
    $task.Principal.UserId = $currentSid
    $task.Principal.LogonType = 3
    $task.Principal.RunLevel = 0
    $task.Settings.MultipleInstances = 2
    $task.Settings.ExecutionTimeLimit = 'PT0S'
    $task.Settings.DisallowStartIfOnBatteries = $false
    $task.Settings.StopIfGoingOnBatteries = $false
    $task.Settings.IdleSettings.StopOnIdleEnd = $false
    $task.Settings.AllowHardTerminate = $false
    $task.Settings.Hidden = $true
    if ($AtLogon) { $trigger = $task.Triggers.Create(9); $trigger.UserId = $currentSid; $trigger.Enabled = $true }
    $exec = $task.Actions.Create(0)
    $exec.Path = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
    $exec.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Action host -Profile "' + $Profile + '"'
    $exec.WorkingDirectory = Split-Path -Parent $PSScriptRoot
    $folder.RegisterTaskDefinition($settings.taskName, $task, 2, $currentSid, $null, 3, $null) | Out-Null
    [pscustomobject]@{installed=$settings.taskName; atLogon=[bool]$AtLogon; elevated=$false} | ConvertTo-Json
    exit
}
if ($Action -eq 'diagnose') {
    $identity = $null; $failure = $null
    try { $identity = Assert-Identity } catch { $failure = $_.Exception.Message }
    [pscustomobject]@{identity=$identity; error=$failure; solution=$solution; pipe=$pipeName; lease=$lease;
        leaseText=$(if (Test-Path -LiteralPath $lease) { [IO.File]::ReadAllLines($lease) });
        pending=(Test-Path -LiteralPath (Join-Path $journalDir 'pending.json'));
        baseline=(Test-Path -LiteralPath (Join-Path $journalDir 'baseline.json')); journalDirectory=$journalDir} | ConvertTo-Json -Depth 10
    exit
}
if ($Action -eq 'host') {
    Assert-NoPendingHistory
    if (Test-Path -LiteralPath (Join-Path $journalDir 'pending.json')) { throw 'Pending journal blocks startup. Preserve and diagnose.' }
    foreach ($key in @(Get-ChildItem Env:TE1000_* | Select-Object -ExpandProperty Name)) { [Environment]::SetEnvironmentVariable($key, $null, 'Process') }
    foreach ($key in $envMap.Keys) { [Environment]::SetEnvironmentVariable($key, $envMap[$key], 'Process') }
    $daemonProcess = Start-Process -FilePath $binary -ArgumentList @('--pipe', $pipeName, '--no-autodismiss') -WindowStyle Hidden -PassThru
    # The foreground scheduler host retains ownership; Scheduler has no restart policy.
    $daemonProcess.WaitForExit()
    exit $daemonProcess.ExitCode
}
if ($Action -eq 'start') {
    Assert-NoPendingHistory
    if (Test-Path -LiteralPath (Join-Path $journalDir 'pending.json')) { throw 'Pending journal blocks startup. Preserve and diagnose.' }
    $task = $folder.GetTask($settings.taskName)
    $taskUser = $task.Definition.Principal.UserId
    if ($taskUser -notmatch '^S-1-') { $taskUser = ([Security.Principal.NTAccount]::new($taskUser)).Translate([Security.Principal.SecurityIdentifier]).Value }
    $taskAction = $task.Definition.Actions.Item(1)
    Assert-XaeTaskAction -ActionCount $task.Definition.Actions.Count -Executable $taskAction.Path `
        -Arguments $taskAction.Arguments -WorkingDirectory $taskAction.WorkingDirectory -ProfilePath $Profile -ScriptPath $PSCommandPath
    if ($taskUser -ne $currentSid -or
        $task.Definition.Principal.LogonType -ne 3 -or $task.Definition.Principal.RunLevel -ne 0) { throw 'Scheduled task/profile identity mismatch.' }
    $task.Run($null) | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try { $identity = Assert-Identity; $ready = $true; break } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'Daemon did not become ready; diagnose. No automatic replacement.' }
    $status = Invoke-Rpc 'xae_status' @{expectedSolutionPath=$solution} 180000
    Assert-Lease $status
    $status | ConvertTo-Json -Depth 10
    exit
}
$identity = Assert-Identity
if ($Action -eq 'status') {
    # COM-free; never initializes or replaces XAE.
    [pscustomobject]@{identity=$identity; leaseText=$(if (Test-Path -LiteralPath $lease) { [IO.File]::ReadAllLines($lease) });
        pending=(Test-Path -LiteralPath (Join-Path $journalDir 'pending.json'));
        baseline=(Test-Path -LiteralPath (Join-Path $journalDir 'baseline.json'))} | ConvertTo-Json -Depth 10
    exit
}
if ($Action -eq 'stop') {
    $status = Invoke-Rpc 'xae_status' @{expectedSolutionPath=$solution}
    Assert-Lease $status
    $result = Invoke-Rpc 'daemon_shutdown' @{expectedSolutionPath=$solution}
    $result | ConvertTo-Json -Depth 10
}
