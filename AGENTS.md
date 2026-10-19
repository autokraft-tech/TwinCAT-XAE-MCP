# Agent maintenance rules

Read [README](README.md), [architecture](docs/ARCHITECTURE.md), [object API](docs/PLC_OBJECT_API.md), [save safety](docs/XAE_SAVE_SAFETY.md) and [lifecycle](docs/XAE_LIFECYCLE.md) before changing engineering/session behavior. Clients that do not load AGENTS.md must explicitly include these rules in their instructions.

## Engineering

- Prefer validated XAE MCP tools. Never synthesize `.TcPOU`, `.TcDUT`, `.TcGVL`, `.plcproj` XML or GUIDs to bypass XAE. XML inspection is read-only.
- Production is read-only. Writes require an explicitly authorized isolated linked Worktree, separate Dev EXE/pipe and startup-pinned Solution, object roots and types. Verify exact Solution/System Manager and paths; clients cannot enlarge permissions.
- Supported writes: ST FB 604, direct-FB ST Method 609, STRUCT 606, ENUM 605, GVL 615. Method folder writes are unvalidated. ALIAS 623 is hard-disabled; preserve failed worktrees/journals and never replay calls.
- Keep COM on one STA, reuse DTE/System Manager, never start XAE/open Solution per request. Preserve user-owned instances.
- Never Download, Online Change, Login/Logout, Run, Stop, Reset, activate configuration, restart runtime, write ADS/device outputs, execute arbitrary DTE commands, click dialogs, delete/move/rename objects or change third-party libraries. Confirmation strings cannot override policy.

## Save and recovery

- Read code first. Use full-content hashes for Method/DUT/GVL updates; prefer them for FB too. Preserve identity.
- All save paths including implicit reload saves use `SaveAudited`. CreateChild can write before SaveAll; audit mutations too.
- After writes check code, GUID, unique Compile references, configuration differences, save audit and full Git Diff. Reload the isolated solution and run necessary offline compilation; inspect diagnostics and audit again.
- Lost responses/timeouts can leave writes unknown. Never auto-retry, replace a stuck worker, launch a second XAE or delete/modify journals, leases or baselines to bypass validation. Stop writes and inspect actual state.
- Recovery requires matching persistent audit, files, policy and owned instance. Audit is not rollback or a power-loss transaction. Preserve pending/executing/blocked evidence.
- Stop only a verified owned instance after saved-state and audit checks; no force-kill or Task.End bypass.

## Repository work

Keep Node MCP + C# Daemon architecture and protocol/configuration compatibility. Make surgical changes and test changed safety behavior. Build to independent output directories; do not replace installed EXEs/configs or restart live instances without deployment authorization.

Run `npm run check`, `npm test`, `npm run test:offline`, `node daemon/test-ping.js`, independent Release/x64 build and `git diff --check`. Live tests are opt-in and require explicit isolated-worktree authorization. Offline fixtures do not prove COM behavior.

Do not commit PLC snapshots, logs, journals, local profiles, user config, credentials or binaries. Preserve history and local evidence. Commit/push/PR/merge require explicit user authorization; integration never implies deployment.
