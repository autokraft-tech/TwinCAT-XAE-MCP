# 测试与验收

单目录模式覆盖 test-git-checkout.ps1、主 checkout Profile、跨策略审计锁夹具；必须额外完成 [真实单目录验收](TESTING.md#single-checkout-release-gate)，不能以单元测试代替。旧 live 脚本中的固定 linked-worktree 路径不适用于新模式，不能默认运行来创建新副本。

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
| daemon-offline-policy.test.js | raw pipe COM 前拒绝，含正式写入及 623 |
| daemon-client.test.js | UTF-8 中文、断线不重放、超时、旧 socket 迟到事件 |
| daemon-managed-client.test.js | 身份绑定，验证后 socket 替换拒绝写入 |
| daemon-lifecycle-policy.test.js | 身份/生命周期夹具，含 pending/executing/blocked，无真实 XAE |
| daemon/test-worker.ps1 | 只读拒绝、同 STA 任务、超时不替换 worker |
| daemon/test-save-audit.ps1 | 文件夹夹具：GUID/配置/引用/即时写盘/journal/恢复 |
| daemon/test-nested-method.ps1 | 嵌套 Method 类型/父链/精确权限/哈希/ST 检查，无 COM |
| daemon/test-object-creation.ps1 | ALIAS 内部 builder 拒绝，FB 兼容，无 COM |
| dev-profile.test.ps1 | 权限、主 checkout/脏副本拒绝、UTF-8、完整任务 action 校验，不注册任务 |
| daemon/test-ping.js | 临时 Daemon，17 工程/20 可发现动作，不操作真实 XAE |

JS 测试位于 tests/。离线回归只启动临时夹具，不连接 PLC。GitHub CI 目前仅 Ubuntu npm check/test；Windows/interop 回归须本机执行，不能称作 CI 已验收 COM。

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

注销/重新登录自动启动、真实另一用户/会话尝试、真实 COM 写超时/晚返回、断电事务、长时间运行、GUI 并发、全部异常崩溃路径、外链/非标准布局尚未完整实测。Method 文件夹按下述真实 XAE 验收要求验证。协议/文件夹模拟不能替代实测。ALIAS 禁用且不得重试失败实验；保存审计不是回滚。

## Real XAE acceptance requirements

Offline fixtures establish policy/parser behavior, not COM behavior or permission to deploy. For each supported object kind, verify the exact Solution/System Manager and daemon/XAE ownership, startup object/type authorization, full code/hash, a single XAE API mutation, preview/audited save, GUID/reference/configuration invariance, reload/readback, offline build, complete diagnostics and a final audited save before normal owned shutdown. Do not perform Runtime operations.

Nested Method acceptance additionally checks the exact folder/FB ancestry, Method name/FolderPath and owning FB identity; parent code, sibling Methods and project references must not change. A multi-folder COM path requires an independent real specimen; nested creation and nonstandard layouts remain unsupported. Keep the live test source, but do not commit its results, snapshots, profiles or logs.

ALIAS remains disabled and failed/unknown calls must not be replayed. Pending/executing/blocked journals, leases, baselines and recovery-dependent evidence are exempt from ordinary temporary-output cleanup. Never rerun dangerous injection merely to clean documentation or obtain a fresh result.

## Single-checkout release gate

Single-checkout releases require real primary-checkout XAE offline acceptance; offline tests or report cleanup alone do not authorize integration or deployment. Use an explicitly authorized Dev MCP only after protecting existing user work and normally closing the prior owned XAE. Unknown/legacy leases and pending journals must not be rewritten to obtain acceptance.

| Acceptance | Required evidence |
| --- | --- |
| Primary checkout feature branch | Exact checkout/branch/HEAD/Solution and daemon/XAE identity; one authorized XAE API edit; contentHash and GUID/reference invariance |
| main and branch/HEAD drift | Refusal before mutation, including a switch away/back; no write replay |
| Open XAE branch switch | Helper refuses without forced closure; old in-memory objects cannot save to another branch |
| Solution exclusivity | Existing read-only or user XAE prevents a second dedicated instance |
| Read-only and unauthorized objects | Existing read-only tools work; writes and out-of-scope objects are refused |
| Save audit and offline build | Preview/save/audit, reload/readback, build, all diagnostics, final audited save |
| Nested Method regression | Existing exact Method update passes; nested creation stays denied |
| COM/audit failure | No automatic retry/replacement; historical Pending Journal blocks a new branch/profile |
| Normal close and reinitialization | Closed lease, no pending/unknown outcome, commit/switch with XAE closed, fresh exact profile |

Branch-policy baselines remain separate while all earlier solution journals are checked. Preserve legacy audit evidence; changing pipe/branch/permissions is not recovery. Arbitrary external Git/GUI concurrency is not a filesystem transaction and must follow the documented shutdown workflow.

### Fixed-checkout live harness

`tests/live-single-checkout.js <stage> <exact-profile.json>` is opt-in. `flow` performs an authorized nested Method write, audited save/reload/readback, restoration through XAE, offline build and final save; it also checks scope/hash refusals and refusal to switch under an open XAE. `drift` tests the real HEAD-rewrite fence without switching a branch beneath XAE. `reconnect` verifies a newly owned session after normal shutdown. `deny-main`, `deny-branch` and `read-only` require a clean checkout and test temporary roles, backend refusals and normal closed-lease handoff. Results print to the caller; do not commit result files.

Actual branch changes are performed only with XAE closed. The offline Git guard fixtures additionally change branches and commits while checking policy refusals; a live acceptance must not bypass the branch-switch prohibition just to inject drift. Investigate every new diagnostic. Stale messages must be distinguished by a fresh normally closed/reopened session and complete diagnostics; do not suppress unknown warnings or edit generated PLC XML to pass acceptance.
