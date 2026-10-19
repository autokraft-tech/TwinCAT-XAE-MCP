"use strict";
// Opt-in Method validation through Node MCP -> daemon -> official XAE interfaces.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { McpClient } = require("./mcp-client");
const root = "TIPC^MainPLC^MainPLC项目^03_POUs";
const fb = root + "^FB_MCP_MethodProbe";
const method = fb + "^M_Test";
const solution = process.env.TE1000_MCP_SOLUTION_PATH;
assert.ok(solution && solution === process.env.TE1000_WRITE_SOLUTION_PATH && !solution.toLowerCase().includes("\\nexplc\\"));
assert.equal(process.env.TE1000_WRITE_ROOTS, fb);
assert.equal(process.env.TE1000_PLC_WRITE_TYPES, "604;609");
const file = path.join(path.dirname(solution), "MainPLC/03_POUs/FB_MCP_MethodProbe.TcPOU");
const records = [];
const output = path.resolve(__dirname, "../artifacts/phase2/method-live.json");
const client = new McpClient();
async function call(name, args) {
  try { const result = await client.call(name, args); records.push({ name, args, result }); return result; }
  catch (error) { records.push({ name, args, error: error.message }); throw error; }
  finally { fs.writeFileSync(output, JSON.stringify(records, null, 2)); }
}
const declaration = "METHOD PUBLIC M_Test : DINT\nVAR_INPUT\n    nValue : DINT;\nEND_VAR\nVAR_OUTPUT\n    bPositive : BOOL;\nEND_VAR\nVAR_IN_OUT\n    nAccumulator : DINT;\nEND_VAR\n";
const implementation = "bPositive := nValue > 0;\nnAccumulator := nAccumulator + nValue;\nM_Test := nValue + 1;\n";
(async () => {
  try {
    await client.initialize();
    const status = await call("xae", { action: "status" });
    assert.equal(status.solution.fullName.toLowerCase(), solution.toLowerCase());
    assert.equal(status.sysManagerAvailable, true);
    assert.equal(fs.existsSync(file), false, "never replay creation on an existing probe");
    await call("plc_pou", { action: "create", parent: root, name: "FB_MCP_MethodProbe", subType: 604, language: 1 });
    await call("project_save", {});
    await assert.rejects(call("plc_pou", { action: "create", parent: root, name: "FB_MCP_MethodProbe", subType: 609, language: 1, returnType: "DINT", expectedHash: "absent" }), /must belong directly/);
    await call("plc_pou", { action: "create", parent: fb, name: "M_Test", subType: 609, language: 1, returnType: "DINT", expectedHash: "absent" });
    const decl = await call("plc_pou", { action: "get_decl", path: method });
    const impl = await call("plc_pou", { action: "get_impl", path: method });
    assert.match(decl.text, /METHOD\s+PUBLIC\s+M_Test\s*:\s*DINT/i);
    assert.equal(impl.language, 1);
    await call("plc_pou", { action: "set_decl", path: method, declText: declaration, expectedHash: decl.contentHash });
    await assert.rejects(call("plc_pou", { action: "set_decl", path: method, declText: declaration, expectedHash: decl.contentHash }), /hash mismatch/);
    await call("plc_pou", { action: "set_impl", path: method, implText: implementation, expectedHash: impl.contentHash });
    await call("project_save", {});
    const identity = () => {
      const xml = fs.readFileSync(file, "utf8");
      return { fb: xml.match(/<POU\s+Name="FB_MCP_MethodProbe"\s+Id="([^"]+)"/)?.[1], method: xml.match(/<Method\s+Name="M_Test"\s+Id="([^"]+)"/)?.[1] };
    };
    const ids = identity(); assert.ok(ids.fb && ids.method);
    await assert.rejects(call("plc_pou", { action: "create", parent: fb, name: "M_Test", subType: 609, language: 1, returnType: "DINT", expectedHash: "absent" }), /already exists/);
    const children = await call("tc_tree", { action: "children", path: fb });
    assert.ok(children.children.some(c => c.name === "M_Test" && c.itemType === 609));
    await call("xae", { action: "open_solution", solutionPath: solution, closeExisting: true });
    const savedDecl = await call("plc_pou", { action: "get_decl", path: method });
    const savedImpl = await call("plc_pou", { action: "get_impl", path: method });
    assert.equal(savedDecl.text.replace(/\r\n/g, "\n").trimEnd(), declaration.trimEnd());
    assert.equal(savedImpl.text.replace(/\r\n/g, "\n").trimEnd(), implementation.trimEnd());
    assert.deepEqual(identity(), ids);
    await call("plc_pou", { action: "set_impl", path: method, implText: implementation.replace("nValue + 1", "nValue + 2"), expectedHash: savedImpl.contentHash });
    await call("project_save", {});
    await call("xae", { action: "open_solution", solutionPath: solution, closeExisting: true });
    const reloaded = await call("plc_pou", { action: "get_impl", path: method });
    assert.ok(reloaded.text.includes("nValue + 2"));
    assert.deepEqual(identity(), ids);
    assert.equal(reloaded.session.xaePid, status.session.xaePid);
    const project = fs.readFileSync(path.join(path.dirname(solution), "MainPLC/MainPLC.plcproj"), "utf8");
    assert.equal((project.match(/Compile Include="03_POUs\\FB_MCP_MethodProbe.TcPOU"/g) || []).length, 1);
    assert.ok(!project.includes("M_Test.TcPOU"), "Methods must remain nested in their FB");
    const build = await call("xae_build", { action: "build", waitForFinish: true, timeoutMs: 180000 });
    assert.equal(build.lastBuildInfo, 0);
    await call("xae", { action: "error_list", limit: 5000 });
    await call("project_save", {});
    console.log(JSON.stringify({ result: "PASS", ids, session: reloaded.session, build, evidence: output }));
  } finally { client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
