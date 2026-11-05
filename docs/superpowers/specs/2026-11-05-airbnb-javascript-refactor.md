# Airbnb JavaScript 规范引入与渐进重构设计

日期：2026-11-05。状态：用户已明确批准按现有设计和计划分阶段实施；P0—P5 已完成并停止，实际验证、历史债务和交接见实施计划第 6—11 节。依据：[根规范](../../../AGENTS.md)、[JavaScript 项目适配](../../../rules/javascript-style-guide.md)。

执行约束：用户要求“分阶段执行重构计划，每个阶段你都要使用新会话”。P0—P5 各使用独立新会话，严格串行复用 `C:/Users/30728/.codex/worktrees/8d15/shiroha-quiz-desktop` 交接；各阶段不得并行修改该工作树。本次授权不包含提交、推送、PR、发布或工作树清理。

## 1. 目标与非目标

采用 Airbnb 的可读性、作用域、函数和条件表达原则，为现有 JavaScript 建立可执行的增量检查，并逐步缩小共享业务单文件的修改范围。验收以行为保全、检查覆盖和可独立回退的切片为准，不以减少行数或消除历史版本后缀为目标。

保持 npm、ESLint 10、现有 JavaScript + JSDoc/checkJs、浏览器脚本加载方式和 Tauri 安全边界。React、全量 TypeScript、全站 ESM、Rust 重构、备份升级和 UI 改版均不在本方案内。

## 2. 实际基线

盘点基线为 `cbd56bfdfe3fdbc9e87689cb5df560e573b80fcb`。规划盘点时工作树起始干净；本地 `main`、`origin/main` 与 GitHub API 核对的远端 `main` 一致。SSH 只读查询被当前网络权限阻止，未据此调整 SSH 或代理。

以下统计只含 Git 跟踪的 `.js/.mjs/.cjs`，排除 `apps/web/libs/`；行数按去除文件末尾空白后的物理行统计，长行不代表低复杂度，路径分组之间可能包含关系。

| 对象 | 实际情况 | 对方案的影响 |
| --- | --- | --- |
| `apps/web/app.js` | 10,224 行、786,878 字节；最外层 IIFE，集中持有练习、考试、导入、AI 和持久化状态 | 先固定行为，再拆纯计算；不整体格式化后直接抽模块 |
| `apps/web/question-bank.js` | 4 行、193,960 字节；内置 C1 题库和 `file://` 初始化兜底 | 作为数据载体保留，不能因为长行而当作重构热点 |
| `apps/web/platform/` | 7 个 JavaScript 文件，共 688 行；已有适配接口与保存队列 | 保留能力边界，适合作为规范验证的较小范围 |
| `apps/web/training.js` | 51 行；通过 `ShirohaTraining` 提供时钟和复盘计算 | 适合作为首个行为不变的可读性试点 |
| `apps/desktop/frontend/` | 5 个 JavaScript 文件，共 1,475 行；其中 `adapter.js` 408 行、`harness.js` 647 行 | 先保留修订、加载正文与迟到响应约束，后处理状态拆分 |
| 桌面 Node 工具 | `scripts/` 14 个文件、`test/` 11 个文件，使用 `.mjs` | 复用已有 ESLint 和类型检查入口 |
| 当前工具链 | `eslint` 10.13.0、`@eslint/js` 10.0.1、TypeScript 7.0.2；规划盘点时工作树未安装 node_modules | 规划阶段未安装依赖；P0 按锁安装、进程核对和实际测试结果见实施计划 |

### 2.1 当前检查缺口与测试耦合

- `eslint.config.mjs` 检查桌面脚本、测试和配置；`eslint.platform.config.mjs` 及 `lint-platform.mjs` 检查平台、训练、桌面前端和双端测试。`app.js`、`question-bank.js` 和其它测试目录未覆盖，不能报告为全仓门禁。
- `tsconfig.platform.json` 检查平台、桌面前端与类型样例；历史 `app.js` 未整体 checkJs，不应在此次风格引入中同时打开全量严格类型检查。
- `test/dual-platform/web-source.cjs` 通过 IIFE 启动边界注入测试桥接；WebDAV、部分 AI 测试还依赖源码提取，AI 浏览器 harness 也适配 IIFE。格式、函数名或加载次序变化都可能先破坏测试入口。
- `prepare-web.mjs` 维护资源条目、生成桌面脚本并外置内联事件。新增浏览器文件必须由这里进入桌面资源，不手改 `dist`，不放宽 CSP。
- 当前 CI 和 pre-commit 调用 `npm run lint`。新门禁必须接入现有命令，保持只读检查；Pages 发布流程的独立性仍按现有规范处理，本任务不修改发布授权。

## 3. ESLint 10 工具选型

本节保留设计时的候选核对历史；P2 已重新验证并采用 Stylistic 5.10.0，实际安装、烟测、覆盖与限制见实施计划第 8 节。下面为 2026-11-05 设计时核对的上游源码、版本标签和 npm 官方仓库发布元数据。只读 `npm view` 确认 Stylistic 最新稳定版为 5.10.0、import-x 为 4.17.1、airbnb-extended 为 3.3.0，三者均为 MIT 许可；查询显式使用官方 registry，没有修改本机 npm 配置。尚未在本工作树安装或完成插件运行烟测，不能将声明兼容当作本项目全部场景已验证。

| 方案 | 已核对证据 | 决策 |
| --- | --- | --- |
| 官方 `eslint-config-airbnb-base` 15.0.0 | [固定版本源码](https://github.com/airbnb/javascript/blob/8ed19247bef145e3cc41b24a02dd1fe6d9b5e681/packages/eslint-config-airbnb-base/package.json) 声明 ESLint `^7.32.0 \|\| ^8.2.0`；入口使用旧式 extends | 不直接安装，不降级 ESLint，不使用 force/legacy-peer-deps 绕过依赖 |
| 社区 `eslint-config-airbnb-extended` | [包配置](https://github.com/eslint-config/airbnb-extended/blob/master/packages/eslint-config-airbnb-extended/package.json) 核对时版本 3.3.0、peer 为 ESLint `^9.0.0`；[ESLint 10 跟踪事项](https://github.com/eslint-config/airbnb-extended/issues/65) 仍未关闭 | 不作为当前 ESLint 10 整套预设；支持 flat config 不等于支持 ESLint 10 |
| `@eslint/js` + 项目规则 | 项目已经采用 recommended + 局部规则；[ESLint 10 已移除旧 eslintrc](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/) | 保留为语义检查基础，以 flat config 组合规则 |
| `@stylistic/eslint-plugin` 5.10.0 | [v5.10.0 包配置](https://github.com/eslint-stylistic/eslint-stylistic/blob/v5.10.0/packages/eslint-plugin/package.json) 与 npm 发布元数据声明 ESLint `^9.0.0 \|\| ^10.0.0` | 作为风格检查候选；显式配置 Airbnb 对应规则和项目例外，不直接采用另一套默认风格 |
| `eslint-plugin-import-x` | [v4.17.1 更新记录](https://github.com/un-ts/eslint-plugin-import-x/blob/v4.17.1/CHANGELOG.md) 包含 ESLint 10 支持；`no-unused-modules` 在 ESLint 10 暂不执行检查 | 作为 ESM 导入检查候选；不启用或宣称拥有 `no-unused-modules` 覆盖，也不隐藏警告冒充通过 |

建议组合为 **已有 `@eslint/js` + 显式语义规则 + Stylistic + 按需 import-x**。这属于 Airbnb 项目适配，不声称完整复刻官方配置。Stylistic 先于 import-x；当前 classic script 不存在模块导入，只有确有 ESM 检查需要且烟测通过时才加入 import-x。

新增包仅作为开发依赖，不进入 Web/Tauri 生产资源。实施前核对 npm 已发布稳定版本、peer 范围、传递依赖、许可证、Windows 原生 resolver 和安装影响；不得把上游主分支或 beta 当作已经发布的稳定版本。本方案不预先填写未经测量的包体积，也不因插件带类型依赖而扩展为 TypeScript 迁移。

## 4. 检查与重构方式

### 4.1 规则分层

| 层次 | 采用内容 | 推进方式 |
| --- | --- | --- |
| 已有正确性门禁 | recommended、no-var、prefer-const、现有 no-unused-vars | 保持强度和现有覆盖，不以迁移为由放宽 |
| 增量语义规则 | eqeqeq（保留有意 `== null`）、no-nested-ternary、no-param-reassign（先不禁止属性修改）、no-duplicate-imports、no-eval、no-new-func、guard-for-in | 先输出每文件/规则清单，逐规则、逐范围清零后设 error；覆盖外的问题显式记录 |
| 目标格式 | 2 空格、单引号、分号、尾逗号、箭头参数括号、运算符与块间距 | 使用 Stylistic 对已迁移文件执行只读检查；历史 app.js 先保留报告，按业务拆出文件后收紧 |
| 导入规则 | ESM 文件的缺失模块、重复导入等 | 按 ESM/Node/CommonJS/classic script 分配置验证；本项目的扩展名和导出例外优先 |
| 业务可读性 | 命名条件、共享判断、状态所有权、取消和失败恢复 | 代码审查配合行为测试，不能只靠格式通过证明 |

工具 smoke fixture 应验证规则确实会报错、正确代码可通过，以及 IIFE/global、`.mjs` 和 `.cjs` 三类运行时配置。生产页面不能新增任意 `eval`；测试中现有隔离 `vm`/浏览器求值机制按用途单独处理，不扩大为生产能力。

历史债务报告与正式门禁分开：保持现有门禁阻断错误；债务报告标明文件、规则、数量和后续批次，生成失败必须失败，不能用 `|| true` 隐藏执行错误。新建文件直接执行完整目标规则；纳入强制范围的文件不得退回债务范围，也不按告警总量抵扣新违规。

### 4.2 结构重构顺序

1. **先保证测试不依赖排版。** 固定 KEY、IIFE 启动边界、函数定位和测试导出；对会被格式化影响的加载器补少量等价源码变体验证。不得通过放宽业务断言修好加载器。
2. **先做小模块试点。** `training.js` 保持 `ShirohaTraining` API 和时钟、复盘行为，分开验证格式整理与语义条件展开；再处理平台小文件和桌面工具。
3. **抽取真正独立的共享计算。** 从 `app.js` 的分页/答案比较等已有特征测试切片开始。`scoreOf` 仍读取 DOM 默认分，若抽取只能将默认分显式传入，不能直接宣称其为纯函数。候选文件采用现有 IIFE/global 发布方式，具体路径与接口在实施批次中固定。
4. **处理解析与备份。** `parseTextQuestions`、`parseAnswerEntries`、`mergeQuestionAnswers`、`normalizeBackupPayloadV23` 等按已核对调用图拆分纯转换与 IO；先保留旧调用入口，验证题意、答案、图片、JSON/ZIP 和旧 Android 字段。
5. **最后处理高风险状态。** 练习/考试、AI 会话、`adapter.js` 正文加载/修订与 `harness.js` 的 generation/查询屏障分别处理；每批明确状态所有者、清理入口和迟到响应保护，不同时改多个状态机。

每次先核对全部调用者和数据副作用；必要时增加可复用测试入口，不能仅复制函数到新文件。删除旧实现应在全部调用完成迁移后进行；原有注释删除仍需按根规范确认。

## 5. 行为不变量与验收

- 题号、题型、等价答案、判分、练习草稿、考试记录和历史快照保持语义；重构缺少回归时先补特征测试，发现 Bug 单独红—绿修复。
- 保留备份 kind/version/schema、旧 Android JSON/ZIP 字段、图片绑定、未知版本拒绝及失败后原数据；不修改存储键、SQLite 格式和恢复点策略。
- 保留凭据隔离、受控 IPC、证书/重定向校验、CSP 和本地可执行脚本边界；AI/WebDAV 测试用 mock，不调用真实账户或收费 API。
- 每批检查通过且迁移范围清晰；Web 行为同时验证真实浏览器与桌面生成/隔离 WebView2。格式化之后的物理行数增长不作为质量退步。
- 最初规范引入按文档检查交付；获批后的 P0 基线及后续命令、批次退出条件和回退方法见[实施计划](../plans/2026-11-05-airbnb-javascript-refactor.md)；未执行项目测试和插件烟测不能标为通过。
