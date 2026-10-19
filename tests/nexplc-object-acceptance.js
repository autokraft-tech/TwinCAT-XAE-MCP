"use strict";
// Opt-in, one fresh worktree and daemon per object type. Never retries writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const { McpClient } = require("./mcp-client");
const stage = process.argv[2];
const worktree = path.resolve(process.argv[3] || "missing");
const binary = path.resolve(process.argv[4] || "missing");
const plc = "TIPC^MainPLC^MainPLC项目";
const definitions = {
  struct: { type: 606, name: "ST_P2Resume", text: "TYPE ST_P2Resume :\nSTRUCT\n    bEnable : BOOL;\n    nCount : DINT;\n    rValue : REAL;\n    aValues : ARRAY[0..2] OF REAL;\nEND_STRUCT\nEND_TYPE\n", from: "0..2", to: "0..3", fbVars: "    stData : ST_P2Resume;", code: "stData.bEnable := TRUE;\nstData.nCount := 42;\nstData.rValue := DINT_TO_REAL(stData.nCount);\nstData.aValues[0] := stData.rValue;\n" },
  enum: { type: 605, name: "E_P2Resume", text: "TYPE E_P2Resume :\n(\n    McpIdle := 0,\n    McpReady := 1\n);\nEND_TYPE\n", from: "McpReady := 1", to: "McpReady := 2", fbVars: "    eState : E_P2Resume;", code: "eState := E_P2Resume.McpReady;\n" },
  alias: { type: 623, name: "T_P2Resume", text: "TYPE T_P2Resume : DINT;\nEND_TYPE\n", from: "DINT", to: "LINT", fbVars: "    nValue : T_P2Resume;", code: "nValue := 42;\n" },
  gvl: { type: 615, name: "GVL_P2Resume", text: "VAR_GLOBAL\n    gP2Bool : BOOL;\n    gP2Dint : DINT;\n    gP2Real : REAL;\n    gP2Array : ARRAY[0..2] OF DINT;\n    gP2Data : ST_P2Resume;\nEND_VAR\n", from: "0..2", to: "0..3", fbVars: "    nCalls : DINT;", code: "GVL_P2Resume.gP2Bool := TRUE;\nGVL_P2Resume.gP2Dint := 43;\nGVL_P2Resume.gP2Real := DINT_TO_REAL(GVL_P2Resume.gP2Dint);\nGVL_P2Resume.gP2Array[0] := GVL_P2Resume.gP2Dint;\nGVL_P2Resume.gP2Data.bEnable := GVL_P2Resume.gP2Bool;\nGVL_P2Resume.gP2Data.nCount := GVL_P2Resume.gP2Dint;\nnCalls := nCalls + 1;\n" },
};
assert.ok(definitions[stage], "choose exactly one supported validation stage");
const d = definitions[stage];
assert.notEqual(worktree.toLowerCase(), "d:\\will\\documents\\source\\repos\\nexplc");
assert.ok(path.basename(worktree).startsWith("NexPlc-p2-20261019-"));
assert.ok(fs.existsSync(binary));
assert.equal(execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: worktree, encoding: "utf8" }), "", "fresh clean worktree required");
const solution = path.join(worktree, "MySPT_Machine/MySPT_Machine.sln");
const objectFolder = stage === "gvl" ? "04_GVLs" : "01_DUTs";
const objectExtension = stage === "gvl" ? ".TcGVL" : ".TcDUT";
const objectTag = stage === "gvl" ? "GVL" : "DUT";
const objectPath = plc + "^" + objectFolder + "^" + d.name;
const dependency = plc + "^01_DUTs^ST_P2Resume";
const fbName = "FB_P2Resume_" + stage;
const fbPath = plc + "^03_POUs^" + fbName;
const pipe = "nexplc-p2-20261019-" + stage;
const outputDir = path.resolve(__dirname, "../artifacts/p2-resume-20261019");
fs.mkdirSync(outputDir, { recursive: true });
const env = {
  TE1000_DAEMON_EXE: binary, TE1000_DAEMON_PIPE: pipe,
  TE1000_SESSION_MODE: "createOnce", TE1000_PROGID: "TcXaeShell.DTE.17.0", TE1000_XAE_VERSION: "3.1.4026.20",
  TE1000_MCP_SOLUTION_PATH: solution, TE1000_WRITE_SOLUTION_PATH: solution,
  TE1000_WRITE_ROOTS: [objectPath, fbPath, ...(stage === "gvl" ? [dependency] : [])].join(";"), TE1000_PLC_WRITE_TYPES: "604;" + d.type + (stage === "gvl" ? ";606" : ""),
  TE1000_PROJECT_NAME: "MySPT_Machine", TE1000_PLC_ROOT: plc, TE1000_DIALOG_AUTODISMISS: "0",
  TE1000_DAEMON_LOG: path.join(outputDir, stage + "-daemon.log"),
};
fs.writeFileSync(path.join(outputDir, stage + "-environment.json"), JSON.stringify(env, null, 2));
const records = [], client = new McpClient(env);
async function call(name, args) {
  try { const result = await client.call(name, args); records.push({ name, args, result }); return result; }
  catch (error) { records.push({ name, args, error: error.message }); throw error; }
  finally { fs.writeFileSync(path.join(outputDir, stage + "-calls.json"), JSON.stringify(records, null, 2)); }
}
const objectFile = path.join(path.dirname(solution), "MainPLC", objectFolder, d.name + objectExtension);
function guid(file, tag, name) {
  const xml = fs.readFileSync(file, "utf8");
  const id = xml.match(new RegExp("<" + tag + '\\s+Name="' + name + '"\\s+Id="([^"]+)"'))?.[1];
  assert.match(id || "", /^\{[0-9a-f-]{36}\}$/i); return id;
}
function reference(file) {
  const xml = fs.readFileSync(path.join(path.dirname(solution), "MainPLC/MainPLC.plcproj"), "utf8");
  assert.equal(xml.split('Compile Include="' + file + '"').length - 1, 1);
}
async function readonlyRejection() {
  const socket = await new Promise((resolve, reject) => {
    const s = net.connect("\\\\.\\pipe\\nexplc-readonly-validation"); s.once("connect", () => resolve(s)); s.once("error", reject);
  });
  try {
    socket.setEncoding("utf8");
    const response = new Promise((resolve, reject) => {
      let buffer = ""; const timer = setTimeout(() => reject(new Error("production denial check timed out")), 10000);
      socket.on("data", data => { buffer += data; if (!buffer.includes("\n")) return; clearTimeout(timer); resolve(JSON.parse(buffer.slice(0, buffer.indexOf("\n")))); });
      socket.once("error", reject);
    });
    socket.write(JSON.stringify({ id: "readonly-" + stage, action: "plc_pou_create", payload: { parent: plc + "^" + objectFolder, name: d.name, subType: d.type, expectedHash: "absent", declText: d.text, expectedSolutionPath: "D:\\Will\\Documents\\source\\repos\\NexPlc\\MySPT_Machine\\MySPT_Machine.sln" } }) + "\n");
    const result = await response; assert.equal(result.ok, false); assert.match(result.error, /Read-only solution/); return result;
  } finally { socket.destroy(); }
}
(async () => {
  try {
    await client.initialize();
    const status = await call("xae", { action: "status" });
    assert.equal(status.solution.fullName.toLowerCase(), solution.toLowerCase()); assert.equal(status.sysManagerAvailable, true);
    assert.equal(fs.existsSync(objectFile), false);
    await call("project_save_preview", {});
    let dependencyGuid;
    if (stage === "gvl") {
      await call("plc_pou", { action: "create", parent: plc + "^01_DUTs", name: "ST_P2Resume", subType: 606, expectedHash: "absent" });
      const initialStruct = await call("plc_pou", { action: "get_decl", path: dependency });
      await call("plc_pou", { action: "set_decl", path: dependency, declText: definitions.struct.text, expectedHash: initialStruct.contentHash });
      await call("project_save", {});
      dependencyGuid = guid(path.join(path.dirname(solution), "MainPLC/01_DUTs/ST_P2Resume.TcDUT"), "DUT", "ST_P2Resume");
    }
    const create = { action: "create", parent: plc + "^" + objectFolder, name: d.name, subType: d.type, expectedHash: "absent" };
    if (stage === "alias") create.declText = d.text;
    await call("plc_pou", create);
    const initial = await call("plc_pou", { action: "get_decl", path: objectPath });
    if (stage === "alias") assert.equal(initial.text.replace(/\r\n/g, "\n").trimEnd(), d.text.trimEnd(), "one documented declaration-array attempt only; stop on unexpected creation semantics");
    const firstGuid = guid(objectFile, objectTag, d.name);
    await call("plc_pou", { action: "set_decl", path: objectPath, declText: d.text, expectedHash: initial.contentHash });
    await call("project_save", {});
    assert.equal(guid(objectFile, objectTag, d.name), firstGuid);
    const current = await call("plc_pou", { action: "get_decl", path: objectPath });
    const edited = d.text.replace(d.from, d.to);
    await assert.rejects(call("plc_pou", { action: "set_decl", path: objectPath, declText: edited, expectedHash: "0".repeat(64) }), /hash mismatch/);
    await assert.rejects(call("plc_pou", create), /already exists/);
    await assert.rejects(call("plc_pou", { action: "set_impl", path: objectPath, implText: "", expectedHash: current.contentHash }), /declarations only/);
    await call("plc_pou", { action: "set_decl", path: objectPath, declText: edited, expectedHash: current.contentHash });
    await call("project_save", {});
    await call("project_changes", {});
    await call("xae", { action: "open_solution", solutionPath: solution, closeExisting: true });
    const reloaded = await call("plc_pou", { action: "get_decl", path: objectPath });
    assert.equal(reloaded.text.replace(/\r\n/g, "\n").trimEnd(), edited.trimEnd());
    assert.equal(guid(objectFile, objectTag, d.name), firstGuid); reference(objectFolder + "\\" + d.name + objectExtension);
    await call("plc_pou", { action: "create", parent: plc + "^03_POUs", name: fbName, subType: 604, language: 1 });
    await call("plc_pou", { action: "set_decl", path: fbPath, declText: "FUNCTION_BLOCK " + fbName + "\nVAR_OUTPUT\n" + d.fbVars + "\nEND_VAR\n" });
    await call("plc_pou", { action: "set_impl", path: fbPath, implText: d.code });
    await call("project_save", {});
    const fbFile = path.join(path.dirname(solution), "MainPLC/03_POUs", fbName + ".TcPOU");
    const fbGuid = guid(fbFile, "POU", fbName);
    await call("xae", { action: "open_solution", solutionPath: solution, closeExisting: true });
    const fbRead = await call("plc_pou", { action: "get_impl", path: fbPath });
    assert.equal(fbRead.text.replace(/\r\n/g, "\n").trimEnd(), d.code.trimEnd());
    assert.equal(guid(fbFile, "POU", fbName), fbGuid); assert.equal(guid(objectFile, objectTag, d.name), firstGuid);
    if (stage === "gvl") {
      assert.equal(guid(path.join(path.dirname(solution), "MainPLC/01_DUTs/ST_P2Resume.TcDUT"), "DUT", "ST_P2Resume"), dependencyGuid);
      reference("01_DUTs\\ST_P2Resume.TcDUT");
    }
    reference("03_POUs\\" + fbName + ".TcPOU");
    const build = await call("xae_build", { action: "build", waitForFinish: true, timeoutMs: 180000 }); assert.equal(build.lastBuildInfo, 0);
    const diagnostics = await call("xae", { action: "error_list", limit: 5000 });
    await call("project_save", {}); const changes = await call("project_changes", {}); assert.equal(changes.blocked, false);
    const denied = await readonlyRejection();
    const sessions = records.filter(r => r.result?.session).map(r => r.result.session);
    assert.ok(sessions.every(s => s.xaePid === status.session.xaePid && s.daemonPid === status.session.daemonPid));
    const summary = { result: "PASS", stage, env, guid: firstGuid, fbGuid, dependencyGuid, session: fbRead.session, build, diagnostics, productionDenied: denied, changes };
    fs.writeFileSync(path.join(outputDir, stage + "-summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ result: "PASS", stage, guid: firstGuid, fbGuid, session: fbRead.session, build: build.lastBuildInfo }));
  } finally { client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
