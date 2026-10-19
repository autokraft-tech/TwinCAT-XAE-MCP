# 系统架构

单目录模式增加 GitCheckout 固定 checkout/branch/HEAD、策略指纹和操作前校验。独立策略 baseline 仍扫描同 Solution 全部历史 Pending Journal。详见 [验收状态](TESTING.md#single-checkout-release-gate)；以下内容中的隔离 Worktree 为旧模式背景。

Node.js MCP 前端负责工具描述、参数校验和传输；独立 C# Daemon 在唯一 STA 上持有 XAE COM 并实施工程权限和审计。

| 模块 | 职责 |
| --- | --- |
| `index.js` / `offlineSchemas.js` | stdio MCP、固定离线工具面：只读 4 个，Dev 8 个工具 |
| `daemonClient.js` | UTF-8 JSON 行管道、请求关联、身份验证和不重放策略 |
| `PipeServer.cs` / `Dispatcher.cs` | 当前用户 ACL、客户端会话校验、动作分派、COM-free 运维入口 |
| `OfflinePolicy.cs` | 17 个工程动作白名单、固定 Solution/类型/对象权限，raw pipe 同样受限 |
| `ComWorker.cs` | 单 STA 串行队列、OLE 消息处理；超时锁止，不替换 worker |
| `ComSession.cs` / `LifecycleIdentity.cs` | DTE/System Manager 持有、同会话附加、PID/时间/租约 |
| `Actions/PlcPouActions.cs` | 官方 CreateChild、声明/实现接口，类型和身份检查 |
| `ProjectSaveAudit.cs` | 文件快照、GUID/引用/配置审计、journal 和恢复基线 |
| `lifecycle.ps1` / `task-definition.ps1` | 独立计划任务宿主、定义核验和运维命令 |
| `new-dev-profile.ps1` | 隔离工程、精确对象/类型的启动配置 |
| `tests/` / `daemon/test-*.ps1` | 离线回归与显式启用的实机测试 |

C# 和运维脚本位于 `daemon/`。`toolSchemas.js` 和部分旧 action 保留上游结构；可达接口以 offlineSchemas 和服务端白名单为准，不以 handler 存在为准。没有恢复废弃 PowerShell COM Bridge。

## 请求与会话

UTF-8 JSON 行请求含 `id/action/payload`，响应含 `id/ok/result` 或 `ok:false/error/errorKind`；MCP 错误使用 `isError`。未知动作在 COM 前拒绝。

`createOnce` 创建专用 XAE；`active` 查找匹配实例。工程请求核对固定 Solution/System Manager，树缓存按请求失效。所有 COM 在同一 STA，前端断开不释放会话。

managed 前端每次工程请求前核对身份和启动策略，验证与操作绑定同一 socket；连接被替换则拒绝发送。旧 socket 迟到事件不能影响新请求。超时 COM 仍可能晚返回，不通过重试/新 worker 消除未知状态。

## 生命周期与边界

ACL 与客户端会话检查限制错误附加。PID 加启动时间防 PID 重用，SID/session、EXE、Solution、pipe、策略指纹和 owned lease 共同核对身份。每个 Solution 的租约阻止重复专用实例；失配拒绝接管，不删记录。

交互计划任务在客户端进程树之外持有 Daemon。旧 detached 自启动保留兼容，但不保证跨 Codex/Windows job 生命周期；managed Dev 固定 autostart=0。任务不自动故障重启。正常停止在 STA 检查审计、未保存内容和所有权，仅关闭自有 XAE。

保存/构建映射和 Profile 生成器针对已验收布局：`MySPT_Machine/MySPT_Machine.sln`、PLC 目录 `MainPLC` 和包含 `TIPC^MainPLC` 的树根。非标准/外链布局尚未验收，不能仅改环境变量就宣称通用支持。

持久审计是本地一致性证据，不是文件事务或抵御文件所有者篡改的签名系统。见 [保存安全](XAE_SAVE_SAFETY.md)、[生命周期](XAE_LIFECYCLE.md)、[配置](MCP_CONFIGURATION.md)。
