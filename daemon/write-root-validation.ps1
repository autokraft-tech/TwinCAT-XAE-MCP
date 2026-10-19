# Read-only inspection of existing XAE-generated files; never creates PLC XML.
function Assert-XaeWriteRoot([string]$Root, [string]$PlcRoot, [string]$Solution) {
    $prefix = $PlcRoot + '^'
    if (-not $Root.StartsWith($prefix, [StringComparison]::Ordinal) -or $Root.Split('^').Count -gt 64 -or $Root.Contains('_Libraries')) {
        throw 'Use exact object paths in startup write roots.'
    }
    $parts = $Root.Substring($prefix.Length).Split('^')
    if ($parts.Count -lt 2 -or $parts[0] -notin @('03_POUs','01_DUTs','04_GVLs')) { throw 'Invalid code root.' }
    foreach ($part in $parts) {
        if ($part -cnotmatch '^[A-Za-z0-9_]+$') { throw 'Invalid object path segment.' }
    }
    $base = Join-Path (Split-Path -Parent $Solution) 'MainPLC'
    for ($i = 0; $i -lt $parts.Count; $i++) {
        $base = Join-Path $base $parts[$i]
        if (Test-Path -LiteralPath $base -PathType Container) {
            if ($i -eq $parts.Count - 1) { throw 'Folder-level write authorization is disabled.' }
            continue
        }
        $pouFile = $base + '.TcPOU'
        if (Test-Path -LiteralPath $pouFile -PathType Leaf) {
            $xml = New-Object Xml.XmlDocument
            $xml.XmlResolver = $null
            $xml.Load($pouFile)
            $pou = $xml.SelectSingleNode('/TcPlcObject/POU')
            if (-not $pou -or $pou.GetAttribute('Name') -cne $parts[$i] -or $pou.SelectSingleNode('Declaration').InnerText -notmatch '^\s*FUNCTION_BLOCK\b') { throw 'Expected an existing FB.' }
            if ($i -eq $parts.Count - 1) { return }
            $folders = @($parts[($i + 1)..($parts.Count - 1)])
            $methodName = $folders[-1]
            $folderPath = ''
            for ($j = 0; $j -lt $folders.Count - 1; $j++) {
                $matches = @($pou.SelectNodes('Folder') | Where-Object { $_.GetAttribute('Name') -ceq $folders[$j] -and $_.GetAttribute('FolderPath') -ceq $folderPath })
                if ($matches.Count -ne 1) { throw 'Method folder chain is not present in the owning FB.' }
                $folderPath += $folders[$j] + '\'
            }
            $methods = @($pou.SelectNodes('Method') | Where-Object { $_.GetAttribute('Name') -ceq $methodName -and $_.GetAttribute('FolderPath') -ceq $folderPath })
            if ($methods.Count -ne 1) { throw 'Exact existing Method is required.' }
            return
        }
    }
    # Preserve the existing shallow creation scopes; deep scopes require an existing FB/Method.
    if ($parts.Count -gt 3 -or ($parts[1..($parts.Count - 1)] | Where-Object { $_ -cnotmatch '^[A-Za-z_][A-Za-z0-9_]*$' })) {
        throw 'Deep write roots must identify an existing FB or Method.'
    }
}
