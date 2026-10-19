$ErrorActionPreference = 'Stop'
$repoDir = Split-Path -Parent $PSScriptRoot
$daemonExe = $env:TE1000_DAEMON_EXE
if (-not $daemonExe) { throw 'Set TE1000_DAEMON_EXE to an independent build.' }
$testExe = Join-Path (Split-Path -Parent $daemonExe) 'NestedMethodTests.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /platform:x64 "/out:$testExe" "/reference:$daemonExe" (Join-Path $PSScriptRoot 'OfflinePolicy.cs') (Join-Path $PSScriptRoot 'GitCheckout.cs') (Join-Path $PSScriptRoot 'MethodTarget.cs') (Join-Path $repoDir 'tests\NestedMethodTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Nested Method test compilation failed.' }
& $testExe
if ($LASTEXITCODE -ne 0) { throw 'Nested Method tests failed.' }
