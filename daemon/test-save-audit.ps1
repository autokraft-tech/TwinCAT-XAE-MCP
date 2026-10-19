$ErrorActionPreference = 'Stop'
$repoDir = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$testExe = Join-Path $PSScriptRoot 'bin\Phase2Tests\ProjectSaveAuditTests.exe'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $testExe) | Out-Null
& $csc /nologo /platform:x64 "/out:$testExe" /reference:System.Xml.Linq.dll (Join-Path $PSScriptRoot 'Json.cs') (Join-Path $PSScriptRoot 'ProjectSaveAudit.cs') (Join-Path $repoDir 'tests\ProjectSaveAuditTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Save audit test compilation failed.' }
& $testExe
if ($LASTEXITCODE -ne 0) { throw 'Save audit tests failed.' }
