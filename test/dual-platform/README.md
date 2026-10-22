# 双端阶段 A：基线与契约

执行日期：2026-10-23。依据[双端设计](../../docs/superpowers/specs/2026-10-23-web-desktop-dual-platform-design.md)和[详细实施计划 A1—A4](../../docs/superpowers/plans/2026-10-23-web-desktop-dual-platform.md)。本轮只建立可复现基线、共享样本、类型/纯校验和检查入口；未接入平台适配器、异步保存队列、SQLite、原生文件/网络或系统凭据。

## 1. 来源与交付入口

开始时当前工作树干净，基线提交为 `10539bb382b44f18af4d2ce4e01061c004498f6c`。双端设计和计划来自用户指定的[列出 Tauri 版本改造方案](thread://01a16496-3d95-7723-9a2d-178595ccf5a7?hostId=local)，其源工作树为 `E:/Codex/worktrees/5ad6/shiroha-quiz-desktop`。当前工作树此前仅有原型文档，因此将两份实施依据复制入本工作树，调整历史草稿链接并记录阶段结果；没有执行跨工作树代码合并，没有提交，未更改来源工作树。

- [调用点与性能协议](./baseline-inventory.md)：31 处 `saveSilent()` 调用、保存全部、独立存储、文件、网络、凭据、关闭路径及 B—E 任务归属。
- [共享 fixture 与格式边界](./fixtures/README.md)：手写逻辑预期、真实 Web 实现特征测试、Android 兼容容器，以及执行中的待修复断言。
- [平台契约说明](./contracts.md)：接口、版本、提交冻结、结果查询、排他操作和任务终态；[类型](../../apps/web/platform/contracts.d.ts)与[纯校验器](../../apps/web/platform/validation.js)。
- [依赖决策](./dependencies.md)：后续 SQLite、HTTP、凭据、桥接和文件对话框候选，本轮没有新增生产依赖。

用户全局规则引用的 `global-rules/AGENTS_condition_rules.md` 在当前仓库不存在；未假定其内容或创建替代规则。实际遵循根规范、已确认双端设计与本计划。

## 2. 本轮环境与隔离

| 项目 | 实测值 |
| --- | --- |
| 系统 | Windows 11 专业版，10.0.26200，x64；未覆盖 Win10 |
| 硬件 | Ryzen 9 5950X；系统报告物理内存 34,280,775,680 字节 |
| Node / npm | 24.17.0 / 11.13.0 |
| Rust / Cargo | rustc 1.99.1 / cargo 1.99.1；通过用户 `.cargo/bin` 加入当前命令 PATH，未修改系统 PATH |
| MSVC / SDK | Build Tools 18.7.11911.148，MSVC 14.51.36231，Windows SDK 10.0.26100.0 |
| Edge / WebView2 | 155.0.4283.62 / 155.0.4283.62 |
| Chrome | 已安装 155.0.8059.85，本轮未运行 Chrome 回归 |
| 自动化 | 桌面锁定 playwright-core 1.64.1；既有 Web AI 框架使用本机预装 playwright 1.62.1 + Edge |

依赖目录开始时不存在。安装前通过进程命令行核对当前工作树，没有 Node、开发服务器或应用占用。沙箱下 npm 安装异常、浏览器启动失败和 junction 的 EPERM 单独归为环境限制；核实进程后在正常本机环境重跑，不删除测试或弱化断言。`npm ls --depth=0` 成功，npm/Cargo 锁文件均未更改。

Web AI 每项独立 browser context，mock 限定 `mock-ai.invalid`，阻断其他 API，未调用收费服务。桌面 smoke/benchmark 使用临时 WebView2 profile，原生能力尚未接入，因此现有 profile 隔离适用；C1 必须在增加原生副作用前扩展数据库、媒体、锁、日志、凭据与出站网络隔离。

## 3. 可重复命令与检查范围

在 `apps/desktop`：

```powershell
npm test
npm run test:shared
npm run typecheck
npm run lint
npm run build
npm run test:desktop
npm run bench:desktop
npm run bench:desktop -- --fixtures
```

在仓库根目录：

```powershell
node --test test/dual-platform/*.test.cjs
node --test test/web-webdav/request.test.cjs
node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' --report reports/stage-a-baseline.jsonl
```

最后一条要求 `require('playwright')` 可解析；本机实际运行前将已有 runtime 的 `node_modules` 设置为本次命令的 `NODE_PATH`，未更改 AI 框架或安装新包。其他机器按[既有说明](../web-ai-practice/README.md)提供自己的路径。

`npm test` 串行包含桌面 `.mjs` 和共享 `.cjs`。Node 类型配置仍覆盖桌面 scripts/test；`tsconfig.platform.json` 使用 DOM/ES2023、空 `types`、strict/checkJs，并检查共享 `.d.ts`、平台 `.js`、未来桌面 frontend 及契约 `.types.ts`。不会因全局 Node 类型误放行浏览器里的 `process`。

`lint:platform` 从仓库根匹配平台 `.js`、共享 `.cjs`，桌面 frontend 目录出现后自动纳入。未来若引入 TypeScript 实现文件，应同步配置对应 ESLint parser；目前 `.types.ts`/`.d.ts` 由 tsc 检查。`lint:docs` 检查 14 份文档的严格 UTF-8、代码围栏和本地链接。

新增门禁有破坏性输入测试：错误 JSDoc 类型、浏览器误用 Node 全局、`var`、缺失 Markdown 链接、坏 UTF-8 和未闭合围栏均能使检查失败。文档测试最初新增 7 组全部失败，补齐清单后通过；浏览器门禁先因缺配置失败，再通过实际配置。契约测试先因缺校验器失败，再实现并验证；A2 则按计划直接记录现有行为，没有人为制造红色基线。

## 4. 执行结果

| 检查 | 结果与范围 |
| --- | --- |
| 修改前桌面基线 | 原有 11 项测试、typecheck、lint 通过；junction 在正常本机环境通过 |
| WebDAV 请求基线 | 9/9 通过，fetch mock；未验证真实服务 |
| Web AI 基线 | 25 项中 14 通过、11 失败；均在未修改业务源码时运行，详见下一节 |
| release 构建 | 成功，Tauri 2.12.5，`--no-bundle`；不是安装包 |
| WebView2 smoke | 10/10 通过：导航/延迟插画、存储、真实界面导入与练习、MathJax、PDF 真 Worker、英文 Canvas OCR、离线脚本、重启数据与题库 |
| 阶段 A 桌面检查 | 20/20 通过，包含新增文档范围与浏览器门禁的故障输入检查 |
| 阶段 A 共享检查 | 业务/格式 18 项正常通过，5 项执行型 TODO；契约复核后 26/26 通过，共 44 项正常通过、5 项 TODO |
| 类型 / lint | Node 与浏览器 typecheck、桌面和平台 lint、14 份文档检查通过 |
| 性能基线 | 默认启动 5/5、固定样本 15/15 成功，两个最终报告均 `complete=true` |

构建基线 EXE 为 58,599,424 字节，SHA-256 `3ff241fa1f370571b1bac1cc00c963dd49d55f6443c1698ead0adc60a0fb29ca`。Web `app.js` SHA-256 为 `f690f30287054a65ac123e58005de3702b850db5107056d4235f8021295f63cb`，阶段 A 没有更改该文件或入口 HTML。

最终资源重新生成后的 EXE 仍为 58,599,424 字节，SHA-256 `2b23c65ad0fc95583cd2cc111e718ea2371aa825faf08ffd588c4af393347954`；再次执行 WebView2 smoke 10/10 通过。新增校验脚本随资源准备保留，但入口尚未加载它；本轮没有提前启用 B 阶段行为。

本轮没有修改 Rust/Cargo 或 Android 源码，因此未额外执行 Rust fmt/clippy/test、Gradle 和 Android 外部解析器回归；release 编译实际执行了现有 Rust 工程构建。Android fixture 只证明交换数据的逻辑兼容，不能替代 Kotlin/设备运行。

## 5. 既有失败与后续归属

Web AI 失败的共同诊断为 `Follow-up must use plainText, without response_format.`，无页面异常或真实 API 请求。`runAiSingleFollowUpV613()` 调用 `requestAiChatV99()` 时没有传入 `plainText`，而后者默认先请求 JSON 格式；现有 mock 因此拒绝追问，依赖追问的后续断言超时。不是通过增加超时或弱化 mock 可以宣称通过的问题，后续 B4/D3 接入时应先修复并重跑完整 25 项。

11 个失败用例为：`generate-follow-navigation-isolated-and-close`、`new-session-clears-analysis-conversation-and-draft`、`late-follow-up-cannot-write-new-session`、`stop-and-failure-preserve-analysis-history-and-follow-draft`、`failed-or-cancelled-regeneration-keeps-history`、`malformed-regeneration-retains-draft-valid-success-resets-conversation`、`save-only-analysis-preserves-answered-practice`、`save-only-analysis-preserves-revealed-practice`、`rich-analysis-formula-save-keeps-backslashes-and-updates-only-analysis`、`quota-save-rolls-back-memory-storage-and-preserves-draft`、`unsent-images-force-insufficient-information-even-if-model-confident`。后续步骤被前置追问阻断，不等于全部后续业务各有独立缺陷。原始报告保存在忽略目录 `test/web-ai-practice/reports/stage-a-baseline.jsonl`。

A2 的 5 个执行型 TODO 记录富字段/题库扩展丢失、未来版本不拒绝、settings 中敏感数据未限定，以及 ZIP 导出修改孤立历史快照的图片引用。详见[样本缺陷表](./fixtures/README.md)。它们真实执行目标断言，没有注入修复后状态或删字段使其通过；阶段 A 不修改这些 B2/B4/C3/C6 业务。

阶段 A 结束不等于旧业务无缺陷。B 阶段应沿用上述失败样例，修复后保留有效断言并移除对应 TODO。契约纯校验的通过不能作为已经保护真实持久化、导出或 Rust IPC 的证据。

## 6. 性能记录口径

默认启动按原协议运行 5 次，首轮 fresh profile、后 4 轮复用；样本模式对 1 题 JSON、7 题图片 JSON、2 题材料文本各运行 5 次，全部使用新 profile。每轮均保留默认题库，样本导入后验证实际存储的题数与顺序练习，不把小样本称为大题库测试。

首轮样本模式因保存提示定位歧义失败，报告 `complete=false`、有效样本 0；已保存在 `.reports/performance-fixtures-locator-failure.json`。修复仅定位真实保存 toast 后，重新执行整组。首次默认启动报告另存 `.reports/performance-initial.json`；最终启动和样本数据分别在 `.reports/performance.json` 与 `.reports/performance-fixtures.json`，基线 EXE 保留为 `.reports/stage-a-baseline.exe`。这些是本机忽略产物，不提交。

保存耗时测到成功 toast 可见，包含现有通知排队等待及自动化往返；不能解读为 localStorage 写入本身需要数秒。内存是首页/进入练习后各空闲 5 秒的完整进程树单点采样，不是峰值；工作集求和包含共享页重复计数，私有提交不等于驻留内存。没有清 OS 文件缓存、强制 GC 或关闭 GPU，也没有候选优化版，因而不报告性能提升百分比。

最终默认启动 5 轮 `domMs` 为 `[784, 814, 863, 788, 854]`，可见耗时为 `[814, 843, 892, 815, 883]` ms。全部 5 轮中位数分别为 **814 / 843 ms**，工作集 **512.5 MiB**、私有提交 **287.0 MiB**；fresh 首轮可见 814 ms，后 4 轮 reused 中位数 863 ms。这里的 fresh 只表示新 profile，不是系统冷启动。

下表为各样本 5 轮中位数。保存提示约 4.5 秒是上述 toast 排队口径；后续测纯持久化需另设打点，不能拿该值计算数据库提速。

| 样本 | 输入字节 / 题数 | 解析预览 ms | 确认入库 ms | 保存提示 ms | 练习后工作集 MiB | 练习后私有提交 MiB |
| --- | --- | --- | --- | --- | --- | --- |
| small-json | 409 / 1 | 151 | 81 | 4501 | 584.0 | 395.6 |
| image-json | 2967 / 7 | 161 | 72 | 4499 | 583.8 | 391.6 |
| material-text | 233 / 2 | 171 | 87 | 4502 | 584.2 | 397.7 |

输入 SHA-256：small-json 为 `49e191136bb959101961559b4efd6785265bc78ff43f216395b015dbfa54f6d9`，image-json 为 `459b2d18e001bb37036bfb7e636129ad02bd16df531d83ad8e16eb2c222fc7f8`，material-text 为 `c65630df5f350c3f83faf538b61aa6050524d274dda90e5e891314705394be38`。每轮确认持久化题数分别为 1/7/2，并能进入对应题数的顺序练习；全部使用同一个基线 EXE。性能仅作为本机初始记录，未来优化仍需按预登记协议与保留的基线在同轮串行对照。

## 7. 未覆盖范围

中文扫描 PDF 全链路、DOCX/XLSX、大文件、真实 AI/WebDAV、Win10、安装/卸载/升级、原生凭据和故障恢复尚未验收。英文 `TEST` OCR、PDF 原语、小型图片和静态格式 fixture 均不代替这些场景。性能协议在测量/优化前登记于[基线盘点](./baseline-inventory.md)，本轮不声称内存或耗时已经改善。
