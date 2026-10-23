# 双端阶段 A/B：基线、契约与 Web 适配

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

## 8. 阶段 B 实施记录（2026-10-23）

本轮按用户指定的阶段 B 实施，工作树开始时干净；没有提交、推送、增加生产依赖或修改锁文件。全局状态流转规则引用仍未在仓库找到，沿用根规范及已确认计划。

平台入口为 [index.js](../../apps/web/platform/index.js)，浏览器存储/文件/媒体见 [browser.js](../../apps/web/platform/browser.js)，网络与凭据分别位于 [browser-network.js](../../apps/web/platform/browser-network.js)、[browser-credentials.js](../../apps/web/platform/browser-credentials.js)，提交队列为 [save-queue.js](../../apps/web/platform/save-queue.js)。Web 保持普通本地脚本、静态站及 file URL 入口；桌面生成器复制同一平台目录并保留明确的入口注入位置。已有标题栏窗口权限和应用来源未改变。

运行时采用 [兼容门面类型](../../apps/web/platform/runtime.d.ts) 对接历史整包页面，真正提交时复用 A3 的版本、快照及敏感字段校验。此门面不等于完整原生 PlatformServices 已实现：分页/增量提交、原生文件授权、持久操作结果、SQLite、媒体文件和 IPC 仍由 C 阶段实现，浏览器原子整包写入没有原生事务的不确定结果状态。

启动区分缺省、明确空库、损坏/未来版本及存储访问失败；失败锁定编辑并提供重试和原始数据导出，禁止默认库覆盖。题目富字段与题库扩展保留；默认库抑制与全量重置分别验证。

31 处业务保存和保存全部均等待提交。页面写入事务期间暂停交互，避免异步回滚覆盖之后的编辑；队列入队复制载荷、串行提交、推进修订、记录操作 ID，并在失败时阻断后继写入。回滚恢复原对象及属性引用，保留练习身份、编辑草稿和 AI 会话；持久化已经成功后的界面异常不会反向回滚内存。导入、恢复、重置使用同一互斥入口；考试写入成功后才停止计时并完成交卷，失败可重试，自动提交失败不会不断自动重试。关闭提示仅辅助，未增加完整会话恢复。

浏览器仍使用原 localStorage/sessionStorage 键；新增凭据端点绑定元数据不包含秘密。UI 不再回填已保存秘密，凭据读取与鉴权头生成留在浏览器服务内部；切换记住选项会清除旧副本，失败有补偿并报告。绑定到已初始化端点的旧凭据不能随恢复/改端点发给新地址。独立 WebDAV 配置、侧栏、文件读取、下载及内联图片显示也有平台归属。浏览器下载成功只代表已触发下载，不能证明用户已经将文件保存到磁盘。

外部存储原值比较与 storage 事件用于拒绝已知过期写入；不提供 localStorage 跨标签原子比较交换或并发编辑保证。页面实例内的修订和操作记录在重新加载时重建。

A 阶段的 5 个格式 TODO 已修复并转换为正常断言。另发现既有 AI 测试仍使用旧纯文本追问，而当前源码的 V38.1 已要求 reply/revisedAnalysis JSON，故保留当前产品行为，更新 mock 输入和请求结构断言；保留全部 25 项用例的评分、迟到结果、草稿、公式及 quota 回滚断言。测试中的富字段断言使用跨 VM 的普通 JSON 值比较，避免对象原型差异造成假失败。

### 验证入口与覆盖

在 apps/desktop 执行 npm test、npm run typecheck、npm run lint、npm run test:web-platform、npm run build 和 npm run test:desktop。页面测试默认使用本机 Edge；可通过 SHIROHA_BROWSER_EXECUTABLE 指定 Chrome。AI 回归继续使用阶段 A 所述 NODE_PATH 和 Edge 可执行文件参数。

已验证 Edge 155.0.4283.62 与 Chrome 155.0.8059.85 的延迟启动、损坏数据保全、空库/重置、延迟保存、过期写入、quota 保留输入、考试重试/重复提交及静态 file URL 入口。新增恢复失败保留选择/重试、导出失败和重置失败用例。所有浏览器上下文与桌面 profile 隔离，网络为 mock 或本地资源，没有调用收费 API。

最终验证结果如下：

| 检查 | 结果 |
| --- | --- |
| npm test | 桌面测试通过；共享测试 59/59，无 TODO |
| typecheck、lint、依赖完整性 | 全部通过；文档 UTF-8、围栏与本地链接检查通过 |
| 浏览器页面回归 | Edge、Chrome 各 8/8 |
| Web AI / WebDAV | 25/25、9/9；AI 测试框架自检 1/1 |
| release 构建与 WebView2 冒烟 | 通过；覆盖窗口、布局、导入/练习、离线 MathJax/PDF/OCR 及重启持久化 |

AI 报告为本机忽略产物 `test/web-ai-practice/reports/stage-b-final.jsonl`；桌面报告与截图位于 `apps/desktop/.reports/`。中文扫描 PDF、大文件、真实 AI/WebDAV、Win10、安装升级及完整关闭协调仍未验证，属于后续阶段；本轮未重复性能基准，不声称性能改善。

## 9. 阶段 C 实施与验收（2026-10-23）

用户授权仅执行 C，D2 凭据联调保留。本轮续作完成 C8 按需界面、损坏数据库恢复入口和本机可运行的故障验收；没有提交、推送或改动 Android，没有接入原生网络和 Windows 凭据库。正常发行环境及 D2 的联合验收仍未完成。

| 任务 | 实现与验证边界 |
| --- | --- |
| C1 | 开发/正式/测试根、祖先 reparse 检查和单写入锁；测试同时隔离 SQLite、媒体与 WebView2。正常发行版拒绝测试根覆盖，未在真实用户目录运行 |
| C2 | 官方本地桥接、逐项 ACL、主窗口/来源检查、阻塞 I/O、脱敏错误；保存任务及持久操作回执。统一网络/文件任务进度与退出交互仍归 D5/E2；真实远程页面及非主窗口 IPC 注入未实测 |
| C3 | SQLite WAL + FULL、复合身份、富字段、差量行更新、事务修订和幂等回执。覆盖 SQLite 空间耗尽、只读连接、事务失败、进程退出、未来版本及重启；不等同真实磁盘被写满或 OS 断电测试 |
| C4 | 图片签名/大小/哈希、先媒体后事务、WAL 一致快照；按需正文才回填图片。媒体展开与批量详情共享大小上限，缺图阻止提交/快照。保守保留恢复点和未引用媒体，不启用 GC |
| C5 | 系统对话框、限时令牌、256 KiB 分块、临时导出回读哈希与替换；中文路径、取消、篡改、占用目标保全通过。页面重新初始化撤销旧令牌并清理临时文件；系统对话框人工点击仍未验收 |
| C6 | 共享 JSON/ZIP 安全校验及覆盖前快照；正常数据可恢复到历史恢复点，损坏数据可从恢复点或兼容备份建立新活动代。两条损坏恢复 UI 在 WebView2 实际通过，原损坏文件保留 |
| C7 | 同来源旧数据和独立非敏感配置迁移、原始副本/幂等标记；保留旧键和凭据，拒绝自动覆盖非空目标；IPC 迁移和重启通过。D2 仍待办 |
| C8 | 首页摘要/索引；题库、预览、错题、收藏和记录分页；练习/考试按选题批量读取，记录展开才读详情；导出补齐全文；元数据更新与题目增删分离，未读题目不能被空占位覆盖。5000 题原生及 130 题实际 UI 回归通过 |
| C9 | 隔离测试 feature 的 release 闭环通过。D2、正常发行制品的隔离 Windows 用户/VM 运行、人工对话框及真实磁盘故障仍单列，不标记联合验收全部通过 |

入口为 [Rust 服务](../../apps/desktop/src-tauri/src/lib.rs)、[桌面适配器](../../apps/desktop/frontend/adapter.js)、[存储故障测试](../../apps/desktop/src-tauri/tests/local_data.rs)、[文件测试](../../apps/desktop/src-tauri/tests/files.rs)和 [ZIP 回归](./zip-safety.test.cjs)。运行时适配对接既有整包页面，不宣称完整 A3 PlatformServices 已全部落地。SQLite 分类与复合 ID 存储无损 JSON，原生摘要/差量计算目前仍遍历原始条目；不声称 CPU、内存或耗时达到尚未测量的性能目标。

C8 用完整轻量索引计算统计与跨库选题，不截断为当前页。读取按题库/题目 ID 和修订号批量进行；迟到的分页响应不能覆盖新选择。页面保存前等待已有读取；失败回滚同时恢复页面和适配器基线。二次编辑保存前补齐正文并保留扩展字段；导航只释放未修改且未被活动练习/考试引用的正文。完整导出主动读取所有内容，因此仍可能有较高峰值；未做完整进程树性能复测，不报告性能改善比例。

### 故障与界面证据

- SQLite `max_page_count` 注入空间耗尽，`query_only` 注入只读连接；失败后原数据、修订和操作回执一致，重开仍可读。未填满真实磁盘或修改真实目录 ACL。
- 子进程在事务更新条目/修订/回执后直接退出，绕过析构与提交；重开仅见此前已提交内容，未留下中断操作回执。
- 失败事务、过期修订、重复操作、单写入锁、缺失媒体、损坏快照和不完整快照均有保全断言。文件回读发现同长度篡改，Windows 占用目标时不替换原文件。
- 5000 题 fixture 验证全部索引、200 条末尾详情和全文逐字段一致；索引不含题干。已有触发器测试确认记录变化不会更新题目行。
- WebView2 使用 2 库、130 题（跨库同 ID）：启动无全文/详情 IPC、预览 50/15 分页、历史记录展开、跨库第 65—66 题、二次编辑保存与扩展保全、完整读取均通过。测试数据和网络完全隔离。
- 同时损坏隔离主库和 WAL 后，从启动恢复页选择恢复点，核对原损坏字节并重启读取新活动代；再损坏活动代，通过兼容 JSON 备份修复。文件选择使用 Playwright 注入合成 File，不能代替系统对话框人工点击。

恢复时先验证新目录内数据库与媒体，再原子切换 `active.json`；原数据、WAL、媒体及旧活动代不删除。没有完成标记的快照不会列出；恢复验证失败不切换。原生失败不会回退 localStorage，迁移也不清理尚未完成 D2 的旧凭据。

### 最终检查

桌面 Node 36 项、共享 61 项、Web 页面 8 项、AI mock 25 项、WebDAV 9 项通过；typecheck、lint（含 14 份文档）、Rust fmt/Clippy 和默认/native-test 两组各 25 项原生测试通过。正常 release 与 native-test release 均构建成功。WebView2 smoke 22 项通过，报告为忽略产物 `apps/desktop/.reports/stage-c-smoke.json`，AI 报告为 `test/web-ai-practice/reports/stage-c.jsonl`。

Windows junction、快照复制和替换故障用例在沙箱中可能因权限限制产生非业务失败，采用正常权限下的隔离临时目录重跑；不跳过断言。测试不使用真实题库、凭据或收费 API。Win10、中文扫描 PDF 全链路、长时间内存、大图峰值、安装升级和真实网络服务仍归后续阶段；D2 凭据联调继续待办。

## 阶段 D：原生网络、凭据及 C/D 联调（2026-10-23）

### 实现与联调范围

基于 C 整合提交 `4ba29fc` 实现 D1—D5。已与 C 会话核对私有绑定元数据、C3 操作回执、C7 来源清理和 C6 恢复撤销规则。网络仅提供 AI 和 WebDAV 业务枚举，凭据不经状态接口明文返回；系统写入、配置提交、旧副本清理分别记账，失败保留补偿责任。凭据 sidecar 不可用不能阻断本地题库修复。

WebView2 联调覆盖原生 AI、WebDAV 列举及备份字节往返、历史上传重试不重复 PUT、latest 失败保留历史文件、取消及恢复后拒绝旧绑定、导出不含假秘密；C7 通过真实页面从同来源旧 profile 迁移假凭据，只有原生验证后清理对应旧值，原数据和未知键保留。原有分页、持久化、恢复、损坏数据库修复及关闭回归继续执行。

### 验证与环境边界

桌面 Node 测试 38 项、共享回归 61 项通过；typecheck、lint（含 14 份文档检查）通过。普通 Rust 测试 40 项通过，Windows provider 测试默认忽略，已另行显式执行并通过：只读写随机测试命名空间的假凭据，结束清理。WebDAV 9 项和单题 AI 25 项通过；AI 浏览器回归使用本机 Edge 与预装 Playwright，未调用收费 API。

WebView2 使用隔离 SQLite、媒体和 profile，凭据为 fake provider，原生网络只开放 runner 本次回环 mock 地址。不是普通发行制品的独立用户验收。TLS 自动测试确认 HTTPS 失败不降级明文，尚未覆盖可信/不可信/过期证书的完整链路矩阵。独立 Windows 用户或 VM、Win10/Win11 系统差异、C9 人工系统对话框、中文扫描 PDF、大文件性能及真实服务仍未验收，D 总体复选框保持未勾选。

首次沙箱回环测试受限，改在本机权限下使用同一隔离 mock 后通过。一次 smoke 因测试读取接口重置保存基线而失败，改用只读 IPC 后恢复；关闭回归发现官方关闭协调需要 destroy 权限，按最小主窗口范围补齐后通过。最终检查时 Rust 测试与构建的 prepare:web 同时读取/生成 dist 产生一次缺资源失败，改为串行重跑，未放宽断言。

最终普通与 native-test 两种 Rust 配置均为 40 项通过、1 项需显式执行的 Windows 测试默认忽略；两种配置 Clippy（-D warnings）及 cargo fmt 检查通过。普通 build、build:test 和最终实际 WebView2 smoke 全部通过，smoke 共 23 项。日志存放于工作树 `apps/desktop/.reports/stage-d-*.log`，不提交测试产物。

最终普通 EXE 为 63,860,224 字节，隔离 EXE 为 63,869,440 字节。普通 EXE SHA-256：`0D817FB36CBB7D22182E59770EBF2C349350EC8566F79B9DE622CCFE9096190D`。相较 C 记录的普通制品 62,165,504 字节增加约 1.62 MiB；这是包含本轮代码和桥接的整体差异，不单独归因于某个依赖。阶段 D 开发验证结束时尚未提交；后续提交与合并见下节。

## C/D 合并 main 后验证（2026-10-23）

用户授权提交并合并 C、D，明确不 push。C 已有独立功能提交 `86fd961` 和整合提交 `4ba29fc`，原历史完整保留。D 在来源工作树 `E:/Codex/worktrees/518e/shiroha-quiz-desktop` 的 `codex/dual-platform-stage-d` 分支独立提交为 `8fe2750`，再以 `f31ffae` 无冲突合入 main；没有复制未提交文件集中整合，也没有改写 C 历史。

以下检查均在合并后的 main 工作树 `E:/Projects/shiroha-quiz-desktop` 运行：

- 桌面 Node 38 项、共享 61 项、WebDAV 9 项、Web 单题 AI 25 项通过。
- typecheck、lint（含 14 份文档检查）、cargo fmt 通过。
- Rust 普通和 native-test 配置各 40 项通过，Clippy 两种配置均以 `-D warnings` 通过；实际系统凭据单测仍默认忽略，其前一轮随机命名空间实测结果不冒充本轮重复执行。
- 普通 release、隔离 release 构建通过，实际 WebView2 联调 23 项通过，涵盖 C7/D2 迁移、原生网络、凭据撤销、数据恢复和窗口关闭。

main 旧 node_modules 缺少已在锁文件中的 API/esbuild，导致首次资源测试失败。核实无项目进程占用后按原锁文件执行 npm ci，依赖完整性检查通过，再完整重跑上述门禁；未改锁文件或放宽断言。日志保存在 main 的 `apps/desktop/.reports/merge-cd-*.log`，不提交构建及测试产物。

C、D 总体验收继续保持未勾选：独立 Windows 用户/VM 的正常发行制品、完整 TLS 证书矩阵、C9 人工系统对话框，以及既有中文扫描 PDF/大文件/真实服务等未覆盖项继续保留。本次没有 push。

## 阶段 E 验证记录（2026-10-23）

### 范围、源码与环境

按已确认双端实施计划执行，起点 `27ab92a50fecc7c69d44c81f01352d3ac7dd138b`，工作区起始干净。阶段 E 初版开发验证时尚未 commit、push、PR 或发布，后续用户授权的提交与整合记录见下节；未增加生产依赖，npm/Cargo 锁文件不变。全局规范引用的 `global-rules/AGENTS_condition_rules.md` 在当前仓库缺失，沿用实际根规范及已确认设计。

本次环境：Windows 11 专业版 10.0.26200 x64；Node 24.17.0、npm 11.13.0、rustc/cargo 1.99.1；Edge 与 WebView2 155.0.4283.62。测试使用自建文档、隔离浏览器/数据库目录及假凭据，原生网络使用现有隔离 mock；未读取用户题库或调用真实服务。依赖安装前在沙箱外核对当前工作区没有 Node/Electron/esbuild/应用进程，按原锁文件执行 npm ci；第一次沙箱安装异常退出，重试成功并完成门禁。

### 交付与行为证据

- E1：`document-lifecycle.test.cjs` 验证 PDF 成功/失败释放、OCR 异常释放、换源迟到结果隔离与超大页面拒绝。真实页面回归自建文字 PDF、中文扫描 PDF、DOCX、XLSX；选择、解析、核对、预览、确认、保存、重载后核对每库 1 题、答案 A。扫描样本为实际 JPEG 页面 PDF，通过 PDF.js 渲染再调用本地中英文 OCR；不是直接识别英文 Canvas。显式取消后再次识别通过。
- 原始中文 OCR 输出含“Lo 中 国 的 首 都 是 哪 里 ? / A 北 京 / B 上 海 / 答 案 : A”，置信度约 80%。测试检查实际识别文字后，在可编辑 OCR 结果框模拟人工核对题号与分隔，再点击填入/确认。不能把核对后的结果表述为 OCR 原样准确识别。
- E2：窗口位置在 Rust 内保存，不新增 IPC 权限；只有落在现有显示器工作区内的有效大小位置才恢复。HTML 单文件拖放复用选择文件解析路径，不接受路径字符串；拒绝多文件及非法扩展。退出单元回归覆盖保存中、保存失败、未交卷、OCR、单题 AI 与原生取消失败。WebDAV 恢复框补初始焦点、Tab 循环、Escape 与焦点恢复，现有 reduced-motion 保持。
- E3：沿用 A1 的 5 轮启动和三类固定样本各 5 轮。修复 Windows CRLF 与 textarea LF 不同导致的等待；固定文本样本在输入前统一 LF，使样本哈希可与 A1 对照。测量仍是完整进程树空闲后单点采样，不是峰值。早期并行诊断与 CRLF 失败报告保留为 `.reports/performance-concurrent-diagnostic.json`、`.reports/performance-fixtures-crlf-failure.json`，不计入有效结果。
- E4：独立普通/离线 NSIS 配置，默认 currentUser，应用身份与版本保持，禁止降级。离线包使用 offlineInstaller，而非 bootstrapper。生成 NSIS 脚本检查到卸载仅在用户勾选删除数据时删除 AppData；此为脚本审查证据，不替代真正卸载验收。
- E5：新增 `.github/workflows/desktop.yml`，固定已记录 Node/Rust 工具链；按锁安装、JS/浏览器/文档/Rust 两种 feature 检查、独立 EXE、普通/离线 NSIS 构建。权限仅 contents:read，无制品上传和发布；Pages 工作流保持。尚未 push，因此没有 GitHub 运行记录。
- E6：根规范、桌面说明、设计/计划和文档索引同步当前实现；阶段 E 保持未勾选。

### 自动检查与失败归属

| 检查 | 本轮结果 |
| --- | --- |
| npm test | 桌面 39、共享 69 项通过；无 TODO/跳过 |
| typecheck / lint | 通过；文档 UTF-8、围栏与链接覆盖 14 份 |
| Web 平台页面 | 9 项通过，包含新增拖放回归 |
| Web 文档页面 | 1 条完整链路通过，覆盖 4 种自建文档及取消重试 |
| Web AI / WebDAV | 25 / 9 项通过；全部 mock |
| Rust 默认 / native-test | 各 41 项通过、1 项既有显式系统凭据测试 ignored；未把 ignored 当通过 |
| release EXE / native-test EXE | 构建成功；正常发行版没有用于真实用户目录运行 |
| WebView2 | 25 项通过，包含窗口尺寸重启恢复、本地 MathJax、PDF Worker、中文扫描文档、网络隔离、迁移、分页及损坏库恢复 |
| 普通 / 离线 NSIS | 本地构建成功；未安装、签名或发布 |

首次 npm 路径安全测试因沙箱不允许 junction 失败，未删断言，在隔离临时目录提升执行后通过。Rust 文件提交测试同样在沙箱下失败，沙箱外通过。Rust 测试目录使用时间戳导致并发目录碰撞，改用现有 UUID 依赖后通过。一次 Clippy 与资源生成并行导致 dist 临时缺文件，属于执行顺序问题，最终串行复查另记。Web AI 初次因测试框架硬编码旧机器 Playwright 路径未启动，使用当前机器已有 runtime 的 NODE_PATH 和已有 Edge 后 25 项通过。测试 HTTP 服务补齐 .mjs/.wasm MIME 后才完成真实 PDF/OCR，不用缺资源降级冒充通过。

### 未完成的阶段出口

阶段 E 尚未整体验收：缺少独立 Win10/Win11 干净系统、无 WebView2 断网新装、旧安装版覆盖升级、卸载保留、中文用户/目录、标准用户与磁盘不足的实际安装记录；本机正常发行环境的系统对话框闭环、资源管理器真实拖入、多显示器/DPI、全部覆盖层键盘验收也未完成。长时间大文档、多轮内存峰值/释放、复杂嵌图/公式文档和各类导出仍需专项测试。当前没有测定最低 WebView2 版本，不宣称 Windows 10 已支持。

本机故障回归只证明注入条件下的保全与恢复，不等于真实磁盘写满、断电或操作系统崩溃已验收。候选制品不应直接覆盖真实用户环境做试验；后续先在隔离用户/VM 按桌面说明逐项验证并补记录，再决定发行。没有自动更新、证书购买或发布授权。

### 初版性能与候选制品

本节性能、哈希与安装包属于阶段 E 初版 `845318d` 的证据；后续 OCR 取消修复 `b9ba107` 未重新测量性能或打包 NSIS，不将此处安装包标记为整合后 main 的发行制品。

最终独立串行运行 5 轮默认启动、三种样本各 5 轮，两个 JSON 报告均 `complete=true`。启动 DOM/可见中位数为 724/751 ms，整树工作集 499.1 MiB、私有提交 285.2 MiB。固定样本哈希与阶段 A 的三种样本一致；性能测试 EXE SHA-256 为 `227e373a0d51725eb168f2e397860082a492033189f24e131f92cf3f7d00d3d6`，共享 app.js 为 `6cc07af7835430ecc8ecd2c2820f71b0579c895dae5cf7b8f0315614e6a546e1`。

| 样本（各 5 轮） | 解析预览 ms | 确认入库 ms | 保存提示 ms | 练习后工作集 MiB | 练习后私有提交 MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| small-json | 174 | 163 | 5081 | 555.7 | 403.7 |
| image-json | 179 | 165 | 5129 | 558.7 | 401.5 |
| material-text | 242 | 153 | 5067 | 558.2 | 403.7 |

保存提示依然包含通知排队与自动化等待，不能称为数据库耗时。本次私有提交没有相对历史阶段 A 显示下降，且未在本轮重新运行阶段 A EXE，因此不计算提升比例、不宣称达到峰值/大数据性能目标。未清 OS 缓存、未强制 GC；fresh 表示新 profile，不代表系统冷启动。原始结果为桌面 `.reports/performance.json`、`.reports/performance-fixtures.json`。

最终串行 Clippy 默认 feature 与 native-test feature 均通过；此前与资源生成并发的缺文件失败不再出现。实际 Windows 系统凭据往返为既有 ignored 测试，本轮未显式执行。

候选安装包保存在桌面 `.reports/candidates/`，均为未签名（NotSigned），没有安装或上传。版本 npm/Cargo/Tauri 均为 0.1.0。正常 release EXE SHA-256 为 `9728abccf916123a38d40e296094f0018b8681a2b634638f09b44eb4d254a4fe`。

| 制品 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Shiroha-Quiz-0.1.0-online-x64.exe | 53575265 | `8709e78de8e1d9c807398d6b13828f6e38be703a1d3b461e77673d29b4814b12` |
| Shiroha-Quiz-0.1.0-offline-x64.exe | 271189987 | `b160f97df518f8810deffe5c08d024e77842065c313e16ef7bf40ccb8b2b7da9` |

## 阶段 E 合并 main 的整合验证（2026-10-23）

用户明确要求“合并到 main”，授权完成本次必要提交，没有授权 push。来源工作树为 `E:/Codex/worktrees/9dc6/shiroha-quiz-desktop`；阶段 E 在 `codex/dual-platform-stage-e` 独立提交为 `845318d`，从原 main `27ab92a` 建立 `codex/integrate-stage-e` 并以 `3843e3b` 合入。整合分支另保留修复提交 `b9ba107`，main 通过快进纳入上述完整历史；没有复制其他任务未提交文件，也没有改写既有 C/D 历史。

合并前复核发现 Tesseract 5.1.1 终止 Worker 不会结束尚在等待的 `recognize()` Promise，识别中取消可能一直保持处理中。先补稳定失败回归，再加入每轮独立取消信号，确保清理 Canvas、恢复按钮并隔离旧结果。真实 Web 与 WebView2 回归在 Worker 报告 `recognizing text` 时触发取消，再重新完整识别中文扫描 PDF、核对并保存重载；没有以加载前取消替代识别中取消。

以下检查在来源工作树的整合分支完成，最终 main 纳入相同代码树：

- 桌面 Node 39 项、共享 70 项、Web 平台 9 项、Web 文档完整链路 1 项、Web 单题 AI 25 项、WebDAV 9 项通过。
- typecheck、lint（含 14 份文档）、Rust fmt、默认配置 Clippy（`-D warnings`）通过；默认/native-test 两组 Rust 测试各 41 项通过、1 项既有系统凭据测试默认忽略。native-test Clippy 沿用阶段 E 初版已通过结果，本次 OCR 修复没有改 Rust。
- 普通 release 和隔离 native-test release 重新构建成功；实际 WebView2 25 项全部通过，包含识别中取消重试、窗口恢复、迁移、分页及损坏数据库恢复。
- 全部测试使用自建文档、临时数据目录和 mock 服务；没有调用收费 API 或操作真实题库。日志位于来源工作树 `apps/desktop/.reports-stage-e-merge-*.log`，不提交测试产物。

修复后共享 app.js SHA-256 为 `8be6448e1f56f1adaee6adcb9927030d81340e374f6b4754b6df342ad427b607`，普通 release EXE 为 `de132ecf610f30e4e5c600928fc5bda7d862bd57f24e63cfedbfb8517543d721`。前节性能与 NSIS 候选包保留初版标识，本次不冒充已对修复后安装包进行验收。

阶段 E 总体复选框保持未勾选；Win10/Win11 干净安装、升级卸载、长时间大文档与其他人工验收仍按前节待办执行。本次不 push、不发布，不清理其他来源工作树。
