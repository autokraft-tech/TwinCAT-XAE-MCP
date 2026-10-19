# 单目录 Branch 开发流程

每个 Git 仓库使用一个固定本地 checkout，通过普通 feature/fix 分支开发。普通任务禁止新建 Worktree/clone；特殊任务必须先说明必要性并取得明确授权。

**验收状态：单目录实现是待真实 XAE 离线验收的候选版本，不能仅凭离线夹具测试投入正式 PLC 开发。未替换正式 Daemon。旧 linked-worktree 配置保留兼容，不因此授权新建 Worktree。**

## 切换前

完成 Save Audit、Offline Build、诊断及完整 Git Diff，最后再次审计保存。用原 Profile 的 lifecycle stop 正常关闭自有 XAE/Daemon，确认 closed lease 和无 Pending Journal。手工 XAE 由用户正常关闭，未知 COM 结果或异常审计必须保留现场。

先保护/提交全部有价值的工作区和未跟踪文件，再执行 Git 操作。禁止在 XAE 打开时提交、更换 HEAD 或分支。`daemon/switch-branch.ps1` 在任何 TcXaeShell/devenv 运行、工程租约未知/未关闭、存在历史 Pending Journal 或工作区不干净时拒绝切换；它不会关闭进程。直接使用 Git 不受脚本拦截，因此所有客户端必须遵守此流程。

```powershell
& ./daemon/switch-branch.ps1 -Checkout '<PLC_REPOSITORY>' -Branch main
git -C '<PLC_REPOSITORY>' pull --ff-only
& ./daemon/switch-branch.ps1 -Checkout '<PLC_REPOSITORY>' -Branch 'fix/component-name' -Create
```

## 精确授权

使用独立 Dev 构建，不能覆盖正在运行的 EXE 或正式 Release：

```powershell
& ./daemon/build.ps1 -OutputPath "$PWD\artifacts\dev-build"
& ./daemon/new-dev-profile.ps1 `
  -Checkout '<PLC_REPOSITORY>' -AuthorizedBranch 'fix/component-name' `
  -DaemonExe "$PWD\artifacts\dev-build\Te1000Daemon.exe" `
  -Profile "$PWD\artifacts\component-task\profile.json" `
  -TaskName 'NexPlcXae-Dev-Component' -Pipe 'nexplc-p4-dev-fixed-checkout' `
  -WriteRoots @('<PLC_ROOT>^03_POUs^FB_Existing^I_Component^M_Existing') `
  -WriteTypes @(609)
```

仍限已验证的 MySPT_Machine/MySPT_Machine.sln、MainPLC 布局。生成器要求干净工作区、精确当前非 main/master 分支，固定 checkout/branch/HEAD、Solution、SID/session、EXE/pipe、对象/类型。分离 HEAD、路径链接和错误授权被拒绝。文件夹内 Method 必须已有且精确授权；哈希、GUID、引用及 Save Audit 不变。配置只生成本地 UTF-8 文件，不自动安装任务或部署。

按 [生命周期](XAE_LIFECYCLE.md) install/start，再将完整 env 复制到默认禁用的 [Dev 模板](../examples/nexplc-codex-dev.toml)。保持 autostart=0。正常停止后重授权使用新 Profile/任务名，复用固定 pipe；不要覆盖旧 Profile、修改旧租约或复用旧 XAE 内存。

## 工程与集成

1. 核对 xae.status 的精确 Solution、System Manager、daemon/XAE 身份与 ownership；读取完整代码/hash。
2. 只用 [XAE 对象 API](PLC_OBJECT_API.md) 修改授权对象，不直接编辑 PLC XML/GUID。
3. preview → save → audit；检查 safe/saved、GUID、唯一引用、TmcHash、完整 Git Diff。
4. 重载同一 owned Solution 并读回；Offline Build，检查全部诊断，再审计保存。
5. 正常 stop，确认退出、closed lease、无未知结果；再 Commit/Push/PR/合并 main。分支提交和切换均需在 XAE 关闭后。
6. main 构建结果和远程 SHA 核实后，只删除已合并、无独有内容且不再使用的分支。

操作前反复检查固定分支/HEAD；发现变化后锁止会话，切回原分支也不自动解除。新授权使用独立策略目录保存 baseline，所有旧记录原样保留；任一历史 Pending Journal 阻断新授权，不能通过换分支/权限逃逸。旧 lease 必须匹配且正常 closed，未知/旧格式租约不自动迁移。

脚本和操作前检查不能为任意外部 Git/GUI 并发提供文件事务保证。分支意外变化且 XAE 尚开时，保留内存和磁盘现场，不自动保存/重试/结束进程。候选版本仍需真实单目录验收，见 [验收清单](TESTING.md#single-checkout-release-gate)。
