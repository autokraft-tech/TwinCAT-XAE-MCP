$ErrorActionPreference = 'Stop'
$daemonExe = $env:TE1000_DAEMON_EXE
if (-not $daemonExe) { throw 'Use an independent build via TE1000_DAEMON_EXE.' }
$testExe = Join-Path (Split-Path -Parent $daemonExe) 'GitCheckoutTests.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /platform:x64 "/out:$testExe" "/reference:$daemonExe" (Join-Path $PSScriptRoot 'OfflinePolicy.cs') (Join-Path $PSScriptRoot 'GitCheckout.cs') (Join-Path (Split-Path -Parent $PSScriptRoot) 'tests\GitCheckoutTests.cs')
if ($LASTEXITCODE) { throw 'Git checkout guard fixture compilation failed.' }
foreach ($scenario in @('valid','main','branch','head','return','detached','root','solution','unconfigured','active')) {
    & $testExe $scenario
    if ($LASTEXITCODE) { throw "Git checkout guard failed: $scenario" }
}
