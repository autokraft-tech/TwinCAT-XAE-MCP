# 保存审计与安全恢复

所有可达 SaveAll 路径经过 STA 上的 SaveAudited，包括 project_save、xae.save_all、重载隐式保存。对象修改也审计磁盘，因为 CreateChild 可能在 SaveAll 前写文件。

## 范围与检查

首次编辑要求隔离 Git Worktree 干净。修改前记录初始哈希、预期对象并持久化 pending。保存前核对最近检查点、未保存编辑器文档、顶层项目归属，拒绝外部修改。

快照覆盖 Solution 目录内跟踪文件及递归工程源码、工程/XML/xti 文件；排除 .git、.vs、构建/库缓存，拒绝扫描到的链接目录/源码。不能保证目录外没有副作用。

| 内容 | 允许的预期变化 |
| --- | --- |
| 既有 PLC 对象 | 授权代码；名称、GUID、结构稳定 |
| 新对象 | XAE GUID 保持一致，唯一 Compile 引用 |
| Method | 实际归属 FB 内的精确方法及 FolderPath，父/子 GUID 稳定 |
| GVL | TcGVL 身份、声明、预期 LinkAlways |
| plcproj | 仅预期对象的允许引用变化 |
| tsproj | 仅 TmcHash 构建元数据及格式，其他配置变化全部锁止 |
| 其他工程文件/删除 | 默认阻断 |

TargetNetId、工程/PLC GUID、Task/Runtime、AMS/EtherCAT、TwinCAT 版本不得静默改变。真实 SaveAll 曾出现目标配置副作用，因此不能视为仅保存一个 POU。

报告记录前后 SHA-256、完整文本、Git binary diff、XML 属性/叶节点差异。XML 仅读分析，格式处理不改代码 CDATA。构建单独前后审计，要求先保存编辑批次。

## 持久状态

| 状态 | 处理 |
| --- | --- |
| 完成审计的保存，baseline 全匹配 | 验证自有 XAE/未保存标志后可恢复，返回 recovered |
| 已保存但无可验证 baseline | 不接管脏副本，保留并诊断 |
| 未保存编辑 | 不作恢复基线，不自动保存/丢弃 |
| pending/executing/blocked 或 COM 未知 | 拒绝写入、保存、编译及不安全停止；不新建 XAE、不重放 |
| 文件/Git/归档/策略/租约失配 | 锁止，不覆盖哈希接受差异 |
| 元数据风险 | 锁止并保留完整差异，无自动修复 |

恢复检查精确 Solution、启动策略、Git HEAD/status/diff、全部工程文件哈希、归档哈希及 saved/safe/state。构建审计不建立保存基线，构建后需再次 audited SaveAll。已审计保存下的 Daemon 重附加及继续编辑经过真实隔离验收。

本机记录位于 `%LOCALAPPDATA%\NexPlcXaeMcp\save-audits`，包含工程文本，不发布。采用先 pending、持久刷新和完整审计后退休 pending 的保守协议。损坏或不匹配记录拒绝恢复，无 MCP 清锁入口。

## 失败与限制

冻结副本，保留 XAE 状态、journal、日志、完整 diff 和快照。人工核对实际结果；只有能证明无未保存内容且所有权匹配时才正常关闭自有实例。需要新起点时从已知提交另建干净 Worktree，逐项授权重建；旧失败现场不清理，不自动应用异常 diff。

审计在写盘后发生，不能回滚副作用，不是文件事务或防文件所有者篡改的签名系统。Project.Save/ProjectItem.Save 未单独验证，不能作为更安全替代。Flush(true) 不是断电事务保证。

GUI 并发、真实 COM 写超时/晚返回、全部崩溃点、断电及非标准/外链布局尚未完整实测。专用 Dev 避免 GUI 并发修改。见 [生命周期](XAE_LIFECYCLE.md)、[故障排查](TROUBLESHOOTING.md)。
