# 配置与使用示例

- [只读 TOML](nexplc-codex.toml)：正式 nexplc_xae，不授权写/保存/编译。
- [Dev TOML](nexplc-codex-dev.toml)：独立 nexplc_xae_dev，connect-only，复制已审查 Profile 完整 env。
- [其他客户端 JSON](mcp-config.json)：默认禁用；替换占位符后按客户端格式启用。

模板不是本机注册配置。SID/session 来自当前用户 Profile，不是可分享凭据。[开发流程](../docs/DEVELOPMENT_WORKFLOW.md) 包含 Dev Profile 生成示例，[生命周期](../docs/XAE_LIFECYCLE.md) 包含计划任务操作，[对象 API](../docs/PLC_OBJECT_API.md) 包含编辑参数。

helper 目前针对已验收工程布局，不能套模板就宣称任意工程支持。真实 Profile、日志、journal 和源码差异留在 ignored 本机目录。ALIAS、在线控制和下载不支持。
