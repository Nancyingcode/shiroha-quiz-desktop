# 全项目 JavaScript 逐文件处置清单

本清单配合[实施计划第 8 节](2026-11-11-project-javascript-optimization.md#8-批次交接记录)。按 Git HEAD 与跟踪、未忽略的新路径、扩展名大小写不敏感及现有 ESLint 忽略规则核对：基线 **150 份手写**，当前 **163 份手写**（新增 13，未删除）；另有 **88 份第三方脚本和 1 份题库数据**。每个当前路径只出现一次；“初始/新增”以 HEAD 为准，“修改/新增/保留”以当前工作树为准。

“依据”列标识实际入口、已审查的逻辑和对应断言，第一至四批的执行结果详见交接；第五批最终全量门禁和隔离桌面 GUI 结果见实施计划第 8 节。测试中的 fixture/VM 使用自建数据和假凭据，发布检查只使用临时目录与模拟 gh，不代表真实服务或发行验收。

## Web 业务与平台（40）

| 路径 | 来源与处置 | 实际入口与依据 |
| --- | --- | --- |
| [apps/web/ai-import-panel.js](../../../apps/web/ai-import-panel.js) | 初始；修改 | Web index.html 的本地脚本；第一至三批：AI 目标、忙碌、刷新及固定按钮回归。 |
| [apps/web/ai-import-sessions.js](../../../apps/web/ai-import-sessions.js) | 初始；修改 | Web index.html 的本地脚本；第一、二、四批：ai-import-retry 的身份、ABA 与人工确认。 |
| [apps/web/ai-prompts.js](../../../apps/web/ai-prompts.js) | 初始；保留 | Web index.html 的本地脚本；第一批：ai-import-retry 与浏览器 mock 请求载荷。 |
| [apps/web/ai-question-panels.js](../../../apps/web/ai-question-panels.js) | 初始；保留 | Web index.html 的本地脚本；第一批：web-ai-practice 的单题与人工确认。 |
| [apps/web/ai-question-sessions.js](../../../apps/web/ai-question-sessions.js) | 初始；保留 | Web index.html 的本地脚本；第一批：web-ai-practice 的切题、取消和迟到结果。 |
| [apps/web/ai-results.js](../../../apps/web/ai-results.js) | 初始；修改 | Web index.html 的本地脚本；第一批：ai-results 的模式与未知 ID。 |
| [apps/web/ai-settings.js](../../../apps/web/ai-settings.js) | 初始；保留 | Web index.html 的本地脚本；第一批：ai-harness、ai-codebuddy-execution 的就绪与配置。 |
| [apps/web/ai-transport.js](../../../apps/web/ai-transport.js) | 初始；修改 | Web index.html 的本地脚本；第一批：ai-connection、ai-import-retry 的取消与兼容重试。 |
| [apps/web/app.js](../../../apps/web/app.js) | 初始；修改 | Web index.html 的本地脚本；第一至四批：草稿/页面归属、保存与备份；browser-page、format、空图片回归。 |
| [apps/web/backup-archive.js](../../../apps/web/backup-archive.js) | 初始；保留 | Web index.html 的本地脚本；第四批：format 与 zip-safety 的备份/ZIP 边界。 |
| [apps/web/backup-core.js](../../../apps/web/backup-core.js) | 初始；保留 | Web index.html 的本地脚本；第四批：backup-core 和 format 的转换/保全。 |
| [apps/web/backup-data.js](../../../apps/web/backup-data.js) | 初始；保留 | Web index.html 的本地脚本；第四批：format 的旧 Android 及当前题优先规则。 |
| [apps/web/bank-editor.js](../../../apps/web/bank-editor.js) | 初始；修改 | Web index.html 的本地脚本；第三、四批：browser-page 的旧按钮及编辑草稿归属。 |
| [apps/web/bank-page.js](../../../apps/web/bank-page.js) | 初始；修改 | Web index.html 的本地脚本；第三批：browser-page 的选择、分页与旧读取归属。 |
| [apps/web/docx-import.js](../../../apps/web/docx-import.js) | 初始；保留 | Web index.html 的本地脚本；第四批：document-formats 和自建 DOCX 离线导入。 |
| [apps/web/exam-page.js](../../../apps/web/exam-page.js) | 初始；修改 | Web index.html 的本地脚本；第三批：browser-page 的答题卡、保存失败与自动交卷。 |
| [apps/web/import-preview.js](../../../apps/web/import-preview.js) | 初始；修改 | Web index.html 的本地脚本；第一、四批：快照及 import-ownership 的读取代次。 |
| [apps/web/ocr-import.js](../../../apps/web/ocr-import.js) | 初始；保留 | Web index.html 的本地脚本；第四批：document-lifecycle 和自建中文扫描 PDF/OCR。 |
| [apps/web/pdf-import.js](../../../apps/web/pdf-import.js) | 初始；保留 | Web index.html 的本地脚本；第四批：document-lifecycle 和自建文字层 PDF。 |
| [apps/web/platform/browser-credentials.js](../../../apps/web/platform/browser-credentials.js) | 初始；保留 | Web index.html 的本地脚本；第四批：browser-credentials 检查绑定、迁移和失败补偿。 |
| [apps/web/platform/browser-network.js](../../../apps/web/platform/browser-network.js) | 初始；保留 | Web index.html 的本地脚本；第四批：web-webdav/request 的假 Fetch 与中止诊断。 |
| [apps/web/platform/browser.js](../../../apps/web/platform/browser.js) | 初始；修改 | Web index.html 的本地脚本；第一批：browser-storage 的损坏、未来版本和写入失败。 |
| [apps/web/platform/dialogs.js](../../../apps/web/platform/dialogs.js) | 初始；保留 | Web index.html 的本地脚本；第四批：dialog-page 的焦点循环与关闭恢复。 |
| [apps/web/platform/index.js](../../../apps/web/platform/index.js) | 初始；保留 | Web index.html 的本地脚本；第四批：platform-index 的平台选择和存储事件。 |
| [apps/web/platform/save-queue.js](../../../apps/web/platform/save-queue.js) | 初始；保留 | Web index.html 的本地脚本；第四批：browser-storage 与 exit 的队列、失败和重试。 |
| [apps/web/platform/validation.js](../../../apps/web/platform/validation.js) | 初始；保留 | Web index.html 的本地脚本；第四批：contracts 的参数、敏感字段和操作边界。 |
| [apps/web/practice-page.js](../../../apps/web/practice-page.js) | 初始；修改 | Web index.html 的本地脚本；第三批：browser-page 的切题、旧节点和迟到入口。 |
| [apps/web/practice-selection.js](../../../apps/web/practice-selection.js) | 初始；修改 | Web index.html 的本地脚本；第三批：practice-selection-performance 的跨库与随机计数。 |
| [apps/web/question-editor.js](../../../apps/web/question-editor.js) | 初始；修改 | Web index.html 的本地脚本；第二至四批：预览诊断、编辑归属与 preview-performance。 |
| [apps/web/question-view.js](../../../apps/web/question-view.js) | 初始；保留 | Web index.html 的本地脚本；第三批：question-view 与页面题型/焦点回归。 |
| [apps/web/quiz-core.js](../../../apps/web/quiz-core.js) | 初始；保留 | Web index.html 的本地脚本；第三批：quiz-core、business 的纯计算和评分。 |
| [apps/web/saved-questions-page.js](../../../apps/web/saved-questions-page.js) | 初始；修改 | Web index.html 的本地脚本；第三批：browser-page 的收藏/错题读取及重试。 |
| [apps/web/study-sessions.js](../../../apps/web/study-sessions.js) | 初始；修改 | Web index.html 的本地脚本；第三批：browser-page 的练习/考试会话所有权。 |
| [apps/web/table-import.js](../../../apps/web/table-import.js) | 初始；保留 | Web index.html 的本地脚本；第四批：table-import 的 CSV/XLSX。 |
| [apps/web/text-answers.js](../../../apps/web/text-answers.js) | 初始；保留 | Web index.html 的本地脚本；第三批：text-answers 和重复题号答案匹配。 |
| [apps/web/text-parser.js](../../../apps/web/text-parser.js) | 初始；修改 | Web index.html 的本地脚本；第四批：text-parser 和 parser-risk-performance 完整输出与计数。 |
| [apps/web/training-review-page.js](../../../apps/web/training-review-page.js) | 初始；修改 | Web index.html 的本地脚本；第三批：browser-page 的记录明细、复盘及焦点。 |
| [apps/web/training.js](../../../apps/web/training.js) | 初始；保留 | Web index.html 的本地脚本；第三批：training 和 training-characterization。 |
| [apps/web/webdav-panel.js](../../../apps/web/webdav-panel.js) | 初始；修改 | Web index.html 的本地脚本；第四批：browser-page 的开始、列表、取消和重试。 |
| [apps/web/zip.js](../../../apps/web/zip.js) | 初始；保留 | Web index.html 的本地脚本；第四批：zip-safety 的校验、路径与格式边界。 |

## 桌面前端（5）

| 路径 | 来源与处置 | 实际入口与依据 |
| --- | --- | --- |
| [apps/desktop/frontend/adapter.js](../../../apps/desktop/frontend/adapter.js) | 初始；修改 | prepare-web 注入；第二批 native-adapter 的有序 IPC、回执和线性计数，第四批原生网络 mock。 |
| [apps/desktop/frontend/bridge.js](../../../apps/desktop/frontend/bridge.js) | 初始；保留 | prepare-web 经 esbuild 打包并注入；config、退出和桌面 smoke。 |
| [apps/desktop/frontend/codebuddy-login.js](../../../apps/desktop/frontend/codebuddy-login.js) | 初始；保留 | prepare-web 注入；codebuddy-login 的修订、取消与账号状态。 |
| [apps/desktop/frontend/harness.js](../../../apps/desktop/frontend/harness.js) | 初始；保留 | prepare-web 注入；ai-harness 的就绪、重试和恢复屏障。 |
| [apps/desktop/frontend/titlebar.js](../../../apps/desktop/frontend/titlebar.js) | 初始；保留 | prepare-web 注入；titlebar 的窗口控制、互斥与错误反馈。 |

## 桌面脚本（初始 20，现 21）

| 路径 | 来源与处置 | 实际入口与依据 |
| --- | --- | --- |
| [apps/desktop/scripts/benchmark.mjs](../../../apps/desktop/scripts/benchmark.mjs) | 初始；修改 | npm run bench:desktop；benchmark.test 和第二批自建样本/原生读回，临时 profile。 |
| [apps/desktop/scripts/check-docs.mjs](../../../apps/desktop/scripts/check-docs.mjs) | 初始；保留 | npm run lint:docs；check-docs.test 验证 UTF-8、围栏和本地链接。 |
| [apps/desktop/scripts/codebuddy-cli-smoke.mjs](../../../apps/desktop/scripts/codebuddy-cli-smoke.mjs) | 初始；保留 | smoke.mjs 调用；隔离标记、假会话及重启回归。 |
| [apps/desktop/scripts/codebuddy-login-smoke.mjs](../../../apps/desktop/scripts/codebuddy-login-smoke.mjs) | 初始；保留 | codebuddy-cli-smoke.mjs 引用状态和任务辅助；无真实账户。 |
| [apps/desktop/scripts/dev-smoke.mjs](../../../apps/desktop/scripts/dev-smoke.mjs) | 初始；保留 | npm run test:dev；验证本地端口、隔离 profile、仅回收自有进程。 |
| [apps/desktop/scripts/document-smoke.mjs](../../../apps/desktop/scripts/document-smoke.mjs) | 初始；保留 | smoke.mjs 调用；document-page 与桌面 smoke 的自建离线文档。 |
| [apps/desktop/scripts/harness-smoke.mjs](../../../apps/desktop/scripts/harness-smoke.mjs) | 初始；保留 | smoke.mjs 调用；假订阅就绪、取消与切换。 |
| [apps/desktop/scripts/installer-integrity.mjs](../../../apps/desktop/scripts/installer-integrity.mjs) | 初始；保留 | 打包后命令与 release-artifacts；installer-integrity.test 的临时 EXE、失败和 junction。 |
| [apps/desktop/scripts/lint-ci.mjs](../../../apps/desktop/scripts/lint-ci.mjs) | 初始；保留 | npm run lint:ci；lint-ci.test 的模拟基线、合并提交、回退和失败码。 |
| [apps/desktop/scripts/lint-debt.mjs](../../../apps/desktop/scripts/lint-debt.mjs) | 初始；保留 | npm run lint:debt；lint-cli.test 的只读报告与失败传播。 |
| [apps/desktop/scripts/lint-incremental.mjs](../../../apps/desktop/scripts/lint-incremental.mjs) | 初始；修改 | npm run lint:incremental 与完整 lint；lint-dedup、mixed-extensions、worktree、链接读取探针。 |
| [apps/desktop/scripts/lint-index.mjs](../../../apps/desktop/scripts/lint-index.mjs) | 初始；保留 | pre-commit / npm run lint:index；git-hooks.test 的索引、首次提交和符号链接。 |
| [apps/desktop/scripts/lint-platform.mjs](../../../apps/desktop/scripts/lint-platform.mjs) | 初始；保留 | npm run lint:platform；platform-checks.test；独立入口仍保留。 |
| [apps/desktop/scripts/lint-runner.mjs](../../../apps/desktop/scripts/lint-runner.mjs) | 初始；修改 | npm run lint；lint-runner、lint-dedup 和 git-hooks 的并发、失败与 stdin。 |
| [apps/desktop/scripts/native-isolation.mjs](../../../apps/desktop/scripts/native-isolation.mjs) | 初始；保留 | smoke、dev-smoke、benchmark 引用；标记假凭据和禁止网络的临时 profile。 |
| [apps/desktop/scripts/network-smoke.mjs](../../../apps/desktop/scripts/network-smoke.mjs) | 初始；修改 | smoke.mjs 引用；回环假 AI/WebDAV 和受控凭据断言；本批覆盖启动失败关闭监听器并保留原错。 |
| [apps/desktop/scripts/prepare-web.mjs](../../../apps/desktop/scripts/prepare-web.mjs) | 初始；修改 | npm run prepare:web / 构建；prepare-web 与 prepare-web-actual 的顺序、字节、mtime、链接和离线资源。 |
| [apps/desktop/scripts/release-artifacts.mjs](../../../apps/desktop/scripts/release-artifacts.mjs) | 初始；保留 | desktop-release 工作流；release.test 的临时制品选择、版本、摘要和失败。 |
| [apps/desktop/scripts/release-github.mjs](../../../apps/desktop/scripts/release-github.mjs) | 初始；保留 | desktop-release 工作流；release.test 注入假 gh，核对标签、草稿及上传失败。 |
| [apps/desktop/scripts/smoke-control.mjs](../../../apps/desktop/scripts/smoke-control.mjs) | 新增；新增 | smoke.mjs 调用；smoke-timeout.test 的超时、重启、收敛和退出。 |
| [apps/desktop/scripts/smoke.mjs](../../../apps/desktop/scripts/smoke.mjs) | 初始；修改 | npm run test:desktop；自有进程、隔离 profile、mock；本批超时、启动和关闭双故障保留原错及目录，桌面 smoke 44/44。 |

## 工程配置（6）

| 路径 | 来源与处置 | 实际入口与依据 |
| --- | --- | --- |
| [apps/desktop/commitlint.config.mjs](../../../apps/desktop/commitlint.config.mjs) | 初始；保留 | commit-msg Hook / npm run commitlint；git-hooks.test 验证提交文案。 |
| [apps/desktop/eslint.config.mjs](../../../apps/desktop/eslint.config.mjs) | 初始；保留 | npm run lint:eslint 与完整 lint 的旧范围；lint-config 和 lint-dedup 检查实际配置。 |
| [apps/desktop/eslint.migration.mjs](../../../apps/desktop/eslint.migration.mjs) | 初始；保留 | eslint.rules.mjs 与 lint-debt；lint-suppressions 限制历史豁免。 |
| [apps/desktop/eslint.platform.config.mjs](../../../apps/desktop/eslint.platform.config.mjs) | 初始；保留 | 平台、增量、索引和 CI lint；lint-config 与 lint-ci。 |
| [apps/desktop/eslint.rules.mjs](../../../apps/desktop/eslint.rules.mjs) | 初始；保留 | 两套 ESLint 配置；lint-config 的规则、运行时和全局变量。 |
| [apps/desktop/stylelint.config.mjs](../../../apps/desktop/stylelint.config.mjs) | 初始；保留 | npm run lint:css；lint-css.test 的 CSS 范围及旧基线。 |

## 桌面回归与辅助（初始 22，现 26）

| 路径 | 来源与处置 | 实际入口与依据 |
| --- | --- | --- |
| [apps/desktop/test/benchmark.test.mjs](../../../apps/desktop/test/benchmark.test.mjs) | 新增；新增 | npm test；临时目录启动非桌面程序，断言失败报告、三份样本题数、源码摘要及隔离 profile；真实基准见第二批。 |
| [apps/desktop/test/check-docs.test.mjs](../../../apps/desktop/test/check-docs.test.mjs) | 初始；保留 | npm test；临时文档检查 UTF-8、代码围栏与本地链接，并验证不同工作目录。 |
| [apps/desktop/test/codebuddy-login.test.mjs](../../../apps/desktop/test/codebuddy-login.test.mjs) | 初始；保留 | npm test；VM 假账号覆盖加载、修订、取消、迟到响应、重试和 CLI 引导。 |
| [apps/desktop/test/config.test.mjs](../../../apps/desktop/test/config.test.mjs) | 初始；保留 | npm test；检查窗口几何恢复、主窗口权限与本地执行资源边界。 |
| [apps/desktop/test/distribution.test.mjs](../../../apps/desktop/test/distribution.test.mjs) | 初始；保留 | npm test；比较普通和离线安装配置的应用身份及 WebView2 分发。 |
| [apps/desktop/test/git-hooks.test.mjs](../../../apps/desktop/test/git-hooks.test.mjs) | 初始；修改 | npm test；临时 Git 仓库覆盖首次提交、索引与工作树差异、链接类型、完整 lint 及失败传播；本批验证 --complete。 |
| [apps/desktop/test/installer-integrity.test.mjs](../../../apps/desktop/test/installer-integrity.test.mjs) | 初始；保留 | npm test；临时 EXE 与模拟命令验证完整性标签、权限失败、字节保全和 junction 拒绝。 |
| [apps/desktop/test/lint-ci.test.mjs](../../../apps/desktop/test/lint-ci.test.mjs) | 初始；保留 | npm test；临时合并提交与假 API 覆盖基线不明回退、配置变化、索引链接和失败码。 |
| [apps/desktop/test/lint-cli.test.mjs](../../../apps/desktop/test/lint-cli.test.mjs) | 初始；保留 | npm test；临时仓库检查新增路径、债务报告、缺失文件和解析失败。 |
| [apps/desktop/test/lint-config.test.mjs](../../../apps/desktop/test/lint-config.test.mjs) | 初始；保留 | npm test；真实 ESLint 覆盖规则、运行时全局、历史例外及浏览器边界。 |
| [apps/desktop/test/lint-css.test.mjs](../../../apps/desktop/test/lint-css.test.mjs) | 初始；保留 | npm test；临时样式验证历史基线、新 CSS 和大小写扩展名。 |
| [apps/desktop/test/lint-dedup.test.mjs](../../../apps/desktop/test/lint-dedup.test.mjs) | 新增；新增 | npm test / lint:fixtures；本批新增：旧范围中 Git 忽略文件、不同配置、索引链接、嵌套 junction、读取探针及编排；大小写敏感用例按文件系统能力跳过。 |
| [apps/desktop/test/lint-deleted-worktree.test.mjs](../../../apps/desktop/test/lint-deleted-worktree.test.mjs) | 初始；保留 | npm test；临时索引验证工作树删除路径被跳过，其他文件仍检查。 |
| [apps/desktop/test/lint-fixture-helpers.mjs](../../../apps/desktop/test/lint-fixture-helpers.mjs) | 初始；保留 | lint-ci、lint-cli、lint-worktree 等引用；临时仓库隔离 Git 环境变量和依赖。 |
| [apps/desktop/test/lint-mixed-extensions.test.mjs](../../../apps/desktop/test/lint-mixed-extensions.test.mjs) | 初始；保留 | npm test；临时仓库验证 JS/MJS/CJS 大小写及运行时全局。 |
| [apps/desktop/test/lint-runner.test.mjs](../../../apps/desktop/test/lint-runner.test.mjs) | 初始；保留 | npm test；验证检查并发、失败传播和提交消息 stdin 保全。 |
| [apps/desktop/test/lint-suppressions.test.mjs](../../../apps/desktop/test/lint-suppressions.test.mjs) | 初始；保留 | npm test；核对完整规则诊断和局部类型转换例外的数量与说明。 |
| [apps/desktop/test/lint-worktree.test.mjs](../../../apps/desktop/test/lint-worktree.test.mjs) | 初始；保留 | npm test；验证未跟踪完整文件、Git 环境隔离和索引链接类型。 |
| [apps/desktop/test/native-adapter.test.mjs](../../../apps/desktop/test/native-adapter.test.mjs) | 初始；修改 | npm test；第二批扩展 500/1000 题身份计数、有序 IPC、跨库同 ID、惰性正文、丢回执与失败重试。 |
| [apps/desktop/test/native-services.test.mjs](../../../apps/desktop/test/native-services.test.mjs) | 初始；保留 | npm test；模拟原生 IPC 验证 AI 取消、受控 WebDAV 和凭据暂存提交。 |
| [apps/desktop/test/platform-checks.test.mjs](../../../apps/desktop/test/platform-checks.test.mjs) | 初始；保留 | npm test；真实 ESLint/TypeScript 验证浏览器全局、嵌套脚本及 JSDoc 错误。 |
| [apps/desktop/test/prepare-web-actual.test.mjs](../../../apps/desktop/test/prepare-web-actual.test.mjs) | 新增；新增 | npm test；本批新增：真实 Web 与隔离桌面完整脚本顺序、第三方 JS/许可字节、mtime 及缺失错序损坏。 |
| [apps/desktop/test/prepare-web.test.mjs](../../../apps/desktop/test/prepare-web.test.mjs) | 初始；保留 | npm test；临时资源树验证增量、mtime、离线资产、许可、事件外置及路径/junction 拒绝。 |
| [apps/desktop/test/release.test.mjs](../../../apps/desktop/test/release.test.mjs) | 初始；保留 | npm test；临时制品和假 gh 验证版本、在线/离线选择、摘要、标签、草稿、失败与 junction；不发布。 |
| [apps/desktop/test/smoke-timeout.test.mjs](../../../apps/desktop/test/smoke-timeout.test.mjs) | 新增；新增 | npm test；本批新增：超时、步骤失败、迟到重启、监听器/初始化失败回收、首次 CDP 与进程/浏览器关闭失败或超时、profile 保留及非零退出。 |
| [apps/desktop/test/titlebar.test.mjs](../../../apps/desktop/test/titlebar.test.mjs) | 初始；保留 | npm test；模拟当前窗口，验证按钮、拖动、并发互斥和失败反馈。 |

## 仓库回归与辅助（初始 57，现 65）

| 路径 | 来源与处置 | 实际入口与依据 |
| --- | --- | --- |
| [test/codebuddy-cli-stdio/container-relay-fixture.mjs](../../../test/codebuddy-cli-stdio/container-relay-fixture.mjs) | 初始；保留 | CodeBuddy 测试 README 的隔离 AppContainer 实验；固定回环假 SSE，非生产服务。 |
| [test/codebuddy-cli-stdio/guard.mjs](../../../test/codebuddy-cli-stdio/guard.mjs) | 初始；保留 | guard.test、probe、container-relay-fixture 引用；回环单请求预算与 SSE 证据。 |
| [test/codebuddy-cli-stdio/guard.test.mjs](../../../test/codebuddy-cli-stdio/guard.test.mjs) | 初始；保留 | node --test test/codebuddy-cli-stdio/guard.test.mjs；假 SSE、取消、大小和并发预算。 |
| [test/codebuddy-cli-stdio/probe.mjs](../../../test/codebuddy-cli-stdio/probe.mjs) | 初始；保留 | CodeBuddy 测试 README 的显式本机探针；固定哈希、假 Key、隔离 profile 和回环服务，本批不调用真实服务。 |
| [test/codebuddy-cli-stdio/verify-guarded.mjs](../../../test/codebuddy-cli-stdio/verify-guarded.mjs) | 初始；保留 | README 的 node verify-guarded.mjs &lt;run-directory&gt;；核对隔离实验报告，非执行模型。 |
| [test/codebuddy-cli-stdio/verify.mjs](../../../test/codebuddy-cli-stdio/verify.mjs) | 初始；保留 | README 的 node verify.mjs &lt;run-directory&gt;；核对 11 个已有实验报告，非执行模型。 |
| [test/dual-platform/ai-codebuddy-execution.test.cjs](../../../test/dual-platform/ai-codebuddy-execution.test.cjs) | 初始；保留 | npm run test:shared；模拟账号和执行修订，验证三类任务、错误诊断、切换和取消。 |
| [test/dual-platform/ai-connection.test.cjs](../../../test/dual-platform/ai-connection.test.cjs) | 初始；保留 | npm run test:shared；模拟桌面/浏览器请求，验证 403、网络、跨域、取消和正文失败诊断。 |
| [test/dual-platform/ai-fixed-bindings.test.cjs](../../../test/dual-platform/ai-fixed-bindings.test.cjs) | 新增；新增 | npm run test:shared；第三批新增：逐个验证六个按钮的处理器、事件参数、缺节点与重复绑定。 |
| [test/dual-platform/ai-harness.test.cjs](../../../test/dual-platform/ai-harness.test.cjs) | 初始；修改 | npm run test:shared；模拟就绪、配置/账号修订、恢复屏障和取消；本轮覆盖双面板与状态同步。 |
| [test/dual-platform/ai-import-retry.test.cjs](../../../test/dual-platform/ai-import-retry.test.cjs) | 初始；修改 | npm run test:shared；本轮扩展完整草稿及选区 ABA、固定目标、迟到成功/失败、兼容重试与人工采纳归属。 |
| [test/dual-platform/ai-results.test.cjs](../../../test/dual-platform/ai-results.test.cjs) | 初始；修改 | npm run test:shared；本轮扩展未知返回 ID 不落到其他题，并检查结果模式、空值和 HTTP 错误。 |
| [test/dual-platform/ai-settings-helper.cjs](../../../test/dual-platform/ai-settings-helper.cjs) | 初始；保留 | ai-import-retry / ai-harness 引用；source-tools 在 VM 安装真实设置模块。 |
| [test/dual-platform/ai-transport-helper.cjs](../../../test/dual-platform/ai-transport-helper.cjs) | 初始；保留 | ai-connection / ai-import-retry 引用；source-tools 在 VM 安装真实传输模块。 |
| [test/dual-platform/backup-core.test.cjs](../../../test/dual-platform/backup-core.test.cjs) | 初始；保留 | npm run test:shared；无 DOM/存储环境加载备份转换，检查来源对象不被修改。 |
| [test/dual-platform/backup-entry-performance.test.cjs](../../../test/dual-platform/backup-entry-performance.test.cjs) | 新增；新增 | npm run test:shared；第四批新增：空/非空资产替换次数、缺图检测、恢复失败保全和重试。 |
| [test/dual-platform/backup-serialization-empty.test.cjs](../../../test/dual-platform/backup-serialization-empty.test.cjs) | 新增；新增 | npm run test:shared；第四批新增：完整核对空图片数组、缺失字段、无效图片及旧 Android ZIP 的当前题/孤儿回退。 |
| [test/dual-platform/browser-credentials.test.cjs](../../../test/dual-platform/browser-credentials.test.cjs) | 初始；保留 | npm run test:shared；假凭据覆盖端点绑定、记住切换、失败补偿和秘密不泄露。 |
| [test/dual-platform/browser-page.cjs](../../../test/dual-platform/browser-page.cjs) | 初始；修改 | npm run test:web-platform；本轮扩展 AI 固定目标/ABA、页面迟到读写、答题卡/题库、导入竞争、WebDAV 与备份保全。 |
| [test/dual-platform/browser-storage.test.cjs](../../../test/dual-platform/browser-storage.test.cjs) | 初始；修改 | npm run test:shared；本轮扩展损坏 JSON、未来版本、真实 DOMException、原值保全、串行队列和重试。 |
| [test/dual-platform/business.test.cjs](../../../test/dual-platform/business.test.cjs) | 初始；保留 | npm run test:shared；隔离 VM 覆盖题型/答案、跨库同 ID、错题、文本解析和输入所有权。 |
| [test/dual-platform/circled-stem.test.cjs](../../../test/dual-platform/circled-stem.test.cjs) | 初始；保留 | npm run test:shared；旧组合题圈号陈述、分隔符和答案保全，不修改输入。 |
| [test/dual-platform/contracts.test.cjs](../../../test/dual-platform/contracts.test.cjs) | 初始；保留 | npm run test:shared；拒绝任意 SQL/系统路径、过期修订、重复操作 ID 与非法业务变更。 |
| [test/dual-platform/desktop-inline-events.test.cjs](../../../test/dual-platform/desktop-inline-events.test.cjs) | 新增；新增 | npm run test:shared；第三批新增：实际 Web 七处事件生成桌面六处 click，验证导航和折叠。 |
| [test/dual-platform/dialog-page.cjs](../../../test/dual-platform/dialog-page.cjs) | 初始；保留 | npm run test:web-platform；真实页面验证模态焦点、取消、消息转义、队列、窄屏与考试到时。 |
| [test/dual-platform/document-formats.test.cjs](../../../test/dual-platform/document-formats.test.cjs) | 初始；保留 | npm run test:shared；自建 DOCX 图片/公式/外部块、PDF 页面排序和失败释放。 |
| [test/dual-platform/document-lifecycle.test.cjs](../../../test/dual-platform/document-lifecycle.test.cjs) | 初始；保留 | npm run test:shared；模拟 PDF/OCR 成败释放、取消重试、切换后迟到结果及超大页面限制。 |
| [test/dual-platform/document-page.cjs](../../../test/dual-platform/document-page.cjs) | 初始；保留 | npm run test:documents；隔离浏览器实际处理自建中文扫描 PDF/OCR、文字 PDF、DOCX、XLSX 和 CSV。 |
| [test/dual-platform/exit.test.cjs](../../../test/dual-platform/exit.test.cjs) | 初始；保留 | npm run test:shared；模拟保存、考试/OCR/AI 取消及原生取消失败，验证退出确认和数据保全。 |
| [test/dual-platform/fixtures/dataset.cjs](../../../test/dual-platform/fixtures/dataset.cjs) | 初始；保留 | business、format、browser-page 和 benchmark 引用；自建题库/假凭据。 |
| [test/dual-platform/format.test.cjs](../../../test/dual-platform/format.test.cjs) | 初始；修改 | npm run test:shared；本轮扩展无图旧 Android JSON/ZIP 完整字段、图片资产、跨库记录、凭据排除和往返。 |
| [test/dual-platform/import-lifecycle.test.cjs](../../../test/dual-platform/import-lifecycle.test.cjs) | 初始；保留 | npm run test:shared；模拟取消、PDF 失败、双文件顺序及 AI 失败时保留识别草稿。 |
| [test/dual-platform/import-ownership.test.cjs](../../../test/dual-platform/import-ownership.test.cjs) | 新增；新增 | npm run test:shared；第四批新增：单/双文件重选、清空、独立槽位、跨入口命名及旧成功/失败失效。 |
| [test/dual-platform/json-import.test.cjs](../../../test/dual-platform/json-import.test.cjs) | 初始；修改 | npm run test:shared；本轮扩展备份合并、取消保全、未来版本拒绝和普通题库识别。 |
| [test/dual-platform/pagination.test.cjs](../../../test/dual-platform/pagination.test.cjs) | 初始；保留 | npm run test:shared；纯计算覆盖页码、四档条数、空列表和删除末页回退。 |
| [test/dual-platform/parser-risk-performance.test.cjs](../../../test/dual-platform/parser-risk-performance.test.cjs) | 新增；新增 | npm run test:shared；第四批新增：固定四类合成文本输出及主候选风险统计次数。 |
| [test/dual-platform/platform-index.test.cjs](../../../test/dual-platform/platform-index.test.cjs) | 初始；保留 | npm run test:shared；模拟桌面与浏览器初始化，验证存储事件只影响应用键。 |
| [test/dual-platform/practice-selection-performance.test.cjs](../../../test/dual-platform/practice-selection-performance.test.cjs) | 新增；新增 | npm run test:shared；第三批新增：随机起点零枚举、顺序继续、自选范围和跨库身份。 |
| [test/dual-platform/preview-performance.test.cjs](../../../test/dual-platform/preview-performance.test.cjs) | 新增；新增 | npm run test:shared；第二批新增：500 题诊断复用、108 组目标索引、面板同步和选项重建。 |
| [test/dual-platform/question-view.test.cjs](../../../test/dual-platform/question-view.test.cjs) | 初始；保留 | npm run test:shared；模拟 MathJax 预热，保留原有配置赋值语义。 |
| [test/dual-platform/quiz-core.test.cjs](../../../test/dual-platform/quiz-core.test.cjs) | 初始；保留 | npm run test:shared；无 DOM/存储/原生能力加载共享计算并验证多空答案。 |
| [test/dual-platform/review-options.test.cjs](../../../test/dual-platform/review-options.test.cjs) | 初始；保留 | npm run test:shared；验证错题选项、未作答、解析空态及来源补读。 |
| [test/dual-platform/select-page.cjs](../../../test/dual-platform/select-page.cjs) | 初始；保留 | npm run test:web-platform；Web/桌面样式下拉框的选中/禁用、键盘、窄屏、上下避让和动态选项。 |
| [test/dual-platform/settings-action-page.cjs](../../../test/dual-platform/settings-action-page.cjs) | 初始；保留 | npm run test:web-platform；Web/桌面多宽度下快捷按钮与输入对齐、窄屏高度和焦点裁剪。 |
| [test/dual-platform/source-loading.test.cjs](../../../test/dual-platform/source-loading.test.cjs) | 初始；保留 | npm run test:shared；AST 桥接只命中唯一 IIFE/启动边界，并验证路径及等价排版。 |
| [test/dual-platform/source-tools.cjs](../../../test/dual-platform/source-tools.cjs) | 初始；保留 | source-loading 与多个双端测试引用；AST 校验唯一 IIFE/启动、限制 Web 路径和 VM 超时。 |
| [test/dual-platform/styles.cjs](../../../test/dual-platform/styles.cjs) | 初始；保留 | browser-page、dialog-page、select-page、settings-action-page 引用；装配共享样式。 |
| [test/dual-platform/table-import.test.cjs](../../../test/dual-platform/table-import.test.cjs) | 初始；保留 | npm run test:shared；固定 CSV 引号/跨行/表头与 XLSX 稀疏列、共享字符串。 |
| [test/dual-platform/text-answers.test.cjs](../../../test/dual-platform/text-answers.test.cjs) | 初始；保留 | npm run test:shared；无 DOM/存储环境验证答案表和题号匹配模块加载。 |
| [test/dual-platform/text-parser-cases.cjs](../../../test/dual-platform/text-parser-cases.cjs) | 初始；保留 | text-parser 与 parser-risk-performance 引用；固定解析样本与独立快照。 |
| [test/dual-platform/text-parser.test.cjs](../../../test/dual-platform/text-parser.test.cjs) | 初始；保留 | npm run test:shared；固定四种策略的题目/答案/来源、诊断、Symbol 元数据和局部修复。 |
| [test/dual-platform/training-characterization.test.cjs](../../../test/dual-platform/training-characterization.test.cjs) | 初始；保留 | npm run test:shared；验证暂停/倒退时间的计时所有权与复盘草稿快照隔离。 |
| [test/dual-platform/training.test.cjs](../../../test/dual-platform/training.test.cjs) | 初始；保留 | npm run test:shared；验证范围、计时、跨库同 ID、未提交快照和历史复盘。 |
| [test/dual-platform/web-source.cjs](../../../test/dual-platform/web-source.cjs) | 初始；保留 | business、format、zip-safety 等引用；隔离 VM、内存存储和明确桥接。 |
| [test/dual-platform/zip-safety.test.cjs](../../../test/dual-platform/zip-safety.test.cjs) | 初始；保留 | npm run test:shared；验证 ZIP 重名、穿越、链接、截断、大小、CRC 和正常条目。 |
| [test/web-ai-practice/cases.cjs](../../../test/web-ai-practice/cases.cjs) | 初始；保留 | runner.cjs 引用；装配单题、收藏、错题、复盘和提交模式案例。 |
| [test/web-ai-practice/dialogs.cjs](../../../test/web-ai-practice/dialogs.cjs) | 初始；保留 | harness 及 browser/document/dialog-page 引用；监听对话框并清理。 |
| [test/web-ai-practice/fixtures.cjs](../../../test/web-ai-practice/fixtures.cjs) | 初始；保留 | runner、harness、cases 引用；假 Key、模型和自建题库。 |
| [test/web-ai-practice/harness.cjs](../../../test/web-ai-practice/harness.cjs) | 初始；保留 | runner 及页面测试引用；回环服务、请求拦截、隔离 context 与清理。 |
| [test/web-ai-practice/runner.cjs](../../../test/web-ai-practice/runner.cjs) | 初始；保留 | README 的 node runner.cjs；隔离浏览器、mock、退出码和逐例报告。 |
| [test/web-ai-practice/saved-analysis.cjs](../../../test/web-ai-practice/saved-analysis.cjs) | 初始；保留 | cases.cjs 引用；已保存解析的重开、再生成和历史。 |
| [test/web-ai-practice/submit-modes.cjs](../../../test/web-ai-practice/submit-modes.cjs) | 初始；保留 | cases.cjs 引用；总提交/单题草稿、取消、保存失败与重试。 |
| [test/web-ai-practice/training-review-analysis.cjs](../../../test/web-ai-practice/training-review-analysis.cjs) | 初始；保留 | cases.cjs 引用；复盘草稿、切换迟到和来源核对。 |
| [test/web-ai-practice/wrong-analysis.cjs](../../../test/web-ai-practice/wrong-analysis.cjs) | 初始；保留 | cases.cjs 引用；错题草稿、配额失败、取消和迟到。 |
| [test/web-webdav/request.test.cjs](../../../test/web-webdav/request.test.cjs) | 初始；保留 | node --test test/web-webdav/request.test.cjs；假 Fetch 覆盖 CORS、超时和错误分类。 |

## 第三方与内置题库（89）

以下逐路径保持原文件；prepare-web-actual.test.mjs 从真实 Web 目录发现全部第三方 JS，与隔离生成桌面文件逐份比较字节、重跑 mtime，并检查许可。单文件字节一致不等于每种动态组件都已实际运行；此前离线 MathJax、PDF Worker 和中文 OCR 的实际范围见第四批交接。

| 路径 | 资源角色与兼容处置 |
| --- | --- |
| [apps/web/libs/image_decoders/pdf.image_decoders.min.mjs](../../../apps/web/libs/image_decoders/pdf.image_decoders.min.mjs) | PDF.js 本地模块/解码辅助，复制校验；并非逐文件执行。 |
| [apps/web/libs/image_decoders/pdf.image_decoders.mjs](../../../apps/web/libs/image_decoders/pdf.image_decoders.mjs) | PDF.js 本地模块/解码辅助，复制校验；并非逐文件执行。 |
| [apps/web/libs/mathjax/a11y/assistive-mml.js](../../../apps/web/libs/mathjax/a11y/assistive-mml.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/a11y/complexity.js](../../../apps/web/libs/mathjax/a11y/complexity.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/a11y/explorer.js](../../../apps/web/libs/mathjax/a11y/explorer.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/a11y/semantic-enrich.js](../../../apps/web/libs/mathjax/a11y/semantic-enrich.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/a11y/sre.js](../../../apps/web/libs/mathjax/a11y/sre.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/adaptors/liteDOM.js](../../../apps/web/libs/mathjax/adaptors/liteDOM.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/core.js](../../../apps/web/libs/mathjax/core.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/asciimath.js](../../../apps/web/libs/mathjax/input/asciimath.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/mml.js](../../../apps/web/libs/mathjax/input/mml.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/mml/entities.js](../../../apps/web/libs/mathjax/input/mml/entities.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/mml/extensions/mml3.js](../../../apps/web/libs/mathjax/input/mml/extensions/mml3.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex-base.js](../../../apps/web/libs/mathjax/input/tex-base.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex-full.js](../../../apps/web/libs/mathjax/input/tex-full.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex.js](../../../apps/web/libs/mathjax/input/tex.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/action.js](../../../apps/web/libs/mathjax/input/tex/extensions/action.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/all-packages.js](../../../apps/web/libs/mathjax/input/tex/extensions/all-packages.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/ams.js](../../../apps/web/libs/mathjax/input/tex/extensions/ams.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/amscd.js](../../../apps/web/libs/mathjax/input/tex/extensions/amscd.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/autoload.js](../../../apps/web/libs/mathjax/input/tex/extensions/autoload.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/bbox.js](../../../apps/web/libs/mathjax/input/tex/extensions/bbox.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/boldsymbol.js](../../../apps/web/libs/mathjax/input/tex/extensions/boldsymbol.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/braket.js](../../../apps/web/libs/mathjax/input/tex/extensions/braket.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/bussproofs.js](../../../apps/web/libs/mathjax/input/tex/extensions/bussproofs.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/cancel.js](../../../apps/web/libs/mathjax/input/tex/extensions/cancel.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/cases.js](../../../apps/web/libs/mathjax/input/tex/extensions/cases.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/centernot.js](../../../apps/web/libs/mathjax/input/tex/extensions/centernot.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/color.js](../../../apps/web/libs/mathjax/input/tex/extensions/color.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/colortbl.js](../../../apps/web/libs/mathjax/input/tex/extensions/colortbl.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/colorv2.js](../../../apps/web/libs/mathjax/input/tex/extensions/colorv2.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/configmacros.js](../../../apps/web/libs/mathjax/input/tex/extensions/configmacros.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/empheq.js](../../../apps/web/libs/mathjax/input/tex/extensions/empheq.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/enclose.js](../../../apps/web/libs/mathjax/input/tex/extensions/enclose.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/extpfeil.js](../../../apps/web/libs/mathjax/input/tex/extensions/extpfeil.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/gensymb.js](../../../apps/web/libs/mathjax/input/tex/extensions/gensymb.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/html.js](../../../apps/web/libs/mathjax/input/tex/extensions/html.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/mathtools.js](../../../apps/web/libs/mathjax/input/tex/extensions/mathtools.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/mhchem.js](../../../apps/web/libs/mathjax/input/tex/extensions/mhchem.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/newcommand.js](../../../apps/web/libs/mathjax/input/tex/extensions/newcommand.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/noerrors.js](../../../apps/web/libs/mathjax/input/tex/extensions/noerrors.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/noundefined.js](../../../apps/web/libs/mathjax/input/tex/extensions/noundefined.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/physics.js](../../../apps/web/libs/mathjax/input/tex/extensions/physics.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/require.js](../../../apps/web/libs/mathjax/input/tex/extensions/require.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/setoptions.js](../../../apps/web/libs/mathjax/input/tex/extensions/setoptions.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/tagformat.js](../../../apps/web/libs/mathjax/input/tex/extensions/tagformat.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/textcomp.js](../../../apps/web/libs/mathjax/input/tex/extensions/textcomp.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/textmacros.js](../../../apps/web/libs/mathjax/input/tex/extensions/textmacros.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/unicode.js](../../../apps/web/libs/mathjax/input/tex/extensions/unicode.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/upgreek.js](../../../apps/web/libs/mathjax/input/tex/extensions/upgreek.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/input/tex/extensions/verb.js](../../../apps/web/libs/mathjax/input/tex/extensions/verb.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/latest.js](../../../apps/web/libs/mathjax/latest.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/loader.js](../../../apps/web/libs/mathjax/loader.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/mml-chtml.js](../../../apps/web/libs/mathjax/mml-chtml.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/mml-svg.js](../../../apps/web/libs/mathjax/mml-svg.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/node-main.js](../../../apps/web/libs/mathjax/node-main.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/output/chtml.js](../../../apps/web/libs/mathjax/output/chtml.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/output/chtml/fonts/tex.js](../../../apps/web/libs/mathjax/output/chtml/fonts/tex.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/output/svg.js](../../../apps/web/libs/mathjax/output/svg.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/output/svg/fonts/tex.js](../../../apps/web/libs/mathjax/output/svg/fonts/tex.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/startup.js](../../../apps/web/libs/mathjax/startup.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/tex-chtml-full-speech.js](../../../apps/web/libs/mathjax/tex-chtml-full-speech.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/tex-chtml-full.js](../../../apps/web/libs/mathjax/tex-chtml-full.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/tex-chtml.js](../../../apps/web/libs/mathjax/tex-chtml.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/tex-mml-chtml.js](../../../apps/web/libs/mathjax/tex-mml-chtml.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/tex-mml-svg.js](../../../apps/web/libs/mathjax/tex-mml-svg.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/tex-svg-full.js](../../../apps/web/libs/mathjax/tex-svg-full.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/tex-svg.js](../../../apps/web/libs/mathjax/tex-svg.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/ui/lazy.js](../../../apps/web/libs/mathjax/ui/lazy.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/ui/menu.js](../../../apps/web/libs/mathjax/ui/menu.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/mathjax/ui/safe.js](../../../apps/web/libs/mathjax/ui/safe.js) | MathJax 本地包/按需组件，复制校验；未逐文件执行。 |
| [apps/web/libs/ocr/core/index.js](../../../apps/web/libs/ocr/core/index.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/ocr/core/tesseract-core-lstm.js](../../../apps/web/libs/ocr/core/tesseract-core-lstm.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/ocr/core/tesseract-core-lstm.wasm.js](../../../apps/web/libs/ocr/core/tesseract-core-lstm.wasm.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/ocr/core/tesseract-core-simd-lstm.js](../../../apps/web/libs/ocr/core/tesseract-core-simd-lstm.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/ocr/core/tesseract-core-simd-lstm.wasm.js](../../../apps/web/libs/ocr/core/tesseract-core-simd-lstm.wasm.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/ocr/core/tesseract-core-simd.js](../../../apps/web/libs/ocr/core/tesseract-core-simd.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/ocr/core/tesseract-core-simd.wasm.js](../../../apps/web/libs/ocr/core/tesseract-core-simd.wasm.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/ocr/core/tesseract-core.js](../../../apps/web/libs/ocr/core/tesseract-core.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/ocr/core/tesseract-core.wasm.js](../../../apps/web/libs/ocr/core/tesseract-core.wasm.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/ocr/tesseract/tesseract.min.js](../../../apps/web/libs/ocr/tesseract/tesseract.min.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/ocr/tesseract/worker.min.js](../../../apps/web/libs/ocr/tesseract/worker.min.js) | Tesseract 本地 worker/core，复制校验；具体模型与设备覆盖见离线验收。 |
| [apps/web/libs/pdf.min.mjs](../../../apps/web/libs/pdf.min.mjs) | PDF.js 本地模块/解码辅助，复制校验；并非逐文件执行。 |
| [apps/web/libs/pdf.sandbox.min.mjs](../../../apps/web/libs/pdf.sandbox.min.mjs) | PDF.js 本地模块/解码辅助，复制校验；并非逐文件执行。 |
| [apps/web/libs/pdf.worker.min.mjs](../../../apps/web/libs/pdf.worker.min.mjs) | PDF.js 本地模块/解码辅助，复制校验；并非逐文件执行。 |
| [apps/web/libs/wasm/jbig2_nowasm_fallback.js](../../../apps/web/libs/wasm/jbig2_nowasm_fallback.js) | PDF.js 本地模块/解码辅助，复制校验；并非逐文件执行。 |
| [apps/web/libs/wasm/openjpeg_nowasm_fallback.js](../../../apps/web/libs/wasm/openjpeg_nowasm_fallback.js) | PDF.js 本地模块/解码辅助，复制校验；并非逐文件执行。 |
| [apps/web/libs/wasm/quickjs-eval.js](../../../apps/web/libs/wasm/quickjs-eval.js) | PDF.js 本地模块/解码辅助，复制校验；并非逐文件执行。 |
| [apps/web/question-bank.js](../../../apps/web/question-bank.js) | Web index.html 的内置题库数据及本地兜底；保持数据原文，生成文件字节与源一致。 |

## 七处内联事件

Web 源入口包含五个导航按钮、一个图片错误处理和一个折叠按钮。桌面生成器先移除含图片的侧栏 brand，再外置六个 click；desktop-inline-events.test.cjs 验证映射、导航和折叠，prepare-web-actual.test.mjs 独立核对 Web 与生成桌面完整脚本顺序；第三批隔离 WebView2 结果见计划交接。图像 error 在桌面生产 HTML 中随 brand 移除，合成 error fixture 仅验证生成器能力。


## 本批本地辅助脚本（Git 忽略）

以下 16 个文件位于本工作树的 `apps/desktop/.reports/`，是本批一次性验证或编辑辅助，不随产品、测试门禁或清单中的 252 个 Git 路径交付；未删除历史报告。日志与临时脚本只作为本机证据，不能当成真实服务或发行验收。

| 文件 | 入口与用途 |
| --- | --- |
| `batch5-artifact-hash.cjs` | 构建后读取正式和 native-test 制品，记录大小及 SHA-256。 |
| `batch5-artifact-verify.cjs` | GUI 后比对两份制品与已记录哈希。 |
| `batch5-diff-check.mjs` | 对已跟踪差异和每个未跟踪文件检查空白。 |
| `batch5-doc-check.cjs` | 对额外五份文档检查 UTF-8、围栏、本地链接及空白。 |
| `batch5-final-handoff.cjs` | 一次性精确更新计划和清单中的交接文字，非产品入口。 |
| `batch5-final-document-update.cjs` | 一次性登记最终清单与制品复核信息，非产品入口。 |
| `batch5-inventory.mjs` | 生成初始清单草稿；最终文字逐行审查，后续不再运行草稿生成器覆盖。 |
| `batch5-launch-fix.cjs` | 一次性精确替换首次启动清理实现，不参与生产运行。 |
| `batch5-launch-test-followup.cjs` | 一次性补充关闭双故障断言，不参与测试入口。 |
| `batch5-lint-beforeafter.mjs` | 使用同机相同输入交替计时 HEAD 旧入口与新完整入口。 |
| `batch5-lint-benchmark.mjs` | 较早的旧编排加当前增量脚本对照；不误称为修改前实现。 |
| `batch5-lint-incremental-before.mjs` | 从 HEAD 原文提取的旧增量脚本，仅作改前计时。 |
| `batch5-png-check.mjs` | 核对历史截图哈希，并验证本批 PNG 签名、CRC、解压与尺寸。 |
| `batch5-run.mjs` | 串行执行指定命令，记录工作目录、时间、退出码和完整输出。 |
| `batch5-smoke-paths.mjs` | 隔离 smoke 的截图输出，加本批前缀以保留历史图片。 |
| `batch5-verify-inventory.cjs` | 重新比较 Git/未跟踪 JS 与清单的路径、分类、唯一性及处置状态。 |
