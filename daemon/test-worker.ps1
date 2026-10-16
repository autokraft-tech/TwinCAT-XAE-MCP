$ErrorActionPreference = 'Stop'
$repoDir = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$daemonExe = Join-Path $PSScriptRoot 'bin\Release\Te1000Daemon.exe'
$testExe = Join-Path $PSScriptRoot 'bin\Release\DaemonWorkerTests.exe'
$source = Join-Path $repoDir 'tests\DaemonWorkerTests.cs'
& $csc /nologo /platform:x64 "/out:$testExe" "/reference:$daemonExe" $source
if ($LASTEXITCODE -ne 0) { throw 'Worker test compilation failed.' }
& $testExe
if ($LASTEXITCODE -ne 0) { throw 'Worker tests failed.' }
