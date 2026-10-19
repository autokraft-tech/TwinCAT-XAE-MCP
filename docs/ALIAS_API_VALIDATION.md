# ALIAS 623 故障与禁用规则

ALIAS 未通过写入验收，当前不支持。其他 DUT 已验收不意味着 ALIAS 可用。

XAE 3.1.4026.20 中空 vInfo 缺少必需 baseClass；一次完整声明 Object[] 候选也没有形成可验证成功对象，留下未知/失败状态。CLR 数组形状不证明 COM 支持，旧候选断言已改为禁用回归。

两个失败工作区、pending journal 和证据保持锁止并留在本机，不清理、不重试。公开文档不包含现场源码、机器路径或凭据。

MCP schema 拒绝 623，Daemon 白名单在 raw pipe 同样拒绝，内部 BuildVInfo 也抛错；启动类型配置不能开放。离线回归验证这些拒绝路径，不执行真实 ALIAS COM 调用。

禁止 XML 合成、改 GUID、删 journal、覆盖哈希、重启/换管道绕过。未来研究需另行授权、官方接口核实和全新隔离副本全流程验收；当前没有继续实验授权。

见 [对象 API](PLC_OBJECT_API.md)、[保存安全](XAE_SAVE_SAFETY.md)、[排查](TROUBLESHOOTING.md)。
