"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { runViaDaemon } = require("../daemonClient");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const records = [];
  const call = async (action, payload = {}) => {
    try {
      const result = await runViaDaemon(action, payload);
      records.push({ action, payload, result });
      return result;
    } catch (error) { records.push({ action, error: error.message }); throw error; }
    finally { fs.writeFileSync("artifacts/validation/lifecycle-" + process.env.TE1000_SESSION_MODE + ".json", JSON.stringify(records, null, 2)); }
  };
  const before = await call("xae_status");
  if (process.env.TE1000_SESSION_MODE === "active") {
    assert.equal(before.session.owned, false);
    const stopped = await call("daemon_shutdown");
    assert.equal(stopped.closedOwnedXae, false);
    await sleep(1000);
    process.kill(before.session.xaePid, 0); // Attached session must not close this XAE.
    console.log("PASS: attached-session shutdown preserves XAE PID " + before.session.xaePid);
  } else {
    assert.equal(before.session.owned, true);
    assert.equal(process.env.TE1000_MCP_SOLUTION_PATH, process.env.TE1000_WRITE_SOLUTION_PATH);
    await call("xae_save_all");
    const stopped = await call("daemon_shutdown");
    assert.equal(stopped.closedOwnedXae, true);
    await sleep(1500);
    const after = await call("xae_status");
    assert.notEqual(after.session.daemonPid, before.session.daemonPid);
    assert.notEqual(after.session.xaePid, before.session.xaePid);
    assert.equal(after.session.solutionOpenCount, 1);
    const code = await call("plc_pou_get_impl", { path: "TIPC^MainPLC^MainPLC项目^03_POUs^FB_MCP_Test" });
    assert.ok(code.text.includes("nValue + 42"));
    console.log(JSON.stringify({ result: "PASS", before: before.session, after: after.session, savedCodeSurvived: true }));
    await call("daemon_shutdown");
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(process.exitCode || 0), 500));
