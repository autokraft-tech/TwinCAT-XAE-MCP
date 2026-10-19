# XAE 保存安全（第二阶段开发）

日期：2026-10-16。当前验收状态以 `NEXPLC_XAE_MCP_PHASE2_REPORT.md` 为准。

## 保存接口比较

| 接口 | 官方说明与本机证据 | 是否仅保存指定 POU | 工程元数据风险 |
| --- | --- | --- | --- |
| `DTE.ExecuteCommand("File.SaveAll")` | 第一阶段及第二阶段真实执行；继续使用固定命令，不接受调用者指定命令 | 否 | 可能保存 `.plcproj`、`.tsproj`；第一阶段观察到 TargetNetId 被移除和 TmcHash 更新 |
| `EnvDTE.Project.Save` | Microsoft 文档定义项目/项目项保存；本机尚未单独验证 TwinCAT 项目实现 | 未证实 | 没有只保存 POU 或不更新 TwinCAT 配置的保证；不能作为已验证替代方案 |
| `EnvDTE.ProjectItem.Save` | Microsoft 文档定义项目项保存；PLC tree item 与 DTE ProjectItem 并非已证明的一对一关系 | 未证实 | 尚未验证引用新增、脏项目和关闭/重开后的持久化行为 |
| PLC declaration/implementation interfaces | Beckhoff 文档说明通过属性读写代码 | 属性设置不是独立的已验证保存协议 | 本机发现 `CreateChild` 可在 SaveAll 前生成 TcPOU；不能假设所有对象更改都只在内存中 |
| `ITcPlcIECProject.SaveAsLibrary` / archive export | 官方提供库或归档导出 | 不是 POU 源文件保存 | 不替代工程保存；本阶段未调用 |

官方参考：

- [Microsoft Project.Save](https://learn.microsoft.com/en-us/dotnet/api/envdte.project.save?view=visualstudiosdk-2022)
- [Microsoft ProjectItem.Save](https://learn.microsoft.com/en-us/dotnet/api/envdte.projectitem.save?view=visualstudiosdk-2022)
- [Beckhoff declaration/implementation](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/21842480395.html)
- [Beckhoff PLC project handling](https://infosys.beckhoff.com/content/1033/tc3_automationinterface/242730891.html)

未经单独实测，不能用 DTE 的另一个 Save API 替换 SaveAll，也不能声称未保存数据不会丢失。

## 审计边界

服务端 `ProjectSaveAudit` 在拥有 COM 的 STA 上执行。第一批写入要求隔离 Git 工作区干净；
已有用户磁盘修改直接拒绝。写入/保存前检查未保存编辑器文档；SaveAll 还检查顶层项目位于
固定 Solution 目录内。对象修改前记录批次初始哈希和预期对象，持久化 pending journal，
每次对象操作后检查磁盘变化，保存前再次比较最近检查点，避免覆盖中途出现的磁盘修改。

快照包含 Solution 目录内的跟踪文件，以及递归发现的工程源码、工程文件、XML/xti 等。
排除 `.git`、`.vs`、编译/库缓存等目录，拒绝扫描到的链接工程目录和链接源码文件。
不宣称覆盖 XAE、Windows 或外部工具在目录之外产生的所有文件。

保存完成后检查：

- 预期 TcPOU 的代码变化；既有对象名称、GUID 和对象结构不得被改变。
- 新建 TcPOU 的 XAE 生成 GUID；同一批次中保持一致。
- `.plcproj` 仅允许预期新建对象的唯一 Compile 引用；其他变化默认阻断。
- `.tsproj` 除 TmcHash 属性和格式之外的变化全部视为关键配置变化。
  因而 TargetNetId、工程 GUID、PLC GUID、Task/Runtime、AMS/EtherCAT 目标参数、
  TwinCAT 版本，以及尚未逐项识别的其他工程配置，都不会被静默放行。
- TmcHash 单独归类为构建元数据，仍记录原值和新值。
- 任何其他工程文件变化或删除默认阻断。

报告包含前后 SHA-256、全部变化文件的完整前后文本、Git binary diff，以及工程 XML 的
属性/叶节点差异。XML 仅用于只读分析，不用于保存、修补或生成工程对象。忽略格式空白，
避免删除预期 Compile 节点后残留的缩进导致误报；代码区 CDATA 内容不会因此被改写。

`project_save` 与旧 `xae.save_all` 均走审计。显式重载中的隐式 SaveAll、现有内部按需保存
也走同一入口。离线 BuildProject 另外做前后审计，且要求先完成待编辑批次的保存。

## 失败与恢复

保存发生后才能确定某些副作用，检查不能撤销已经发生的写盘。本实现不是事务系统，
不提供自动改写 `.tsproj`、替换 GUID、Git reset、对象删除或任意文件恢复接口。

出现未知 COM 结果、外部工程文件变化或异常元数据时，保留 pending journal 和原始差异。
后续对象写入、保存、重载保存和离线编译被阻断；读取和审计报告仍可用。
新 Daemon 遇到未完成 journal 同样拒绝写入，不能靠重启、换管道或确认字符串清除锁止。
STA 超时后原调用仍可能完成；必须人工核对实际结果，不能重放请求。

安全恢复流程：冻结受影响副本，保留其完整目录、Git diff、journal 和 XAE 状态；
核对 Solution、PID、是否有未保存数据。只在能证明无未保存内容时，才通过已有的
owned-session shutdown 关闭自己的实例。另建一个指向已知基线的新 Worktree，先核对
跟踪文件哈希和目标元数据，再逐项通过已验证的 XAE 接口重建需要的改动。
旧副本不删除、不原地还原，不覆盖任何用户已有修改。新副本也不能自动应用旧的异常 diff。

该流程恢复的是一个可审查的干净起点，不保证自动恢复未保存的 PLC 编辑。当前没有
允许调用者自行清锁的 MCP 动作。当前工作流不能阻止用户在服务之外手动执行 Git 或发布；
Codex 必须把 blocked/unsafe 结果当作停止自动提交、合并、发布和应用工程的条件。

## 验证分类与剩余限制

自动化文件夹模拟涵盖配置变化、GUID、唯一引用、即时写盘、未提交用户修改、并发磁盘修改、
保存异常和重建审计对象后的 journal 锁止。真实 XAE 的结果单列在第二阶段报告，
模拟不作为 TwinCAT 保存行为、长期可靠性或独立 Save API 验证的证据。

仍需专门验证：GUI 与 MCP 同时编辑的竞争、进程在每个持久化边界崩溃、晚返回的超时写入、
外部链接工程与非标准文件布局，以及完整恢复后的继续开发。当前要求开发副本由专用
Daemon 独占，不能将哈希检查描述成跨 XAE/编辑器的排他文件事务。

## 2026-10-19 已验证的声明对象

STRUCT 606、ENUM 605、GVL 615 分别在全新副本完成真实 XAE 验收。
GVL 预期文件扩展名为 `.TcGVL`，身份节点为 GVL；新建唯一 Compile 引用以及
LinkAlways 按预期变化处理，既有 GUID、配置、其他引用必须保持稳定。声明规范化
只忽略已授权代码文本，不忽略其他元数据。新增 GVL 保存通过与 GUID 异常锁止模拟，
总计 45 项；真实保存记录、完整差异与编译诊断见第二阶段报告。
ALIAS 两个失败现场继续锁止。623 不因其他 DUT 验收通过而开放。
