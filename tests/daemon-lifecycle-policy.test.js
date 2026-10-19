"use strict";
// Real daemon/pipe, synthetic files, deliberately invalid COM ProgID.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const exe = process.env.TE1000_DAEMON_EXE || path.resolve(__dirname, "../daemon/bin/Release/Te1000Daemon.exe");
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function rpc(pipe, action, payload = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect("\\\\.\\pipe\\" + pipe); socket.setEncoding("utf8");
    let text = ""; const timer = setTimeout(() => { socket.destroy(); reject(new Error("fixture pipe timeout; no replay")); }, 3000);
    socket.once("error", error => { clearTimeout(timer); reject(error); });
    socket.once("connect", () => socket.write(JSON.stringify({ id: "fixture", action, payload }) + "\n"));
    socket.on("data", chunk => { text += chunk; if (!text.includes("\n")) return; clearTimeout(timer); socket.end(); resolve(JSON.parse(text.split("\n")[0])); });
  });
}
async function ready(pipe) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { return await rpc(pipe, "daemon_identity"); } catch { await sleep(50); }
  }
  throw new Error("fixture daemon never became ready");
}
(async () => {
  let checks = 0;
  for (const state of ["pending", "executing", "blocked"]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexplc-lifecycle-fixture-"));
    const solution = path.join(dir, "fixture.sln"); fs.writeFileSync(solution, "Synthetic; never opened by XAE");
    const auditDir = path.join(process.env.LOCALAPPDATA, "NexPlcXaeMcp/save-audits", hash(dir.toUpperCase()));
    fs.mkdirSync(auditDir, { recursive: true });
    const journal = path.join(auditDir, "pending.json");
    const text = JSON.stringify({ state, reason: "synthetic unknown write/metadata lock", solution }); fs.writeFileSync(journal, text);
    for (let restart = 0; restart < 2; restart++) {
      const pipe = "nexplc-lifecycle-fixture-" + process.pid + "-" + state + "-" + restart;
      const child = spawn(exe, ["--pipe", pipe, "--no-watch"], { stdio: "ignore", windowsHide: true, env: { ...process.env,
        TE1000_MCP_SOLUTION_PATH: solution, TE1000_WRITE_SOLUTION_PATH: solution,
        TE1000_SESSION_MODE: "createOnce", TE1000_PROGID: "NexPlc.Fixture.NoCOM",
        TE1000_OWNER_SID: undefined, TE1000_OWNER_SESSION_ID: undefined,
        TE1000_WRITE_ROOTS: "TIPC^MainPLC^MainPLC项目^03_POUs^FB_Test", TE1000_PLC_WRITE_TYPES: "604",
      } });
      try {
        assert.equal((await ready(pipe)).ok, true);
        for (const [action, payload] of [["xae_status", {}], ["daemon_shutdown", {}],
          ["plc_pou_create", { parent: "TIPC^MainPLC^MainPLC项目^03_POUs", name: "FB_Test", subType: 604 }]]) {
          const result = await rpc(pipe, action, payload);
          assert.equal(result.ok, false); assert.match(result.error, /unfinished|unsafe|Save safety lock|initialization failed/i); checks++;
        }
        assert.equal(fs.readFileSync(journal, "utf8"), text, "restart/read/stop must never clear or rewrite unknown journal"); checks++;
      } finally { child.kill(); await new Promise(resolve => child.once("exit", resolve)); }
    }
    // Deliberately retain synthetic lock records for diagnosis, like real failures.
  }
  const wrongSession = spawn(exe, ["--pipe", "nexplc-wrong-session-fixture-" + process.pid, "--no-watch"], {
    stdio: "ignore", windowsHide: true, env: { ...process.env, TE1000_OWNER_SESSION_ID: "-1" },
  });
  const code = await new Promise(resolve => wrongSession.once("exit", resolve));
  assert.notEqual(code, 0); checks++;
  console.log("lifecycle policy checks passed (" + checks + " checks; process restarts preserve pending/executing/blocked locks; session mismatch exits before COM)");
})().catch(error => { console.error(error); process.exitCode = 1; });
