# 全项目 JavaScript 下一轮优化规划

2026-11-11，用户已确认并要求逐批实施。进度见[实施计划与交接](../plans/2026-11-11-project-javascript-optimization.md)。基线为本地 `main` 的 `49a2007`。本轮覆盖项目的 Web 业务、浏览器平台层、桌面前端、构建与发布脚本、工程配置，以及两端的测试与辅助工具。两份附件提供了 AI 导入面板的首批样例，其详细复现和交互约定保留在[AI 导入面板专项](2026-11-11-ai-import-panel-optimization.md)。

## 1. 范围与既有成果

初次规划时按 Git 已跟踪及未忽略的新路径盘点，大小写不敏感匹配 `.js`、`.mjs`、`.cjs`，共有 **239 份脚本文件**。实施后的当前数量与逐文件结论见[交付清单](../plans/2026-11-11-project-javascript-inventory.md)。

| 范围 | 数量 | 本轮如何处理 |
| --- | ---: | --- |
| Web 业务与浏览器平台 | 33 + 7 | 按页面入口、数据读写、计算成本和取消路径审查。 |
| 桌面前端 | 5 | 审查存储适配、原生桥接、Harness、账户状态和窗口交互。 |
| 桌面工程与配置 | 20 + 6 | 审查资源生成、验收、打包发布、Git/CI 检查与配置。 |
| 桌面测试与仓库测试工具 | 22 + 57 | 覆盖用例、测试桥接、数据生成器、页面驱动和辅助脚本。 |
| 第三方脚本与内置题库数据 | 88 + 1 | 通过依赖调用、资源清单、离线加载及题库回退验证。第三方修复走依赖维护流程，题库数据由数据来源维护。 |

前四行合计 **150 份手写 JS**，逐文件列于文末。另计 Web 入口现有 6 处 `onclick`、1 处 `onerror`，连同桌面端生成对应事件脚本的步骤一起审查。构建生成的 `dist` 从源文件和生成器验收。上次优化已经拆出解析、练习、备份和 AI 会话模块，文件级 ESLint 迁移例外也已清零。本轮沿用这些边界，优先修改有复现或有计数证据的调用链。[Web 入口](../../../apps/web/index.html) · [桌面资源生成](../../../apps/desktop/scripts/prepare-web.mjs) · [既有拆分记录](../plans/2026-11-08-web-app-js-split.md) · [项目 JS 规范](../../../rules/javascript-style-guide.md)

## 2. 分批工作与验收

附件中的两个做法也适用于其他模块。对重复计算，先追踪一次真实用户操作，记录扫描次数，再找复用结果的边界。对重复事件绑定，先确认节点是否重建、谁拥有处理器、恢复时是否再次初始化。固定按钮可局部复用绑定逻辑，动态列表按既有渲染生命周期处理。改动保留事件参数、键盘焦点、公开接口和加载顺序。

### 第一批 · 保护草稿、发送范围和存储恢复

| 切片 | 当前证据 | 拟改动与验收 |
| --- | --- | --- |
| AI 整理与批量请求 | 隔离请求中，旧整理成功或失败均可覆盖期间重新识别的草稿。选中 B、D，首批后删除 A，第二批会发送 E。 | 草稿被替换后废弃旧回写与回滚。开始时固定目标身份，每批发送和采纳前核对。验收同时断言草稿、提示、实际发送的题目以及已完成的建议。两种复现分开修复。[专项设计](2026-11-11-ai-import-panel-optimization.md) |
| Web 存储恢复 | 实测非法 JSON 进入恢复页时被归类为 `storage_unavailable`。原生 `SecurityError` 和 `QuotaExceededError` 还可能被当作已有业务错误，透出数字码 18 和 22。 | 分开处理读取、解析、结构校验和写入失败。坏 JSON 与坏结构报告 `corrupt_data`，权限、空间不足、未来版本使用各自已有错误码。测试真实 `DOMException`，断言原始存储值保全、初始化失败后禁止写入、恢复入口仍能在可读取时导出原文。[浏览器存储](../../../apps/web/platform/browser.js) · [存储回归](../../../test/dual-platform/browser-storage.test.cjs) |

AI 面板的开始按钮和批量校验紧接请求修复。双面板共享现有两类任务的互斥规则，界面估算与执行统一使用 1～30 的整数。继续验证就绪检查、显式重试、取消及人工确认。练习单题、追问、错题和训练复盘沿用其各自会话，在切题、离页、恢复和迟到响应时做交叉回归。[AI 传输](../../../apps/web/ai-transport.js) · [练习 AI 回归入口](../../../test/web-ai-practice/README.md)

### 第二批 · 降低大题库的保存和预览成本

先准备可复测的基线。桌面基准的 `--fixtures` 模式用固定格式的正则从 `app.js` 提取存储键，当前声明的空格使预检直接报“找不到基线主状态键”。样本流程实际用原生 `local_read` 核对结果。建议先移除已无消费者的键提取和传参，保留隔离 profile、原生读回和题数断言。内置三份样本各有 1、7、2 题，大题库保存另用下表的合成题库测量。[桌面基准](../../../apps/desktop/scripts/benchmark.mjs)

| 切片 | 当前证据 | 验收目标 |
| --- | --- | --- |
| 桌面增量保存 | 对 100、200、500 题的单题库各改一个收藏，真实适配器配模拟 IPC，各只提交一项 `put_header`，但成员匹配分别比较 10,100、40,200、250,500 次。提交前查删除项和回执后更新已加载集合都会扫描。 | 在单次保存内按题库索引题目 ID，复用顺序和成员表。以 500、1,000 题对比，成员查找工作量随题数线性增长。逐项比较 IPC 变更内容、顺序和回执；覆盖跨库同 ID、增删、排序、未加载正文、丢回执重试和保存失败。[桌面适配器](../../../apps/desktop/frontend/adapter.js) · [原生适配器回归](../../../apps/desktop/test/native-adapter.test.mjs) |
| 普通导入预览 | 500 道模拟题首次渲染、勾选一行后再渲染，各调用 1,000 次题目诊断。表格已经计算每题状态，报告又算一次。 | 让同一轮渲染的表格和报告复用状态，完整渲染最多 500 次。单题编辑后重算最新结果，筛选、异常排序、报告统计和题号映射逐项一致。[导入编辑器](../../../apps/web/question-editor.js) |
| AI 目标选择 | 同一批 500 题，自定义范围、已选和全部均做 500 次诊断；按当前筛选收集做 1,000 次。 | 无需状态的范围为 0 次，需状态的范围至多 500 次。同时校验基础/最终索引、排序和超限提示。选项节点与同步刷新按专项计数验收。[目标选择与刷新](2026-11-11-ai-import-panel-optimization.md) |

### 第三批 · 按一次用户操作更新题库、练习与考试界面

- **练习和考试选题。** 现有两处实现相同的范围、错题、收藏和题型过滤。随机模式只刷新起点控件时，实测还会枚举 500 题一次。复用现有基础筛选，随机模式下该次控件同步枚举 0 题。用跨库同 ID、顺序继续、自选起点、随机题量和考试选题核对结果。[练习筛选](../../../apps/web/practice-selection.js) · [训练规则测试](../../../test/dual-platform/training.test.cjs)
- **考试答题卡。** 选项变化或文本输入都会扫描全卷、替换整张答题卡并重绑跳题事件。先录制空 → 已答 → 改写 → 清空的进度和 DOM 写入次数，再局部更新受影响的题号和总数。连续输入须保留其余按钮与焦点，首次渲染、切换考试、自动交卷和存储失败重试均从实际答案得到正确进度。[考试页面](../../../apps/web/exam-page.js) · [浏览器回归](../../../test/dual-platform/browser-page.cjs)
- **题库勾选和页面装配。** 勾选单个题库导出会重新分组、统计并重建卡片。拟只更新本行、全选状态与导出摘要，列表容器整写目标为 0 次。对 `app.js` 的 `bindEvents`、`renderAll` 分别记录启动、切页、局部修改的调用范围，只替换已验证重复的刷新。验证跨页选择、分页、键盘、恢复时再次初始化。AI 面板的六个固定按钮在本批单独收敛映射，逐钮验证一次点击一次动作；入口的内联导航、图片错误和折叠按钮同时对照 Web 与桌面生成结果。[题库页面](../../../apps/web/bank-page.js) · [应用装配](../../../apps/web/app.js)
- **练习、错题、收藏与训练复盘。** 按正常入口检查页码、题目详情读取、取消和返回后的焦点。对连续翻页或切库后迟到的详情、提交时业务快照和保存失败后的重试增加定向观察。有多余加载才调整，已覆盖且输出正确的路径记录保留依据。[错题与收藏](../../../apps/web/saved-questions-page.js) · [训练记录及复盘](../../../apps/web/training-review-page.js)

### 第四批 · 导入格式、备份与平台生命周期

- **题库解析和文档导入。** 从 `parseTextQuestions` 的候选生成、归一化、评分和诊断分别计数，先在标准文本、重复题号、共用题干、双文件样例上留存完整输出。只有两次计算的输入和结果确实相同才复用。对 DOCX 图片、XLSX 行列、PDF 文字层和 OCR 单独验收取消、重选、失败释放与离线实际加载。比较题意、答案、来源位置、候选排序和诊断，相关联的标记与元数据也要保持。[文本解析器](../../../apps/web/text-parser.js) · [格式回归](../../../test/dual-platform/document-formats.test.cjs) · [文档页面用例](../../../test/dual-platform/document-page.cjs)
- **备份与 WebDAV。** 普通 JSON 读出空资产表，本地导入和恢复入口仍递归遍历整份数据替换资源。空资产时跳过这一步，保留单独的缺图检查、旧 Android JSON/ZIP 往返和失败回滚。WebDAV 启动一个操作时先设置忙碌、再设置提示，两次均刷新列表。按一次状态变化更新，列表未变时保留节点，测试恢复按钮禁用、取消、失败提示与重试。[备份读取与资产](../../../apps/web/backup-archive.js) · [WebDAV 面板](../../../apps/web/webdav-panel.js) · [请求回归](../../../test/web-webdav/request.test.cjs)
- **桌面 Harness、账户和窗口。** 从检查中、已就绪、失败重试、恢复确认和取消五条路径核对状态呈现。错误分类有重复时可提取纯判断，保留原有 Promise 归属、账户修订、取消顺序和凭据迁移的逐项确认。桥接、标题栏、对话框和网络适配逐一核对键盘、关闭保存及平台契约。用假服务和隔离 profile 验收。[桌面 Harness](../../../apps/desktop/frontend/harness.js) · [账户 UI](../../../apps/desktop/frontend/codebuddy-login.js) · [启动就绪设计](2026-11-11-ai-startup-readiness.md)

### 第五批 · 工程脚本、配置和测试可靠性

| 切片 | 工作与通过条件 |
| --- | --- |
| 全量 lint 重复扫描 | 当前完整入口已覆盖 150 份手写脚本，平台入口再扫其中 54 份，桌面入口再扫 48 份。先逐文件核对有效配置、范围、报错和退出码，再合并全量编排中的重复检查。保留单项入口、违规 fixture、未跟踪文件、大小写扩展、Git 索引类型和 CI 全量回退。102 是重叠文件检查项，实际耗时用同机多轮测量。[全量编排](../../../apps/desktop/scripts/lint-runner.mjs) · [完整文件发现](../../../apps/desktop/scripts/lint-incremental.mjs) |
| 资源清单与加载顺序 | 桌面准备脚本在复制和必需资产两处列出同组 33 个 Web 业务脚本。先在生成器内部复用清单。测试从实际 Web 和生成后的桌面 HTML 独立验收，覆盖漏项、错序、文件内容、未变资源的修改时间、第三方许可、离线资源和内联事件外置。源入口、测试预期与生成器保持可相互校验。[生成器](../../../apps/desktop/scripts/prepare-web.mjs) · [生成器测试](../../../apps/desktop/test/prepare-web.test.mjs) |
| 冒烟隔离和测试工具 | 桌面 smoke 的超时由 `Promise.race` 结束等待，失败记录后继续下一个检查。用可控延迟验证共享页面上迟到动作是否干扰下一项，若重叠则在该阶段中止或收敛旧操作并清理所属进程。浏览器驱动、VM 源码加载、fixture 和跨端用例按实际消费者核对，保留独立断言、失败退出以及可复查的报告。发布脚本只用临时目录或假调用检查参数、制品选择和失败清理。[桌面冒烟](../../../apps/desktop/scripts/smoke.mjs) · [测试装配](../../../test/dual-platform/source-loading.test.cjs) · [发布脚本回归](../../../apps/desktop/test/release.test.mjs) |

## 3. 实施与验证

1. 设计确认后在 `docs/superpowers/plans/` 建立中文实施计划，从当时核对的本地 `main` 建任务分支。先做第一批的两类 AI 请求修复和 Web 存储错误分类。桌面保存与 Web 页面可由独立工作树并行；普通导入与 AI 导入对草稿的改动串行，`app.js`、资源生成器和共享测试装配各指定一位负责人。分支 `codex/web-ai-panel-no-shadow` 的变量改名已有独立提交，涉及相同文件时先协调基线。
2. 每批先跑最小用例。行为缺陷先写能失败的回归，性能改动按相同输入比较前后调用次数、DOM 写入或 IPC 内容。评估用户等待时间时，在相同设备及运行环境中对改前、改后版本做多轮计时，分别记录首次与复用 profile 的条件。桌面样本预检修复并验证后，运行 `npm run bench:desktop -- --fixtures`，记录解析、导入提交与保存耗时。[基准脚本](../../../apps/desktop/scripts/benchmark.mjs)
3. 工程和共享业务执行 `apps/desktop` 下的 `npm test`、`npm run typecheck`、`npm run lint`。页面交互跑 `npm run test:web-platform`，文档导入跑 `npm run test:documents`。在仓库根目录按影响运行 `node --test test/web-webdav/request.test.cjs` 和 `node test/web-ai-practice/runner.cjs`（按测试说明配置浏览器）；CodeBuddy 测试工具使用相应假协议/隔离回归。共享资源及 Windows 行为按顺序跑 `npm run build`、`npm run build:test`、`npm run test:desktop`。全批收尾核对 Web、file 入口、离线资源与 WebView2 的实际结果。[工程脚本](../../../apps/desktop/package.json) · [双端测试说明](../../../test/dual-platform/README.md)
4. 以文末清单逐文件登记结果，每项记“已优化并验证”“已审查，保留现状”或“待补证据”，附入口、验证方法或待办。后续新增或移除的脚本按同一 Git 口径复核。全项目交付要求所有文件都有处置记录，仍待验证的项列明原因与下一步。第三方与数据脚本单独记录资源兼容结果。

**本次验证范围。** 规划阶段在同提交、已安装项目依赖的本地主工作树运行了 8 份非 AI 回归，覆盖桌面适配、浏览器存储、评分、解析、导入生命周期、备份、训练和 WebDAV，55 项通过。前述调用计数来自真实 JS 模块与合成数据或模拟 DOM/IPC；答题卡、WebDAV 重绘和 smoke 超时是源码观察。浏览器实测耗时、桌面构建及本轮优化后的功能验收留待实施。

## 4. 手写脚本逐文件清单

同一文件只列一次。目录与文件名拼接即为仓库相对路径，测试目录中的生成器与辅助模块也纳入覆盖。

| 工作范围 | 目录 | 文件 |
| --- | --- | --- |
| 应用入口 | `apps/web/` | `app.js` |
| Web 平台 | `apps/web/platform/` | `browser-credentials.js`、`browser-network.js`、`browser.js`、`dialogs.js`、`index.js`、`save-queue.js`、`validation.js` |
| 文件识别与预览 | `apps/web/` | `docx-import.js`、`import-preview.js`、`ocr-import.js`、`pdf-import.js`、`question-editor.js`、`table-import.js`、`text-parser.js` |
| 题库、作答与训练 | `apps/web/` | `bank-editor.js`、`bank-page.js`、`exam-page.js`、`practice-page.js`、`practice-selection.js`、`question-view.js`、`quiz-core.js`、`saved-questions-page.js` |
| 题库、作答与训练 | `apps/web/` | `study-sessions.js`、`text-answers.js`、`training-review-page.js`、`training.js` |
| 备份与云端恢复 | `apps/web/` | `backup-archive.js`、`backup-core.js`、`backup-data.js`、`webdav-panel.js`、`zip.js` |
| AI | `apps/web/` | `ai-import-panel.js`、`ai-import-sessions.js`、`ai-prompts.js`、`ai-question-panels.js`、`ai-question-sessions.js`、`ai-results.js`、`ai-settings.js`、`ai-transport.js` |
| 桌面适配 | `apps/desktop/frontend/` | `adapter.js`、`bridge.js`、`codebuddy-login.js`、`harness.js`、`titlebar.js` |
| 准备与发布 | `apps/desktop/scripts/` | `installer-integrity.mjs`、`prepare-web.mjs`、`release-artifacts.mjs`、`release-github.mjs` |
| 工程检查 | `apps/desktop/scripts/` | `check-docs.mjs`、`lint-ci.mjs`、`lint-debt.mjs`、`lint-incremental.mjs`、`lint-index.mjs`、`lint-platform.mjs`、`lint-runner.mjs` |
| 桌面验收与基准 | `apps/desktop/scripts/` | `benchmark.mjs`、`codebuddy-cli-smoke.mjs`、`codebuddy-login-smoke.mjs`、`dev-smoke.mjs`、`document-smoke.mjs`、`harness-smoke.mjs`、`native-isolation.mjs`、`network-smoke.mjs` |
| 桌面验收与基准 | `apps/desktop/scripts/` | `smoke.mjs` |
| 配置 | `apps/desktop/` | `commitlint.config.mjs`、`eslint.config.mjs`、`eslint.migration.mjs`、`eslint.platform.config.mjs`、`eslint.rules.mjs`、`stylelint.config.mjs` |
| 桌面工程回归 | `apps/desktop/test/` | `check-docs.test.mjs`、`codebuddy-login.test.mjs`、`config.test.mjs`、`distribution.test.mjs`、`git-hooks.test.mjs`、`installer-integrity.test.mjs`、`lint-ci.test.mjs`、`lint-cli.test.mjs` |
| 桌面工程回归 | `apps/desktop/test/` | `lint-config.test.mjs`、`lint-css.test.mjs`、`lint-deleted-worktree.test.mjs`、`lint-fixture-helpers.mjs`、`lint-mixed-extensions.test.mjs`、`lint-runner.test.mjs`、`lint-suppressions.test.mjs`、`lint-worktree.test.mjs` |
| 桌面工程回归 | `apps/desktop/test/` | `native-adapter.test.mjs`、`native-services.test.mjs`、`platform-checks.test.mjs`、`prepare-web.test.mjs`、`release.test.mjs`、`titlebar.test.mjs` |
| 双端回归 | `test/dual-platform/` | `ai-codebuddy-execution.test.cjs`、`ai-connection.test.cjs`、`ai-harness.test.cjs`、`ai-import-retry.test.cjs`、`ai-results.test.cjs`、`ai-settings-helper.cjs`、`ai-transport-helper.cjs`、`backup-core.test.cjs` |
| 双端回归 | `test/dual-platform/` | `browser-credentials.test.cjs`、`browser-page.cjs`、`browser-storage.test.cjs`、`business.test.cjs`、`circled-stem.test.cjs`、`contracts.test.cjs`、`dialog-page.cjs`、`document-formats.test.cjs` |
| 双端回归 | `test/dual-platform/` | `document-lifecycle.test.cjs`、`document-page.cjs`、`exit.test.cjs`、`fixtures/dataset.cjs`、`format.test.cjs`、`import-lifecycle.test.cjs`、`json-import.test.cjs`、`pagination.test.cjs` |
| 双端回归 | `test/dual-platform/` | `platform-index.test.cjs`、`question-view.test.cjs`、`quiz-core.test.cjs`、`review-options.test.cjs`、`select-page.cjs`、`settings-action-page.cjs`、`source-loading.test.cjs`、`source-tools.cjs` |
| 双端回归 | `test/dual-platform/` | `styles.cjs`、`table-import.test.cjs`、`text-answers.test.cjs`、`text-parser-cases.cjs`、`text-parser.test.cjs`、`training-characterization.test.cjs`、`training.test.cjs`、`web-source.cjs` |
| 双端回归 | `test/dual-platform/` | `zip-safety.test.cjs` |
| 练习 AI 回归 | `test/web-ai-practice/` | `cases.cjs`、`dialogs.cjs`、`fixtures.cjs`、`harness.cjs`、`runner.cjs`、`saved-analysis.cjs`、`submit-modes.cjs`、`training-review-analysis.cjs` |
| 练习 AI 回归 | `test/web-ai-practice/` | `wrong-analysis.cjs` |
| WebDAV 回归 | `test/web-webdav/` | `request.test.cjs` |
| CodeBuddy 工具 | `test/codebuddy-cli-stdio/` | `container-relay-fixture.mjs`、`guard.mjs`、`guard.test.mjs`、`probe.mjs`、`verify-guarded.mjs`、`verify.mjs` |
