# ALIAS 623 创建分析与受控验证方案

日期：2026-10-19。旧现场 `NexPlc-mcp-phase2-dut` 及其 pending journal 不复用、不清锁。

## 已知事实

2026-10-16 失败调用为 `CreateChild("T_MCP_Probe",623,"",null)`，返回
`未指定基类 / baseClass`。失败后树和磁盘都未见对象，但不能证明没有内部副作用。

只读源码核查发现：

1. `BuildVInfo` 原来对 623 返回单个声明字符串（封送为 BSTR），未表达文档的索引 0 数组项。
2. `PouCreate` 随后无条件把 605/606/623 的 vInfo 覆盖为 null；即使构造了声明也不会传入 COM。
3. Daemon 策略同时拒绝新 DUT create 中的 declText，无法通过现有请求把基础类型送到 XAE。

因此旧错误能够证明 **null 没有满足本机 4026.20 的 ALIAS 基础类型要求**，
不能据此断言此版本不支持 ALIAS，也不能据此推定任何未测试的参数形状已可用。

## 官方依据与拟验证契约

[Beckhoff 创建 PLC 对象](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/21842468363.html)
把 623 列为 Alias，并记录 vInfo 索引 0 的声明文本。
[CreateChild 接口](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/242835851.html)
说明 vInfo 是按 subtype 解释的 VARIANT。
参照 [TE1000 手册](https://download.beckhoff.com/download/document/automation/twincat3/TC3_Automation_Interface_EN.pdf)
的对象参数表，候选使用一项 `object[]`，由 .NET COM 互操作封送为 VARIANT 数组；
唯一数组项是完整 ST 声明，不使用 PLCopen XML 或工程 XML。

拟进行的一次调用：

```csharp
object vInfo = new object[] { "TYPE T_P2Resume : DINT;\nEND_TYPE\n" };
parent.CreateChild("T_P2Resume", 623, "", vInfo);
```

这在实测前只是由官方表格支持的候选契约，未声称 4026.20 的具体处理已得到证明。
无需自动操作 GUI；若文档/调用结果仍有歧义，可继续禁用 ALIAS，另行人工 GUI 对照。

## 边界与验收

- 先完成 STRUCT、ENUM 各自独立验收；ALIAS 不能阻塞其他类型。
- 使用全新 Git Worktree、新管道、新 Daemon 和精确的测试 ALIAS/FB 对象根；不使用旧现场。
- 新建前声明必须匹配请求名称、DINT 基础类型和 expectedHash=absent；拒绝缺失/空声明。
- 自动化测试先验证 builder 输出的 CLR 类型为 object[]、长度为 1、元素为原始声明文本。
- 只执行这一种形状的一次创建请求。COM 错误、未知对象形状或非预期元数据变化后立即停止
  ALIAS 测试，保留现场，不换参数重试、不删除对象、不清 journal。
- 成功后先只读核对声明是否确实为 DINT ALIAS，再验证 GUID、修改/保存/重载、唯一引用，
  最后用引用该类型的 FB 离线编译。未完成前不在开发服务默认配置中启用 623。
- ALIAS 不通过时恢复最终服务端对 623 的拒绝；继续其他已独立验收类型的工作。

实际调用结果和最终结论写入 `NEXPLC_XAE_MCP_PHASE2_REPORT.md` 的 2026-10-19 续验部分。

## 本次实际结果：失败，继续禁用

2026-10-19 在全新 `NexPlc-p2-20261019-alias` 副本中只执行了上述一次参数形状。
XAE 返回 `The specified vInfo (Type: Object[]) is not supported for creating ... TREEITEMTYPE_PLCDUTALIAS ... parent item type '601'`。
这证明本机 4026.20 不接受该候选数组，不能将文档索引表直接当作此版本的封送契约。
没有尝试 scalar BSTR、基础类型字符串或其他数组形状；没有复用原失败会话。
新的 pending journal 保留；最终 Daemon 白名单及 MCP schema 继续禁用 623。
后续需要 Beckhoff 针对该版本的契约确认或人工 GUI/接口对照，作为独立待解决问题。
