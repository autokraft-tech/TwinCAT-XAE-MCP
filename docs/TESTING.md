# 测试与验收

## 本地回归

Windows x64 开发机安装 XAE interop 后，构建独立输出并选择该 EXE：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File daemon/build.ps1 -OutputPath "$PWD\daemon\bin\Review"
$env:TE1000_DAEMON_EXE = "$PWD\daemon\bin\Review\Te1000Daemon.exe"
npm run check
npm test
npm run test:offline
node daemon/test-ping.js
git diff --check
```

| 测试 | 验证内容 |
| --- | --- |
| npm run check | MCP 入口语法 |
| npm test | 工程解析、文档本地链接和默认禁用配置模板 |
| offline-surface.test.js | 只读 4/Dev 8 工具面及禁止操作/623 |
| daemon-offline-policy.test.js | 167 项 raw pipe COM 前拒绝，含正式写入及 623 |
| daemon-client.test.js | UTF-8 中文、断线不重放、超时、旧 socket 迟到事件 |
| daemon-managed-client.test.js | 身份绑定，验证后 socket 替换拒绝写入 |
| daemon-lifecycle-policy.test.js | 25 项身份/生命周期夹具，含 pending/executing/blocked，无真实 XAE |
| daemon/test-worker.ps1 | 6 类只读拒绝、20 个同 STA 任务、超时不替换 worker |
| daemon/test-save-audit.ps1 | 58 项文件夹夹具：GUID/配置/引用/即时写盘/journal/恢复 |
| daemon/test-object-creation.ps1 | ALIAS 内部 builder 拒绝，FB 兼容，无 COM |
| dev-profile.test.ps1 | 权限、主 checkout/脏副本拒绝、UTF-8、完整任务 action 校验，不注册任务 |
| daemon/test-ping.js | 临时 Daemon，17 工程/20 可发现动作，不操作真实 XAE |

JS 测试位于 tests/。离线回归只启动临时夹具，不连接 PLC。GitHub CI 目前仅 Ubuntu npm check/test；Windows/interop 回归须本机执行，不能称作 CI 已验收 COM。

## 真实隔离 XAE 证据

ST FB、直接 FB Method、STRUCT、ENUM、GVL 分别完成创建/修改、审计保存、重载、代码/GUID/唯一 Compile 引用及离线编译。GVL 覆盖 BOOL/DINT/REAL/ARRAY/自定义 STRUCT。代表性构建 0 错误、1 条既有 SPT C0196 库警告，第三方库未改。

双 MCP 正式只读/Dev 隔离、前端异常断线不重放、CLI 多次退出/启动后 Daemon/XAE PID 和打开计数稳定、正常 stop/显式 start、已审计保存后的失效重附加同一 XAE 并继续编辑均经过真实验证。正式 65 个跟踪文件、二进制、用户配置及两个 ALIAS journal 的保护哈希保持一致。

20 次暖态 status/get_impl 往返：最小 16.49 ms、中位 22.27 ms、平均 23.19 ms、最大 31.83 ms，含 managed 身份检查。一次带审计离线编译约 11.09 s。冷启动更慢，首次读取预算曾不足；这些是单机样本，不是 SLA 或长期稳定性证明。

源码快照、完整 diff、日志、计划任务 XML 和审计留在 ignored artifacts，不发布。Git 保留开发过程，正式文档维护当前能力。

## 实机测试入口

默认不执行。先建全新授权副本，检查脚本探针和全部动作，输出到 ignored artifacts。不要为整理/提交重跑危险注入。

| 脚本 | 用途/约束 |
| --- | --- |
| tests/live-engineering.js | 接受 mode、Profile、输出目录；inspect/create/reconnect/build/denials/benchmark；stop-guard/disconnect/duplicate/crash-daemon 需单独授权 |
| tests/live-client-reuse.js | 实际 Codex EXE、Profile、输出目录、label；只读检查双服务及 PID |
| tests/nexplc-method.js | 直接 Method 全流程，先核对脚本约定与授权 |
| tests/nexplc-object-acceptance.js | STRUCT/ENUM/GVL；保留特定夹具命名，不是通用部署工具 |
| tests/nexplc-dual-acceptance.js | 双服务隔离和 raw pipe 拒绝 |
| tests/nexplc-readonly.js | 既有只读检查 |
| tests/nexplc-save-safety.js / nexplc-write.js / nexplc-lifecycle.js | 保留旧手动夹具的保存拒绝、身份和附加实例保护检查；有固定探针/旧 autostart 假设，不能直接用于 managed 部署流程 |

双环境 runner 要显式 NEXPLC_PRODUCTION_SOLUTION，不猜生产路径。harness 保留历史 FB_MCP_P4 探针和兼容入口名以免破坏外部脚本，不作为开发阶段流程。

## 未验证边界

注销/重新登录自动启动、真实另一用户/会话尝试、真实 COM 写超时/晚返回、断电事务、长时间运行、GUI 并发、全部异常崩溃路径、外链/非标准布局及 Method 文件夹写入尚未验收。协议/文件夹模拟不能替代实测。ALIAS 禁用且不得重试失败实验；保存审计不是回滚。
