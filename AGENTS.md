# NexPlc XAE MCP maintenance

This fork is an offline PLC source-development service. Read
`docs/NEXPLC_XAE_MCP_VALIDATION.md` and the NexPlc section of `README.md` before
changing session, tool or policy code.

- Use the installed `nexplc_xae` MCP for NexPlc tree/code reads. Create and edit PLC
  objects only through validated XAE Automation Interface methods. Do not resume
  the discontinued XaeBridge.ps1 prototype.
- Keep all COM access on the daemon's single STA. Reuse DTE and ITcSysManager;
  never start XAE or open a solution on each request. Check exact Solution.FullName
  and System Manager project path before work. Do not convert a busy process into
  a second instance.
- The daemon has a fixed offline allowlist. Do not re-enable runtime download,
  online change, login/logout, activation/restart, ADS writes, device control,
  arbitrary DTE commands, XML writes, deletes, moves, renames or dialog clicks.
  Confirmation strings cannot override these restrictions.
- Only ST FB creation (604, language 1) and ST FB declaration/implementation
  writes have been validated. DUT/GVL declarations can be read. Method/DUT/GVL
  creation or modification must stop until separately validated through the
  corresponding official interfaces. Never synthesize TcPOU/project XML or GUIDs.
- The installed formal NexPlc session is read-only. All write validation must use
  an isolated worktree with startup-pinned TE1000_WRITE_SOLUTION_PATH and narrowly
  scoped TE1000_WRITE_ROOTS. Existing FB writes must preserve object name and GUID.
  SPT V4 libraries/framework files must never be modified.
- A pipe drop, timeout or modal can leave a write's outcome unknown. Do not replay
  it. Inspect actual state first; the worker fails closed. Never auto-answer dialogs.
- Preserve user-owned XAE instances. Shutdown may close only a known daemon-owned
  instance with the pinned solution and no unsaved projects/documents.
- Do not commit, push, merge or create a PR without the user's explicit request.

Verification after code changes: build the daemon, run `npm run check`, `npm test`,
`npm run test:offline`, and `node daemon/test-ping.js`. Live tests are opt-in;
follow the report's isolated-worktree instructions. Stop after the requested
validation; do not change NexPlc application behavior.
