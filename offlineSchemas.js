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
  plc_pou: "Read PLC tree/declarations/ST. Create ST FB (604), direct FB Method (609), ENUM (605), STRUCT (606) or GVL (615) through official XAE APIs. Existing ST Methods inside FB folders require exact startup authorization and verified folder/FB ancestry; nested creation is disabled. Method/DUT/GVL edits require expectedHash from a full-content read; declaration-only creation uses expectedHash=absent then set_decl. Writes require startup-pinned solution, exact object roots and TE1000_PLC_WRITE_TYPES. ALIAS (623) remains disabled.",
};
const offlineSchemas = {};
for (const [name, allowed] of Object.entries(actions)) {
  const inputSchema = { action: z.enum(allowed) };
  for (const field of fields[name]) inputSchema[field] = toolSchemas[name].inputSchema.shape[field];
  if (name === "xae_build") inputSchema.waitForFinish = z.literal(true).default(true);
  if (name === "plc_pou") {
    inputSchema.subType = z.union([z.literal(604), z.literal(609), z.literal(606), z.literal(605), z.literal(615)]).optional();
    inputSchema.returnType = z.string().optional();
    inputSchema.expectedHash = z.string().optional();
    inputSchema.language = z.literal(1).optional();
    inputSchema.depth = z.number().int().min(1).max(32).optional();
  }
  offlineSchemas[name] = { description: descriptions[name], inputSchema: z.object(inputSchema).strict(), annotations: { readOnlyHint: name === "tc_tree", destructiveHint: false, openWorldHint: false } };
}
for (const name of ["project_changes", "project_save_preview", "project_save", "project_save_audit"]) {
  offlineSchemas[name] = {
    description: name === "project_save" ? "Save the pinned writable project with a daemon-enforced engineering metadata audit. Unexpected changes return failure and lock subsequent writes." : "Inspect the pinned solution's Git changes, save preview or last save audit. No engineering file writes.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: name !== "project_save", destructiveHint: false, openWorldHint: false },
  };
}
module.exports = { offlineSchemas };
