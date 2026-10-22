# AGENTS.md 项目适配与删改说明

日期：2026-10-23。

## 1. 输入与适用范围

本次将用户提供的 `C:\Users\30728\Documents\token-usage\AGENTS.md` 作为待适配模板，并对照当前 Shiroha Quiz 源码与配置修改[仓库根规范](../AGENTS.md)。修改前两份 AGENTS.md 内容一致；外部原文件不修改。

用户提供的 `C:\Users\30728\Documents\deepseek-harness\default-workspace\rust-style-guide.md` 原样复制到 [rules/rust-style-guide.md](../rules/rust-style-guide.md)，由根规范使用相对链接引用。原文作为参考材料，其配置示例不自动成为本项目指令；Rust 适用边界写在根规范第 4.2 节。

首次规范适配仅修改文档，未实施框架迁移、Rust edition 升级、工具链固定、依赖调整或新的自动化脚本。后续按用户要求扩展 `lint:docs` 覆盖范围，见第 5 节。

## 2. 删改方案与处理结果

下表均已落实到当前根规范。

| 原内容 | 处理 | 原因与替代方案 |
| --- | --- | --- |
| 缺少项目结构与运行范围 | 新增 | 列出 Web、Tauri 桌面、Android、测试与文档目录；标明桌面仍为复用 Web 的原型 |
| Codex 会话目录只读、Token 计量、未知价格、估算账单 | 删除并替换 | 属于 Token 统计项目；改为题库数据保全、导入判定、跨端备份兼容及凭据保密 |
| Electron 主进程、Renderer、preload IPC | 替换 | 使用 Tauri 最小权限与受控原生边界；保留浏览器读取用户选择文件和发起 AI/WebDAV 请求的当前行为 |
| 所有任务统一执行 npm 命令 | 调整 | 根目录无 package.json；桌面 npm 检查注明工作目录，Web/Android/Rust 按影响范围执行各自检查 |
| Electron 修改追加 build | 替换 | 改为 Tauri/Rust、桌面资源、依赖与构建配置；运行行为追加 WebView2 验证 |
| 缺少 Rust 规范入口 | 新增 | 引用用户指南，明确 edition 2021、单 crate 应用、应用锁文件与按需 API 规则 |
| 全局禁止 any/var | 限定语言范围 | 保留 JavaScript/TypeScript 约束，不错误禁止 Kotlin var；桌面脚本保持 JSDoc + checkJs |
| 费用、预算、Token 等核心业务说明 | 替换 | 改为题库解析、答案判定、评分、练习/考试状态、备份恢复和权限边界 |
| React 规范与不存在的 rules/react-guide.md | 删除 | 现有 Web 是 HTML/CSS/JavaScript，Android 是 Compose；不为适配文档引入 React |
| 强制中英文资源及 src/shared/i18n、tests/i18n.test.ts | 替换 | 这些路径不存在；保持现有中文文案与模块资源方式，保留可访问性要求 |
| src/renderer/utils/formatters.ts 等格式化路径 | 替换 | 路径不存在；复用各模块已有格式化，并保护导入/导出格式兼容 |
| rules/style-guide.md、annotation-guide.md、file-header.md | 删除失效入口 | 当前仓库不存在；保留必要的注释与代码原则，只链接真实存在的补充指南 |
| 默认已有 Prettier、lint-staged 与提交阶段文档检查 | 删除不实描述 | 当前无相关配置；说明真实工具与检查覆盖范围，不把规则文字当作已实现的自动化 |
| lint:docs 被当作全仓 Markdown 检查 | 澄清并后续扩展 | 首次适配时只列 3 份桌面文档；后续加入根规范、Rust 指南和本说明，共 6 份，仍未覆盖全仓 Markdown；未列入的文档另做等价检查 |
| 设计确认、先回归后修复、失败如实报告 | 保留并精简 | 保留既有开发流程及无法稳定自动化时的人工验证替代条件 |
| 注释说明原因、删除注释前确认、缓存生命周期 | 保留 | 不因适配项目放宽已有注释约束 |
| 最小改动、保留用户修改、不主动 commit/push | 保留 | 补充包管理器、依赖进程归属与 SSH 远程等用户已有要求 |
| 生成资源与离线运行边界 | 新增 | apps/web 是桌面业务源码来源；不手改 dist，保留许可证，保护 CSP 与路径清理边界 |

## 3. Rust 指南的引用边界

原文保留，不对用户上传文件做隐式修订。以下内容由根规范限定其适用方式：

| 指南内容 | 本项目采用方式 |
| --- | --- |
| Rust 2024、rustc 1.85、rust-toolchain.toml 示例 | 当前 Cargo.toml 为 edition 2021；示例不触发工具链或 edition 变更，也不虚构已声明的 MSRV |
| workspace lint、rustfmt 与依赖片段 | 当前是单 crate Tauri 应用，配置以仓库为准，不直接添加 workspace、lint 或依赖 |
| 格式、命名、借用、错误与 unsafe 建议 | 作为补充参考；格式由工具处理，错误与安全规则按实际边界落实，不改变数据字符串以满足排版要求 |
| 公开类型统一 non_exhaustive、成套派生等概括规则 | 按实际对外 API 和 trait 用途选择，不强加给应用内部所有 pub 类型 |
| anyhow/thiserror 与 main 返回 Result 的示例 | 不自动引入依赖或改造 Tauri 启动入口；重点是外部输入可恢复、错误可处理且不泄露敏感数据 |
| Cargo.lock 策略 | 保留当前应用锁文件；不因后续增加库 target 删除锁文件 |
| CI、all-features、Miri/nightly 示例 | 不宣称本项目已配置这些门禁；Rust fmt/Clippy/test 是根规范明确新增的按需验证要求，涉及 feature/unsafe 时再补相应验证 |

## 4. 事实依据

- [桌面工程说明](../apps/desktop/README.md)：Tauri/WebView2、资源复用、localStorage、网络限制与实际运行验证。
- [桌面 package.json](../apps/desktop/package.json)、[TypeScript 配置](../apps/desktop/tsconfig.json)、[ESLint 配置](../apps/desktop/eslint.config.mjs)：真实脚本与检查范围。
- [Cargo.toml](../apps/desktop/src-tauri/Cargo.toml)、[Tauri 配置](../apps/desktop/src-tauri/tauri.conf.json)：edition、依赖、应用标识、权限与 CSP。
- [资源准备脚本](../apps/desktop/scripts/prepare-web.mjs)：生成目录、路径校验与许可证保留。
- [文档检查脚本](../apps/desktop/scripts/check-docs.mjs)：检查名单包含原有桌面说明、原型设计与计划，以及后续加入的根 AGENTS.md、Rust 指南和本说明，共 6 份；`npm run lint` 已包含 `lint:docs`。
- [Android 构建配置](../apps/android/app/build.gradle.kts)：native/web flavor 与测试配置。
- [WebDAV 回归说明](../test/web-webdav/README.md)、[Web AI 回归说明](../test/web-ai-practice/README.md)、[原生解析器回归说明](../test/native-parser-regression/README.md)：平台测试入口与隔离要求。
- [贡献指南](../CONTRIBUTING.md)：凭据不得进入备份或日志，不提交个人题库与构建产物。

## 5. 验证与范围限制

首次规范适配为纯文档变更，使用当时的 `npm run lint:docs` 检查原覆盖范围，并对根 AGENTS.md、本说明和引入的 Rust 指南单独检查 UTF-8、代码围栏及本地链接；核对 Rust 指南副本与上传源文件的 SHA-256 一致。

首次规范适配未修改应用代码、锁文件、测试与检查脚本，不以文档检查结果宣称 npm、Cargo、Android 或 WebView2 业务验证通过。规则中新增的按需检查要求也不等于已部署 CI 或 Git Hook。

后续按用户要求扩展现有文档检查脚本，将根 `AGENTS.md`、`rules/rust-style-guide.md` 和本说明纳入 `lint:docs`，并补充覆盖范围回归测试。检查总数由 3 份增至 6 份，沿用 UTF-8、代码围栏及本地链接检查；`npm run lint` 已包含此命令，无需另设入口。本次后续变更包含脚本与测试，应按根规范执行桌面测试、类型检查和 lint，并据实际结果报告验证状态。
