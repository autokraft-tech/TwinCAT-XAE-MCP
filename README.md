# NexPlc：本机 XAE 64-bit 离线适配

本 Fork 当前只公开 `xae`、`tc_tree`、`plc_pou`、`xae_build` 四组 MCP 工具。
Daemon 使用独立允许列表强制限制能力；上游的确认字符串不能启用下载、在线变更、
Login/Logout、配置激活、Runtime 重启、ADS 写入、设备控制、任意 DTE 命令、
对象删除/重命名/移动、工程 XML 写入或对话框点击。
下方保留的上游说明用于架构参考，其中更广泛的工具和部署流程在本 Fork 中不可用。

完整实测结果见 [NexPlc 验证报告](docs/NEXPLC_XAE_MCP_VALIDATION.md)。
本机 Codex 配置示例见 [examples/nexplc-codex.toml](examples/nexplc-codex.toml)。
原 PowerShell `XaeBridge.ps1` 原型已停用，后续使用此 MCP 服务。

## 本机安装与启动

要求：Windows 64-bit、Node.js 20+、.NET Framework 4.7.2+、TwinCAT XAE Shell 64-bit
及 Beckhoff Automation Interface。本机验证 Node 24.15.0、.NET Framework 4.8、
`TcXaeShell.DTE.17.0`，工程版本为 `3.1.4026.20`。

```powershell
npm ci --ignore-scripts
powershell.exe -NoProfile -ExecutionPolicy Bypass -File daemon\build.ps1
npm run check
npm test
npm run test:offline
node daemon\test-ping.js
```

构建脚本会实际把找到的 interop DLL 路径传给 MSBuild，也可使用 `-InteropPath`
或 `TE1000_INTEROP_PATH` 指定路径。无需修改 PLC 工程。

按照 [Codex 官方 MCP 文档](https://developers.openai.com/codex/mcp)，将示例中的
`mcp_servers.nexplc_xae` 配置加入用户配置，或使用 `codex mcp add` 注册 stdio 服务。
本机已注册；入口为此仓库的 `index.js`。PATH 中旧版 CLI 0.125.0 不支持现有配置的
`service_tier="default"`，请使用 Codex 桌面版自带的 CLI 或桌面设置管理 MCP，
无需为旧 CLI 修改现有模型设置。

第一次 `xae.status` 自动启动独立 Daemon；`createOnce` 在一个 STA 上创建或恢复
自己持有的 XAE，打开指定 Solution 一次，随后复用 DTE/ITcSysManager。
MCP 前端或 Codex 重启不会结束 detached Daemon。Daemon 重启通过持久化的 PID、
进程启动时间及精确 Solution 路径恢复自己创建的实例；无法可靠附加时拒绝重复启动。
`active` 模式只附加，不会关闭附加到的实例。

## 查询、编辑和编译

```text
xae       {"action":"status"}
tc_tree   {"action":"children","path":"TIPC^MainPLC^MainPLC项目"}
plc_pou   {"action":"tree","path":"TIPC^MainPLC^MainPLC项目^03_POUs","depth":8}
plc_pou   {"action":"get_decl","path":"TIPC^MainPLC^MainPLC项目^03_POUs^01_Bases^Interlock^FB_Interlock_PAx"}
plc_pou   {"action":"get_impl","path":"TIPC^MainPLC^MainPLC项目^03_POUs^01_Bases^Interlock^FB_Interlock_PAx"}
```

已验证的写接口为 ST FB 的 `CreateChild(604, language=1)`、`DeclarationText` 和
`ImplementationText`。仅在有写入授权的隔离副本中设置以下启动环境：

- `TE1000_MCP_SOLUTION_PATH`：该副本 `.sln` 的绝对路径。
- `TE1000_WRITE_SOLUTION_PATH`：同一个绝对路径；未配置或不一致时拒绝所有写入、保存和编译。
- `TE1000_WRITE_ROOTS`：允许修改的完整 XAE 对象路径，以分号分隔；本次仅允许 `TIPC^MainPLC^MainPLC项目^03_POUs^FB_MCP_Test`。
- `TE1000_DAEMON_PIPE`：独立管道名，不要与正式工程会话共用。

配置在 Daemon 启动时固定。新建使用 `plc_pou.create`，修改使用 `set_decl`、
`set_impl`，保存使用 `xae.save_all`，重新加载使用同一路径的
`xae.open_solution(closeExisting:true)`。离线编译使用 `xae_build(action:"build")`；
该操作只调用 PLC 项目的 `SolutionBuild.BuildProject`，之后读取 `xae.error_list`。
新建拒绝重复名称；修改声明必须保持原 FB 名称，XAE 保留原 GUID。
不支持的 Method/DUT/GVL 创建或修改应停止，先单独验证官方接口。

已注册的正式 NexPlc 会话保持只读。不要修改 SPT V4 库，也不要手工生成/改写
TcPOU、plcproj XML 或对象 GUID。读取结果中的 `session` 提供 XAE/Daemon PID、
所有权及此 Daemon 的 Solution 打开次数，便于检查是否复用。

## 停止与故障处理

先退出正在使用该服务的客户端，再用相同管道名执行运维停止命令：

```powershell
$env:TE1000_DAEMON_PIPE = 'nexplc-readonly-validation'
node -e 'require("./daemonClient").runViaDaemon("daemon_shutdown").then(x=>{console.log(JSON.stringify(x));setTimeout(()=>process.exit(0),500)}).catch(e=>{console.error(e.message);process.exit(1)})'
```

该运维动作不属于 Codex MCP 工具面。它只关闭自己创建且没有未保存内容的 XAE；
附加实例保持打开。不要使用按进程名称批量结束所有 XAE 的命令。

对话框只检测和报告，不自动点击。超时/对话框会使 COM worker 停止接受后续工作；
请求断线也不会自动重放。先人工核查操作是否已完成、保存需要保留的内容并处理窗口，
再停止对应 Daemon、重启服务。不要在结果未知时重复写入。
如果日志提示 owned XAE 仍在但无法附加，应人工核对报告的 PID；不能删除租约后
直接启动第二个 XAE。租约位于 `%LOCALAPPDATA%\NexPlcXaeMcp`，同处保留注册前的
Codex 配置备份。工程路径不存在或不符时服务拒绝操作，不生成替代 XML。

`artifacts/validation/` 保存本机调用记录、诊断及哈希，已被 Git 忽略；不要将包含
工程源码的本机诊断记录直接发布到公共仓库。

---

## 上游参考说明（部分能力在此 Fork 中已禁用）

<p align="center">
  <img src="docs/assets/te1000-banner.png" alt="TE1000 MCP — MCP server for Beckhoff TwinCAT XAE / TE1000 Automation Interface" width="100%">
</p>

# te1000-mcp

> A [Model Context Protocol](https://modelcontextprotocol.io) server for **Beckhoff TwinCAT 3** engineering automation — drive the **TE1000 / XAE Automation Interface** from an AI agent or any MCP client.

[![CI](https://github.com/Edge-JB/TwinCAT-XAE-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/Edge-JB/TwinCAT-XAE-MCP/actions/workflows/ci.yml)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TwinCAT](https://img.shields.io/badge/TwinCAT-3%20%2F%20TE1000-orange)](https://www.beckhoff.com/twincat)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

`te1000-mcp` exposes the TwinCAT XAE engineering surface — the System Manager tree,
PLC project authoring, IO/EtherCAT configuration, variable linking, builds, and
runtime deployment — as a compact set of MCP tools. It talks to a **running XAE Shell**
through the TE1000 Automation Interface (COM/DTE), so an agent can configure and build
a TwinCAT project the same way an engineer would in the GUI.

A Node MCP front (`index.js`) owns the MCP protocol, tool schemas, and confirmation
guards; the COM/DTE work runs in a **persistent native C#/.NET daemon**
(`Te1000Daemon.exe`) that the front talks to over a Windows named pipe. The daemon is
the sole backend. See [How it works](#how-it-works).

> [!IMPORTANT]
> This server drives a **real engineering tool** and can activate or download to a
> **TwinCAT runtime**. Every action that touches the target runtime (activate, restart,
> download, deletes, licensing) is **confirmation-gated** and off by default.
> See [Safety & guards](#safety--guards).

---

## Contents

- [Highlights](#highlights)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install](#install)
- [Build the daemon](#build-the-daemon)
- [Configure your MCP client](#configure-your-mcp-client)
- [Environment variables](#environment-variables)
- [Quickstart](#quickstart)
- [Tool reference](#tool-reference)
- [Safety & guards](#safety--guards)
- [Reliability: dialog watchdog & PLC session control](#reliability-dialog-watchdog--plc-session-control)
- [Troubleshooting](#troubleshooting)
- [Examples](#examples)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Highlights

- **25 noun-grouped tools** covering the automatable TE1000 surface — tree, IO/EtherCAT,
  linking, PLC project & POU authoring, libraries, tasks, mapping, routes, fieldbuses,
  TcCOM, C++, measurement/scope, licensing, and variants.
- **Batch-first** — every multi-item operation has a `*_batch` form that runs N operations
  in **one** DTE attach and returns a compact continue-on-error roll-up, instead of paying
  a process spawn + attach per call.
- **Native EtherCAT builder** — `tc_ethercat` creates fully-populated EtherCAT boxes
  (correct identity, SyncManagers, FMMUs, PDOs) for any device class by the GUI's own
  "Add Box" route, driven from the device's ESI.
- **Surgical PLC code edits** — `plc_pou` reads, greps, and patches declaration/implementation
  text in place and returns only the changed region, keeping agent context small.
- **Safe by default** — destructive and runtime-affecting actions are confirmation-gated; the
  safety project is never written to, by policy.
- **Resilient to GUI modals** — a dialog watchdog detects and (optionally) auto-dismisses
  modal dialogs that would otherwise hang a synchronous COM call forever.
- **Persistent native daemon** — a long-lived C#/.NET daemon holds the COM session and
  caches the project tree and POU source text, so warm `plc_pou search` runs roughly
  **500× faster** than the old per-call spawn model.
- **Speaks both MCP protocol eras** — the stateless **2026-07-28** revision
  (envelope-carrying `server/discover` probe, per-request `_meta` envelopes, `resultType`
  + cache-hint stamping) and the legacy `initialize` handshake (≤ 2025-11-25), on one
  stdio endpoint. The opening message pins the era per connection (MCP SDK v2
  `serveStdio`); a claim-less opening — including a bare `server/discover` — is served
  as legacy traffic per the stdio binding's rules.

## How it works

```
  MCP client (agent)
        │  stdio (JSON-RPC, MCP)
        ▼
  index.js ───────────────► Te1000Daemon.exe ──COM/DTE──► XAE Shell (TE1000)
   (Node 20)  named pipe     (persistent, x64,            running TwinCAT project
   daemonClient.js           net472, STA COM session)
   toolSchemas.js
```

Two cooperating processes:

- **Node MCP front (`index.js`)** — serves MCP/JSON-RPC over stdio through the SDK v2
  `serveStdio` entry (both the stateless 2026-07-28 era and the legacy `initialize`
  handshake), validates input with [zod](https://zod.dev), single-sources every tool's
  input schema from `toolSchemas.js`, enforces the confirmation-token guards, and maps
  each tool `action` onto a fine-grained bridge action name. It routes those actions to
  the daemon over a named pipe (`daemonClient.js`).
- **Native daemon (`daemon/Te1000Daemon.exe`)** — a persistent net472/x64 process that
  acquires the DTE + `ITcSysManager` **once** and keeps them, runs the dialog watchdog on
  an internal thread, caches the System Manager tree and POU source text, and serves the
  front over the pipe. It implements the **same 164 bridge actions** and returns the
  **same JSON**, so the tool surface is unchanged.

### Pipe protocol

The front and daemon exchange **newline-delimited JSON** over `\\.\pipe\te1000-mcp`
(name overridable via `TE1000_DAEMON_PIPE`):

```
  request:   {"id": "<n>", "action": "<bridge_action>", "payload": { … }}
  response:  {"id": "<n>", "ok": true,  "result": { … }}
           | {"id": "<n>", "ok": false, "error": "…", "errorKind": "com_error|dialog_blocked|timeout", "dialog": { … }}
```

Responses are correlated by `id`. The daemon serializes every COM call through a single
**STA worker thread**, so concurrent pipe clients are safe (XAE serializes anyway). The
daemon also answers two COM-free meta actions used for health checks: `ping` and
`list_actions`.

### Why a daemon — the performance win

An earlier model spawned a fresh 32-bit `powershell.exe` bridge (plus a second watcher
process) on **every** call. Each spawn re-acquired the DTE/`ITcSysManager` COM handles
(a Running-Object-Table walk + `Marshal.GetActiveObject`), JIT-compiled the inline
`Add-Type` Win32 helpers, and — for `plc_pou.find`/`search` — re-walked the entire
project tree from the root (`O(tree-size)`, ~2,900 COM round-trips on a full project),
so latency grew with project size.

The persistent daemon removes all of that from the hot path:

- **Persistent COM session** (`ComSession.cs`) — the DTE + sysmanager are acquired once,
  health-checked with a cheap property read, and transparently reconnected if stale.
- **Two-layer tree cache** (`TreeCache.cs`) — per-object decl/impl source text **and** a
  flat enumeration of the project's code objects are memoized, so a warm full-project
  search does *zero* COM tree-walk. This is the **~500×** warm-`search` speed-up.
- **Edit watcher** (`EditWatcher.cs`) — an on-demand `DTE.Documents`/`.Saved` dirty check
  plus a `FileSystemWatcher` over the project directory invalidate the cache so it never
  serves stale source for an object you are editing in the IDE (or that changed on disk).
- **Internal dialog watcher** (`DialogWatcher.cs`) — runs on its own thread, so there is
  no per-call watcher process. See [Reliability](#reliability-dialog-watchdog--plc-session-control).

Build the daemon with `daemon/build.ps1` (in-box .NET Framework MSBuild — no SDK/NuGet).
The daemon requires the **64-bit** TcXaeShell (DTE.17.0).
See **[docs/architecture.md](docs/architecture.md)** for the end-to-end design and
**[docs/csharp-daemon-validation.md](docs/csharp-daemon-validation.md)** for the
build/cut-over/validation guide.

## Requirements

| | |
|---|---|
| **OS** | Windows |
| **TwinCAT** | TwinCAT 3 XAE Shell / XAE installed, with the TE1000 Automation Interface |
| **Node.js** | 20 or newer (the MCP front; the daemon does not remove the Node dependency) |
| **A running XAE Shell** | the server attaches to an already-open instance (it does not launch XAE) |
| **Daemon (required backend)** | the **64-bit** TcXaeShell, a .NET Framework 4.x install (for the in-box MSBuild + net472 runtime), and `TCatSysManagerLib.dll` (ships with TwinCAT) |

The XAE ProgID defaults to `TcXaeShell.DTE.17.0`. Override it with the `TE1000_PROGID`
environment variable if your installation differs.

The daemon is **not** auto-built — build it once with `daemon/build.ps1` (see
[Build the daemon](#build-the-daemon)); thereafter the MCP front auto-spawns the prebuilt
`Te1000Daemon.exe` on first use. If the exe is absent, build it before the front can serve
calls.

## Install

```powershell
git clone https://github.com/Edge-JB/TwinCAT-XAE-MCP.git
cd TwinCAT-XAE-MCP
npm install
```

Verify the server starts:

```powershell
node index.js
# -> te1000-mcp server running on stdio (native daemon mode; MCP 2026-07-28 stateless + legacy initialize)   (Ctrl-C to exit)
```

The server communicates over stdio and is normally launched **by an MCP client**, not by
hand. Running it directly just waits for a client on stdin.

## Build the daemon

The native daemon is the backend, which you build **once**:

```powershell
powershell -ExecutionPolicy Bypass -File daemon\build.ps1
# -> daemon\bin\Release\Te1000Daemon.exe   (Release, x64, net472)
```

- Uses the **in-box** .NET Framework MSBuild
  (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe`) — **no .NET SDK, no
  NuGet, no internet**. The csproj is old-style (non-SDK) and targets `net472`; the
  produced x64 exe also runs on the net48 runtime.
- References `TCatSysManagerLib.dll` (embedded interop) for the handful of vtable-only
  `IUnknown` interfaces that late-bound `dynamic` can't reach (`ITcPlcProject`, etc.).
  `build.ps1` probes the known TwinCAT install paths; if yours differs, edit the
  `<HintPath>` in `daemon/Te1000Daemon.csproj` and rebuild. Pass `-Debug` for a Debug build.
- After building, the MCP front **auto-spawns** the exe (detached, `windowsHide`) on the
  first call and connects to its pipe. The daemon is **single-instance per pipe name**
  (named mutex), so duplicate spawns are harmless, and it is **detached** so it survives an
  MCP-front restart. Verify it independently with no XAE attached:

  ```powershell
  node daemon\test-ping.js     # spawns the daemon on a test pipe, round-trips ping
  ```

> [!NOTE]
> The running daemon **locks** `Te1000Daemon.exe`. To rebuild after a code change, stop any
> running instance first: `Get-Process Te1000Daemon | Stop-Process`.

## Configure your MCP client

Point your client at the absolute path of `index.js` in your clone. Example
(Claude Desktop / Claude Code / any MCP client that reads this shape):

```jsonc
{
  "mcpServers": {
    "te1000": {
      "command": "node",
      "args": ["C:\\path\\to\\TwinCAT-XAE-MCP\\index.js"]
    }
  }
}
```

A ready-to-edit copy lives at [`examples/mcp-config.json`](examples/mcp-config.json).

### Environment variables

All optional. The first group is read by the Node front (`index.js` / `daemonClient.js`);
the second by the native daemon process. Defaults are from the source.

**Read by the Node front:**

| Variable | Default | Purpose |
|---|---|---|
| `TE1000_PROGID` | `TcXaeShell.DTE.17.0` | XAE Shell COM ProgID to attach to (passed through to the daemon as `progId`). |
| `TE1000_DAEMON_PIPE` | `te1000-mcp` | Named-pipe name. The front and the daemon it spawns share this, so a custom value applies to both. |
| `TE1000_DAEMON_CONNECT_MS` | `20000` | How long the client waits to connect to (and, if needed, spawn) the daemon before failing the request. |
| `TE1000_DAEMON_REQUEST_MS` | `1900000` | Node-side per-request ceiling: if no matching response arrives, the request is failed. Set comfortably above the daemon's own ~180 s ceiling so it never pre-empts a legitimately long call. `0` disables it. |
| `TE1000_DIALOG_WATCH` | on | `0` disables the daemon's internal modal-dialog watchdog. |
| `TE1000_DIALOG_AUTODISMISS` | on | `0` = detect + report dialogs only, never auto-click an allowlisted one. |
| `TE1000_DIALOG_GRACE_MS` | `4000` | How long a blocking dialog must persist before the daemon recycles its COM worker. |

**Read by the daemon:**

| Variable | Default | Purpose |
|---|---|---|
| `TE1000_MCP_SOLUTION_PATH` | unset | When multiple XAE instances are running, prefer the one whose open solution's full path matches this (otherwise the daemon prefers any instance with an open solution). |
| `TE1000_DAEMON_DEBUG` | unset | `1` enables a diagnostic log at `%TEMP%\te1000-daemon-<pipe>.log`. |
| `TE1000_DAEMON_LOG` | unset | Explicit path for the daemon diagnostic log (implies logging on, overrides the default location). |

> The daemon also accepts CLI flags (`--pipe`, `--no-watch`, `--no-autodismiss`,
> `--grace-ms`, `--allowlist`). The front sets these from the dialog-watch env vars above
> when it spawns the daemon — you normally don't pass them by hand.
>
> **Caveat — spawn-time only.** `TE1000_DIALOG_WATCH`, `TE1000_DIALOG_AUTODISMISS`, and
> `TE1000_DIALOG_GRACE_MS` are read by the Node front **only when it spawns the daemon**, and
> are translated into the daemon's `--no-watch` / `--no-autodismiss` / `--grace-ms` flags.
> The daemon is single-instance per pipe, so changing one of these has **no effect on an
> already-running daemon** — kill that daemon process and let the front re-spawn it before the
> new value takes effect.

## Quickstart

With XAE Shell open on your solution, an agent can drive a full configure → build loop.
A typical session (tool name + arguments shown):

```text
# 1. Confirm the server is attached and a solution is open
xae            action: "status"

# 2. Inspect the IO tree
tc_tree        action: "children"  path: "TIID^Device 2 (EtherCAT)"

# 3. Add a populated EtherCAT rack from its ESI (digital in/out + analog)
tc_ethercat    racks: [{
                 parent: "TIID^Device 2 (EtherCAT)^R01.Main.N01 (EK1200)",
                 modules: [{ type: "EL1008" }, { type: "EL2008" }, { type: "EL3064" }]
               }]
               save: true

# 4. Link a PLC input to a terminal channel
tc_link        action: "link"
               a: "TIPC^MyPlc^MyPlc Instance^PlcTask Inputs^MAIN.bStart"
               b: "TIID^Device 2 (EtherCAT)^Term 1^Channel 1^Input"

# 5. Build the solution
xae_build      action: "build"

# 6. (Optional, guarded) download to the target runtime
plc_download   confirm: "ALLOW_PLC_DOWNLOAD"
```

More end-to-end recipes — bulk linking, parameter edits via `set_xml`, POU authoring —
are in [`examples/`](examples/).

## Tool reference

Paths into the System Manager tree use `^` separators, e.g.
`TIID^Device 2 (EtherCAT)^Box 1^Term 5^Channel 1`. The leading token is the tree root
(`TIPC` = PLC, `TIID` = IO, `TINC` = NC, `TIRC` = realtime/license, …).

### Engineering & build

| Tool | Purpose | Key actions |
|---|---|---|
| `xae` | XAE shell & solution control | `status`, `open_solution`, `save_all`, `active_document`, `selected_items`, `error_list`, `clear_error_list`, `list_commands` |
| `xae_build` | Compile the active configuration | `clean`, `build`, `rebuild` |
| `xae_command` | Run a raw DTE command 🔒 | any command name (guarded) |

### System Manager tree, IO & linking

| Tool | Purpose | Key actions |
|---|---|---|
| `tc_tree` | Read/write any tree item (identity, XML params, rename, create, delete) | `get`, `children`, `exists`, `get_xml`, `set_xml`, `rename`, `create`, `delete`, `import`, `export`, `focus` — each with a `*_batch` form |
| `tc_ethercat` | Build fully-populated EtherCAT boxes from their ESI | `racks: [{ parent, modules: [{ type, name?, revision? }] }]` |
| `tc_link` | Link/unlink variables; verify existing links | `link`, `unlink`, `resolve`, `links`, `link_batch`, `unlink_batch` |
| `tc_system` | Target & rescan helpers | `get_netid`, `set_netid`, `errors`, `rescan_plc`, `scan_io_boxes` |
| `tc_mapping` | Bulk variable mapping | `produce`, `consume`, `clear` |
| `nc` | NC motion tree | `tasks`, `axes`, `axis` |

### PLC project & code

| Tool | Purpose | Key actions |
|---|---|---|
| `plc_project` | PLC project lifecycle | `create_from_template`, `open`, `info`, `set_boot_flags`, `generate_boot_project` 🔒, `online` 🔒, `plcopen_export`, `plcopen_import`, `save_as_library` |
| `plc_pou` | Author + surgically edit POUs/DUTs/GVLs (offline) | author (`create`, `import_template`), read (`get_decl`, `get_impl`, `outline`, `get_graphical`), surgical (`replace`, `replace_lines`, `insert`, `append`), discover (`tree`, `find`, `search`), lifecycle (`rename`, `move`, `delete` 🔒) |
| `plc_library` | Library refs / placeholders / repos | `list`, `scan`, `add_library`, `add_placeholder`, `set_resolution`, `freeze`, `remove_reference`, `install_library` 🔒, … |
| `plc_download` | Deploy the active PLC project 🔒 | boot-project (default) or legacy command route |
| `plc_session` | Online-session control via UI Automation | `status`, `logout` 🔒 |

### Realtime, fieldbus & platform

| Tool | Purpose | Key actions |
|---|---|---|
| `tc_task` | RT tasks / cores / linked tasks | `list`, `get`, `create`, `set_params`, `add_image_var`, `get/set_rt_settings`, `bind_cpu`, `get/set_linked_task` |
| `tc_route` | ADS routes | `list`, `broadcast_search`, `search_host`, `add_route` 🔒, `add_project_route` 🔒 |
| `tc_settings` | Engineering settings & archives | `get/set_silent_mode`, `get/set_target_platform`, `save_solution_archive`, `save_plc_archive`, `get/set_independent_file`, `get/set_disabled` |
| `tc_fieldbus` | Non-EtherCAT fieldbuses (PROFINET/PROFIBUS/CANopen/DeviceNet/EAP) | `create_device`, `create_gsd_box`, `add_netvar`, `set_station_address`, `import_dbc`, `get/set_xml` |
| `tc_module` | TcCOM module objects | `list`, `create`, `get/set_xml`, `enable_symbols`, `set_context` 🔒 |
| `tc_cpp` | TwinCAT C++ projects/modules | `create_project`, `create_module`, `tmc_codegen`, `set_props`, `build`, `publish` 🔒 |
| `tc_measurement` | Scope + Analytics (TIAN) | `scope_create`, `scope_record` 🔒, `analytics_create`, `logger_create`, `stream_create`, … |
| `tc_license` | TwinCAT licensing | `list`, `add`, `activate_response` 🔒 |
| `tc_variant` | Project variant management | `get_config`, `get_current`, `set_config`, `select`, `enable`, `disable` |

### Runtime (guarded)

| Tool | Purpose |
|---|---|
| `twincat_activate_configuration` 🔒 | Activate the configuration on the target |
| `twincat_restart_runtime` 🔒 | Start/restart the TwinCAT runtime |

🔒 = confirmation-gated. See [Safety & guards](#safety--guards). Full action signatures,
batch semantics, and return shapes are documented in **[docs/tools.md](docs/tools.md)**.

## Safety & guards

The server **never auto-activates, auto-restarts, or auto-deploys**. Any action that
changes the target runtime, deletes a node, or alters licensing is blocked unless you pass
the matching `confirm` token:

| Confirm token | Unlocks |
|---|---|
| `ALLOW_TWINCAT_ACTIVATE` | `twincat_activate_configuration` |
| `ALLOW_TWINCAT_RESTART` | `twincat_restart_runtime` |
| `ALLOW_PLC_DOWNLOAD` | `plc_download`, `plc_project` boot/online |
| `ALLOW_XAE_COMMAND_EXEC` | `xae_command` |
| `ALLOW_PLC_LOGOUT` | `plc_session logout` |
| `ALLOW_TWINCAT_DELETE` | node/object deletes (or use `dryRun: true` to preview) |
| `ALLOW_PLC_LIBRARY_REPO` | machine-wide library repository administration |
| `ALLOW_TWINCAT_ROUTE_WRITE` | ADS route writes |
| `ALLOW_TWINCAT_MODULE_CONTEXT` | TcCOM context changes |
| `ALLOW_CPP_PUBLISH` | C++ driver publish |
| `ALLOW_MEASUREMENT_RECORD` | live scope acquisition |
| `ALLOW_LICENSE_ACTIVATE` | license activation |

**Safety project policy.** Nothing in this toolchain writes toward the TwinSAFE safety
project. Every authoring tool refuses safety-rooted (`TISC`) paths via an internal guard.
Safety remains read-only/diagnostic.

## Reliability: dialog watchdog & PLC session control

A synchronous DTE/COM call blocks inside XAE's modal message loop if XAE raises a modal
dialog (save-changes, "file changed externally", activate confirm, license prompt) — which
would hang the MCP call and the calling agent indefinitely.

- **Dialog watchdog.** This runs as an **internal thread** of the daemon
  (`DialogWatcher.cs`) that polls (~750 ms) for an application-modal dialog owned by the XAE
  process. It detects application-modal dialogs owned by XAE and either
  **auto-dismisses** them (if they match a rule in `dialog-allowlist.json`) or **reports** the
  dialog's title, body, and buttons back to the agent and abandons the call. If a
  non-allowlisted modal persists past `TE1000_DIALOG_GRACE_MS`, the daemon recycles its COM
  worker thread (re-acquiring the session on a fresh STA thread) **without** killing the
  daemon, so subsequent calls recover once the dialog is cleared. Detection is dialog-driven,
  not a wall-clock timeout, so long legitimate builds are never killed. The allowlist ships
  **empty** (report-only by default) and must never auto-answer Activate / Run-mode / restart /
  download / safety prompts.
- **Interactive resolution.** When a dialog is *not* in the allowlist, the reported error tells
  the agent to **ask the user** which button to press (and whether to remember it), then call
  **`xae dialog_resolve {button, remember?}`**. That action clicks the chosen button on the live
  dialog; with `remember:true` it appends an auto-dismiss rule to `dialog-allowlist.json` and
  hot-applies it to the running watcher (no restart). Destructive prompts (activate / run-mode /
  restart / download / boot project / TwinSAFE / safety) are **refused for auto-remember** — the
  one-time chosen click still happens, but no rule is persisted (`rememberRefused` is reported).
  Use `xae dialog_probe` (read-only) to inspect the current dialog first.
- **PLC session control** (`powershell/plc-session.ps1`) uses UI Automation to read and toggle
  the Login/Logout state (the DTE Login/Logout commands are unreachable on the 64-bit shell).
  `plc_download` auto-logs-out first (by default) so deferred source edits compile before the
  boot project is generated. It never logs back in.

Full details: **[docs/operations.md](docs/operations.md)**.

## Troubleshooting

- **`Te1000Daemon.exe not found`** — build it: `daemon\build.ps1`. The front cannot serve
  calls until the daemon is built.
- **Build fails on `TCatSysManagerLib`** — the DLL wasn't found at the probed TwinCAT paths.
  Edit the `<HintPath>` in `daemon/Te1000Daemon.csproj` to your install and rebuild.
- **Rebuild fails with the exe locked** — a daemon is still running. Stop it first:
  `Get-Process Te1000Daemon | Stop-Process`, then rebuild.
- **Daemon won't start / stale behavior** — kill it (above) and let the front re-spawn a fresh
  one on the next call. Enable `TE1000_DAEMON_DEBUG=1` to capture
  `%TEMP%\te1000-daemon-<pipe>.log`.
- **Wrong XAE instance picked** (several open) — set `TE1000_MCP_SOLUTION_PATH` to the
  solution's full path to pin the daemon to that instance.
- **A modal dialog is blocking calls** — clear it on the machine, or add a rule to
  `dialog-allowlist.json` (never for Activate / restart / download / safety prompts). The
  daemon picks up the allowlist on start.

## Examples

The [`examples/`](examples/) directory contains:

- [`mcp-config.json`](examples/mcp-config.json) — a drop-in client configuration.
- [`README.md`](examples/README.md) — copy-pasteable recipes: building an EtherCAT rack,
  bulk-linking IO, editing terminal parameters via `set_xml`, authoring a POU, and a safe
  build → activate → download flow.

## Documentation

| Document | What's in it |
|---|---|
| [docs/architecture.md](docs/architecture.md) | The Node-front + persistent C#/.NET daemon design end to end — pipe protocol, COM session, caching, edit-watching |
| [docs/tools.md](docs/tools.md) | Complete tool & action reference — signatures, batch semantics, return shapes |
| [docs/operations.md](docs/operations.md) | Dialog watchdog, PLC session control, and the safety/guard model in depth |
| [docs/automation-interface.md](docs/automation-interface.md) | Survey of the full TE1000 Automation Interface surface (the menu these tools are carved from) |
| [docs/csharp-daemon-coverage.md](docs/csharp-daemon-coverage.md) | The 164-action port coverage checklist (bridge action → C# handler) |
| [docs/csharp-daemon-validation.md](docs/csharp-daemon-validation.md) | Build, cut-over, and live-XAE smoke-test guide for the daemon |
| [docs/notes.md](docs/notes.md) | Running engineering notes / backlog discovered on real projects |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture,
the daemon build/dev loop, the action-handler contract, and the safety rules every change
must respect. In short:

```powershell
npm run check                                          # node --check index.js — syntax-validate the front
node daemon\test-ping.js                               # daemon process + pipe + JSON round-trip (no XAE)
powershell -ExecutionPolicy Bypass -File daemon\build.ps1   # rebuild the daemon after a C# change
```

## License

[MIT](LICENSE) © Edge Automation.

## Legal & trademarks

This is an **independent, third-party project**. It is **not affiliated with, endorsed by,
sponsored by, or supported by Beckhoff Automation GmbH & Co. KG**.

All product names, logos, and brands are the property of their respective owners:

- **Beckhoff®**, **TwinCAT®**, **TE1000**, and **XAE Shell** are trademarks or registered
  trademarks of **Beckhoff Automation GmbH & Co. KG**.
- **EtherCAT®** is a registered trademark and patented technology, licensed by
  **Beckhoff Automation GmbH, Germany**.

These names are used for identification and descriptive purposes only; their use does not
imply any affiliation with or endorsement by the trademark holders.

This project does **not** include, bundle, or redistribute any Beckhoff software. It automates
a separately installed and licensed TwinCAT 3 / TE1000 environment that you must obtain from
Beckhoff yourself. **You are responsible** for complying with all applicable Beckhoff license
terms and for any action this tool performs against your engineering or runtime systems.

The software is provided **"AS IS"**, without warranty of any kind, under the [MIT License](LICENSE).
See [NOTICE](NOTICE) for the full attributions.
