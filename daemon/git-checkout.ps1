# Git inspection only. Engineering files are never written by these helpers.
function Get-XaeGitIdentity([string]$Checkout) {
    $checkoutPath = (Resolve-Path -LiteralPath $Checkout).Path
    $root = & git -C $checkoutPath rev-parse --show-toplevel
    if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath([string]$root) -ne $checkoutPath) { throw 'Use the exact Git checkout root.' }
    $branch = & git -C $checkoutPath symbolic-ref --quiet --short HEAD
    if ($LASTEXITCODE -ne 0 -or -not $branch -or $branch -in @('main','master')) { throw 'An explicitly authorized non-main branch is required; detached HEAD is refused.' }
    $head = & git -C $checkoutPath rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read Git HEAD.' }
    $common = & git -C $checkoutPath rev-parse --path-format=absolute --git-common-dir
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify Git common directory.' }
    for ($directory = Get-Item -LiteralPath $checkoutPath; $directory; $directory = $directory.Parent) {
        if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked checkout paths are unsupported.' }
    }
    [pscustomobject]@{root=$checkoutPath; branch=[string]$branch; head=[string]$head; common=[IO.Path]::GetFullPath([string]$common)}
}

function Assert-XaeGitProfile($Environment) {
    $identity = Get-XaeGitIdentity $Environment.TE1000_GIT_CHECKOUT
    if ($Environment.TE1000_GIT_WORKFLOW -ne 'single-checkout' -or
        $identity.common -ne (Join-Path $identity.root '.git') -or
        $identity.branch -cne $Environment.TE1000_GIT_BRANCH -or $identity.head -cne $Environment.TE1000_GIT_HEAD -or
        $Environment.TE1000_MCP_SOLUTION_PATH -ne (Join-Path $identity.root 'MySPT_Machine\MySPT_Machine.sln')) {
        throw 'Pinned checkout/branch/commit/solution mismatch. Preserve the session and reauthorize only after normal shutdown.'
    }
}
