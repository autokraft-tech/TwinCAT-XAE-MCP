"use strict";
const { z } = require("zod");
const { toolSchemas } = require("./toolSchemas");

// The legacy implementation remains available for upstream comparison, but only
// this fixed offline surface is advertised or callable by an MCP client.
const actions = {
  xae: ["status", "open_solution", "save_all", "error_list", "dialog_probe"],
  xae_build: ["build"],
  tc_tree: ["get", "children"],
  plc_pou: ["tree", "get_decl", "get_impl", "create", "set_decl", "set_impl"],
};
const fields = {
  xae: ["solutionPath", "closeExisting", "limit", "severityFilter"],
  xae_build: ["timeoutMs"],
  tc_tree: ["path"],
  plc_pou: ["path", "parent", "name", "subType", "language", "declText", "implText", "depth", "plcPath", "range", "grep"],
};
const descriptions = {
  xae: "Pinned XAE session: status, open_solution (same solution only; closeExisting reloads owned writable session), save_all, error_list, dialog_probe (report only). Production session is read-only. No dialog clicks or arbitrary commands.",
  xae_build: "Offline PLC build only, in the explicitly configured writable solution. Returns build result; use xae.error_list for diagnostics. No activation or download.",
  tc_tree: "Read PLC project tree identity or children; paths use ^ separators. No tree mutations or XML writes.",
  plc_pou: "Read tree/declaration/ST implementation. Create ST FB via CreateChild(604, language 1); modify declarations or ST via official interfaces while preserving IDs. Writes require daemon-configured solution and object roots. Other creation types are not validated and are disabled.",
};
const offlineSchemas = {};
for (const [name, allowed] of Object.entries(actions)) {
  const inputSchema = { action: z.enum(allowed) };
  for (const field of fields[name]) inputSchema[field] = toolSchemas[name].inputSchema.shape[field];
  if (name === "xae_build") inputSchema.waitForFinish = z.literal(true).default(true);
  if (name === "plc_pou") {
    inputSchema.subType = z.literal(604).optional();
    inputSchema.language = z.literal(1).optional();
    inputSchema.depth = z.number().int().min(1).max(32).optional();
  }
  offlineSchemas[name] = { description: descriptions[name], inputSchema: z.object(inputSchema).strict(), annotations: { readOnlyHint: name === "tc_tree", destructiveHint: false, openWorldHint: false } };
}
module.exports = { offlineSchemas };
