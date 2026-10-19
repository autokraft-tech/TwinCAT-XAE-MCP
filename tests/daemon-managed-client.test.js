"use strict";
const assert = require("node:assert/strict");
const net = require("node:net");
const crypto = require("node:crypto");
let dropAfterIdentity = false;
const originalConnect = net.connect;
net.connect = (...args) => {
  const socket = originalConnect(...args);
  socket.on("data", chunk => {
    if (!dropAfterIdentity) return;
    let reply; try { reply = JSON.parse(chunk.toString().trim()); } catch { return; }
    if (!reply.result?.policyHash) return;
    dropAfterIdentity = false;
    queueMicrotask(() => { socket.emit("close"); socket.destroy(); });
  });
  return socket;
};
process.env.TE1000_DAEMON_AUTOSTART = "0";
process.env.TE1000_DAEMON_PIPE = "nexplc-managed-fixture-" + process.pid;
process.env.TE1000_DAEMON_EXE = process.execPath;
process.env.TE1000_OWNER_SID = "fixture-sid";
process.env.TE1000_OWNER_SESSION_ID = "1";
process.env.TE1000_DAEMON_REQUEST_MS = "1000";
const keys = ["TE1000_MCP_SOLUTION_PATH", "TE1000_WRITE_SOLUTION_PATH", "TE1000_WRITE_ROOTS", "TE1000_PLC_WRITE_TYPES", "TE1000_SESSION_MODE", "TE1000_PROGID", "TE1000_XAE_VERSION", "TE1000_PROJECT_NAME", "TE1000_PLC_ROOT"];
const policyHash = () => crypto.createHash("sha256").update(keys.concat(process.env.TE1000_GIT_WORKFLOW ? ["TE1000_GIT_WORKFLOW", "TE1000_GIT_CHECKOUT", "TE1000_GIT_BRANCH", "TE1000_GIT_HEAD"] : []).map(key => key + "=" + (process.env[key] || "") + "\n").join("")).digest("hex");
const { runViaDaemon } = require("../daemonClient");
(async () => {
  let writes = 0, mismatch = false, hash = policyHash();
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (request.action === "write") { writes++; socket.destroy(); continue; }
        const identity = { policyHash: mismatch ? "wrong-policy" : hash, pipe: process.env.TE1000_DAEMON_PIPE,
          executable: process.execPath, sessionId: 1, userSid: "fixture-sid" };
        socket.write(JSON.stringify({ id: request.id, ok: true, result: request.action === "daemon_identity" ? identity : { read: true } }) + "\n");
      }
    });
  });
  await new Promise(resolve => server.listen("\\\\.\\pipe\\" + process.env.TE1000_DAEMON_PIPE, resolve));
  try {
    assert.deepEqual(await runViaDaemon("read"), { read: true });
    process.env.TE1000_GIT_WORKFLOW = "single-checkout";
    process.env.TE1000_GIT_CHECKOUT = "fixture-checkout";
    process.env.TE1000_GIT_BRANCH = "fix/fixture";
    process.env.TE1000_GIT_HEAD = "fixture-head";
    await assert.rejects(runViaDaemon("write"), /identity.*mismatch/);
    assert.equal(writes, 0, "branch policy cannot reuse the old session identity");
    hash = policyHash();
    assert.deepEqual(await runViaDaemon("read"), { read: true });
    process.env.TE1000_GIT_BRANCH = "fix/other";
    await assert.rejects(runViaDaemon("write"), /identity.*mismatch/);
    assert.equal(writes, 0, "branch changes require a new daemon identity");
    process.env.TE1000_GIT_BRANCH = "fix/fixture";
    mismatch = true;
    await assert.rejects(runViaDaemon("write"), /identity.*mismatch/);
    assert.equal(writes, 0, "wrong policy must reject before sending engineering call");
    mismatch = false;
    dropAfterIdentity = true;
    await assert.rejects(runViaDaemon("write"), /connection changed after identity/i);
    assert.equal(writes, 0, "a replacement connection must not inherit an old identity check");
    await assert.rejects(runViaDaemon("write"), /pipe closed/i);
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(writes, 1, "disconnect must not replay write");
    assert.deepEqual(await runViaDaemon("read"), { read: true });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  await assert.rejects(runViaDaemon("write"), /Managed daemon unavailable/);
  assert.equal(writes, 1);
  console.log("managed client checks passed (identity/policy fence; disconnect no replay; reconnect; missing pipe no spawn)");
})().catch(error => { console.error(error); process.exitCode = 1; });
