# Contributing

Read [README](README.md), [AGENTS.md](AGENTS.md) and [architecture](docs/ARCHITECTURE.md) before changing the offline engineering surface. Preserve upstream attribution and avoid unrelated refactors.

Build to an independent output directory and run [all regression checks](docs/TESTING.md). Cover changed safety behavior with meaningful tests. Real XAE validation requires a separately authorized isolated worktree. Ubuntu CI only checks JavaScript and documentation, not COM.

Document current verified behavior, fixture versus real COM evidence and remaining limitations. Keep protocol/configuration compatibility. Check relative links and git diff --check.

Never commit engineering snapshots, journals, logs, local profiles, user config, credentials or generated binaries. Review the complete diff and untracked files. Integration does not authorize deployment or runtime actions.

Do not re-enable runtime control, downloads, XML writes or ALIAS 623. Do not bypass audit locks. Report vulnerabilities according to [SECURITY](SECURITY.md).
