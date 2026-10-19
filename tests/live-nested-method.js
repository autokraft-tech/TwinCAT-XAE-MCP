"use strict";
// Opt-in, exact existing Method only. Never retries a failed/unknown write.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { McpClient } = require("./mcp-client");
const [mode, profileFile, output] = process.argv.slice(2);
assert.ok(["acceptance", "r23"].includes(mode));
assert.ok(output && !fs.existsSync(output), "Use a fresh evidence file; never replay a run");
const env = JSON.parse(fs.readFileSync(profileFile, "utf8").replace(/^\uFEFF/, "")).env;
const target = env.TE1000_PLC_ROOT + "^03_POUs^02_Components^Heaters^02_FB^FB_Heater^I_Heater^SetManualMode";
assert.equal(env.TE1000_WRITE_ROOTS, target);
assert.equal(env.TE1000_PLC_WRITE_TYPES, "609");
assert.equal(env.TE1000_DAEMON_AUTOSTART, "0");
assert.equal(env.TE1000_MCP_SOLUTION_PATH, env.TE1000_WRITE_SOLUTION_PATH);
const solution = env.TE1000_MCP_SOLUTION_PATH;
assert.ok(solution.includes(mode === "r23" ? "NexPlc-r23-nested-method" : "NexPlc-nested-method-acceptance"));
const solutionDir = path.dirname(solution);
const file = path.join(solutionDir, "MainPLC/03_POUs/02_Components/Heaters/02_FB/FB_Heater.TcPOU");
const project = path.join(solutionDir, "MainPLC/MainPLC.plcproj");
const identities = () => [...fs.readFileSync(file, "utf8").matchAll(/\bId="([^"]+)"/g)].map(m => m[1]);
const refs = () => fs.readFileSync(project, "utf8");
const beforeIds = identities(), beforeRefs = refs();
const records = [], client = new McpClient(env);
async function call(name, args) {
  try { const result = await client.call(name, args); records.push({ name, args, result }); return result; }
  catch (error) { records.push({ name, args, error: error.message }); throw error; }
  finally { fs.writeFileSync(output, JSON.stringify(records, null, 2)); }
}
(async () => {
  try {
    await client.initialize();
    const surface = await client.request("tools/list");
    records.push({ tools: surface.result.tools.map(t => t.name) });
    const status = await call("xae", { action: "status" });
    assert.equal(status.solution.fullName, solution);
    assert.equal(status.sysManagerAvailable, true);
    assert.equal(status.session.owned, true);
    const identity = await call("tc_tree", { action: "get", path: target });
    assert.equal(identity.itemType, 609);
    const old = await call("plc_pou", { action: "get_impl", path: target });
    assert.equal(old.language, 1);
    const eol = old.text.includes("\r\n") ? "\r\n" : "\n";
    const added = mode === "r23" ? "SetManualMode := TRUE;" : "// Nested Method isolated XAE acceptance";
    assert.ok(!old.text.includes(added), "Already applied; do not replay");
    const text = old.text + (old.text.endsWith("\n") ? "" : eol) + added + eol;
    await call("plc_pou", { action: "set_impl", path: target, expectedHash: old.contentHash, implText: text });
    await call("project_save_preview", {});
    const saved = await call("project_save", {});
    assert.equal(saved.safe, true); assert.equal(saved.saved, true);
    const audit = await call("project_save_audit", {}); assert.equal(audit.safe, true);
    await call("xae", { action: "open_solution", solutionPath: solution, closeExisting: true });
    const readback = await call("plc_pou", { action: "get_impl", path: target });
    assert.equal(readback.text, text);
    assert.deepEqual(identities(), beforeIds);
    assert.equal(refs(), beforeRefs);
    const build = await call("xae_build", { action: "build", waitForFinish: true, timeoutMs: 180000 });
    assert.equal(build.lastBuildInfo, 0);
    const diagnostics = await call("xae", { action: "error_list", limit: 5000 });
    const finalSave = await call("project_save", {}); assert.equal(finalSave.safe, true); assert.equal(finalSave.saved, true);
    await call("project_save_audit", {});
    await call("project_changes", {});
    assert.deepEqual(identities(), beforeIds);
    assert.equal(refs(), beforeRefs);
    const diff = execFileSync("git", ["diff", "--binary"], { cwd: solutionDir, encoding: "utf8", windowsHide: true });
    records.push({ beforeIds, afterIds: identities(), projectReferencesUnchanged: true, fullGitDiff: diff });
    fs.writeFileSync(output, JSON.stringify(records, null, 2));
    console.log(JSON.stringify({ result: "PASS", mode, build, diagnostics, evidence: output }));
  } finally { client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
