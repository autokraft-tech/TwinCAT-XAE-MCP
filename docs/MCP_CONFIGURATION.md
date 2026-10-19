# MCP 安装与配置

构建要求见 [README](../README.md)。本机 stdio Node MCP 连接 Named Pipe Daemon，无需网络监听或任意命令入口。

## 客户端

Codex 使用 [只读 TOML](../examples/nexplc-codex.toml) 或 [Dev TOML](../examples/nexplc-codex-dev.toml)。其他兼容客户端可从 [JSON 模板](../examples/mcp-config.json) 调整为其 mcpServers 格式。模板默认禁用，替换所有占位符后按客户端规则启用；不是本机注册配置。

Agent 应加载 [AGENTS.md](../AGENTS.md)。Codex、Claude Code 等客户端自动发现规范的规则不同，不自动读取的客户端须将其加入项目指令。最终限制在服务端，不能依赖 Agent 自律替代权限控制。

## 启动变量

| 变量 | 用途 |
| --- | --- |
| TE1000_DAEMON_EXE | 精确 EXE，Dev 独立输出 |
| TE1000_DAEMON_PIPE | 独立 pipe，正式/Dev 不同 |
| TE1000_DAEMON_AUTOSTART | managed Dev 为 0，仅连接已有进程 |
| TE1000_SESSION_MODE | createOnce 专用实例；active 查找匹配已运行实例 |
| TE1000_MCP_SOLUTION_PATH | 存在的绝对 Solution，前端/Daemon 相同 |
| TE1000_PROJECT_NAME / TE1000_PLC_ROOT | 精确 System Manager 项目和树根 |
| TE1000_PROGID / TE1000_XAE_VERSION | 固定 COM 标识及验收版本 |
| TE1000_WRITE_SOLUTION_PATH | Dev 与固定 Solution 相同；正式留空 |
| TE1000_WRITE_ROOTS | 分号分隔精确对象路径，FB 根包含子方法 |
| TE1000_PLC_WRITE_TYPES | 604/609/606/605/615，分号分隔，默认 604 |
| TE1000_OWNER_SID / TE1000_OWNER_SESSION_ID | managed 用户/会话，复制自 Profile |
| TE1000_DIALOG_AUTODISMISS | 固定 0，不自动确认弹窗 |
| TE1000_DAEMON_LOG | 本机日志，不提交 |

## 两个服务

nexplc_xae 正式只读，Write Solution/Roots 留空；不能保存/编译。不得为 Dev 改其 EXE/config 或重启正式实例。

nexplc_xae_dev 使用独立 linked Worktree、EXE、pipe、任务、Profile；只授权任务需要的对象/类型。启动任务后将 Profile 完整 env 复制到 Dev MCP，固定 autostart=0。不能只改前端路径而共用正式 pipe。

服务端白名单对 raw pipe 一样生效，客户端参数和确认字符串不能扩权。客户端超时不意味着 COM 已取消，不能重放。

helper 和文件映射存在 [已验收布局限制](ARCHITECTURE.md)，模板占位符不代表任意工程支持。新权限应建立新的干净任务，不覆盖运行 Profile、不删基线迁移。见 [开发流程](DEVELOPMENT_WORKFLOW.md) 和 [排查](TROUBLESHOOTING.md)。
