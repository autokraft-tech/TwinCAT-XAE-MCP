"use strict";
// Opt-in real XAE acceptance in the fixed checkout. Never retries engineering calls.
// Print results; persistent recovery evidence belongs to the daemon, not Git.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { McpClient } = require("./mcp-client");
const [stage, profileFile] = process.argv.slice(2);
assert.ok(["flow", "drift", "reconnect", "deny-main", "deny-branch", "read-only"].includes(stage));
const env = JSON.parse(fs.readFileSync(profileFile, "utf8").replace(/^\uFEFF/, "")).env;
assert.equal(env.TE1000_GIT_WORKFLOW, "single-checkout");
assert.equal(env.TE1000_DAEMON_AUTOSTART, "0");
const checkout = env.TE1000_GIT_CHECKOUT;
const solution = env.TE1000_MCP_SOLUTION_PATH;
const target = env.TE1000_PLC_ROOT + "^03_POUs^02_Components^Heaters^02_FB^FB_Heater^I_Heater^SetManualMode";
assert.equal(env.TE1000_WRITE_ROOTS, target);
assert.equal(env.TE1000_PLC_WRITE_TYPES, "609");
const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", windowsHide: true }).trim();
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const pou = path.join(path.dirname(solution), "MainPLC/03_POUs/02_Components/Heaters/02_FB/FB_Heater.TcPOU");
const project = path.join(path.dirname(solution), "MainPLC/MainPLC.plcproj");
const ids = () => [...fs.readFileSync(pou, "utf8").matchAll(/\bId="([^"]+)"/g)].map(m => m[1]);
function raw(pipe, action, payload = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect("\\\\.\\pipe\\" + pipe); socket.setEncoding("utf8");
    let text = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Unknown pipe outcome; preserve state, no replay")); }, 25000);
    socket.once("error", error => { clearTimeout(timer); reject(error); });
    socket.once("connect", () => socket.write(JSON.stringify({ id: stage, action, payload }) + "\n"));
    socket.on("data", chunk => {
      text += chunk; if (!text.includes("\n")) return;
      clearTimeout(timer); socket.end(); resolve(JSON.parse(text.split("\n")[0]));
    });
  });
}
async function temporaryRole(roleEnv) {
  const child = spawn(roleEnv.TE1000_DAEMON_EXE, ["--pipe", roleEnv.TE1000_DAEMON_PIPE, "--no-autodismiss"], {
    env: { ...process.env, ...roleEnv }, windowsHide: true, stdio: "ignore",
  });
  let exit = false; const exited = new Promise(resolve => child.once("exit", () => { exit = true; resolve(); }));
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { ready = (await raw(roleEnv.TE1000_DAEMON_PIPE, "daemon_identity")).ok; if (ready) break; }
      catch { if (exit) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, "Temporary role must become available without initializing COM");
    const client = new McpClient(roleEnv);
    try {
      await client.initialize();
      if (stage === "read-only") {
        const status = await client.call("xae", { action: "status" });
        assert.equal(status.solution.fullName, solution); assert.equal(status.session.owned, true);
        await client.call("plc_pou", { action: "get_impl", path: target });
        const denied = await raw(roleEnv.TE1000_DAEMON_PIPE, "plc_pou_set_impl", { path: target, implText: "", expectedHash: "0".repeat(64) });
        assert.equal(denied.ok, false); assert.match(denied.error, /Read-only solution/);
      } else {
        await assert.rejects(client.call("plc_pou", { action: "set_impl", path: target, implText: "", expectedHash: "0".repeat(64) }),
          stage === "deny-main" ? /non-main branch/ : /branch, commit or solution changed/);
      }
    } finally { client.close(); }
    const closed = await raw(roleEnv.TE1000_DAEMON_PIPE, "daemon_shutdown", { expectedSolutionPath: solution });
    assert.equal(closed.ok, true); assert.equal(closed.result.closedOwnedXae, stage === "read-only");
    let exitTimer;
    try {
      await Promise.race([exited, new Promise((_, reject) => { exitTimer = setTimeout(() => reject(new Error("Daemon exit not confirmed; no force kill")), 15000); })]);
    } finally { clearTimeout(exitTimer); }
  } catch (error) {
    console.error("Preserve temporary daemon if still alive:", child.pid); throw error;
  }
}
(async () => {
  if (["deny-main", "deny-branch", "read-only"].includes(stage)) {
    assert.equal(git("status", "--porcelain=v1", "--untracked-files=all"), "", "Run temporary-role checks only after audited metadata is committed with XAE closed");
    const roleEnv = { ...env, TE1000_DAEMON_PIPE: "nexplc-p4-dev-" + stage + "-" + process.pid,
      TE1000_DAEMON_LOG: path.join(os.tmpdir(), "nexplc-" + stage + "-" + process.pid + ".log") };
    if (stage === "read-only") {
      roleEnv.TE1000_WRITE_SOLUTION_PATH = "";
      for (const key of ["TE1000_GIT_WORKFLOW", "TE1000_GIT_CHECKOUT", "TE1000_GIT_BRANCH", "TE1000_GIT_HEAD"]) roleEnv[key] = "";
    } else {
      roleEnv.TE1000_GIT_BRANCH = stage === "deny-main" ? "main" : "fix/not-authorized";
      roleEnv.TE1000_GIT_HEAD = git("rev-parse", "HEAD");
      assert.equal(git("branch", "--show-current") === "main", stage === "deny-main");
    }
    const before = git("status", "--porcelain=v1", "--untracked-files=all");
    await temporaryRole(roleEnv);
    assert.equal(git("status", "--porcelain=v1", "--untracked-files=all"), before);
    if (fs.existsSync(roleEnv.TE1000_DAEMON_LOG)) fs.unlinkSync(roleEnv.TE1000_DAEMON_LOG);
    console.log(JSON.stringify({ stage, result: "PASS", noEngineeringMutation: true })); return;
  }
  assert.equal(git("branch", "--show-current"), env.TE1000_GIT_BRANCH);
  const client = new McpClient(env);
  try {
    await client.initialize();
    const status = await client.call("xae", { action: "status" });
    assert.equal(status.solution.fullName, solution); assert.equal(status.session.owned, true);
    const beforeIds = ids(), beforeRefs = hash(fs.readFileSync(project));
    if (stage === "flow") {
      assert.equal(git("status", "--porcelain=v1", "--untracked-files=all"), "");
      assert.throws(() => execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.resolve(__dirname, "../daemon/switch-branch.ps1"), "-Checkout", checkout, "-Branch", "main"], { windowsHide: true, stdio: "pipe" }), /Close XAE sessions normally/);
      assert.equal(git("branch", "--show-current"), env.TE1000_GIT_BRANCH);
      const original = await client.call("plc_pou", { action: "get_impl", path: target });
      const fileHash = hash(fs.readFileSync(pou));
      await assert.rejects(client.call("plc_pou", { action: "set_impl", path: target + "Other", expectedHash: original.contentHash, implText: original.text }), /outside TE1000_WRITE_ROOTS/);
      await assert.rejects(client.call("plc_pou", { action: "set_impl", path: target, expectedHash: "0".repeat(64), implText: original.text }), /Content hash mismatch/);
      assert.equal(hash(fs.readFileSync(pou)), fileHash);
      const text = original.text + "\n// Single-checkout live acceptance\n";
      await client.call("plc_pou", { action: "set_impl", path: target, expectedHash: original.contentHash, implText: text });
      const save = await client.call("project_save", {}); assert.equal(save.safe, true); assert.equal(save.saved, true);
      await client.call("xae", { action: "open_solution", solutionPath: solution, closeExisting: true });
      const readback = await client.call("plc_pou", { action: "get_impl", path: target }); assert.equal(readback.text, text);
      // Restore the probe through XAE itself, never by editing PLC XML.
      await client.call("plc_pou", { action: "set_impl", path: target, expectedHash: readback.contentHash, implText: original.text });
      const restored = await client.call("project_save", {}); assert.equal(restored.safe, true); assert.equal(restored.saved, true);
      const build = await client.call("xae_build", { action: "build", waitForFinish: true, timeoutMs: 180000 }); assert.equal(build.lastBuildInfo, 0);
      const diagnostics = await client.call("xae", { action: "error_list", limit: 5000 });
      const errors = String(diagnostics).split("\n").filter(x => x.includes("vsBuildErrorLevelHigh"));
      const warnings = String(diagnostics).split("\n").filter(x => x.includes("vsBuildErrorLevelMedium"));
      assert.equal(errors.length, 0); assert.ok(warnings.every(x => x.includes("C0196"))); assert.ok(warnings.length <= 1);
      const final = await client.call("project_save", {}); assert.equal(final.safe, true); assert.equal(final.saved, true);
      const audit = await client.call("project_save_audit", {}); assert.equal(audit.safe, true);
      assert.equal((await client.call("plc_pou", { action: "get_impl", path: target })).text, original.text);
      console.log(JSON.stringify({ stage, result: "PASS", errors: errors.length, warnings, build: build.lastBuildInfo, xaePid: status.session.xaePid,
        diff: git("diff", "--stat"), saved: audit.saved }));
    } else if (stage === "drift") {
      const headFile = path.join(checkout, ".git/HEAD"), before = fs.readFileSync(headFile);
      // Rewrite detection without switching branches beneath an open XAE.
      const stat = fs.statSync(headFile); fs.utimesSync(headFile, stat.atime, new Date(stat.mtimeMs + 2000));
      await assert.rejects(client.call("plc_pou", { action: "get_impl", path: target }), /Git HEAD was rewritten/);
      await assert.rejects(client.call("plc_pou", { action: "set_impl", path: target, expectedHash: "0".repeat(64), implText: "" }), /Git session identity locked/);
      assert.deepEqual(fs.readFileSync(headFile), before);
      console.log(JSON.stringify({ stage, result: "PASS", oldXaeObjectsBlocked: true, branchNotSwitched: true, xaePid: status.session.xaePid }));
    } else {
      const current = await client.call("plc_pou", { action: "get_impl", path: target }); assert.ok(!current.text.includes("Single-checkout live acceptance"));
      console.log(JSON.stringify({ stage, result: "PASS", xaePid: status.session.xaePid, owned: status.session.owned }));
    }
    assert.deepEqual(ids(), beforeIds); assert.equal(hash(fs.readFileSync(project)), beforeRefs);
  } finally { client.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
