# 故障排查

先停止新增写请求。用本地 Profile 调用 lifecycle.ps1 status/diagnose，保留完整错误；MCP 可读时查看 xae.status、project_save_audit、project_changes。日志可能含源码/机器信息，分享前脱敏。

| 现象 | 处理 |
| --- | --- |
| pipe 不存在 | 核对 Profile、独立 pipe、任务和 EXE；仅安全状态显式 start，不允许客户端创建替代进程 |
| task action 失配 | 核对唯一 action 的 EXE、完整 host/profile 参数及目录，不自动覆盖任务 |
| SID/session/策略失配 | 核对当前登录及完整 env，不单改客户端字段或跨会话接管 |
| COM 连接失败 | 核对 x64 安装、ProgID、版本、interop，不启动多个 XAE 试错或确认弹窗 |
| lease/重附加失败 | 核对 PID/启动时间、Solution、owned，不删租约或关闭手工 XAE |
| 写入拒绝 | 检查固定 Solution、对象根、类型；权限由启动配置决定 |
| expectedHash 失配 | 读实际完整代码，确认无未知写/锁止后形成新编辑，不盲目刷新哈希重放 |
| pending/executing/blocked | 保留 journal、归档、副本及 diff，不删记录或覆盖 baseline |
| GUID/引用/配置异常 | 冻结副本检查唯一引用和完整差异，不手写 XML/GUID 修复 |
| 超时/断线/worker faulted | 结果可能未知，不重放或新建 worker/XAE |
| stop 拒绝 | 检查未保存、待编辑批次、编译后保存和审计；不 Task.End/强制结束 |
| 中文路径指纹异常 | 确保 UTF-8 Profile、完整 env，不用默认编码重写 |

## 恢复原则

仅当持久审计、文件、Git、策略和 owned 实例全部匹配时恢复。已保存但无 baseline、未保存编辑与未知写入不等于完成审计保存，见 [保存安全](XAE_SAVE_SAFETY.md)。

无法证明一致则保持锁止，保留副本/进程现场，由人工核对结果。新任务从已知提交建立新干净 Worktree，授权后逐项重建；不自动导入失败 diff，不删 journal/lease 或改哈希，不重试 ALIAS。

正式只读实例不参与 Dev 排错，不改 EXE/config、不重启。报告代码问题只附脱敏版本、错误类型和最小离线复现，不上传工程/审计目录。见 [安全策略](../SECURITY.md)。
