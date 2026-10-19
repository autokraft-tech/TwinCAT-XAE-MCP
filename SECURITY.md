# Security policy

This fork exposes a fixed offline engineering surface. Downloads, online changes, runtime/session control, ADS writes, configuration activation, arbitrary commands and ALIAS 623 are disabled. Confirmation strings cannot enable them.

Production is read-only. Dev writes require an isolated worktree with startup-pinned Solution, object paths and types. Named Pipe ACL/session checks and process/lease identity reduce accidental attachment to another instance. The file owner remains trusted; audit records are not cryptographically signed against that user.

Unknown writes fail closed. Never delete locked evidence, rewrite a baseline or replay disconnected writes. Save audit detects changes after disk writes, cannot roll back and does not guarantee power-loss atomicity. See [save safety](docs/XAE_SAVE_SAFETY.md) and [limitations](docs/TESTING.md).

Do not post PLC sources, audit archives, paths, credentials or machine configuration publicly. Use a private GitHub vulnerability report if enabled on this fork, otherwise contact its maintainer privately before disclosure. Provide a sanitized reproduction and affected commit. No security response SLA is promised.
