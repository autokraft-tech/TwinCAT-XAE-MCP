# Codex XAE 离线开发流程与双环境配置

日期：2026-10-19。STRUCT、ENUM、GVL 各自完整验收通过，ALIAS 仍禁用。
双 MCP 已注册并通过实际 Codex 调用；进程生命周期限制见下文。

## 实际配置

用户 `C:\Users\Will\.codex\config.toml` 保持原有 `nexplc_xae` 注册，未覆盖其他 MCP。
完整正式配置见 `examples/nexplc-codex.toml`，关键项如下：

| 项目 | 实际值 |
| --- | --- |
| 入口 | `D:\Will\Documents\source\repos\TwinCAT-XAE-MCP\index.js` |
| Named Pipe | `nexplc-readonly-validation` |
| Session | `createOnce`，`TcXaeShell.DTE.17.0`，`3.1.4026.20` |
| Solution | `D:\Will\Documents\source\repos\NexPlc\MySPT_Machine\MySPT_Machine.sln` |
| System Manager / PLC | `MySPT_Machine` / `TIPC^MainPLC^MainPLC项目` |
| Write Solution / Write Roots | 均为空，服务端拒绝写入、保存、编译 |

正式 Daemon 仍运行第一阶段二进制；未为升级而关闭正式 XAE。
开发源码在只读客户端仍只公布原有四组工具，避免向旧正式 Daemon 公布新审计动作。

`nexplc_xae_dev` 已追加到用户配置，完整可用配置见 `examples/nexplc-codex-dev.toml`。
追加前后逐字节检查：原配置字节全部保留，解析后移除 Dev 条目与原设置完全一致。
正式 MCP 条目与 Release 二进制未修改。旧 pending 示例仅保留历史用途。

最终 Dev 固定为 `D:\Will\Documents\source\repos\NexPlc-mcp-dev-final\MySPT_Machine\MySPT_Machine.sln`，
pipe `nexplc-dev-20261019-final`，二进制 `daemon/bin/NexPlcDev20261019/Te1000Daemon.exe`。
只授权 FB_MCP_Dev、ST_MCP_Dev、E_MCP_Dev、GVL_MCP_Dev 四个精确对象路径。
类型权限为 `604;609;605;606;615`；ALIAS 623 硬拒绝。
正式 XAE/Daemon 为 10208/11172；最终 Dev XAE/Daemon 为 39648/40844。
两边的所有权 lease、工程文件 ID、锁止记录分开；证据见第二阶段报告。

### Windows CLI 的 Daemon 生命周期

本机 Codex 0.163.0-alpha.10.2 首轮 CLI 自动拉起的 Dev Daemon 34668，随 CLI
退出结束；第二轮恢复同一 XAE 35396，但 Daemon 变为 27424，openCount=0，最近审计
内存状态为 no_save_in_this_session。因此不能宣称所有 Windows CLI 场景的 detached
子进程都能脱离宿主进程生命周期。已保存代码、GUID、持久化审计文件仍在；失败记录保留。

本次采用从 CLI 外部预启动专用 Daemon 的部署方式：在外部 PowerShell/Node 进程中，
使用 Dev 示例相同的进程级环境调用现有 `daemonClient.runViaDaemon("xae_status")`，
建立 33028，再由 Codex 连接已有管道。不要通过修改正式配置或清 lease/journal 解决。
该预检的两个独立 Codex 客户端均复用 33028/35396。预检结束后通过 owned shutdown
关闭已保存的自有实例，保留副本。最终配置另指向全新 `NexPlc-mcp-dev-final`，在干净
副本首次写入前从 CLI 外预启动 40844/39648，避免恢复后的未提交副本无法继续写入。
最终两个实际 Codex 客户端先创建/保存，再重连继续修改/保存，均保持40844/39648
和 openCount=1，审计 safe；退出后仍可读同一会话。完整证据见报告。当前桌面会话的新工具列表可能需要
重新连接 MCP/开启新会话，不能把 CLI 验证表述成已重启桌面 UI。
此部署不提供 Windows 开机服务安装或任意主机生命周期下的自动常驻保证。

在 **Codex CLI 外部的 PowerShell** 中，可按本机已验证的 literal-only 示例预启动。
以下只读取示例的 TE1000 环境行并传给子进程，不设置用户/系统环境变量；status 不写工程：

```powershell
Set-Location D:\Will\Documents\source\repos\TwinCAT-XAE-MCP
$devStart = New-Object System.Diagnostics.ProcessStartInfo
$devStart.FileName = 'C:\Program Files\nodejs\node.exe'
$devStart.WorkingDirectory = (Get-Location).Path
$devStart.UseShellExecute = $false
$devStart.CreateNoWindow = $true
$devStart.Arguments = '-e "require(''./daemonClient'').runViaDaemon(''xae_status'').then(s=>{console.log(JSON.stringify(s));process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"'
Get-Content examples/nexplc-codex-dev.toml | ForEach-Object {
    if ($_ -match "^(TE1000_[A-Z_]+) = '([^']*)'$") {
        $devStart.EnvironmentVariables[$Matches[1]] = $Matches[2]
    }
}
$devProcess = [System.Diagnostics.Process]::Start($devStart)
$devProcess.WaitForExit()
if ($devProcess.ExitCode -ne 0) { throw 'Dev status failed; inspect state before proceeding' }
```

这不是通用 TOML 解析器，只对应随仓库提供的单引号值示例。使用自定义配置时，
务必由运维按实际 MCP env 传入完全相同的启动配置，不能将旧 Daemon 连接到新工程。

## 可复用流程

1. 保留生产工程原有修改；从已知提交建立干净的 Dev Worktree，检查路径不存在重叠、
   工程文件不通过符号链接共享。不得把正式工作区的未提交修改自动带入 Dev。
2. 为 Dev 配置独立 pipe、固定 Solution、相同 Write Solution、精确测试对象根及
   已验证类型 `604;609;605;606;615`。只在各 MCP 的 env 表中设置，不修改系统/用户全局环境变量。
3. 两边先调用 status，分别核对完整 Solution、System Manager、XAE PID、Daemon PID、
   所有权和打开计数。任何工程不符立即停止，不能切换到另一个 Solution。
4. 使用正式服务读取/分析；只在 Dev 创建、修改。Method 编辑先读取完整内容哈希。
5. 修改前读取 project_changes 和 preview。已有用户磁盘修改或未保存编辑器文档时停止，
   不自动清理工作区。操作后只读核对实际对象，保存后审查全部差异。
6. 重载相同 Dev Solution，核对代码、对象 GUID、唯一项目引用；离线编译并读取诊断。
   编译后再次审查保存元数据。TmcHash 独立分类，关键目标配置变化不能自动接受。
7. 出现 COM 错误、超时、断线、模态、异常元数据或 blocked journal，停止后续写入、
   提交、发布和应用。读实际状态，保留副本和审计；不重放创建、不删除未知对象、不清锁。
8. 在当前阶段验收通过后报告具体文件、GUID、诊断和风险。除 P0 已授权的基线提交外，
   后续开发代码保留未提交；不自动 push、merge 或创建 PR。

本实现尚未恢复跨 Daemon 重启的“已知干净编辑批次”状态；已保存但未提交的 Dev 副本在
新 Daemon 中可能因首次写入的干净工作区要求被拒绝。客户端重启可复用活着的 Daemon，
不因此扩大权限。Daemon 失败后的继续写入需要单独核查，而非删除 journal 或强制覆盖。

## ALIAS 失败现场保留

DUT 测试副本 `D:\Will\Documents\source\repos\NexPlc-mcp-phase2-dut` 的
`T_MCP_Probe` 创建返回 `未指定基类 / baseClass`。随后只读枚举未发现该对象，
磁盘也未发现对应 TcDUT；这不能证明所有内部状态均已恢复。
Daemon 保留锁止，XAE 状态留待检查，没有自动关闭、保存、重试或删除。

继续前需要核实 ALIAS subtype 623 在本机版本中的官方 vInfo 创建契约，
并检查锁止副本。不要直接运行现有 DUT 测试重试失败请求。采用保留旧副本、全新
Worktree 的恢复方案；不手工修改工程 XML。STRUCT/ENUM/GVL 后续已在新副本完成全流程。
新 ALIAS 候选也在独立副本失败并锁止，详见 ALIAS_API_VALIDATION.md。
双 MCP 工具发现、读取、拒绝、Dev 写入和客户端重连已实际执行；未覆盖所有崩溃边界。

配置格式参考：[OpenAI 官方 MCP 文档](https://developers.openai.com/codex/mcp)。
