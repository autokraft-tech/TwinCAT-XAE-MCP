"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

(async () => {
  const pipe = "nexplc-policy-test-" + process.pid;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexplc-policy-"));
  const solution = path.join(dir, "fixture.sln");
  fs.writeFileSync(solution, "policy fixture; no COM operations permitted by this test\n");
  const child = spawn(path.resolve(__dirname, "../daemon/bin/Release/Te1000Daemon.exe"), ["--pipe", pipe, "--no-watch"], {
    windowsHide: true, stdio: "ignore", env: { ...process.env,
      TE1000_MCP_SOLUTION_PATH: solution, TE1000_WRITE_SOLUTION_PATH: solution,
      TE1000_SESSION_MODE: "createOnce", TE1000_WRITE_ROOTS: "TIPC^MainPLC^MainPLC项目^03_POUs^FB_Test",
    },
  });
  child.on("error", error => { throw error; });
  let socket;
  try {
    for (let i = 0; i < 50; i++) {
      socket = await new Promise(resolve => {
        const s = net.connect("\\\\.\\pipe\\" + pipe);
        s.once("connect", () => resolve(s));
        s.once("error", () => { s.destroy(); resolve(null); });
      });
      if (socket) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(socket, "daemon pipe must connect");
    socket.setEncoding("utf8");
    let id = 0;
    const rpc = (action, payload = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.removeListener("data", data); reject(new Error("policy RPC timed out")); }, 3000);
      let buffer = "";
      const data = chunk => {
        buffer += chunk;
        const end = buffer.indexOf("\n");
        if (end < 0) return;
        clearTimeout(timer); socket.removeListener("data", data);
        try { resolve(JSON.parse(buffer.slice(0, end))); } catch (error) { reject(error); }
      };
      socket.on("data", data);
      socket.write(JSON.stringify({ id: String(++id), action, payload }) + "\n");
    });
    const allowed = (await rpc("list_actions")).result.actions;
    const sourceFiles = fs.readdirSync(path.resolve(__dirname, "../daemon/Actions")).filter(f => f.endsWith(".cs"));
    const original = new Set(sourceFiles.flatMap(f => Array.from(fs.readFileSync(path.resolve(__dirname, "../daemon/Actions", f), "utf8").matchAll(/h\["([^"]+)"\]/g), m => m[1])));
    let rejected = 0;
    for (const action of original) {
      if (allowed.includes(action)) continue;
      const result = await rpc(action, { confirm: "ALLOW_PLC_DOWNLOAD", commandName: "TwinCAT.ActivateConfiguration" });
      assert.equal(result.ok, false, action + " must be denied on the raw pipe"); rejected++;
    }
    for (const [action, payload] of [
      ["dialog_resolve", { button: "OK", remember: true }],
      ["xae_open_solution", { solutionPath: path.join(dir, "other.sln") }],
      ["xae_status", { mode: "create" }],
      ["xae_status", { expectedSolutionPath: path.join(dir, "wrong-front.sln") }],
      ["plc_pou_create", { parent: "TIPC^MainPLC^MainPLC项目^03_POUs", name: "FB_Test", subType: 609 }],
      ["plc_pou_set_impl", { path: "TIPC^MainPLC^MainPLC项目^03_POUs^FB_Test", implXml: "<x/>" }],
      ["plc_pou_set_impl", { path: "TIPC^MainPLC^MainPLC项目^03_POUs^MAIN", implText: "" }],
      ["plc_pou_get_decl", { path: "TISC^Safety" }],
    ]) {
      const result = await rpc(action, payload);
      assert.equal(result.ok, false, action + " must reject invalid scope/input before COM"); rejected++;
    }
    console.log(`daemon offline policy checks passed (${rejected} raw pipe requests rejected without COM)`);
  } finally {
    if (socket) socket.destroy();
    child.kill();
    // Remove only the two files/directories created by this test.
    fs.unlinkSync(solution); fs.rmdirSync(dir);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
