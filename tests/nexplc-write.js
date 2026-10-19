"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { McpClient } = require("./mcp-client");
const parent = "TIPC^MainPLC^MainPLC项目^03_POUs";
const probe = parent + "^FB_MCP_Test";
const declaration = "FUNCTION_BLOCK FB_MCP_Test\nVAR_INPUT\n    bEnable : BOOL;\n    nValue : DINT;\nEND_VAR\nVAR_OUTPUT\n    bActive : BOOL;\n    nResult : DINT;\nEND_VAR\n";
const implementation = "bActive := bEnable;\nIF bEnable THEN\n    nResult := nValue + 42;\nELSE\n    nResult := 0;\nEND_IF\n";

(async () => {
  assert.ok(process.env.TE1000_WRITE_SOLUTION_PATH, "an isolated writable solution is required");
  assert.equal(process.env.TE1000_WRITE_ROOTS, probe, "validation may write only the probe");
  const client = new McpClient();
  const resume = process.argv.includes("--resume");
  const records = resume ? JSON.parse(fs.readFileSync("artifacts/validation/write-mcp-calls.json", "utf8")) : [];
  const call = async (name, args, expectFailure = false) => {
    const start = performance.now();
    try {
      const result = await client.call(name, args);
      records.push({ name, args, latencyMs: performance.now() - start, result });
      if (expectFailure) throw new Error("Expected rejection did not occur");
      return result;
    } catch (error) {
      records.push({ name, args, latencyMs: performance.now() - start, error: error.message, expected: expectFailure });
      if (!expectFailure || error.message === "Expected rejection did not occur") throw error;
    } finally { fs.writeFileSync("artifacts/validation/write-mcp-calls.json", JSON.stringify(records, null, 2)); }
  };
  const projectDir = path.join(path.dirname(process.env.TE1000_WRITE_SOLUTION_PATH), "MainPLC");
  const probeFile = path.join(projectDir, "03_POUs/FB_MCP_Test.TcPOU");
  const identity = () => {
    const xml = fs.readFileSync(probeFile, "utf8");
    const id = xml.match(/<POU\s+Name="FB_MCP_Test"\s+Id="([^"]+)"/);
    assert.ok(id, "XAE must save the requested POU with a GUID");
    assert.match(id[1], /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i);
    const project = fs.readFileSync(path.join(projectDir, "MainPLC.plcproj"), "utf8");
    assert.equal((project.match(/Compile Include="03_POUs\\FB_MCP_Test.TcPOU"/g) || []).length, 1);
    return { guid: id[1], file: probeFile, sha256: require("node:crypto").createHash("sha256").update(xml).digest("hex") };
  };
  try {
    await client.initialize();
    const status = await call("xae", { action: "status" });
    assert.equal(status.sysManagerAvailable, true);
    if (resume) {
      assert.ok(records.some(r => r.name === "plc_pou" && r.args.action === "create" && r.result?.child?.pathName === probe), "resume requires a recorded XAE creation of this probe");
    } else {
      assert.equal(fs.existsSync(probeFile), false, "use a fresh isolated copy; never overwrite a previous probe");
      await call("plc_pou", { action: "create", parent, name: "FB_MCP_Test", subType: 604, language: 1 });
      await call("xae", { action: "save_all" });
    }
    const created = identity();
    fs.writeFileSync("artifacts/validation/probe-created.json", JSON.stringify(created, null, 2));
    await call("plc_pou", { action: "get_decl", path: probe });
    const originalImpl = await call("plc_pou", { action: "get_impl", path: probe });
    assert.equal(originalImpl.language, 1);
    await call("plc_pou", { action: "create", parent, name: "FB_MCP_Test", subType: 604 }, true);
    await call("plc_pou", { action: "set_decl", path: probe, declText: declaration.replace("FB_MCP_Test", "FB_Renamed") }, true);
    await call("plc_pou", { action: "set_impl", path: parent + "^MAIN", implText: "" }, true);
    await call("plc_pou", { action: "set_decl", path: probe, declText: declaration });
    await call("plc_pou", { action: "set_impl", path: probe, implText: implementation });
    await call("xae", { action: "save_all" });
    const saved = identity();
    assert.equal(saved.guid, created.guid);
    await call("xae", { action: "open_solution", solutionPath: process.env.TE1000_MCP_SOLUTION_PATH, closeExisting: true });
    const reloadedDecl = await call("plc_pou", { action: "get_decl", path: probe });
    const reloadedImpl = await call("plc_pou", { action: "get_impl", path: probe });
    assert.equal(reloadedImpl.session.xaePid, status.session.xaePid, "explicit solution reload must retain the owned XAE process");
    assert.equal(reloadedImpl.session.solutionOpenCount, status.session.solutionOpenCount + 1, "only the explicit reload may reopen the solution");
    const readText = result => result.text.replace(/\r\n/g, "\n").trimEnd();
    assert.equal(readText(reloadedDecl), declaration.trimEnd());
    assert.equal(readText(reloadedImpl), implementation.trimEnd());
    const reopened = identity();
    assert.equal(reopened.guid, created.guid);
    fs.writeFileSync("artifacts/validation/probe-roundtrip.json", JSON.stringify({ created, saved, reopened }, null, 2));
    await call("xae_build", { action: "build", timeoutMs: 180000, waitForFinish: true });
    await call("xae", { action: "error_list", limit: 5000 });
    console.log(JSON.stringify({ result: "PASS", calls: records.length, created, reopened }));
  } finally { client.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
