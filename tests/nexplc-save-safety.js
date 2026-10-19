"use strict";
// Opt-in real XAE test. Deliberately stops at any unexpected save effect.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { McpClient } = require("./mcp-client");
const root = "TIPC^MainPLC^MainPLC项目^03_POUs";
const probe = root + "^FB_MCP_Phase2_Save";
const solution = process.env.TE1000_MCP_SOLUTION_PATH;
assert.ok(solution && solution === process.env.TE1000_WRITE_SOLUTION_PATH, "isolated writable solution required");
assert.equal(process.env.TE1000_WRITE_ROOTS, probe, "only the new phase-2 probe is permitted");
assert.ok(!solution.toLowerCase().includes("\\nexplc\\"), "production solution is forbidden");
const output = path.resolve(__dirname, "../artifacts/phase2/save-safety-live.json");
const records = [];
const client = new McpClient();
async function call(name, args) {
  try { const result = await client.call(name, args); records.push({ name, args, result }); return result; }
  catch (error) { records.push({ name, args, error: error.message }); throw error; }
  finally { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(records, null, 2)); }
}
(async () => {
  try {
    await client.initialize();
    const status = await call("xae", { action: "status" });
    assert.equal(status.solution.fullName.toLowerCase(), solution.toLowerCase());
    assert.equal(status.sysManagerAvailable, true);
    const existing = await call("tc_tree", { action: "children", path: root });
    const file = path.join(path.dirname(solution), "MainPLC/03_POUs/FB_MCP_Phase2_Save.TcPOU");
    assert.equal(fs.existsSync(file), false, "never overwrite an existing probe");
    assert.ok(existing);
    await call("project_save_preview", {});
    await call("plc_pou", { action: "create", parent: root, name: "FB_MCP_Phase2_Save", subType: 604, language: 1 });
    await call("plc_pou", { action: "set_decl", path: probe, declText: "FUNCTION_BLOCK FB_MCP_Phase2_Save\nVAR_INPUT\n    nValue : DINT;\nEND_VAR\nVAR_OUTPUT\n    nResult : DINT;\nEND_VAR\n" });
    await call("plc_pou", { action: "set_impl", path: probe, implText: "nResult := nValue + 42;\n" });
    await call("project_save_preview", {});
    let failed = false;
    try { await call("project_save", {}); } catch { failed = true; }
    const report = await call("project_save_audit", {});
    if (failed) {
      assert.equal(report.saved, true, "indeterminate COM outcome: stop without further writes");
      assert.equal(report.safe, false);
      const code = await call("plc_pou", { action: "get_impl", path: probe });
      assert.ok(code.text.includes("nValue + 42"));
      assert.equal(code.session.xaePid, status.session.xaePid);
      assert.equal(code.session.solutionOpenCount, status.session.solutionOpenCount);
      await assert.rejects(call("plc_pou", { action: "set_impl", path: probe, implText: "nResult := 0;\n" }), /Save safety lock/);
      await assert.rejects(call("xae_build", { action: "build", waitForFinish: true }), /Save safety lock/);
      const xml = fs.readFileSync(file, "utf8");
      const guid = xml.match(/<POU\s+Name="FB_MCP_Phase2_Save"\s+Id="([^"]+)"/i)?.[1];
      assert.ok(guid, "XAE-created GUID must be persisted");
      const project = fs.readFileSync(path.join(path.dirname(solution), "MainPLC/MainPLC.plcproj"), "utf8");
      assert.equal((project.match(/Compile Include="03_POUs\\FB_MCP_Phase2_Save.TcPOU"/g) || []).length, 1);
      console.log(JSON.stringify({ outcome: "unsafe_save_detected_and_locked_STOP", session: code.session, guid, changes: report.changes.map(c => ({ file: c.file, category: c.category, metadataChanges: c.metadataChanges })), evidence: output }));
      process.exitCode = 2; // Deliberate stage gate: this is not a full P1 pass.
      return;
    }
    assert.equal(report.safe, true);
    const identity = () => {
      const xml = fs.readFileSync(file, "utf8");
      const guid = xml.match(/<POU\s+Name="FB_MCP_Phase2_Save"\s+Id="([^"]+)"/i)?.[1];
      assert.ok(guid);
      const project = fs.readFileSync(path.join(path.dirname(solution), "MainPLC/MainPLC.plcproj"), "utf8");
      assert.equal((project.match(/Compile Include="03_POUs\\FB_MCP_Phase2_Save.TcPOU"/g) || []).length, 1);
      return guid;
    };
    const guid = identity();
    await call("xae", { action: "open_solution", solutionPath: solution, closeExisting: true });
    const reloaded = await call("plc_pou", { action: "get_impl", path: probe });
    assert.ok(reloaded.text.includes("nValue + 42"));
    assert.equal(identity(), guid);
    await call("plc_pou", { action: "set_impl", path: probe, implText: "nResult := nValue + 43;\n" });
    await call("project_save", {});
    await call("xae", { action: "open_solution", solutionPath: solution, closeExisting: true });
    const modified = await call("plc_pou", { action: "get_impl", path: probe });
    assert.ok(modified.text.includes("nValue + 43"));
    assert.equal(modified.session.xaePid, status.session.xaePid);
    assert.equal(modified.session.solutionOpenCount, status.session.solutionOpenCount + 2);
    assert.equal(identity(), guid);
    const built = await call("xae_build", { action: "build", waitForFinish: true, timeoutMs: 180000 });
    assert.equal(built.lastBuildInfo, 0);
    await call("xae", { action: "error_list", limit: 5000 });
    let postBuildFailure = false;
    try { await call("project_save", {}); } catch { postBuildFailure = true; }
    const postBuildAudit = await call("project_save_audit", {});
    if (postBuildFailure) {
      assert.equal(postBuildAudit.saved, true);
      assert.equal(postBuildAudit.safe, false);
      await assert.rejects(call("plc_pou", { action: "set_impl", path: probe, implText: "nResult := 0;\n" }), /Save safety lock/);
      await assert.rejects(call("xae_build", { action: "build", waitForFinish: true }), /Save safety lock/);
      console.log(JSON.stringify({ outcome: "unsafe_post_build_save_detected_and_locked_STOP", session: modified.session, guid, build: built, changes: postBuildAudit.changes.map(c => ({ file: c.file, category: c.category, metadataChanges: c.metadataChanges })), evidence: output }));
      process.exitCode = 2;
      return;
    }
    assert.equal(postBuildAudit.safe, true);
    console.log(JSON.stringify({ outcome: "save_reload_modify_build_passed", session: modified.session, guid, build: built }));
  } finally { client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
