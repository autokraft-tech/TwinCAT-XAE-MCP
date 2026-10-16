"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { performance } = require("node:perf_hooks");
const { McpClient } = require("./mcp-client");

const base = "TIPC^MainPLC^MainPLC项目";
const fb = base + "^03_POUs^01_Bases^Interlock^FB_Interlock_PAx";
const output = "artifacts/validation/readonly-mcp-calls.json";

(async () => {
  let client = new McpClient();
  const records = [];
  const call = async (name, args) => {
    const start = performance.now();
    try {
      const result = await client.call(name, args);
      records.push({ name, args, latencyMs: +(performance.now() - start).toFixed(3), result });
      fs.writeFileSync(output, JSON.stringify(records, null, 2));
      return result;
    } catch (error) {
      records.push({ name, args, latencyMs: performance.now() - start, error: error.message });
      fs.writeFileSync(output, JSON.stringify(records, null, 2));
      throw error;
    }
  };
  try {
    await client.initialize();
    const status = await call("xae", { action: "status" });
    assert.equal(status.sysManagerAvailable, true);
    assert.equal(status.solution.fullName.toLowerCase(), process.env.TE1000_MCP_SOLUTION_PATH.toLowerCase());
    const session = status.session;
    const sourceFile = require("node:path").join(require("node:path").dirname(process.env.TE1000_MCP_SOLUTION_PATH), "MainPLC/03_POUs/01_Bases/Interlock/FB_Interlock_PAx.TcPOU");
    const sourceXml = fs.readFileSync(sourceFile, "utf8");
    const normalize = text => text.replace(/\r\n/g, "\n");
    const expectedDecl = sourceXml.match(/<Declaration><!\[CDATA\[([\s\S]*?)\]\]><\/Declaration>/)[1];
    const expectedImpl = sourceXml.match(/<Implementation>\s*<ST><!\[CDATA\[([\s\S]*?)\]\]><\/ST>/)[1];
    assert.ok(expectedImpl.trim().length > 0, "exercise an FB with a nonempty ST implementation");
    for (let i = 0; i < 20; i++) {
      const result = i % 2 === 0
        ? await call("tc_tree", { action: "children", path: base })
        : await call("plc_pou", { action: i % 4 === 1 ? "get_decl" : "get_impl", path: fb });
      assert.deepEqual(result.session, session, "20 calls must share PID, owner and solution-open count");
      if (i % 2 === 1) assert.equal(normalize(result.text), normalize(i % 4 === 1 ? expectedDecl : expectedImpl), "COM text must match the saved source");
    }
    for (const root of ["03_POUs", "01_DUTs", "04_GVLs"]) {
      const result = await call("plc_pou", { action: "tree", plcPath: "TIPC^MainPLC", path: base + "^" + root, depth: 8 });
      assert.ok(result.count > 0);
    }
    await call("plc_pou", { action: "get_decl", path: base + "^01_DUTs^Common^Interlock^ST_Interlock" });
    await call("plc_pou", { action: "get_decl", path: base + "^04_GVLs^GVL" });
    client.close();
    client = new McpClient();
    await client.initialize();
    const reconnected = await call("xae", { action: "status" });
    assert.deepEqual(reconnected.session, session, "a new MCP front must reuse the detached daemon and XAE");
    console.log(JSON.stringify({ calls: records.length, errors: 0, session, frontRestart: "PASS", latenciesMs: records.slice(1, 21).map(r => r.latencyMs) }));
  } finally { client.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
