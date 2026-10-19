"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { McpClient } = require("./mcp-client");
const plc = "TIPC^MainPLC^MainPLC项目";
const solution = process.env.TE1000_MCP_SOLUTION_PATH;
assert.ok(solution && solution === process.env.TE1000_WRITE_SOLUTION_PATH && !solution.toLowerCase().includes("\\nexplc\\"));
const definitions = [
  { name: "ST_MCP_Probe", type: 606, text: "TYPE ST_MCP_Probe :\nSTRUCT\n    bEnable : BOOL;\n    nCount : DINT;\n    rValue : REAL;\n    aValues : ARRAY[0..2] OF REAL;\nEND_STRUCT\nEND_TYPE\n", from: "0..2", to: "0..3" },
  { name: "E_MCP_Probe", type: 605, text: "TYPE E_MCP_Probe :\n(\n    McpIdle := 0,\n    McpReady := 1\n);\nEND_TYPE\n", from: "McpReady := 1", to: "McpReady := 2" },
  { name: "T_MCP_Probe", type: 623, text: "TYPE T_MCP_Probe : DINT;\nEND_TYPE\n", from: "DINT", to: "UDINT" },
];
const fb = plc + "^03_POUs^FB_MCP_DUTProbe";
const roots = [fb, ...definitions.map(d => plc + "^01_DUTs^" + d.name)].join(";");
assert.equal(process.env.TE1000_WRITE_ROOTS, roots);
const records = [], ids = {};
const client = new McpClient();
const output = path.resolve(__dirname, "../artifacts/phase2/dut-live.json");
async function call(name, args) {
  try { const result = await client.call(name, args); records.push({ name, args, result }); return result; }
  catch (error) { records.push({ name, args, error: error.message }); throw error; }
  finally { fs.writeFileSync(output, JSON.stringify(records, null, 2)); }
}
const fileFor = d => path.join(path.dirname(solution), "MainPLC/01_DUTs", d.name + ".TcDUT");
const idFor = d => fs.readFileSync(fileFor(d), "utf8").match(/<DUT\s+Name="[^"]+"\s+Id="([^"]+)"/)?.[1];
(async () => {
  try {
    await client.initialize();
    const status = await call("xae", { action: "status" });
    assert.equal(status.solution.fullName.toLowerCase(), solution.toLowerCase());
    for (const d of definitions) {
      const objectPath = plc + "^01_DUTs^" + d.name;
      assert.equal(fs.existsSync(fileFor(d)), false, "DUT probe must not already exist");
      await call("plc_pou", { action: "create", parent: plc + "^01_DUTs", name: d.name, subType: d.type, expectedHash: "absent" });
      const initial = await call("plc_pou", { action: "get_decl", path: objectPath });
      await call("plc_pou", { action: "set_decl", path: objectPath, declText: d.text, expectedHash: initial.contentHash });
      await call("project_save", {});
      ids[d.name] = idFor(d); assert.ok(ids[d.name]);
      await assert.rejects(call("plc_pou", { action: "create", parent: plc + "^01_DUTs", name: d.name, subType: d.type, expectedHash: "absent" }), /already exists/);
      const current = await call("plc_pou", { action: "get_decl", path: objectPath });
      await assert.rejects(call("plc_pou", { action: "set_decl", path: objectPath, declText: d.text, expectedHash: "0".repeat(64) }), /hash mismatch/);
      await assert.rejects(call("plc_pou", { action: "set_impl", path: objectPath, implText: "", expectedHash: current.contentHash }), /declarations only/);
      const edited = d.text.replace(d.from, d.to);
      await call("plc_pou", { action: "set_decl", path: objectPath, declText: edited, expectedHash: current.contentHash });
      await call("project_save", {});
      assert.equal(idFor(d), ids[d.name]);
    }
    await call("plc_pou", { action: "create", parent: plc + "^03_POUs", name: "FB_MCP_DUTProbe", subType: 604, language: 1 });
    await call("plc_pou", { action: "set_decl", path: fb, declText: "FUNCTION_BLOCK FB_MCP_DUTProbe\nVAR_OUTPUT\n    stData : ST_MCP_Probe;\nEND_VAR\nVAR\n    eState : E_MCP_Probe;\n    nAlias : T_MCP_Probe;\nEND_VAR\n" });
    await call("plc_pou", { action: "set_impl", path: fb, implText: "stData.nCount := UDINT_TO_DINT(nAlias);\nstData.aValues[0] := DINT_TO_REAL(stData.nCount);\neState := E_MCP_Probe.McpReady;\n" });
    await call("project_save", {});
    await call("xae", { action: "open_solution", solutionPath: solution, closeExisting: true });
    for (const d of definitions) {
      const reloaded = await call("plc_pou", { action: "get_decl", path: plc + "^01_DUTs^" + d.name });
      assert.equal(reloaded.text.replace(/\r\n/g, "\n").trimEnd(), d.text.replace(d.from, d.to).trimEnd());
      assert.equal(idFor(d), ids[d.name]);
      assert.equal(reloaded.session.xaePid, status.session.xaePid);
      const project = fs.readFileSync(path.join(path.dirname(solution), "MainPLC/MainPLC.plcproj"), "utf8");
      assert.equal(project.split('Compile Include="01_DUTs\\' + d.name + '.TcDUT"').length - 1, 1);
    }
    const build = await call("xae_build", { action: "build", waitForFinish: true, timeoutMs: 180000 });
    assert.equal(build.lastBuildInfo, 0);
    await call("xae", { action: "error_list", limit: 5000 });
    await call("project_save", {});
    console.log(JSON.stringify({ result: "PASS", ids, build, evidence: output }));
  } finally { client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
