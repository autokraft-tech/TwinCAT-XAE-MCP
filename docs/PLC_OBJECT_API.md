# PLC 对象 MCP 接口

日期：2026-10-19。正式已安装 `nexplc_xae` 保持只读；以下写入仅适用于经过单独配置的隔离服务。
`nexplc_xae_dev` 使用独立 Worktree、管道和二进制；实际验收证据见第二阶段报告。

## 验证状态

| 类型 | 读取 | 创建和修改 | 保存/重载/编译 |
| --- | --- | --- | --- |
| ST FB，604 | 已实测 | 已实测 | 已实测 |
| FB 的直接 ST Method，609 | 已实测 | 已实测，编辑需内容哈希 | 已实测，父 FB/Method GUID 稳定 |
| STRUCT，606 | 已实测 | 独立全流程已实测，需启动授权 | 保存、两次重载、GUID/唯一引用、离线编译通过 |
| ENUM，605 | 已实测 | 独立全流程已实测，需启动授权 | 保存、两次重载、GUID/唯一引用、离线编译通过 |
| ALIAS，623 | 只读检查 | null 缺 baseClass；一次 Object[] 候选被拒，继续禁用 | 未完成 |
| GVL，615 | 已实测 | BOOL/DINT/REAL/ARRAY/自定义 STRUCT 已实测 | 保存、两次重载、GUID/唯一引用、引用 FB 编译通过 |

声明/实现使用官方 `ITcPlcDeclaration.DeclarationText` 和
`ITcPlcImplementation.ImplementationText`。创建使用官方 `ITcSmTreeItem.CreateChild`；
没有工程 XML 写入或 GUID 生成接口。

## 核心工具

`xae {action:"status"}` 必须先确认完整 Solution、System Manager 可用性和 session PID。
`tc_tree {action:"children",path:"...^FB"}` 枚举 FB 子对象，包括 Method；带方法文件夹的
既有工程可通过逐层 children 或 `plc_pou.tree` 读取。当前写入验证只覆盖 FB 的直接 Method。

`plc_pou {action:"get_decl",path:"..."}` 读取声明；
`plc_pou {action:"get_impl",path:"..."}` 读取 ST 实现。
开发源码返回 `contentHash`，是完整原始文本 UTF-8 的 SHA-256，包含原始换行；
即使使用 range/grep，哈希仍对应完整内容。不要用截断文本自行计算预期哈希。
正式基线 Daemon 尚未升级，不保证返回新字段。

## 创建和修改 Method

Daemon 启动配置必须同时满足：固定的隔离 Solution、相同 Write Solution、精确对象根，
以及 `TE1000_PLC_WRITE_TYPES=604;609`。默认仍仅启用 FB 类型 604。
这些权限不能由 MCP 请求参数扩大。首次写入要求干净 Git 副本；重名对象拒绝覆盖。

```json
{"action":"create","parent":"TIPC^MainPLC^MainPLC项目^03_POUs^FB_MCP_MethodProbe","name":"M_Test","subType":609,"language":1,"returnType":"DINT","expectedHash":"absent"}
```

已实测的 COM 参数为 `CreateChild(name,609,"",new object[]{1,"DINT","PUBLIC"})`。
使用官方参数表中的语言/返回类型/访问级别顺序；官方页面的示例与参数表存在第一项差异，
本机实测确认的是上述数组，不能将其他形式也视为已验证。

先 get_decl，再把其 `contentHash` 原样传入 set_decl：

```json
{"action":"set_decl","path":"TIPC^MainPLC^MainPLC项目^03_POUs^FB_MCP_MethodProbe^M_Test","expectedHash":"<get_decl 返回的 contentHash>","declText":"METHOD PUBLIC M_Test : DINT\nVAR_INPUT\n    nValue : DINT;\nEND_VAR\nVAR_OUTPUT\n    bPositive : BOOL;\nEND_VAR\nVAR_IN_OUT\n    nAccumulator : DINT;\nEND_VAR\n"}
```

ST 修改使用 get_impl 返回的独立哈希：

```json
{"action":"set_impl","path":"TIPC^MainPLC^MainPLC项目^03_POUs^FB_MCP_MethodProbe^M_Test","expectedHash":"<get_impl 返回的 contentHash>","implText":"bPositive := nValue > 0;\nnAccumulator := nAccumulator + nValue;\nM_Test := nValue + 1;\n"}
```

旧哈希、缺少哈希、改名声明、非 ST、非直接 FB 父项或超出写入根都会拒绝。
读取现有嵌套文件夹内的方法可用；修改这些方法尚未验证，服务端拒绝。
Method 保存到父 FB 的 TcPOU 内，不创建独立 Method 源文件或 Compile 引用。

FB 的原有 604 接口保持兼容；可传 `expectedHash` 启用文本前置检查。
本阶段未把哈希改成原有 FB API 的强制参数。

## STRUCT、ENUM 与 GVL

启动权限分别为 606、605、615；默认只开放 604，生产配置仍无写权限。
Dev 当前显式授权 `604;609;605;606;615`，623 在服务端硬拒绝，不能靠配置扩大。
创建使用 `expectedHash:"absent"`，DUT/GVL 父节点类型须为 601：

```json
{"action":"create","parent":"TIPC^MainPLC^MainPLC项目^01_DUTs","name":"ST_MCP_Dev","subType":606,"expectedHash":"absent"}
```

ENUM 对应 605；GVL 对应 615，父目录改为 `04_GVLs`。
通过 `CreateChild(name,subType,"",null)` 建立对象，读取 get_decl 后将完整 contentHash
传给 set_decl。DUT 保留 TYPE 名称与原类型种类；GVL 使用 VAR_GLOBAL 声明，可带
attribute 前缀。两者无 ST 实现，set_impl 被拒绝。不得将声明 XML 直接写入文件。
保存后 `.TcDUT`/`.TcGVL` 的名称和 GUID 必须稳定，Compile 引用必须唯一；
GVL 的 LinkAlways 元数据也纳入审计。精确对象路径必须先列入启动 Write Roots。

## 保存、审计和编译

可写客户端公布四个无参数工具：

| 工具 | 行为 |
| --- | --- |
| `project_changes {}` | Git 状态、完整跟踪差异、工程哈希、锁止原因 |
| `project_save_preview {}` | 保存前检查点校验、预期文件范围和风险提示；不能预测所有 COM 副作用 |
| `project_save {}` | 固定 SaveAll，保存后审计；异常返回错误并保留 journal |
| `project_save_audit {}` | 最近批次的变化分类、完整前后内容、哈希和元数据差异，或上次未完成 journal |

旧 `xae {action:"save_all"}`、重载中的隐式保存也走同一服务端审计。
`xae {action:"open_solution",solutionPath:"同一路径",closeExisting:true}` 只重载自己拥有的隔离会话。
保存后重载，再读声明/实现、核对 GUID 和唯一引用。
`xae_build {action:"build",waitForFinish:true,timeoutMs:180000}` 只离线构建 PLC 项目；
要求先保存待编辑批次，并审计编译引起的工程文件变化。随后读取 `xae.error_list`。

MCP 工具错误返回 `isError`；管道返回 `ok:false/error/errorKind`。
保存审计的详细结构在 `project_save_audit` 中，不用成功的底层 COM 返回值替代安全审查。
出现锁止或未知结果后停止写入、提交和发布，先读取报告和实际状态；禁止自动重试或清锁。

参考：[Beckhoff 创建对象](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/21842468363.html)、
[声明与实现接口](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/21842480395.html)。
