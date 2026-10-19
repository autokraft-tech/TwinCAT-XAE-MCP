"use strict";
// Runs an actual installed Codex executable. Does not modify user MCP settings.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const [cli, profileFile, outputDir, label] = process.argv.slice(2);
assert.ok(cli && profileFile && outputDir && /^[A-Za-z0-9_-]+$/.test(label));
const profile = JSON.parse(fs.readFileSync(profileFile, "utf8").replace(/^\uFEFF/, ""));
const env = profile.env;
const production = process.env.NEXPLC_PRODUCTION_SOLUTION;
assert.ok(production && path.isAbsolute(production), "Set the exact NEXPLC_PRODUCTION_SOLUTION before live acceptance");
assert.match(env.TE1000_DAEMON_PIPE, /^nexplc-p4-dev-/);
const prefix = path.resolve(outputDir, "codex-" + label);
const prompt = "P4 acceptance, read-only. Use ONLY nexplc_xae and nexplc_xae_dev MCP tools; no shell, writes, save, reload or build. " +
  "Call xae status on BOTH services. Production must be exact " + production + "; " +
  "Dev must be exact " + env.TE1000_MCP_SOLUTION_PATH + ". Then read Dev project_save_audit and require completed_and_audited, safe true. " +
  "Read Dev get_impl at " + env.TE1000_PLC_ROOT + "^03_POUs^FB_MCP_P4. Report the actual two daemon/XAE PID pairs, Dev openCount, and audit state. Stop on any mismatch; never replay or clear anything.";
const args = ["exec", "--ephemeral", "--skip-git-repo-check", "--json", "-C", path.resolve(__dirname, ".."), "-o", prefix + "-final.txt"];
for (const [key, value] of Object.entries(env)) args.push("-c", "mcp_servers.nexplc_xae_dev.env." + key + "=" + JSON.stringify(value));
args.push("-");
fs.writeFileSync(prefix + "-prompt.txt", prompt);
const out = fs.openSync(prefix + ".jsonl", "w"), err = fs.openSync(prefix + ".stderr", "w");
const child = spawn(cli, args, { stdio: ["pipe", out, err], windowsHide: true });
child.stdin.end(prompt);
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("close", code => {
  fs.closeSync(out); fs.closeSync(err);
  try {
    assert.equal(code, 0, "actual Codex process must exit successfully");
    const events = fs.readFileSync(prefix + ".jsonl", "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
    const calls = events.filter(e => e.type === "item.completed" && e.item?.type === "mcp_tool_call").map(e => e.item);
    assert.ok(calls.length >= 4, "require actual MCP calls, not final prose");
    assert.ok(calls.every(c => c.status === "completed" && !c.error && !c.result?.isError));
    const statuses = calls.filter(c => c.tool === "xae" && c.arguments.action === "status").map(c => ({ server: c.server, result: JSON.parse(c.result.content.find(b => b.type === "text").text) }));
    assert.equal(new Set(statuses.map(s => s.server)).size, 2);
    const dev = statuses.find(s => s.server === "nexplc_xae_dev").result;
    const prod = statuses.find(s => s.server === "nexplc_xae").result;
    assert.equal(prod.solution.fullName.toLowerCase(), production.toLowerCase());
    assert.equal(dev.solution.fullName.toLowerCase(), env.TE1000_MCP_SOLUTION_PATH.toLowerCase());
    assert.notEqual(dev.session.daemonPid, prod.session.daemonPid);
    const audit = calls.find(c => c.server === "nexplc_xae_dev" && c.tool === "project_save_audit");
    assert.ok(audit); const report = JSON.parse(audit.result.content.find(b => b.type === "text").text);
    assert.equal(report.safe, true); assert.equal(report.state, "completed_and_audited");
    const summary = { result: "PASS", calls: calls.length, production: prod.session, development: dev.session, audit: report.state };
    fs.writeFileSync(prefix + "-summary.json", JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});
