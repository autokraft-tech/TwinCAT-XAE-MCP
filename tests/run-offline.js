"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
for (const file of ["offline-surface.test.js", "daemon-offline-policy.test.js", "daemon-client.test.js", "daemon-managed-client.test.js", "daemon-lifecycle-policy.test.js"]) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
const worker = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve(__dirname, "../daemon/test-worker.ps1")], { stdio: "inherit", windowsHide: true });
if (worker.status !== 0) process.exit(worker.status || 1);
const audit = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve(__dirname, "../daemon/test-save-audit.ps1")], { stdio: "inherit", windowsHide: true });
if (audit.status !== 0) process.exit(audit.status || 1);
const creation = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve(__dirname, "../daemon/test-object-creation.ps1")], { stdio: "inherit", windowsHide: true });
if (creation.status !== 0) process.exit(creation.status || 1);
const profile = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "dev-profile.test.ps1")], { stdio: "inherit", windowsHide: true });
if (profile.status !== 0) process.exit(profile.status || 1);
