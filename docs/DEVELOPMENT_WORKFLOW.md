# 隔离开发流程

正式工程只读。写入只在明确授权的隔离工程中执行。以下占位符必须替换并核对，代码提交不代表部署。

## 准备

从已知 PLC 仓库提交建立独立 linked Worktree，不复制正式未提交变更；在 MCP 仓库根目录独立构建：

```powershell
git -C '<PLC_REPOSITORY>' worktree add -b '<DEV_BRANCH>' '<DEV_WORKTREE>' '<KNOWN_COMMIT>'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File daemon/build.ps1 -OutputPath "$PWD\daemon\bin\Review"
```

helper 要求已验收 MySPT_Machine/MySPT_Machine.sln、MainPLC 等布局，从 Git common directory 识别主 checkout 并拒绝主 checkout/脏副本。其他布局需独立验证，不能手写 Profile 绕过检查。

## 精确启动权限

将 `<PLC_ROOT>` 替换为实际已验证树根，仅保留任务所需对象/类型：

```powershell
$plc = '<PLC_ROOT>'
& ./daemon/new-dev-profile.ps1 `
  -Worktree '<DEV_WORKTREE>' `
  -DaemonExe "$PWD\daemon\bin\Review\Te1000Daemon.exe" `
  -Profile "$PWD\artifacts\my-task\profile.json" `
  -TaskName 'NexPlcXae-Dev-MyTask' -Pipe 'nexplc-p4-dev-my-task' `
  -WriteRoots @("$plc^03_POUs^FB_Example", "$plc^03_POUs^FB_Existing^M_Example", "$plc^01_DUTs^ST_Example", "$plc^01_DUTs^E_Example", "$plc^04_GVLs^GVL_Example") `
  -WriteTypes @(604,609,606,605,615)
```

生成器只写 UTF-8 本地配置，不安装/启动任务。FB 授权保留直接子方法行为；文件夹内已有 Method 必须单独授权完整路径，不能借父 FB 授权。深层授权通过只读检查已有 XAE 文件确认精确对象，写入时再通过 COM 验证实际父级链。623、文件夹级权限及 Profile 覆盖被拒绝。

按 [生命周期](XAE_LIFECYCLE.md) install/start/status/diagnose。将 Profile 完整 env 复制到默认禁用的 [Dev 模板](../examples/nexplc-codex-dev.toml)，保持 connect-only 后启用；不改正式 MCP。

## 编辑、审查、集成

1. xae.status 确认精确 Solution、System Manager、PID/所有权，读取树和已有代码。
2. 按 [API](PLC_OBJECT_API.md) 创建/修改；Method/DUT/GVL 更新传完整内容哈希，不手写 XML/GUID。
3. preview → save → audit，检查 saved/safe、完整 diff、GUID、唯一 Compile 引用、关键配置和 TmcHash。
4. 同一路径 open_solution 携 closeExisting=true 重载自有 Dev，读回代码/身份；离线 xae_build、检查 error_list，再审计保存形成恢复基线。
5. 复核完整 Git Diff，仅集成授权 PLC 代码，不带日志/快照/journal/机器数据。Git 提交/推送/合并需明确授权。

未知结果/锁止立即停止写入和成果集成，保留现场 [诊断](TROUBLESHOOTING.md)。不重试、换管道清锁、reset 失败副本或改第三方框架。任务结束仅在保存/审计/所有权通过后正常 stop；不触碰手工 XAE，未保存编辑不能靠重启恢复。
