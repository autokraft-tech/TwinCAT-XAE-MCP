# PLC 对象 API

先调用 `xae {"action":"status"}` 核对精确 Solution/System Manager。树路径用 `^` 分隔，以下 `<PLC_ROOT>` 均为待替换示例。

## 工具面

| 工具 | action / 用途 |
| --- | --- |
| `xae` | status、open_solution（固定 Solution）、save_all、error_list、dialog_probe（仅报告） |
| `tc_tree` | get、children，只读身份和子项 |
| `plc_pou` | tree、get_decl、get_impl、create、set_decl、set_impl |
| `xae_build` | build，waitForFinish=true，仅 Dev 离线 PLC build |
| `project_changes` | 无参数，完整 Git 差异、哈希及锁止原因 |
| `project_save_preview` | 无参数，保存前检查点和预期范围 |
| `project_save` | 无参数，固定 SaveAll 加审计 |
| `project_save_audit` | 无参数，最近审计或未完成 journal |

后四个工具仅向写入配置的 MCP 公布。正式只读拒绝 create/set/save/build，raw pipe 同样受限。旧 save_all 和重载隐式保存也走同一审计入口。

## 类型与参数

| 类型 | subType | 创建/修改 |
| --- | --- | --- |
| ST FB | 604 | language=1，声明/实现；expectedHash 可选但推荐 |
| FB 直接子 ST Method | 609 | language=1、returnType、expectedHash=absent；更新各自声明/实现必须传哈希 |
| STRUCT | 606 | 创建 expectedHash=absent，再用哈希更新声明 |
| ENUM | 605 | 同上，保持 TYPE 名称和种类 |
| GVL | 615 | 同上，VAR_GLOBAL，可有 attribute 前缀 |
| ALIAS | 623 | 硬拒绝，启动配置不能开放 |

每个类型还需在 TE1000_PLC_WRITE_TYPES，默认只有 604。已有对象不覆盖、不改名。方法文件夹仅可读，写入未验收且拒绝。DUT/GVL 无实现，set_impl 拒绝。

直接 Method 创建参数：

```json
{"action":"create","parent":"<PLC_ROOT>^03_POUs^FB_Example","name":"M_Value","subType":609,"language":1,"returnType":"DINT","expectedHash":"absent"}
```

验收 COM 参数为 `CreateChild(name,609,"",new object[]{1,"DINT","PUBLIC"})`，不将其他候选数组视为支持。

声明对象创建：

```json
{"action":"create","parent":"<PLC_ROOT>^01_DUTs","name":"ST_Example","subType":606,"expectedHash":"absent"}
```

ENUM 改为 605；GVL 改为 615，parent 改为 `<PLC_ROOT>^04_GVLs`。DUT/GVL 使用 `CreateChild(name,subType,"",null)`，再读声明并修改，create 不传 declText。父目录需已存在。

```json
{"action":"get_decl","path":"<PLC_ROOT>^01_DUTs^ST_Example"}
```

contentHash 为完整原始文本 UTF-8 SHA-256，含原始换行；range/grep 不改变完整哈希。更新原样传回：

```json
{"action":"set_decl","path":"<PLC_ROOT>^01_DUTs^ST_Example","expectedHash":"<get_decl.contentHash>","declText":"TYPE ST_Example :\nSTRUCT\n    nValue : DINT;\nEND_STRUCT\nEND_TYPE\n"}
```

Method set_impl 使用独立 get_impl 哈希。FB 完整示例声明：`FUNCTION_BLOCK FB_Example\nVAR_OUTPUT\n    nResult : DINT;\nEND_VAR\n`，配合 README 的实现示例。名称、类型、父项、权限或哈希不符时拒绝。

声明/实现使用 ITcPlcDeclaration.DeclarationText / ITcPlcImplementation.ImplementationText，身份由 XAE 维护。Method 保存在父 FB TcPOU 内，无独立 Compile 引用；其他新对象要求唯一引用，GVL LinkAlways 纳入审计。

## 保存与错误

preview 不能预测全部 COM 副作用。保存后检查 audit 的 safe/saved、GUID、配置和完整 diff，再同一路径 open_solution 携 closeExisting=true 重载自有 Dev 并读回。离线构建：

```json
{"action":"build","waitForFinish":true,"timeoutMs":180000}
```

随后 xae.error_list 查看诊断。构建也审计，之后可能需再次 SaveAll 形成恢复基线。MCP 使用 isError，管道使用 ok:false/error/errorKind；COM 成功不代表审计通过。未知结果/pending/blocked 时停止写入，不重试或清锁。

接口参考：[Beckhoff 对象创建](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/21842468363.html)、[声明与实现](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/21842480395.html)。见 [保存安全](XAE_SAVE_SAFETY.md)。
