"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = [
  ...fs.readdirSync(root).filter(name => name.endsWith(".md")).map(name => path.join(root, name)),
  ...["docs", "examples", ".github"].flatMap(name => walk(path.join(root, name))).filter(name => name.endsWith(".md")),
];
let links = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8").replace(/```[^\n]*\n[\s\S]*?```/g, "");
  for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
    const relative = decodeURIComponent(target.split("#")[0]);
    let current = path.dirname(file);
    for (const part of relative.split("/")) {
      if (part === "..") { current = path.dirname(current); continue; }
      if (!part || part === ".") continue;
      // Exact spelling also catches Windows-only case mistakes before Linux CI.
      assert.ok(fs.readdirSync(current).includes(part), `${path.relative(root, file)}: missing/case-mismatched ${relative}`);
      current = path.join(current, part);
    }
    links++;
  }
}
const json = JSON.parse(fs.readFileSync(path.join(root, "examples/mcp-config.json"), "utf8"));
for (const config of Object.values(json.mcpServers)) {
  assert.equal(config.disabled, true);
  assert.equal(config.env.TE1000_WRITE_SOLUTION_PATH, "");
  assert.equal(config.env.TE1000_WRITE_ROOTS, "");
}
for (const name of ["nexplc-codex.toml", "nexplc-codex-dev.toml"]) {
  const text = fs.readFileSync(path.join(root, "examples", name), "utf8");
  assert.match(text, /^enabled = false$/m);
  assert.match(text, /<SOLUTION>/);
  assert.doesNotMatch(text, /D:\\Will|C:\\Users\\Will/);
}
console.log(`documentation checks passed (${files.length} Markdown files, ${links} relative links, disabled templates)`);
