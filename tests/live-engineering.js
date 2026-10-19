"use strict";
// Opt-in live acceptance. Profiles and evidence stay in ignored local artifacts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { performance } = require("node:perf_hooks");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { spawn } = require("node:child_process");
const { McpClient } = require("./mcp-client");
const [stage, profileFile, outputDir] = process.argv.slice(2);
assert.ok(["inspect", "create", "reconnect", "build", "denials", "stop-guard", "disconnect", "benchmark", "duplicate", "crash-daemon"].includes(stage));
const production = process.env.NEXPLC_PRODUCTION_SOLUTION;
if (stage === "denials") assert.ok(production && path.isAbsolute(production), "Set the exact NEXPLC_PRODUCTION_SOLUTION before dual-service acceptance");
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8").replace(/^\uFEFF/, ""));
const env = profile.env;
assert.equal(env.TE1000_DAEMON_AUTOSTART, "0");
assert.match(env.TE1000_DAEMON_PIPE, /^nexplc-p4-dev-/);
const solution = env.TE1000_MCP_SOLUTION_PATH;
assert.equal(solution, env.TE1000_WRITE_SOLUTION_PATH);
assert.ok(!solution.toLowerCase().includes("\\nexplc\\"));
const root = env.TE1000_PLC_ROOT + "^03_POUs";
const fb = root + "^FB_MCP_P4";
assert.ok(env.TE1000_WRITE_ROOTS.split(";").includes(fb));
fs.mkdirSync(outputDir, { recursive: true });
const records = [], client = new McpClient(env);
const evidence = path.join(outputDir, stage + "-" + Date.now() + ".json");
async function call(name, args) {
  const started = performance.now();
  try { const result = await client.call(name, args); records.push({ name, args, ms: performance.now() - started, result }); return result; }
  catch (error) { records.push({ name, args, ms: performance.now() - started, error: error.message }); throw error; }
  finally { fs.writeFileSync(evidence, JSON.stringify(records, null, 2)); }
}
async function raw(pipe, action, payload = {}) {
  return new Promise((resolve, reject) => {
    const s = net.connect("\\\\.\\pipe\\" + pipe);
    const timer = setTimeout(() => { s.destroy(); reject(new Error("Unknown result; no replay")); }, 20000);
    let text = ""; s.setEncoding("utf8");
    s.once("error", error => { clearTimeout(timer); reject(error); });
    s.once("connect", () => s.write(JSON.stringify({ id: "p4", action, payload }) + "\n"));
    s.on("data", chunk => { text += chunk; if (!text.includes("\n")) return; clearTimeout(timer); s.end(); resolve(JSON.parse(text.split("\n")[0])); });
  });
}
(async () => {
  try {
    await client.initialize();
    if (stage === "inspect") {
      const identity = await raw(env.TE1000_DAEMON_PIPE, "daemon_identity");
      const dialog = await raw(env.TE1000_DAEMON_PIPE, "dialog_probe");
      console.log(JSON.stringify({ identity, dialog }));
    }
    const status = await call("xae", { action: "status" });
    assert.equal(status.solution.fullName.toLowerCase(), solution.toLowerCase());
    assert.equal(status.sysManagerAvailable, true);
    const file = path.join(path.dirname(solution), "MainPLC/03_POUs/FB_MCP_P4.TcPOU");
    if (stage === "create") {
      assert.equal(fs.existsSync(file), false, "Never overwrite/replay an existing probe");
      await call("project_save_preview", {});
      await call("plc_pou", { action: "create", parent: root, name: "FB_MCP_P4", subType: 604, language: 1 });
      await call("plc_pou", { action: "set_decl", path: fb, declText: "FUNCTION_BLOCK FB_MCP_P4\nVAR_OUTPUT\n    nResult : DINT;\nEND_VAR\n" });
      await call("plc_pou", { action: "set_impl", path: fb, implText: "nResult := 4;\n" });
      const save = await call("project_save", {}); assert.equal(save.safe, true); assert.equal(save.saved, true);
    }
    if (stage === "reconnect") {
      const report = await call("project_save_audit", {}); assert.equal(report.safe, true);
      const current = await call("plc_pou", { action: "get_impl", path: fb });
      const value = Number(current.text.match(/nResult\s*:=\s*(\d+)/)[1]);
      await call("plc_pou", { action: "set_impl", path: fb, implText: "nResult := " + (value + 1) + ";\n", expectedHash: current.contentHash });
      const save = await call("project_save", {}); assert.equal(save.safe, true);
    }
    if (stage === "stop-guard") {
      const current = await call("plc_pou", { action: "get_impl", path: fb });
      await call("plc_pou", { action: "set_impl", path: fb, implText: current.text + "\n// P4 stop guard\n", expectedHash: current.contentHash });
      const refused = await raw(env.TE1000_DAEMON_PIPE, "daemon_shutdown", { expectedSolutionPath: solution });
      assert.equal(refused.ok, false); assert.match(refused.error, /Pending edit batch|unsaved/);
      records.push({ action: "daemon_shutdown", result: refused });
      const save = await call("project_save", {}); assert.equal(save.safe, true);
    }
    if (stage === "disconnect") {
      const before = await call("plc_pou", { action: "get_impl", path: fb });
      // Disconnect an actual MCP frontend during a read. Write-response loss is
      // covered separately by the deterministic managed-client transport fixture.
      const pending = client.call("xae", { action: "status" }).catch(error => error.message);
      client.child.kill(); await pending;
      const next = new McpClient(env);
      try {
        await next.initialize();
        const after = await next.call("xae", { action: "status" });
        const code = await next.call("plc_pou", { action: "get_impl", path: fb });
        assert.equal(after.session.daemonPid, status.session.daemonPid); assert.equal(after.session.xaePid, status.session.xaePid);
        assert.equal(after.session.solutionOpenCount, status.session.solutionOpenCount); assert.equal(code.contentHash, before.contentHash);
        records.push({ abnormalFrontendExit: true, after }); fs.writeFileSync(evidence, JSON.stringify(records, null, 2));
      } finally { next.close(); }
      console.log(JSON.stringify({ result: "PASS", stage, session: status.session, evidence })); return;
    }
    if (stage === "benchmark") {
      const timings = [];
      for (let i = 0; i < 20; i++) {
        const value = i % 2 ? await call("plc_pou", { action: "get_impl", path: fb }) : await call("xae", { action: "status" });
        assert.equal(value.session.daemonPid, status.session.daemonPid); assert.equal(value.session.xaePid, status.session.xaePid);
        assert.equal(value.session.solutionOpenCount, status.session.solutionOpenCount); timings.push(records.at(-1).ms);
      }
      timings.sort((a, b) => a - b);
      console.log(JSON.stringify({ sample: 20, minMs: timings[0], medianMs: (timings[9] + timings[10]) / 2, meanMs: timings.reduce((a, b) => a + b, 0) / 20, maxMs: timings[19] }));
    }
    if (stage === "duplicate") {
      const pipe = env.TE1000_DAEMON_PIPE + "-duplicate";
      const child = spawn(env.TE1000_DAEMON_EXE, ["--pipe", pipe, "--no-watch"], { stdio: "ignore", windowsHide: true,
        env: { ...process.env, ...env, TE1000_DAEMON_PIPE: pipe, TE1000_DAEMON_LOG: path.join(path.resolve(outputDir), "duplicate-daemon.log") } });
      let rejected = false;
      try {
        let ready = false;
        for (let i = 0; i < 30; i++) {
          try { ready = (await raw(pipe, "daemon_identity")).ok; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
        }
        assert.equal(ready, true);
        const result = await raw(pipe, "xae_status", { expectedSolutionPath: solution });
        assert.equal(result.ok, false); assert.match(result.error, /Another daemon owns/); rejected = true;
        records.push({ duplicateDaemon: child.pid, result }); fs.writeFileSync(evidence, JSON.stringify(records, null, 2));
        const stopped = await raw(pipe, "daemon_shutdown", { expectedSolutionPath: solution });
        assert.equal(stopped.ok, true); assert.equal(stopped.result.closedOwnedXae, false);
        await new Promise(resolve => child.once("exit", resolve));
      } finally { if (rejected && child.exitCode === null) child.kill(); }
      const after = await call("xae", { action: "status" });
      assert.equal(after.session.daemonPid, status.session.daemonPid); assert.equal(after.session.xaePid, status.session.xaePid);
    }
    if (stage === "crash-daemon") {
      const report = await call("project_save_audit", {});
      assert.equal(report.state, "completed_and_audited"); assert.equal(report.safe, true); assert.equal(report.saved, true); assert.equal(report.blocked, false);
      const preview = await call("project_save_preview", {}); assert.equal(preview.hasEditBatch, false);
      const auditDir = path.join(process.env.LOCALAPPDATA, "NexPlcXaeMcp/save-audits", crypto.createHash("sha256").update(path.dirname(solution).toUpperCase()).digest("hex"));
      assert.equal(fs.existsSync(path.join(auditDir, "pending.json")), false);
      const baseline = fs.readFileSync(path.join(auditDir, "baseline.json"));
      const checkAndTerminate = "$p4Daemon=Get-Process -Id $env:P4_DAEMON_PID; if ($p4Daemon.Path -ne $env:P4_EXE -or $p4Daemon.StartTime.ToUniversalTime().Ticks.ToString() -ne $env:P4_START -or $p4Daemon.SessionId.ToString() -ne $env:P4_SESSION) { throw 'Identity mismatch; no termination' }; Stop-Process -Id $p4Daemon.Id";
      execFileSync("powershell.exe", ["-NoProfile", "-Command", checkAndTerminate], { windowsHide: true, env: { ...process.env,
        P4_DAEMON_PID: String(status.session.daemonPid), P4_EXE: env.TE1000_DAEMON_EXE,
        P4_START: status.session.identity.daemonStartTicks, P4_SESSION: env.TE1000_OWNER_SESSION_ID } });
      await assert.rejects(client.call("xae", { action: "status" }), /Managed daemon unavailable|pipe closed/);
      assert.deepEqual(fs.readFileSync(path.join(auditDir, "baseline.json")), baseline);
      assert.equal(fs.existsSync(path.join(auditDir, "pending.json")), false);
      const checkXae = "$p4Xae=Get-Process -Id $env:P4_XAE_PID; if ($p4Xae.StartTime.ToUniversalTime().Ticks.ToString() -ne $env:P4_XAE_START -or $p4Xae.SessionId.ToString() -ne $env:P4_SESSION) { throw 'XAE identity changed' }; Write-Output 'Owned XAE preserved'";
      execFileSync("powershell.exe", ["-NoProfile", "-Command", checkXae], { windowsHide: true, env: { ...process.env,
        P4_XAE_PID: String(status.session.xaePid), P4_XAE_START: status.session.xaeStartTicks, P4_SESSION: env.TE1000_OWNER_SESSION_ID } });
      records.push({ terminatedOnlyAuditedDevDaemon: status.session.daemonPid, preservedXae: status.session.xaePid });
      fs.writeFileSync(evidence, JSON.stringify(records, null, 2));
      console.log(JSON.stringify({ result: "PASS", stage, previous: status.session, evidence })); return;
    }
    if (stage === "build") {
      await call("xae", { action: "open_solution", solutionPath: solution, closeExisting: true });
      const build = await call("xae_build", { action: "build", waitForFinish: true, timeoutMs: 180000 }); assert.equal(build.lastBuildInfo, 0);
      const errors = await call("xae", { action: "error_list", severityFilter: "errors", limit: 5000 });
      const warnings = await call("xae", { action: "error_list", severityFilter: "warnings", limit: 5000 });
      const saved = await call("project_save", {}); assert.equal(saved.safe, true);
      console.log(JSON.stringify({ build, errors, warnings }));
    }
    if (stage === "denials") {
      for (const [action, payload, pattern] of [
        ["plc_pou_create", { parent: root, name: "FB_MCP_Outside", subType: 604, writeRoots: root }, /WRITE_ROOTS/],
        ["plc_pou_create", { parent: env.TE1000_PLC_ROOT + "^01_DUTs", name: "ST_MCP_P4", subType: 623, expectedHash: "absent" }, /623/],
        ["xae_status", { expectedSolutionPath: "D:\\wrong.sln" }, /different solutions/],
      ]) {
        const result = await raw(env.TE1000_DAEMON_PIPE, action, payload); assert.equal(result.ok, false); assert.match(result.error, pattern);
        records.push({ action, payload, result });
      }
      const prod = await raw("nexplc-readonly-validation", "xae_status");
      assert.equal(prod.ok, true); assert.notEqual(prod.result.session.xaePid, status.session.xaePid);
      assert.equal(prod.result.solution.fullName.toLowerCase(), production.toLowerCase());
      const denied = await raw("nexplc-readonly-validation", "plc_pou_create", { parent: root, name: "FB_MCP_P4", subType: 604, writeSolutionPath: solution, writeRoots: root });
      assert.equal(denied.ok, false); assert.match(denied.error, /Read-only/);
      records.push({ production: prod, denied });
      fs.writeFileSync(evidence, JSON.stringify(records, null, 2));
    }
    let guid;
    if (fs.existsSync(file)) {
      const xml = fs.readFileSync(file, "utf8"); guid = xml.match(/<POU\s+Name="FB_MCP_P4"\s+Id="([^"]+)"/)[1];
      const project = fs.readFileSync(path.join(path.dirname(solution), "MainPLC/MainPLC.plcproj"), "utf8");
      assert.equal(project.split('Compile Include="03_POUs\\FB_MCP_P4.TcPOU"').length - 1, 1);
      const code = await call("plc_pou", { action: "get_impl", path: fb });
      assert.equal(code.session.xaePid, status.session.xaePid);
      fs.writeFileSync(path.join(outputDir, "complete-tracked.diff"), execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: path.dirname(solution) }));
      fs.writeFileSync(path.join(outputDir, "new-pou-local.txt"), xml);
    }
    console.log(JSON.stringify({ result: "PASS", stage, session: status.session, guid, evidence }));
  } finally { client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
