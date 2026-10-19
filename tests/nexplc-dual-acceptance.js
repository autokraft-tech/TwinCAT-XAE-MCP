"use strict";
// Opt-in checks against the two already configured services. No successful writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const out = path.resolve(__dirname, "../artifacts/p2-resume-20261019");
assert.equal(process.argv[2], "--live-read-only", "explicit live acceptance required");
const registration = JSON.parse(fs.readFileSync(path.join(out, "p3-registration.json")));
const prod = process.env.NEXPLC_PRODUCTION_SOLUTION;
assert.ok(prod && path.isAbsolute(prod), "Set the exact NEXPLC_PRODUCTION_SOLUTION before live acceptance");
const dev = registration.dev.env.TE1000_MCP_SOLUTION_PATH;
const root = "TIPC^MainPLC^MainPLC项目";
const records = [];
async function rpc(pipe, action, payload) {
  const result = await new Promise((resolve, reject) => {
    const socket = net.connect("\\\\.\\pipe\\" + pipe);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("No replay: pipe timeout")); }, 20000);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("error", error => { clearTimeout(timer); reject(error); });
    socket.once("connect", () => socket.write(JSON.stringify({ id: "dual", action, payload }) + "\n"));
    socket.on("data", chunk => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      clearTimeout(timer); socket.end(); resolve(JSON.parse(buffer.split("\n")[0]));
    });
  });
  records.push({ pipe, action, payload, result });
  fs.writeFileSync(path.join(out, "p3-raw-isolation.json"), JSON.stringify(records, null, 2));
  return result;
}
(async () => {
  const pipe = registration.dev.env.TE1000_DAEMON_PIPE;
  const production = await rpc("nexplc-readonly-validation", "xae_status", {});
  const development = await rpc(pipe, "xae_status", {});
  assert.equal(production.ok, true); assert.equal(development.ok, true);
  assert.equal(production.result.solution.fullName, prod);
  assert.equal(development.result.solution.fullName, dev);
  for (const key of ["xaePid", "daemonPid"]) assert.notEqual(production.result.session[key], development.result.session[key]);
  const create = { parent: root + "^03_POUs", name: "FB_MCP_Forbidden", subType: 604, language: 1 };
  const checks = [
    [pipe, "xae_open_solution", { solutionPath: prod }, /pinned solution/i],
    [pipe, "xae_status", { expectedSolutionPath: prod }, /solution/i],
    [pipe, "plc_pou_create", { ...create, writeRoots: root, confirm: "ALLOW_PLC_WRITE" }, /WRITE_ROOTS|outside/i],
    [pipe, "plc_pou_create", { parent: root + "^01_DUTs", name: "ST_MCP_Dev", subType: 623, expectedHash: "absent", declText: "TYPE ST_MCP_Dev : DINT;\nEND_TYPE\n" }, /type|623|disabled/i],
    ["nexplc-readonly-validation", "plc_pou_create", { ...create, name: "FB_MCP_Dev", writeSolutionPath: dev, writeRoots: root, confirm: "ALLOW_PLC_WRITE" }, /read.only/i],
  ];
  for (const [target, action, payload, pattern] of checks) {
    const response = await rpc(target, action, payload);
    assert.equal(response.ok, false); assert.match(response.error, pattern);
  }
  // Different file IDs prove that the checked-out engineering files are independent.
  const identities = ["MySPT_Machine.sln", "MySPT_Machine.tsproj", "MainPLC/MainPLC.plcproj"].map(file => {
    const a = fs.statSync(path.join(path.dirname(prod), file));
    const b = fs.statSync(path.join(path.dirname(dev), file));
    assert.notEqual(a.dev + ":" + a.ino, b.dev + ":" + b.ino);
    return { file, production: a.dev + ":" + a.ino, development: b.dev + ":" + b.ino };
  });
  const worktree = path.dirname(path.dirname(dev));
  fs.writeFileSync(path.join(out, "p3-complete-tracked.diff"), execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: worktree }));
  const files = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: worktree, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
  fs.writeFileSync(path.join(out, "p3-new-files.json"), JSON.stringify(files.map(file => ({ file, text: fs.readFileSync(path.join(worktree, file), "utf8") })), null, 2));
  const xml = fs.readFileSync(path.join(path.dirname(dev), "MainPLC/03_POUs/FB_MCP_Dev.TcPOU"), "utf8");
  const guid = xml.match(/<POU\s+Name="FB_MCP_Dev"\s+Id="([^"]+)"/)[1];
  const project = fs.readFileSync(path.join(path.dirname(dev), "MainPLC/MainPLC.plcproj"), "utf8");
  assert.equal(project.split('Compile Include="03_POUs\\FB_MCP_Dev.TcPOU"').length - 1, 1);
  fs.writeFileSync(path.join(out, "p3-isolation-summary.json"), JSON.stringify({ result: "PASS", production: production.result, development: development.result, rejected: checks.length, identities, guid }, null, 2));
  console.log("PASS: two live sessions; five raw isolation denials; independent engineering file IDs; unique FB reference");
})().catch(error => { console.error(error); process.exitCode = 1; });
