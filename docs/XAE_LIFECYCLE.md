# Daemon 生命周期

固定主 checkout 允许精确授权的非 main 分支。正常审计关闭后才允许 commit/switch，并以新 Profile 重授权。任何 XAE 运行时 switch-branch.ps1 保守拒绝切换；发现同 Solution 已打开时不创建第二个实例。未知或旧格式租约不自动迁移，见 [流程](DEVELOPMENT_WORKFLOW.md)。

managed Dev 使用当前用户交互计划任务，独立于客户端持有 Daemon/XAE。正式 nexplc_xae 保持只读；脚本不管理或升级正式 Release。

## 配置

在固定 checkout 从 main 建立普通非 main 分支，保持工作区干净，构建独立 Dev EXE，再用 new-dev-profile.ps1 生成 Profile，见 [开发流程](DEVELOPMENT_WORKFLOW.md)。生成器不安装/启动任务、不改 MCP。

Profile 固定 SID/session、EXE、pipe、Solution、对象/类型和日志，UTF-8 支持中文路径。实际配置留在 ignored artifacts，不提交。新权限使用新干净任务，客户端不能扩权。

helper 针对已验收的 MySPT_Machine/MySPT_Machine.sln 布局及 PLC 根，拒绝未授权或 main 分支、脏副本、覆盖 Profile、目录级授权和 623。深层 Method 授权须匹配已有 FB 文件中的 FolderPath 和方法；启动前复核同一对象，不能授权整棵 POUs。任务前缀 NexPlcXae-Dev-、管道前缀 nexplc-p4-dev- 是保留兼容协议，不随文档整理改名。

## 命令

在仓库根目录 PowerShell 执行：

```powershell
$profileFile = '<LOCAL_PROFILE.json>'
& ./daemon/lifecycle.ps1 -Action install -Profile $profileFile -AtLogon
& ./daemon/lifecycle.ps1 -Action start -Profile $profileFile
& ./daemon/lifecycle.ps1 -Action status -Profile $profileFile
& ./daemon/lifecycle.ps1 -Action diagnose -Profile $profileFile
& ./daemon/lifecycle.ps1 -Action stop -Profile $profileFile
```

install 使用当前用户 InteractiveToken/LeastPrivilege，无需密码或强制管理员权限，已有任务不覆盖。AtLogon 可省略。任务 IgnoreNew，无时长限制、无失败自动重启、不因电池/空闲结束。

start 核对唯一 task action 的 EXE、完整 host/profile 参数、工作目录、用户/会话、Solution 和租约。首次工程查询才初始化 XAE，start 为首次 status 保留 180 秒读取预算；不并行创建同工程第二实例。

运维 status 为 COM-free，显示身份、租约和审计记录是否存在，不打开 Solution。diagnose 增加错误和目录信息。MCP xae.status 属于工程查询，可能触发首次初始化，与运维 status 不同。

MCP 复制 Profile 完整 env，固定 TE1000_DAEMON_AUTOSTART=0。前端多次退出仍复用同一进程；管道缺失只诊断，不自动拉起。旧 detached 模式不保证跨客户端/job 生命周期。

## 停止与恢复

stop 核对 PID/启动时间、EXE、SID/session、Solution、pipe、策略和 owned lease，再由 STA 检查 Saved 标志、审计和磁盘检查点。未保存、未知写入、异常审计或构建后未建立保存基线时拒绝。

仅正常关闭自有 XAE，确认退出后记录 closed lease。不调用 Task.End，不强制结束用户 XAE、不删记录。停止超时先检查实际状态，不重发 stop。

正常审计停止后显式 start 可验证 closed lease/baseline，创建新专用 XAE。Daemon 失效但已保存 XAE 存活时，人工 start 可核对 owned lease 后重附加同一 XAE。PID 死亡/时间变化/租约不符不自动创建替代。未知 journal 始终阻止恢复写入。

## 取舍与限制

交互任务避免 Session 0 服务访问桌面的风险，也不依赖 Codex 进程树。审计/归属优先于自动重启，不配置故障重放。

同一登录会话多次 CLI 复用、正常停止/显式重启、已保存状态失效重附加已实测。注销/重新登录、开机登录触发、真实另一用户/会话尝试尚未实测。session 固定可能拒绝新登录，不把 AtLogon 配置能力称为跨登录验收；注销后 XAE 存活无保证。

旧二进制/租约迁移需单独评估，不自动迁移旧所有权记录，不借提交替换生产。恢复规则见 [保存安全](XAE_SAVE_SAFETY.md)。

## Normal handoff and identity drift

A closed lease may transfer to another pipe only when its user/session/Solution match and its recorded XAE process is no longer alive. An active lease still requires its original pipe and cannot be taken over. Each role opens a fresh owned XAE; no in-memory engineering objects cross the handoff.

Git identity drift blocks engineering reads/writes/saves/builds. Normal stop remains available only for the matching owned process and Solution, with unchanged audited engineering files, no pending edit/build/unknown result, and all Saved flags true. It closes without saving; it cannot repair or clear a lock. The lifecycle client verifies ownership without a Git-blocked engineering request, then waits for both daemon and scheduler host exit before returning. A failed/unknown stop is never replayed automatically.
