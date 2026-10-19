$ErrorActionPreference = 'Stop'
$repoDir = Split-Path -Parent $PSScriptRoot
$daemonExe = $env:TE1000_DAEMON_EXE
if (-not $daemonExe) { $daemonExe = Join-Path $PSScriptRoot 'bin\Release\Te1000Daemon.exe' }
$testExe = Join-Path (Split-Path -Parent $daemonExe) 'ObjectCreationTests.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /platform:x64 "/out:$testExe" "/reference:$daemonExe" (Join-Path $repoDir 'tests\ObjectCreationTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Object creation test compilation failed.' }
& $testExe
if ($LASTEXITCODE -ne 0) { throw 'Object creation builder tests failed.' }
