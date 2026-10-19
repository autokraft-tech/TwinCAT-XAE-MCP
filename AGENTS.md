# Agent maintenance rules

Read [README](README.md), [architecture](docs/ARCHITECTURE.md), [object API](docs/PLC_OBJECT_API.md), [save safety](docs/XAE_SAVE_SAFETY.md) and [lifecycle](docs/XAE_LIFECYCLE.md) before changing engineering/session behavior. Clients that do not load AGENTS.md must explicitly include these rules in their instructions.

## Engineering

- Prefer validated XAE MCP tools. Never synthesize `.TcPOU`, `.TcDUT`, `.TcGVL`, `.plcproj` XML or GUIDs to bypass XAE. XML inspection is read-only.
- Production is read-only. One repository uses one fixed checkout and ordinary feature/fix branches. Do not create another Worktree or clone for routine development; an exceptional Worktree requires explaining necessity and explicit user authorization. Writes require an explicitly authorized non-main branch, separate Dev EXE/pipe and startup-pinned checkout/branch/commit, Solution, object roots and types. Single-checkout operation requires the validated NexPlc layout and an exact startup-authorized branch/commit; do not bypass the daemon policy. Verify exact Solution/System Manager and paths; clients cannot enlarge permissions.
- Supported writes: ST FB 604, direct-FB ST Method 609 and exact-authorized existing ST Methods inside FB folders, STRUCT 606, ENUM 605, GVL 615. Nested updates verify 601 folder ancestry and 604 FB ownership; nested creation remains disabled. ALIAS 623 is hard-disabled; preserve failed worktrees/journals and never replay calls.
- Keep COM on one STA, reuse DTE/System Manager, never start XAE/open Solution per request. Preserve user-owned instances.
- Never Download, Online Change, Login/Logout, Run, Stop, Reset, activate configuration, restart runtime, write ADS/device outputs, execute arbitrary DTE commands, click dialogs, delete/move/rename objects or change third-party libraries. Confirmation strings cannot override policy.

## Save and recovery

- Read code first. Use full-content hashes for Method/DUT/GVL updates; prefer them for FB too. Preserve identity.
- All save paths including implicit reload saves use `SaveAudited`. CreateChild can write before SaveAll; audit mutations too.
- After writes check code, GUID, unique Compile references, configuration differences, save audit and full Git Diff. Reload the authorized solution and run necessary offline compilation; inspect diagnostics and audit again.
- Lost responses/timeouts can leave writes unknown. Never auto-retry, replace a stuck worker, launch a second XAE or delete/modify journals, leases or baselines to bypass validation. Stop writes and inspect actual state.
- Recovery requires matching persistent audit, files, policy and owned instance. Audit is not rollback or a power-loss transaction. Preserve pending/executing/blocked evidence.
- Stop only a verified owned instance after saved-state and audit checks; no force-kill or Task.End bypass.

## Repository work

Keep Node MCP + C# Daemon architecture and protocol/configuration compatibility. Make surgical changes and test changed safety behavior. Build to independent output directories; do not replace installed EXEs/configs or restart live instances without deployment authorization.

Run `npm run check`, `npm test`, `npm run test:offline`, `node daemon/test-ping.js`, independent Release/x64 build and `git diff --check`. Live tests are opt-in and require exact branch/object/session authorization. Finish audited save, offline build and full diff review, normally close the owned XAE and stop its daemon before Git commits or branch switching. Preserve unknown journals/leases and user-owned instances. Keep main usable; after verified integration clean up only merged branches without independent contents. Offline fixtures do not prove COM behavior.

Do not commit PLC snapshots, logs, journals, local profiles, user config, credentials or binaries. Preserve history and local evidence. Commit/push/PR/merge require explicit user authorization; integration never implies deployment.

## Codex outputs and task completion

- Commit only maintained project source, required PLC engineering metadata, AGENTS.md, .gitignore, automated test source, and maintained architecture/API/development/deployment/security/testing documentation. Test source is allowed; test execution output is not.
- Never commit generated review reports, temporary acceptance/execution summaries, test/build logs, exported diffs or snapshots, JSON results/inventories, backups/bundles/patches, local daemon profiles/state, debug screenshots, temporary project copies, or intermediate Markdown. State task conclusions directly in the final reply; do not create a per-task Markdown report.
- Put ordinary outputs in the system temporary directory or outside the repository, or in an explicitly ignored output directory. Do not ignore all docs/, *.md or *.json. .gitignore does not untrack files: remove tracked reports in an ordinary follow-up deletion commit, preserving Git history. Before removing a mixed report, move enduring requirements into existing maintained documentation.
- At task completion run the necessary tests/build, review the complete diff, check that only maintained project files enter the commit, clean ordinary task-owned temporary reports/build outputs/backups/test data, then inspect git status and git diff --check and verify the tracked file list. Summarize errors, warnings, test counts and commit SHAs in the final reply. Documentation-only changes require documentation/link and Git hygiene checks; they do not require PLC writes or a new engineering build.
- Before cleanup prove that files are task-owned, not pre-existing user files, and contain no unique unsaved work. Never delete Pending Journals, leases, audit baselines or failure/recovery evidence while a running instance, unknown write, unfinished audit or recovery dependency remains. Keep uncertain data and explain why. Do not rewrite Git history or merge an unaccepted PR merely because its reports were cleaned up.
