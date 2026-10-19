# NexPlc XAE MCP 第二阶段实施与验收记录

日期：2026-10-19（Asia/Shanghai）。本文件保留 10 月 16 日历史，续验结论见下。

**续验状态：STRUCT、ENUM、GVL 已分别完成独立真实 XAE 全流程验收，开发端可按启动权限启用。
ALIAS 的一次官方文档候选参数验证仍失败，623 保持硬禁用；新旧失败现场均保留锁止。
P3 在 CLI 外预启动专用 Daemon 的部署条件下通过实际 Codex 读写、拒绝和重连验收；
生命周期限制在末尾单列。正式工程和已运行的正式二进制不升级。**

以下 P0/P1/P2 原始记录为 **2026-10-16 历史结果**，其中“未执行/禁用”描述该日期状态；
后续能力仅以 2026-10-19 续验记录为准。

## P0：已通过

分支 `codex/nexplc-xae64-validation`；本地基线提交
`b6e07bd8fc83fc0c5d36335ac93ea8e3baee6cca`：
`feat: establish validated persistent TwinCAT XAE MCP baseline`。
33 个现有改动文件与第一阶段 `source-manifest.json` 的 SHA-256 完全一致；无缺失、
无额外未记录修改。未包含 artifacts、日志、构建输出、密钥或 NexPlc 正式工程修改。

`npm run check`、`npm test`、`npm run test:offline`、C# Release/x64 构建、
`node daemon/test-ping.js`、`git diff --check` 全部通过。原有测试涵盖 159 个
raw-pipe 拒绝请求、5 类只读写入拒绝、客户端 UTF-8/不重放/重连/超时，以及单 STA 复用。
解析比较 Codex 注册前备份与当前配置，移除新增 `nexplc_xae` 后完全相同。
未 push、merge 或创建 PR。后续开发代码不提交。

## P1：正常保存流程与安全回归已通过

已实现四个审计工具、固定保存入口审计、对象操作后检查点、前后文件哈希/完整差异、
元数据分类、持久化锁止和隔离恢复工作流。见 `XAE_SAVE_SAFETY.md`。

### 自动化模拟

P1 通过时新增 40 项保存审计检查通过；最终包含 Method/DUT 文件夹模拟共 43 项。
原有安全回归仍通过，正式只读拒绝增加为 6 类，最终 raw-pipe 拒绝测试为 166 项。
关键元数据异常、并发磁盘修改、COM 失败和重启锁止使用独立临时文件夹模拟，
未向真实工程注入 TargetNetId、AMS、EtherCAT 或 Runtime 配置变化。

### 真实 XAE

最终测试 Worktree：`D:\Will\Documents\source\repos\NexPlc-mcp-phase2-final`，
基线 `11be33e3e37bc0076fc62069571252dee4349dfe`。
独立管道 `nexplc-phase2-save-safety-c`；测试对象仅
`TIPC^MainPLC^MainPLC项目^03_POUs^FB_MCP_Phase2_Save`。

- XAE PID `38500`、Daemon PID `28824`。两次显式重载前后保持同一 XAE，
  Solution 打开计数从 1 增加至 3，没有逐次启动 XAE。
- 创建、声明/ST 修改、保存、重载、再次修改和重载通过。
- GUID `{fef91087-b6f8-424e-b995-af060affca83}` 保持不变；Compile 引用始终一条。
- 离线编译 `buildState=3`、`lastBuildInfo=0`；0 错误、1 条既有 SPT C0196 警告。
- 创建保存新增唯一 Compile 引用；再次代码保存只改测试 POU。
- 编译后保存仅更新 `.tsproj` 的 TmcHash：
  `{43FD8352-F9E3-A36E-7595-B7ACA9A3F5AC}` → `{D67265DF-0BB8-CCE4-12EB-2665ED20DAD3}`。
  本次 TargetNetId、工程/PLC GUID、目标/Task 配置未变化。
- 正式工程 65 个跟踪文件哈希比较，变化数 0；用户既有 Valve、tsproj 修改保留。

前两次测试各自在独立副本中触发审计误报，均阻断后续写入，副本和 journal 保留：
`NexPlc-mcp-phase2` 发现 CreateChild 在 SaveAll 前立即生成 TcPOU；
`NexPlc-mcp-phase2-save` 发现删除预期 Compile 节点后的缩进空白影响 XML 比较。
分别增加对象操作后检查点和忽略格式空白的比较，均补充模拟回归，再使用全新副本验证。
这两次误报不能作为真实危险元数据注入的验证证据，未清锁重试旧对象。

### P1 边界

未验证 Project.Save/ProjectItem.Save 的 TwinCAT 保存语义，继续固定使用 SaveAll。
恢复采用保留旧副本、另建干净 Worktree 的流程，不提供自动原地回滚。
未验证长期并发 GUI 编辑、崩溃时的所有边界或超时后晚返回的写入。
报告与模拟通过不意味着真正的文件事务、在线安全认证或可用于正式写入。

## P2.1：Method 已通过真实验收

Worktree `D:\Will\Documents\source\repos\NexPlc-mcp-phase2-method`，
pipe `nexplc-phase2-method`，XAE PID `6352`，Daemon PID `43496`。
使用 `CreateChild(name,609,"",new object[]{1,"DINT","PUBLIC"})` 创建直接属于
`FB_MCP_MethodProbe` 的 `M_Test`，未生成/编辑工程 XML。

- 创建、枚举、读取声明和非空 ST 通过；名称、DINT 返回类型、VAR_INPUT、
  VAR_OUTPUT 和 VAR_IN_OUT 均经过真实代码保存及编译验证。
- 内容哈希前置检查、旧哈希拒绝、错误父项拒绝、重名拒绝通过。
- 声明/实现保存、两次重载、再次修改、唯一 Compile 引用检查通过。
- FB GUID `{e21cde3c-724c-4df7-9b80-9f2e30567614}`，
  Method GUID `{62d1afd3-de5d-457d-9709-9201b89c3bf4}` 保持稳定。
- 同一 XAE PID，Solution 打开计数 1 → 3。离线编译 `lastBuildInfo=0`，
  0 错误、1 条既有 SPT 警告。编译后保存审计通过。
- 正式注册 MCP 另外读取既有 `FB_Valve.Feedback` 的声明和非空实现通过；
  未修改该生产 Method。

实测对象是 FB 直接子 Method，方法文件夹内的 Method 写入未验收并明确拒绝。
最终源码默认只允许 FB；Method 必须由启动配置显式启用 `TE1000_PLC_WRITE_TYPES=604;609`。

## P2.2：DUT 未通过完整验收，已停止

Worktree `D:\Will\Documents\source\repos\NexPlc-mcp-phase2-dut`，
pipe `nexplc-phase2-dut`，XAE PID `46436`，Daemon PID `30940`。
在 Method 验收及差异审查通过后，才使用单独的测试 Daemon 开启 DUT 验证类型。

STRUCT 和 ENUM 各完成创建、读取、声明修改和两次保存；重名、哈希冲突和非法
implementation 写入拒绝通过。STRUCT 验证声明包含 BOOL、DINT、REAL 和 ARRAY 成员。

| 对象 | XAE 生成 GUID | 两次保存比较 | 重载/引用 FB 编译 |
| --- | --- | --- | --- |
| ST_MCP_Probe | `{17d4b16c-c7d0-4fb2-87c8-8748497f22fe}` | GUID 稳定 | 未执行 |
| E_MCP_Probe | `{3a6fcf11-aa30-4f89-a0e7-610113e85abc}` | GUID 稳定 | 未执行 |
| T_MCP_Probe | 未观察到对象/文件 | 创建失败 | 未执行 |

ALIAS 的 `CreateChild(623, vInfo:null)` 返回：
`TwinCAT PLC automation call (ITcSmTreeItem:CreateChild) failed: 未指定基类！参数名: baseClass`。
官方把部分 vInfo 信息列为可选，但此版本的 ALIAS 实际要求未满足；不猜测其他
参数形状、不自动重试，不以 XML 方式补建。

服务端立即记录 `Create outcome requires inspection` 并锁止。
随后只读枚举仅有 Common、E_MCP_Probe、ST_MCP_Probe，磁盘没有 T_MCP_Probe.TcDUT。
这不足以证明失败调用没有任何内部副作用；因此没有继续保存、重载、编译或 GVL 写入。
副本、Daemon/XAE 状态和 journal 保留供检查：

`%LOCALAPPDATA%\NexPlcXaeMcp\save-audits\75409619e46789f96d8fdae23212e47b1655c6d58a1dafbb95e95fb885a8c239\pending.json`。

该副本 Git diff 只有 `.plcproj` 的 6 行预期引用新增及两个未跟踪 TcDUT，`.tsproj` 无变化。
未创建引用这些 DUT 的 FB，未取得 DUT 的重载和离线编译证据。

**最终源码同时在 MCP schema 和 Daemon 类型白名单禁用全部 DUT/GVL 写入**。
即使启动环境列出 605/606/623/615，也不能在最终版本启用；166 项 raw-pipe 回归覆盖此项。
DUT 候选代码和 opt-in 测试保留为开发记录，不表示接口已发布；不能直接重跑失败测试。

## P2.3 / P3：未执行

GVL 创建/修改和 BOOL/DINT/REAL/ARRAY/自定义 DUT 类型声明验证未开始。
没有注册 `nexplc_xae_dev`，没有完成双 Codex MCP 工具发现、独立所有权/互斥冲突、
客户端重启或 Daemon 故障的双环境验收。不能用本次多个隔离测试进程代替 P3 验收。

正式 `nexplc_xae` 配置和二进制保持原状，实际最终状态仍是 XAE `44152` / Daemon `37868`，
精确生产 Solution，read-only，当前 Daemon 打开计数 0（恢复第一阶段的既有拥有实例）。
P1 前三次测试的 Daemon 已通过受控 shutdown 关闭各自拥有且确认已保存的 XAE；
Method/DUT 测试实例保留，未操作用户自行打开的 XAE。

实际正式配置见 `examples/nexplc-codex.toml`；未安装的开发示例见
`examples/nexplc-codex-dev.pending.toml`（`enabled=false`，示例 Dev 路径尚未建立）。
两个 TOML 均已解析检查；用户配置未新增 Dev，也未影响其他 MCP。
标准流程与停止点处理见 `CODEX_XAE_WORKFLOW.md`。

## 最终自动化结果与复现

| 检查 | 最终结果 | 证据类别 |
| --- | --- | --- |
| npm run check / npm test | PASS | 语法及现有 project-resolution 回归 |
| npm run test:offline | PASS | 模拟/无 COM；包括 166 个管道拒绝、6 类只读拒绝、20 个同 STA 任务、43 项审计检查 |
| daemon Release/x64 构建 | PASS，输出 `daemon/bin/Phase2Review` | 本机编译，不替换占用中的正式 Release EXE |
| node daemon/test-ping.js | PASS，17 个工程动作、20 个可发现动作 | 无 XAE 的实际 Daemon/Pipe 往返 |
| git diff --check | PASS | MCP 与已完成 P1/Method 的隔离工程差异检查 |
| P1 / Method opt-in 脚本 | PASS | 真实 MCP → COM → XAE |
| DUT opt-in 脚本 | FAIL/安全停止 | 真实 ALIAS COM 失败，不作为 DUT 验收通过 |
| 正式工程完整性 | 65 个跟踪文件 SHA-256 全部相同 | 真实磁盘比较，包含用户原有未提交改动 |

最终权限收紧和生产/开发工具面区分是在 COM 停止点之后完成，验证为 Release/x64 构建与
无 COM 自动化回归；没有为重测这些收紧操作继续真实工程写入。最终构建不等同于所有
异常/恢复路径均经过真实 XAE 演练。

开发构建与无 COM 回归：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File daemon/build.ps1 -OutputPath "$PWD\daemon\bin\Phase2Review"
$env:TE1000_DAEMON_EXE = "$PWD\daemon\bin\Phase2Review\Te1000Daemon.exe"
npm run check
npm test
npm run test:offline
node daemon/test-ping.js
git diff --check
```

这只是当前 PowerShell 子进程的配置示例，不要设置机器级全局环境。
真实测试必须使用新的隔离 Worktree 和精确 Startup 权限；不得重用停止点副本或重放创建。

## 本地修改文件（P0 基线之后，未提交）

| 文件 | 作用 |
| --- | --- |
| AGENTS.md、README.md | 当前验证能力、保存入口、阶段停止规则 |
| daemon/ProjectSaveAudit.cs | 保存/对象操作/编译审计、哈希、元数据分类、journal |
| daemon/Actions/PlcPouActions.cs | Method 创建/编辑、哈希、父项/类型限制、操作后审计；禁用的 DUT 候选代码 |
| daemon/Actions/XaeActions.cs | 四个审计动作、固定保存与离线编译审计 |
| daemon/ComSession.cs | 审计生命周期、保存前 scope/dirty 检查、重载保存入口 |
| daemon/Dispatcher.cs、daemon/OfflinePolicy.cs | 写入锁止、固定权限与类型白名单、raw-pipe 参数限制 |
| daemon/Te1000Daemon.csproj、daemon/build.ps1 | 编译审计源码、独立构建输出 |
| daemonClient.js、index.js、offlineSchemas.js | 独立开发 EXE、Method 参数、正式/开发工具面 |
| daemon/test-ping.js、daemon/test-worker.ps1、daemon/test-save-audit.ps1 | 对应独立二进制的回归入口 |
| tests/DaemonWorkerTests.cs、tests/daemon-offline-policy.test.js、tests/offline-surface.test.js、tests/run-offline.js | 原有安全回归扩展 |
| tests/ProjectSaveAuditTests.cs | 文件夹模拟保存/异常/GUID/引用/锁止检查 |
| tests/nexplc-save-safety.js、tests/nexplc-method.js、tests/nexplc-dut.js | opt-in 真实验证；DUT 脚本停止于 ALIAS 错误 |
| docs/NEXPLC_XAE_MCP_PHASE2_REPORT.md、docs/XAE_SAVE_SAFETY.md、docs/PLC_OBJECT_API.md、docs/CODEX_XAE_WORKFLOW.md | 四份交付文档 |
| examples/nexplc-codex-dev.pending.toml | 默认禁用、未安装的 Dev 配置示例 |

共 29 个新增/修改文件；精确列表也保存在本地 `artifacts/phase2/final-summary.json`。
唯一新增的开发分支提交仍为 P0 的 `b6e07bd`。没有后续开发提交、push、merge 或 PR。

## 未完成与已知风险

- ALIAS 官方创建参数与失败状态需先核查；DUT 重载、引用 FB 编译及完整类型验收未完成。
- GVL 和 P3 双 MCP 验收全部未完成，Dev MCP 未注册。
- 独立 Project.Save/ProjectItem.Save、GUI 并发、所有崩溃/超时边界和长期稳定性未验证。
- 保存/编译已经写盘后的检查不能提供事务回滚；不手工修补 XML。
- 失败调用即使树/文件中未见新对象，也不能视为可安全重试；停止点仍锁止。
- 新 Daemon 对已保存但未提交的旧 Dev 副本可能拒绝首次写入；不靠清除 journal 绕过。
- 当前不能从 MCP 阻止服务之外的手工 Git/发布；Codex 工作流必须遵守 unsafe/blocked 停止条件。

## 记录

`artifacts/phase2/` 被 Git 忽略，包含真实 MCP 调用、前两次失败记录、Daemon 日志和
正式工程哈希清单。保存 journal/归档位于 `%LOCALAPPDATA%\NexPlcXaeMcp\save-audits`。
不得将含 PLC 源码的本机审计直接公开发布。

## 2026-10-19：P2 独立续验

仍在 `codex/nexplc-xae64-validation`，HEAD 为上述 P0 基线，未提交后续开发。
读取原报告、安全策略、保存审计、对象接口文档后，先只读核查正式服务与 ALIAS 实现。
正式服务仍为 XAE 10208 / Daemon 11172，Solution 打开计数 1。
本轮已完成类型验收后才启动 P3；ALIAS 的失败只停止 ALIAS，不再阻塞其他类型。

### ALIAS 根因与边界

原 builder 生成单个 System.String（反射只读确认），调用点却把 subtype 623 的
vInfo 无条件改为 null，策略也不允许创建时提交声明文本。旧调用没有传入基础类型，
故 `未指定基类 / baseClass` 与实现丢弃声明相符；这不是完整的 4026.20 支持结论。

依据 Beckhoff 官方 subtype 参数表和 CreateChild VARIANT 契约，唯一候选为
`new object[]{"TYPE T_P2Resume : DINT;\nEND_TYPE\n"}`。先验证 CLR 数组形状，
再在全新副本中只尝试一次。4026.20 明确返回 `Object[] is not supported`，
父项类型 601、对象类型 TREEITEMTYPE_PLCDUTALIAS；未尝试其他形状、BSTR、基础类型字符串。
没有自动 GUI 操作。详见 [ALIAS 分析](ALIAS_API_VALIDATION.md) 及官方链接。

`NexPlc-p2-20261019-alias` / pipe `nexplc-p2-20261019-alias`：
XAE **9644** / Daemon **32396**，打开计数 1；读树未见对象、磁盘未见对应文件，
但不据此推断所有内部状态无副作用。现场保持运行/锁止，没有保存、重试或清锁。
新 journal 为 `%LOCALAPPDATA%\NexPlcXaeMcp\save-audits\5eddde938138027f8b638d531def7814ba8f1cd9d986d073e4aaa2cc0919111a\pending.json`。
旧 journal `75409619…` 及旧 `NexPlc-mcp-phase2-dut` 均不复用。
最终 schema 不公开 623，Daemon 即使配置包含 623 也拒绝；builder 模拟通过不表示 API 支持。
后续作为独立问题，需要 Beckhoff 版本契约澄清或人工 GUI/接口对照。

### STRUCT、ENUM、GVL：各自通过

三份全新 Worktree 均来自 NexPlc 提交 `11be33e3e37bc0076fc62069571252dee4349dfe`；
每份单独 pipe、二进制目录、Daemon、XAE、精确写入根与类型权限。
表中路径均位于 `D:\Will\Documents\source\repos`，管道后缀与副本一致。

| 类型 | Worktree | XAE / Daemon PID | Solution 复用 |
| --- | --- | --- | --- |
| STRUCT 606 | NexPlc-p2-20261019-struct | 3284 / 24724 | 同一实例，两次显式重载，1→3 |
| ENUM 605 | NexPlc-p2-20261019-enum | 25900 / 33136 | 同一实例，两次显式重载，1→3 |
| GVL 615 | NexPlc-p2-20261019-gvl | 12040 / 12544 | 同一实例，两次显式重载，1→3 |

全部通过 CreateChild 创建、get_decl 读取、内容哈希约束修改、保存审计、同 Solution
重载、GUID 稳定、声明一致、项目唯一 Compile 引用、创建引用对象的 FB、离线编译。
正式 raw pipe 对相同 subtype 的创建均返回只读拒绝。重复创建、旧哈希、声明对象写实现
也被拒绝。三份最终 buildState=3 / lastBuildInfo=0，**0 错误，1 条既有 SPT C0196 警告**；
没有新增错误。全部保存结果 safe，最后通过 owned-session shutdown 关闭已保存的自有会话；
不是按进程名关闭 XAE。ALIAS 会话未参与关闭。

| 对象 | XAE 生成并在重载后核对的 GUID |
| --- | --- |
| ST_P2Resume（STRUCT） | {e819e77e-d782-48fa-91ec-f8e5eb10a457} |
| FB_P2Resume_struct | {50c0c1f2-1dd5-45c2-8387-d5ce7e878da1} |
| E_P2Resume | {c02700f9-498c-409e-89a1-9fc67e0f43f2} |
| FB_P2Resume_enum | {b2c45069-598d-45ce-b47c-fd4a29f4c668} |
| GVL 的依赖 ST_P2Resume | {357e48a0-53b6-41f9-9d3f-27e750025742} |
| GVL_P2Resume | {a0638176-ff0c-4251-9959-8e1b63f18483} |
| FB_P2Resume_gvl | {4932374d-20e6-46c1-ba6a-7f371daadbe5} |

STRUCT 覆盖 BOOL、DINT、REAL、ARRAY，修改 ARRAY 上界 2→3。
ENUM 修改 McpReady 的值 1→2。GVL 覆盖 BOOL、DINT、REAL、ARRAY 和自定义 STRUCT，
修改 ARRAY 上界 2→3；引用 FB 实际读写这些离线变量并成功编译（未连接 Runtime）。
GVL LinkAlways、对象名称与 GUID 均保留，依赖 STRUCT 的 GUID 也在重载后核对。

### 完整保存差异与证据

本机证据目录为 `artifacts/p2-resume-20261019/`（Git 忽略，含工程源码，不自动发布）。
每个 struct/enum/gvl 有 `*-environment.json`、`*-calls.json`、`*-summary.json`、
`*-daemon.log`、`*-shutdown.json`；alias 有 `alias-calls.json`、`alias-stop.json`。
调用记录包含真实 save audit 的完整前后内容、哈希、风险分类；汇总包含 project_changes。
`*-complete-tracked.diff` 保存相对 HEAD 的完整跟踪工程差异，`*-new-files.json`
保存全部新增文件内容，避免 git diff 漏掉未跟踪的 DUT/GVL/FB。

工程变化仅为各测试对象、唯一 Compile 引用（GVL 带 LinkAlways），以及编译引起的
`.tsproj` TmcHash 从 `{43FD8352-F9E3-A36E-7595-B7ACA9A3F5AC}` 到
`{D67265DF-0BB8-CCE4-12EB-2665ED20DAD3}`。没有工程/PLC GUID、TargetNetId、
Task、Runtime、设备或 SPT 第三方源码变化。保存审计是检测机制，不是事务回滚。

### 新增回归与限制

最终独立 x64 构建、`npm run check`、`npm test`、`npm run test:offline`、
`node daemon/test-ping.js` 通过。raw pipe **167** 项 COM 前拒绝，审计模拟 **45** 项；
客户端 split UTF-8/不重放/重连/超时、单 STA 20 任务复用/超时拒绝后续任务均通过。
新增 GVL 创建/身份/引用及 GUID 异常锁止模拟；新增 ALIAS 候选封送形状检查
（不调用 COM），以及即使配置授权 623 也拒绝的回归。策略测试使用不可能的测试 ProgID，
避免回归意外触及真实 XAE。新 live runner 每类要求全新干净副本，不自动重放失败写入。

尚不支持 ALIAS 写入；非 ST、Method 文件夹中的方法修改、其他 POU/DUT 类型、删除/移动/
改名、任意 DTE 命令、工程 XML/GUID 写入均未开放。既有离线运行边界不变。
未全面验证 GUI 并发编辑、所有持久化边界崩溃、晚返回写入和非标准外链工程。
Daemon 重启后不恢复已知编辑批次，已保存未提交的副本可能拒绝首次后续写入；
不得用清 journal 或强制覆盖绕过。客户端重启复用活着的 Daemon 不受此限制。

## 2026-10-19：P3 双 MCP 部署与实际 Codex 验证

仅追加/配置新的 `mcp_servers.nexplc_xae_dev`。原配置字节完整保留为前缀；
解析移除 Dev 后与原设置完全相同。正式注册、正式二进制和正式 XAE 不变。
完整 Dev 配置在 `examples/nexplc-codex-dev.toml`，旧 pending 示例为历史材料。

| MCP | 固定 Solution 所在 Worktree | Named Pipe | XAE / Daemon |
| --- | --- | --- | --- |
| nexplc_xae | NexPlc | nexplc-readonly-validation | 10208 / 11172 |
| nexplc_xae_dev（最终） | NexPlc-mcp-dev-final | nexplc-dev-20261019-final | 39648 / 40844 |

所有 Worktree 位于 `D:\Will\Documents\source\repos`；Solution 均为其下
`MySPT_Machine\MySPT_Machine.sln`。正式 Write Solution/Roots 为空。
Dev 单独使用 `daemon/bin/NexPlcDev20261019/Te1000Daemon.exe`，固定相同 Write Solution，
只授权 `03_POUs^FB_MCP_Dev`、`01_DUTs^ST_MCP_Dev`、`01_DUTs^E_MCP_Dev`、
`04_GVLs^GVL_MCP_Dev`（均带完整 `TIPC^MainPLC^MainPLC项目^` 前缀），类型
`604;609;605;606;615`。不同 Solution 对应不同所有权 mutex/lease、审计目录与 journal。

### 真实发现的问题及处置

预检副本 `NexPlc-mcp-dev` / pipe `nexplc-dev-20261019` 首个实际 Codex CLI
成功发现两组工具、读取、拒绝正式写/Dev 越界，并创建修改保存 `FB_MCP_Dev`，
GUID `{185d821d-9f75-40e8-b4a7-6ad5669d5deb}`，保存 safe。
当时 XAE35396 / Daemon34668，打开计数 1。

但该 CLI 自动启动的 detached Daemon 随 CLI 退出结束。下一独立 CLI 恢复同一
XAE35396，Daemon27424、打开计数0，代码与哈希保持，但最近审计返回
no_save_in_this_session。因此严格“Daemon PID 不变”重连断言失败，原始失败日志保留。
观察到的是宿主退出相关进程生命周期行为，未进一步证明 Windows job 的具体内部机制。
不将恢复代码读取解释为审计批次恢复，也不把这次检查记成无条件通过。

从 CLI 外部预启动 Daemon33028 后，两个独立 Codex 客户端均复用
33028/35396，退出后 Daemon 仍活着。为避免已保存未提交副本在新 Daemon 中后续
首次写入被安全策略拒绝，预检结束后经 owned shutdown 关闭已保存自有实例，
保留副本与证据；最终另外建立干净的 `NexPlc-mcp-dev-final`，在任何首次写入前
外部预启动40844/39648。未清 journal/lease，未扩大权限或恢复未知写入。

最终首个 CLI 的树读取错误地将文件夹传入 plc_pou.tree 的 plcPath，收到
E_NOINTERFACE 后停止；没有工程写入、没有产生写入结果歧义。后续明确使用
`tc_tree.children(path=完整03_POUs路径)` 更正只读调用，保留两次日志。
当前部署要求 Daemon 从 CLI 外部先启动；不宣称任何 Windows CLI 自动拉起场景都能常驻。
Daemon 崩溃后编辑批次恢复与开机服务安装仍未实现。

### 最终实际验收：通过（上述预启动部署条件）

使用桌面版自带 Codex CLI `0.163.0-alpha.10.2`，真实加载用户配置中的两个 MCP；
没有用自写客户端冒充 Codex 工具发现。独立 CLI JSONL 的 mcp_tool_call 事件与返回值
另行解析核验，未只信任模型最终文字。正式端只公布4组工具，Dev 公布8组。

1. 最终写入客户端：两边 status 与 tc_tree.children 读取成功，精确路径符合；
   正式相同 FB create 返回只读拒绝，Dev 越界 create 返回 Write Roots 拒绝。
   Dev 创建 FB_MCP_Dev，读取哈希、修改声明/ST、preview、保存与审计、读回代码全部通过。
2. 新的独立 Codex 客户端：仍为正式10208/11172、Dev39648/40844，均 openCount=1；
   读取到前次 completed_and_audited/safe 审计。随后通过精确内容哈希将测试实现从
   `nResult := 20261019;` 改为 `nResult := 20261020;`，再次 preview/save/readback
   成功，审计仅为 expected_pou_code。证明客户端退出后仍可继续编辑，未重建编辑批次。
3. 两个客户端退出后，真实 raw pipe 再次读取同一会话；五项隔离拒绝通过：Dev 请求打开
   正式 Solution、伪造 expectedSolutionPath、伪造 Write Roots 的越界创建、623 创建，
   以及正式端伪造 Dev 写权限。没有触发成功写入或工程锁止。
4. `.sln`、`.tsproj`、`.plcproj` 在正式/Dev 的文件 ID 均不同，无硬链接共享；
   所有权 lease 与审计 journal 分离。最终 Daemon/XAE 保留运行以供开发连接。

最终 FB GUID **`{93442ad7-24ff-434f-8238-037307ba0229}`**，两次保存保持稳定，Compile 引用唯一。
最终实现 contentHash `108068230d06f44bbd82b5690fac0760301a574ac895cc9d10d667e3c53eceed`。
第一次保存工程差异只含新增 FB 与唯一 Compile 引用；重连后第二次保存只改测试 FB 源码。
最终完整工程跟踪差异见 `p3-complete-tracked.diff`，新增文件全文见 `p3-new-files.json`。
P3 未再次离线编译此 FB；类型引用的离线编译证据为前述各自 P2 独立工程，不能混称。

实际 Codex 已完成工具调用：最终创建客户端 16 次，
最终重连编辑客户端 14 次（含预期拒绝/审计读取）。
原始证据为 `p3-codex-final-write-corrected.jsonl`、`p3-codex-final-reconnect.jsonl`；
最初 CLI 生命周期失败及只读参数错误日志同目录保留，未覆盖。
`p3-raw-isolation.json`、`p3-isolation-summary.json`、`p3-ownership-records.json`
包含真实拒绝、会话、文件身份、GUID、lease；`p3-preflight-*` 保留原预检副本记录。
外部 PowerShell 预启动示例也执行成功；具体命令见 CODEX_XAE_WORKFLOW.md。

### 最终保护核查与交付边界

正式65个跟踪文件哈希无变化，用户既有 Valve/tsproj 改动保留；原生产注册的全部字节
与解析设置不变，正式 Release 二进制 SHA-256 仍为
`868ef4c0adcc3cb1a6a0689f1378a65794bbe64bf7bf16748b1a103c45df4949`。
旧 ALIAS pending SHA-256 仍为 `850e32483cf7750af737b4f87a0300deadcce3c5e29852d45aa1152e3391e735`；
新 ALIAS pending SHA-256 为 `6138f594fa8f615c5063deb9163b2384e72559a4dd7ef3f14e10190638eb3478`，最终核查未变化。
最终 Dev 二进制 SHA-256 为 `d267d3124f88ae4f28f27e4eac6c97f70b267dd2fc5eab42557be1b61ae6683e`。
完整复核数据在 `protected-final.json`，初始值在 `protected-before.json`。

新增 opt-in 双环境检查 `tests/nexplc-dual-acceptance.js --live-read-only` 在最终实际服务
通过：两会话、5项拒绝、工程文件ID独立、唯一引用；两个新增 live runner 的 JS 语法
检查通过。保存审计模拟45项、raw policy167项和其余离线回归结果见前述记录。
最终 `git diff --check` 通过。当前分支/HEAD 未改变，开发代码未提交；未 push、merge、PR。

本机旧 ALIAS 与新 ALIAS 现场均继续保留，623 不支持；正式工程服务端仍只读。
未验证全宿主生命周期自动常驻、完整 Daemon 崩溃批次恢复、GUI 并发与所有故障边界；
当前 P3 通过指上述明确配置与实际客户端重连路径，不代表这些扩展保证。
