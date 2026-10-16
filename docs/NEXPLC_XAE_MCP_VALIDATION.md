# NexPlc XAE MCP 本机适配与验证报告

日期：2026-10-16（Asia/Shanghai）。

结论：本机离线开发所需的受限 MCP 链路已验证并注册。Codex 可以通过 stdio →
Node → Named Pipe → 持久化 C# STA → XAE 读取正式 NexPlc；ST FB 的创建、修改、
保存、重新加载及离线编译在独立 Worktree 中通过。正式工程的 PLC 源码和工程文件
未修改，写入仍被服务端禁用。原 PowerShell Bridge 按用户要求停止使用。

**需要保留的限制：** 仅验证了 ST FB 写入。Method/DUT/GVL 创建和修改尚未验收，
服务端拒绝这些创建类型和非 FB 写入，不可改用 XML。测试也发现 XAE 的 SaveAll
会保存额外 `.tsproj` 元数据，包括移除测试工程的 TargetNetId；详见后文。

## 1. 仓库及环境

| 项目 | 实测值 |
|---|---|
| Fork | `https://github.com/autokraft-tech/TwinCAT-XAE-MCP` |
| MCP 本地目录 | `D:\Will\Documents\source\repos\TwinCAT-XAE-MCP` |
| 基线提交 | `30d8e2938eeed1c41ee24765b469d13430ab0a32` |
| 适配分支 | `codex/nexplc-xae64-validation`；未提交、推送或创建 PR |
| Node / npm | 24.15.0 / 11.12.1 |
| .NET Framework | 4.8.09221，Release 533509 |
| MSBuild | Windows Framework64 `v4.0.30319\MSBuild.exe` |
| .NET SDK | 8.0.425、9.0.312；Daemon 构建不依赖 SDK |
| Daemon | .NET Framework 4.7.2 target、x64、C# 5 |
| XAE ProgID / DTE Version | `TcXaeShell.DTE.17.0` / `17.0` |
| 工程 XAE 版本 | `3.1.4026.20`，通过 `TcRemoteManager.Version` 选择 |
| interop DLL | `C:\Program Files (x86)\Beckhoff\TwinCAT\Functions\TF3500-Analytics-Logger\SystemManagerExtension\TCatSysManagerLib.dll` |
| 实际使用的 Codex CLI | 桌面版自带 `0.163.0-alpha.10.2` |

正式 Solution：
`D:\Will\Documents\source\repos\NexPlc\MySPT_Machine\MySPT_Machine.sln`。
System Manager：`MySPT_Machine`；PLC：`MainPLC`；IEC 工程：`MainPLC项目`。

开始验证时正式仓库已存在 Valve Config、Status、FB 和 `.tsproj` 的用户改动，以及
未跟踪的 `docs/`。未覆盖这些改动。验证前后比较了正式仓库全部 **65 个跟踪文件**
的 SHA-256，变化数 **0**。另外新增了仓库根目录 `AGENTS.md`，它不是 PLC 工程文件。

## 2. 上游审查结论与本机问题

审查内容包括 README、`docs/architecture.md`、`docs/csharp-daemon-validation.md`，
以及 `index.js`、`toolSchemas.js`、`daemonClient.js` 和 Daemon 的入口、分发、管道、
会话、STA worker、OLE filter、对话框、缓存、工程解析、PLC/tree/build 核心实现。

- 原设计已经是持久化 Daemon，不需要重建为逐次启动 PowerShell 的架构。
- 上游有 164 个动作；大部分远超本次离线源码开发范围。确认字符串主要在 Node
  前端检查，直接访问管道可以绕过这些前端检查，不能作为工业操作的安全边界。
- 原 Solution 环境变量只是 ROT 选择偏好；找不到匹配项时会回退到其他实例。
- 原模式缓存不明确区分创建实例的所有权，缺少创建后持续打开指定工程的本机工作流。
- 原 worker 超时后遗弃旧 STA 并启动新 STA；未完成的旧调用可能继续运行，因此存在
  重复实例、并发旧调用和结果未知时重试的风险。
- 原 Node 客户端在管道断线后自动重放请求；对创建/写入操作不安全。
- 原对话框配置默认允许自动关闭，且 watcher 扫描所有 XAE 进程。
- 原 build.ps1 找到 DLL 后并没有把选中的路径传给项目；本机已装 TF3500 目录未被探测。
  原构建虽然成功，仍输出了误导性的 interop 未找到警告。
- PATH 中 CLI 0.125.0 无法解析本机已有的 `service_tier="default"`。改用桌面自带
  CLI 注册，没有更改用户模型、服务等级或其他 MCP 设置。配置解析比较证明，除
  新增 `nexplc_xae` 外，其余原有配置保持一致。

首次按上游 ROT/active 逻辑实测：返回 **0x800401E3 / MK_E_UNAVAILABLE**。
后来 Daemon 自己创建并持有的 XAE 可以通过 ROT、PID/启动时间和所有权租约精确恢复；
这不意味着任意手工打开的 XAE 都能通过 GetActiveObject 附加。

## 3. 代码适配

| 文件 | 改动与理由 |
|---|---|
| `daemon/OfflinePolicy.cs` | 固定服务端允许列表；精确 Solution、写入 Solution、PLC 路径和对象范围校验；拒绝 XML 写入、未验证创建类型和请求覆盖会话模式 |
| `daemon/ComSession.cs` | `createOnce`；持有 DTE/System Manager；固定 XAE 版本；精确 `.sln`/`.tsproj` 校验；PID/启动时间、租约和单工程 mutex；初始化失败锁止；平衡释放 ROT/COM 引用 |
| `daemon/ComWorker.cs` | 单 STA 串行处理；超时/对话框后拒绝后续操作；不再创建第二个 STA；在拥有 COM 的线程释放资源 |
| `daemon/Dispatcher.cs` | 从实际动作表移除禁止动作；在进入 COM 前强制策略；禁用交互式对话框处理和无关的后台全工程预热 |
| `daemon/DialogWatcher.cs`、`Program.cs` | 禁止自动点击；仅观察当前会话 PID；提供受控的运维停止路径 |
| `daemon/PipeServer.cs` | Named Pipe ACL 仅授权当前 Windows 用户；停止时唤醒监听并释放资源 |
| `daemon/Actions/PlcPouActions.cs` | 新建前权威枚举查重；保留 FB 名称；仅接受 ST FB 修改；不自动删除异常创建结果 |
| `daemon/Actions/XaeActions.cs` | 重开仅针对已拥有的指定工程；编译只使用 PLC `.plcproj` 的 `SolutionBuild.BuildProject` |
| `daemon/Actions/ActionContext.cs` | 使用启动时固定的会话模式 |
| `daemon/ComHelpers.cs` | 修正 RETRYLATER HRESULT；子项读取失败不再伪装成空树 |
| `daemon/build.ps1`、`.csproj` | 探测并实际使用本机 interop 路径；支持显式路径覆盖 |
| `daemonClient.js` | UTF-8 流解码保留中文路径；禁止断线重放；下一次显式调用可重连；前端/Daemon 工程不一致时拒绝 |
| `offlineSchemas.js`、`index.js` | 只公布四组工具及有限动作，严格 Schema；返回明确的 MCP 工具错误 |
| 测试、README、AGENTS、配置示例 | 自动化回归、本机操作说明、未来会话规则 |

后台预热关闭前，显式重载后曾观察到 XAE 进程退出，Daemon 随后创建替代会话并恢复
已保存的代码。不能仅凭日志确定 XAE 退出的根因。当前受限工具面不需要上游的全工程
后台搜索预热，移除该任务后重测：显式重载保持同一 PID，随后编译及额外 20 次读取
也保持同一 PID。未进行长期稳定性压测，不能据此保证任意工程或长时间运行都不会崩溃。

## 4. 自动化测试

| 检查 | 结果 |
|---|---|
| `npm ci --ignore-scripts` | 成功；审计 0 漏洞 |
| `npm run check` / `node --check daemonClient.js` | 通过 |
| `npm test` | 现有 project-resolution 回归通过 |
| `daemon/build.ps1` | Release/x64 构建通过 |
| `node daemon/test-ping.js` | PASS；ping、list_actions、未知动作错误往返；13 个工程动作，列表含 3 个只读元动作 |
| MCP surface 测试 | 仅 4 个工具；6 个危险工具/动作调用被拒绝 |
| Daemon raw-pipe 策略测试 | 159 个禁止动作/非法范围请求被拒绝，未进入 COM |
| 只读策略测试 | 创建、两种代码写入、保存、编译共 5 类操作均在进入 COM 前拒绝 |
| 客户端测试 | 分片中文 UTF-8、断线不重放、显式重连、无响应超时均通过 |
| Worker 测试 | 20 个任务复用同一 STA；模拟阻塞超时后不执行新任务、不重放旧任务 |
| `git diff --check` | MCP 仓库和隔离 PLC Worktree 均通过；仅有 Git 的 LF/CRLF 提示 |

本机离线回归入口：`npm run test:offline`。它需要先构建 Daemon，但不创建 XAE。
实时测试脚本单独运行，不能混入默认 CI 的 COM-free 测试。

正式仓库已有的用户 diff 在 `FB_Valve.TcPOU:32` 存在 trailing whitespace。
这是验证前已有且哈希未变的内容，未清理或改写；上表的 diff 检查结果针对本次 MCP
改动和隔离 PLC Worktree。

## 5. 工程树和持久会话

工程根 `TIPC^MainPLC^MainPLC项目` 返回 8 项：References、01_DUTs、02_ITFs、
03_POUs、04_GVLs、VISUs、PlcTask、MainPLC.tmc。02_ITFs 在当前工程中为空。

| 遍历根 | 节点数（含文件夹及对象子项） |
|---|---:|
| `03_POUs` | 255 |
| `01_DUTs` | 6 |
| `04_GVLs` | 2 |

通过只读解析 `.plcproj` 对照 **48 个源码 Compile 引用**，全部能在返回的工程树中
找到，缺失路径 **0**。读取 DUT `ST_Interlock`、GVL `GVL` 声明通过。

最终连续 20 次交替读取工程树及 `FB_Interlock_PAx` 声明/ST 实现：

- XAE PID：**44152**；Daemon PID：**37868**；错误：**0**。
- 最小延迟 **5.514 ms**，中位数 **16.803 ms**，平均 **33.550 ms**，最大 **337.734 ms**。
- 所有响应的 PID、所有权和打开计数相同；读取的代码逐一与磁盘源码比较一致。
- 本次代码读取特意使用有非空 ST 实现的 FB；FB_Valve 的主实现本来为空，不将其空实现
  当作非空 ST 读取的证据。

最初创建的同一 XAE PID 44152 在 Daemon 41720 中仅打开 Solution 1 次。
之后重启 Daemon，经 44572、15140 到最终 37868，均可恢复该已拥有实例而不重新打开
Solution。响应中的 `solutionOpenCount` 是**当前 Daemon 生命周期内**的计数；恢复后为 0。
MCP 前端重启后的会话比较也通过。

## 6. 隔离写入、GUID、保存及重载

最终 Worktree：`D:\Will\Documents\source\repos\NexPlc-mcp-validation`。
分支：`codex/nexplc-mcp-validation`；基线：`11be33e`，不包含正式工作区的未提交改动。
写入范围仅为 `TIPC^MainPLC^MainPLC项目^03_POUs^FB_MCP_Test`。

实际测试顺序：

1. `xae.status` 确认隔离 Solution。
2. `plc_pou.create`：`parent=...^03_POUs`，`name=FB_MCP_Test`，`subType=604`，`language=1`。
3. `xae.save_all`，只读检查 XAE 生成的 TcPOU 与 Compile 引用。
4. `get_decl` / `get_impl` 导出；确认实现语言为 1。
5. 重复创建、修改 FB 名称、对 MAIN 越界写入均被拒绝。
6. 用 `set_decl` 添加 BOOL/DINT 输入输出，用 `set_impl` 写入使能和 `nValue + 42` 逻辑。
7. 保存后显式重开同一路径；代码逐字比较通过（只规范化换行）。
8. 读取 GUID、文件哈希和唯一 Compile 引用；之后离线编译。

XAE 生成的 GUID：**`{df1c8738-ca14-4da3-bb13-f2bf3c34429f}`**。
修改、保存、重开后保持不变，项目引用始终只有一条。

- 首次创建文件 SHA-256：`bd6d0dd46c7430d2b8ed3561e9b75084768174b502f88dd2310950ff0fdadb30`。
- 代码修改后 SHA-256：`bb6019ff89325223a88821ea36a22f2d403c6894a5369fff413143215a8fe821`。
- 重新加载后 SHA-256：与修改后完全一致。

关闭后台预热后的最终重载验证：XAE PID **43276**、Daemon PID **41332**；
显式重载前后 XAE PID 不变，打开次数从 1 变为 2。额外 20 次读取测试 FB 均成功，
仍是同一会话，未再打开 Solution。

第一次临时 Worktree 是先前 Bridge 验证使用的目录，用户随后确认已手动删除。
旧路径重新打开失败的记录已保留；没有通过生成工程 XML 绕过失败。此后全部最终写入
验证在上述新 Worktree 中重做。旧原型不再用于后续会话。

## 7. 离线编译和最终 Git Diff

调用：`xae_build {action:"build", waitForFinish:true, timeoutMs:180000}`。
实际路径为隔离副本的 `MainPLC\MainPLC.plcproj`，配置为 `Debug|TwinCAT RT (x64)`。

- `BuildState = 3`，`LastBuildInfo = 0`；最终编译约 **10.514 s**。
- 错误 **0**，警告 **1**。
- 警告 C0196：`FB_NextAvailablePackMLCommands.GetCommands(1)`，SPT Base Types 4.0.3，
  从 UDINT 隐式转换为 DINT 可能改变符号。未修改该第三方库。
- Error List 共 20 项，其他为生成代码、内存使用、库重新加载等信息。
  “Ready for download” 是编译器信息，不表示执行过 Download。

离线编译后工程处于未保存状态，运维 shutdown 正确拒绝关闭。随后仅在隔离副本显式
SaveAll，再次 shutdown 成功关闭自己的 XAE 与测试 Daemon。

最终隔离 Worktree 的改动：

- 新增 `03_POUs/FB_MCP_Test.TcPOU`，完全由 XAE 创建/写入。
- `.plcproj` 增加 3 行：测试 FB 的唯一 Compile 引用。
- `.tsproj` 有 2 行元数据替换：XAE 保存时移除了原 `TargetNetId` 属性，并更新了
  编译后的 `TmcHash`。工程/PLC GUID 未变，未调用 SetTargetNetId、ADS 或运行控制 API。

**保存副作用是真实风险。** 不能假设 SaveAll 只保存所编辑的 POU。今后生产写入必须
先检查目标配置和完整 diff；此次保留正式会话只读，不将测试 `.tsproj` 改动合并回正式
工程，也不手工修补 XML。恢复/回滚应在关闭隔离会话后由用户保留或丢弃测试 Worktree。

## 8. 安全边界和生命周期

MCP 只公开四个工具的有限动作；Daemon 只注册 13 个工程动作。危险功能既不出现在
Codex 工具面，也不能用确认字符串或直接 Named Pipe 请求启用。XML 写接口和任意 DTE
命令执行均禁用。内部固定使用 File.SaveAll 保存、View.ErrorList 查询诊断，这些不是
可由调用者指定的任意命令。

写入需同时匹配启动时固定的 Solution 和对象路径。已注册正式会话清空写入配置，
即使 Codex 调用可见的写入动作，服务端也会拒绝。SPT V4 框架/库不在允许写范围内。

所有 COM 工作由同一 STA 处理。活着但忙碌/拒绝调用的进程不会触发第二次创建。
PID 同时比较进程启动时间，防止 PID 重用。创建前写入 pending 所有权租约，若中途
失败则要求人工处理；不能在无法确认旧实例状态时静默创建第二个 XAE。

对话框仅报告、从不点击。超时或阻塞后 worker 停止接受请求；管道中断不自动重放。
模拟 timeout 回归验证了该行为；未人为向正式 XAE 注入模态对话框。

运维 `daemon_shutdown` 不属于 MCP 工具面：只关闭自己拥有、路径匹配且无未保存内容的
XAE。实测 `active` 附加会话 shutdown 返回 `closedOwnedXae=false`，PID 44152 保留。
在隔离会话中关闭自己的实例后，新的 Daemon 能重新创建单一 XAE、打开同一测试工程，
并读回保存的 `nValue + 42` 代码。未执行 PLC Run/Stop/Reset 等任何运行状态操作。

## 9. Codex 集成

用户配置中已注册 `nexplc_xae`，入口为本仓库 `index.js`，stdio、启动超时 30 秒、
工具超时 240 秒。正式会话管道为 `nexplc-readonly-validation`，`createOnce` 模式，
写入 Solution 和写入对象范围均为空。可复用配置见 `examples/nexplc-codex.toml`。

实际验证包含：

- 两次独立 `codex exec --ephemeral` 进程发现并调用 `nexplc_xae`。第一次读取 status 和
  工程 children；第二次重启后读取 status，仍为 XAE 44152 / Daemon 44572。
- 当前 Codex 桌面聊天已动态发现四组工具，并实际调用 status、children 和
  `FB_Interlock_PAx` 的非空 ST 片段；最终会话为 XAE 44152 / Daemon 37868。
- 这是实际 MCP → Daemon → XAE → PLC 读取，不是仅检查配置文件或模拟返回值。
- 未重启整个桌面 UI；独立 Codex 进程重启和 MCP 前端重启均经过验证。

Codex 注册前的配置备份保留在 `%LOCALAPPDATA%\NexPlcXaeMcp`。
MCP 仓库和 NexPlc 根目录均已写入 `AGENTS.md`；正式 PLC 工程文件未修改。

## 10. 记录、复现和未实现范围

本机完整记录位于被 Git 忽略的 `artifacts/validation/`：

| 记录 | 内容 |
|---|---|
| `rot-status.log` | 原 ROT 附加失败 |
| `readonly-mcp-calls.json`、`readonly-final-summary.log` | 27 次正式只读调用，含连续 20 次复用测量 |
| `tree-project-consistency.json` | 48 个项目源码引用对照，无缺失 |
| `write-mcp-calls.json`、`write-final-stability-summary.log` | 创建、读写、拒绝用例、重载、编译调用 |
| `probe-first-created.json`、`probe-roundtrip.json` | UUID 和文件哈希 |
| `probe-post-reload-20.json` | 重载后额外 20 次同会话读取 |
| `build-diagnostics.json` | 原始错误列表和严重度 |
| `plc-tracked-final.diff`、`probe-final.TcPOU.txt` | XAE 生成的项目 diff 与只读对象快照 |
| `mcp-source-final.diff` | MCP 最终改动及新增文件补丁，未暂存或提交 |
| `lifecycle-*.json`、`test-clean-shutdown.json` | 所有权、停止/重建、未保存拒绝等记录 |
| `codex-integration-1.jsonl`、`codex-integration-2.jsonl` | 两次真实 Codex 进程的 MCP 事件 |
| `desktop-native-tool-calls.json` | 当前聊天的原生 MCP 工具调用 |
| `production-before.json`、`production-integrity.json` | 正式跟踪文件哈希验证 |
| `offline-tests-final.log`、`final-build.log` | 自动化回归和构建日志 |

复现只读验证：按示例环境运行 `node tests/nexplc-readonly.js`。
复现创建验证：新建隔离 Worktree，配置独立 pipe、Solution 和唯一测试 FB 写入范围，
运行 `node tests/nexplc-write.js`；已有 probe 时拒绝覆盖，`--resume` 仅用于有真实创建
记录的本机测试续跑。不要对正式 Solution 运行该写入脚本。

未实现/未验收：Method、DUT、GVL 创建和写入，接口对象写入，非 ST POU，属性/动作等
复杂子对象编辑，批量写入，删除/重命名/移动，生产工程写入授权配置，长时间 soak
测试、完整桌面 UI 重启测试，以及任何在线/运行/下载能力。遇到这些需求应停止报告，
不扩展到 XML 或任意命令执行。

参考：[Codex 官方 MCP 配置](https://developers.openai.com/codex/mcp)、
[Beckhoff 创建 PLC 对象](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/21842468363.html)、
[声明及实现接口](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/21842480395.html)、
[离线编译](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/21842451979.html)、
[Remote Manager](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/2507904267.html)。
