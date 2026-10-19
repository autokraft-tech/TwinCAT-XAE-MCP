function Assert-XaeTaskAction {
    param([int]$ActionCount, [string]$Executable, [string]$Arguments, [string]$WorkingDirectory,
        [string]$ProfilePath, [string]$ScriptPath)
    $expectedExecutable = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
    $expectedArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $ScriptPath + '" -Action host -Profile "' + $ProfilePath + '"'
    $expectedDirectory = Split-Path -Parent (Split-Path -Parent $ScriptPath)
    if ($ActionCount -ne 1 -or $Executable -ne $expectedExecutable -or $Arguments -ne $expectedArguments -or
        $WorkingDirectory -ne $expectedDirectory) {
        throw 'Scheduled task action differs from the pinned lifecycle host/profile. Nothing was dispatched.'
    }
}
