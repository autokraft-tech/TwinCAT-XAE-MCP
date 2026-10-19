"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");

class McpClient {
  constructor(env = {}) {
    this.child = spawn(process.execPath, [path.resolve(__dirname, "../index.js")], {
      env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", chunk => { this.stderr += chunk; });
    this.child.stdout.setEncoding("utf8");
    let buffer = "";
    this.child.stdout.on("data", chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        let response;
        try { response = JSON.parse(line); }
        catch (error) { this.fail(error); continue; }
        const waiter = this.pending.get(response.id);
        if (waiter) { this.pending.delete(response.id); waiter.resolve(response); }
      }
    });
    this.child.on("error", error => this.fail(error));
    this.child.on("exit", code => this.fail(new Error(`MCP front exited ${code}: ${this.stderr}`)));
  }
  fail(error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
  async request(method, params = {}, timeoutMs = 220000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async initialize() {
    const result = await this.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "nexplc-local-validation", version: "1" } });
    if (result.error) throw new Error(JSON.stringify(result.error));
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return result;
  }
  async call(name, args) {
    const response = await this.request("tools/call", { name, arguments: args });
    if (response.error || response.result?.isError) throw new Error(JSON.stringify(response));
    const text = response.result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
    try { return JSON.parse(text); } catch { return text; }
  }
  close() { this.child.kill(); }
}
module.exports = { McpClient };
