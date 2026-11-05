# Shiroha Quiz 文档索引

这里整理当前仍建议阅读的文档入口。主要文档按主题放在独立文件夹中；历史计划和旧方案统一放在 `archive/`，避免和当前主线混在一起。

当前主线为 Web 与 Windows 桌面。Android 已退出本仓库维护，保留旧 JSON/ZIP 备份兼容；当前功能与验收边界见根 README 和桌面说明。

## 目录

- [用户文档](README.md#docs-user)
- [Android 历史资料](README.md#docs-native)
- [工程与发布](README.md#docs-engineering)
- [计划归档参考](README.md#docs-plan)
- [归档文档](README.md#docs-archive)

<a name="docs-user"></a>

## 用户文档

- 标准题库格式示例：推荐题库格式模板，含文本、Excel、普通 JSON 示例。  
  [Markdown](./标准题库格式示例/标准题库格式示例.md) / [Excel 通用模板](./标准题库格式示例/Shiroha_Quiz_Excel题库导入通用模板.xlsx)
- 题库导入格式支持说明：支持哪些文件格式、每种格式怎么写。  
  [Markdown](./题库导入格式支持说明/Shiroha_Quiz_题库导入格式支持说明.md)
- 题库导入策略与使用指南：面向普通用户的导入入口、AI 辅助、预览检查和备份恢复说明。<br>
  [Markdown](./题库导入策略与使用指南/Shiroha Quiz 题库导入策略与使用指南.md)
- 题目导入解析方法说明：解释软件如何识别题号、选项、答案、解析、集中答案区和异常提示。<br>
  [Markdown](./题目导入解析方法说明/Shiroha Quiz 题目导入解析方法说明.md)
- WebDAV 云备份使用指南：把题库备份到自己的 WebDAV 云盘，含 Web/Windows 配置和手动云端恢复说明。<br>
  [Markdown](./WebDAV云备份使用指南/Shiroha Quiz WebDAV 云备份使用指南.md)

<a name="docs-native"></a>

## Android 历史资料

- [停止维护与旧备份迁移](./universal/Android停止维护与迁移.md)
- [归档的 Android 开发、设计与测试资料](./archive/native/README.md)
- [历史解析样例（不作为 Web 通过清单）](../test/fixtures/legacy-android-parser/README.md)
- [旧版指南及 Word/PDF 历史快照](./archive/android-era-documents/README.md)

<a name="docs-engineering"></a>

## 工程与发布

- [Airbnb JavaScript 项目适配指南](../rules/javascript-style-guide.md)
- [Airbnb JavaScript 规范引入与重构设计（已批准，分阶段实施）](./superpowers/specs/2026-11-05-airbnb-javascript-refactor.md)
- [Airbnb JavaScript 分阶段实施计划与验证记录](./superpowers/plans/2026-11-05-airbnb-javascript-refactor.md)
- Airbnb 重构已按用户授权完成 P0—P5，各阶段串行交接；历史规则债务和验证限制见上述实施计划，未授权提交、推送、PR 或发布。
- [Android 移除设计](./superpowers/specs/2026-11-04-remove-android-support.md)
- [Android 移除实施与验证](./superpowers/plans/2026-11-05-remove-android-support.md)

- [协作开发分支规划](./universal/协作开发分支规划.md)
- [Web 与 Windows 桌面双端设计](./superpowers/specs/2026-10-23-web-desktop-dual-platform-design.md)
- [AI 设置中的 Harness 执行方式设计（已确认，仅订阅登录）](./superpowers/specs/2026-10-24-ai-harness-execution.md)
- [Codex Harness 实施计划与验证记录](./superpowers/plans/2026-10-24-ai-harness-execution.md)
- [Codex 组件自动管理设计](./superpowers/specs/2026-10-25-managed-codex-runtime.md)
- [Codex 组件自动管理实施与验证](./superpowers/plans/2026-10-25-managed-codex-runtime.md)
- [CodeBuddy CLI 直接管道可行性验证（P0 未通过）](./superpowers/plans/2026-10-25-codebuddy-cli-stdio-p0.md)
- [CodeBuddy 自有适配层补救设计与研究](./superpowers/specs/2026-10-25-codebuddy-adapter-containment.md)
- [CodeBuddy 适配层转发与原生隔离验证](./superpowers/plans/2026-10-25-codebuddy-adapter-p0.md)
- [CodeBuddy Rust 原生适配器实施与验证](./superpowers/plans/2026-10-25-codebuddy-native-adapter.md)
- [CodeBuddy 模型响应兼容与执行前置验证](./superpowers/plans/2026-10-25-codebuddy-model-compatibility.md)
- [CodeBuddy 客户端正式执行设计](./superpowers/specs/2026-10-25-codebuddy-client-execution.md)
- [CodeBuddy 单题解析与追问接入计划](./superpowers/plans/2026-10-25-codebuddy-client-execution.md)
- [CodeBuddy 登录状态存储设计（已批准）](./superpowers/specs/2026-10-28-codebuddy-login-storage.md)
- [CodeBuddy 登录状态存储实施与验证](./superpowers/plans/2026-10-28-codebuddy-login-storage.md)
- [CodeBuddy CLI 共享登录设计（已批准，仅独立 CLI）](./superpowers/specs/2026-11-04-codebuddy-cli-auth.md)
- [CodeBuddy CLI 共享登录实施与验证](./superpowers/plans/2026-11-04-codebuddy-cli-auth.md)
- [Harness 提供方选择与账户保留](./superpowers/plans/2026-10-25-harness-provider-selection.md)
- [Codex 学习助手嵌入设计（暂缓）](./superpowers/specs/2026-10-24-codex-learning-assistant.md)
- [Windows 候选安装包、人工升级和验收限制](../apps/desktop/README.md#候选安装包与人工升级)
- [Windows GitHub Release 操作与附件校验](../.github/DESKTOP_RELEASE.md)
- [Windows GitHub Release 实施与验证](./superpowers/plans/2026-10-29-windows-github-release.md)
- [双端阶段验证记录（含阶段 E）](../test/dual-platform/README.md)
- [双端详细实施计划](./superpowers/plans/2026-10-23-web-desktop-dual-platform.md)
- [阶段 A 基线、测试入口与执行记录](../test/dual-platform/README.md)
- [架构说明](./universal/架构说明.md)
- [旧 Web/Android WebDAV 方案（历史参考）](./WebDAV同步实现方案/Shiroha%20Quiz%20WebDAV%20同步实现方案.md)
- [Git Release 操作速查](./universal/Git-Release-操作速查.md)

<a name="docs-plan"></a>

## 计划归档参考

这里收录仍有参考价值的阶段计划，但不代表当前必须按这些旧计划执行。

- [后续功能开发计划 33-34](./archive/native/Shiroha_Quiz_后续功能开发计划33-34.md)

<a name="docs-archive"></a>

## 归档文档

- [历史原生计划](./archive/native/)
- [历史 Web 计划](./archive/web/)
- [历史通用架构建议](./archive/universal/)
- [阶段 32-33 计划归档](./archive/native/Shiroha_Quiz_后续功能开发计划32-33.md)
