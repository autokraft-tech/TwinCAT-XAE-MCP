"use strict";
const assert = require("node:assert/strict");
const net = require("node:net");
const clientSockets = [];
const originalConnect = net.connect;
net.connect = (...args) => { const socket = originalConnect(...args); clientSockets.push(socket); return socket; };

(async () => {
  process.env.TE1000_DAEMON_PIPE = "nexplc-client-test-" + process.pid;
  process.env.TE1000_DAEMON_REQUEST_MS = "1000";
  const { runViaDaemon } = require("../daemonClient");
  let requests = 0;
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        requests++;
        if (request.action === "simulated_write") { socket.destroy(); continue; }
        if (request.action === "no_reply") continue;
        const reply = Buffer.from(JSON.stringify({ id: request.id, ok: true, result: { text: "MainPLC项目中文" } }) + "\n");
        const split = reply.indexOf(Buffer.from("中")) + 1;
        socket.write(reply.subarray(0, split));
        setTimeout(() => socket.write(reply.subarray(split)), request.action === "delayed_read" ? 100 : 10);
      }
    });
  });
  await new Promise(resolve => server.listen("\\\\.\\pipe\\" + process.env.TE1000_DAEMON_PIPE, resolve));
  try {
    assert.deepEqual(await runViaDaemon("read"), { text: "MainPLC项目中文" });
    await assert.rejects(runViaDaemon("simulated_write"), /pipe closed/i);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(requests, 2, "a lost response must not replay the write");
    assert.deepEqual(await runViaDaemon("read"), { text: "MainPLC项目中文" });
    const replacementRead = runViaDaemon("delayed_read");
    await new Promise(resolve => setTimeout(resolve, 20));
    clientSockets[0].emit("close"); // Delayed duplicate event from the disconnected socket.
    assert.deepEqual(await replacementRead, { text: "MainPLC项目中文" });
    await assert.rejects(runViaDaemon("no_reply"), /timed out/i);
    console.log("daemon client checks passed (split UTF-8, no write replay, reconnect, stale close isolation, request timeout)");
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
