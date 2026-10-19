"use strict";
const assert = require("node:assert/strict");
const { McpClient } = require("./mcp-client");

(async () => {
  const client = new McpClient({ TE1000_WRITE_SOLUTION_PATH: "surface-only-fixture" });
  const readonly = new McpClient({ TE1000_WRITE_SOLUTION_PATH: "" });
  try {
    await client.initialize();
    await readonly.initialize();
    const readonlyTools = await readonly.request("tools/list");
    assert.deepEqual(readonlyTools.result.tools.map(t => t.name).sort(), ["plc_pou", "tc_tree", "xae", "xae_build"]);
    const listed = await client.request("tools/list");
    assert.deepEqual(listed.result.tools.map(t => t.name).sort(), ["plc_pou", "project_changes", "project_save", "project_save_audit", "project_save_preview", "tc_tree", "xae", "xae_build"]);
    for (const [name, args] of [
      ["xae_command", { confirm: "ALLOW_XAE_COMMAND_EXEC", commandName: "TwinCAT.ActivateConfiguration" }],
      ["plc_download", { confirm: "ALLOW_PLC_DOWNLOAD" }],
      ["plc_pou", { action: "delete", path: "TIPC^MainPLC", confirm: "ALLOW_TWINCAT_DELETE" }],
      ["tc_tree", { action: "set_xml", path: "TIPC", xml: "<x/>" }],
      ["xae", { action: "dialog_resolve", button: "OK" }],
      ["xae_build", { action: "rebuild" }],
    ]) {
      const response = await client.request("tools/call", { name, arguments: args }, 10000);
      assert.ok(response.error || response.result?.isError, `${name} ${args.action || ""} must be rejected before COM`);
    }
    console.log("offline MCP surface checks passed (4 production / 8 development tools; 6 forbidden calls rejected)");
  } finally { client.close(); readonly.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
