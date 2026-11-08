# app.js 拆分与条件状态重构实施计划

日期 2026-11-08。依据[已批准设计](../specs/2026-11-05-web-app-js-split.md)。用户要求按批执行，每批独立会话，使用 `gpt-6.1-terra`、`max` 和 Fast，并明确要求纳入条件判断与状态流转重构。

## 任务与协作

- 负责人为本次主协调会话，各批由独立的新上下文子会话串行实施。每批指定 `gpt-6.1-terra` 和 `max`，采用支持 priority（Fast）的代理运行通道。子会话完成后由主会话读取交接并审查，再创建下一批子会话。
- 唯一工作树为 `C:/Users/30728/.codex/worktrees/a4ce/shiroha-quiz-desktop`，任务分支 `codex/web-app-split`。开始时本地 `main` 为 `9434786f01019e096f40c64e3023a66bd2b20ed4`，旧审查基线为 `e0764bf2a8d795d3fe6c70972bfd5925a8c18814`。本地 `origin/main` 仍为旧基线，不能据此判断服务器状态。
- 从当前本地 main 建立任务分支，已保留原未跟踪设计文档。各批在同一分支保留未提交成果，后续批完整读取此前交接和差异。用户当前授权为实现和验证，Git 提交、合并与推送遵守根规范中的单独授权要求。
- 共享业务、HTML、资源生成器、测试桥接及本计划由当前批单独写入。协调会话在子会话运行时仅做只读检查。资源准备、Rust 构建及 GUI 验收串行运行。
- 每个新子会话完整读取仓库规则、JavaScript 指南及两份绝对路径外部规则，修改 Rust 前另读 Rust 指南。先核对实际路径、origin、HEAD、分支和已有改动，再进入本批代码。

## 逐批工作

各批均先盘点调用方、闭包读写和生命周期。使用真实实现固定业务输出，补充能发现特定回归的边界样例，随后完成全部计划范围的迁移接线及条件整理。原文、题意、答案、评分和旧备份数据以现有回归和最新基线为依据。已批准批次中的局部实现选择由执行会话按现有结构决定。

| 批次 | 必须完成的范围 | 最小验证与退出条件 | 状态 |
| --- | --- | --- | --- |
| 1 | 练习题号范围及精确题号格式化移入 training；多空答案归一化及判定纯函数归集到 quiz-core。结合最新单题号起点语义更新调用。 | 题号边界、多空顺序、简答自评、当前起点题量与复盘重练回归；相关共享测试、typecheck、lint、npm test 和受影响页面通过。 | 已完成，见第 1 批交接 |
| 2 | 共用 ZIP 目录、读取、解压、CRC32、打包模块，全量迁移 DOCX、XLSX、备份和 OCR 导出的调用及资源清单。 | ZIP 安全、旧 JSON/ZIP、文档及备份回归；新模块进入完整 lint，Web、file 入口和桌面资源接通。 | 已完成，见第 2 批交接 |
| 3 | 文本解析按选项、题型、题干分段、候选策略迁移，接通 parseTextQuestions 与诊断。元数据 Symbol 保持同一所有者。 | 原有解析特征、答案表、重复题号、材料题、图片、双文件与局部修复回归，比较完整业务输出和诊断。 | 已完成，见第 3 批交接 |
| 4 | 按 CSV/XLSX、DOCX、PDF/OCR 顺序完成格式模块，归集导入预览及 OCR 生命周期。 | 文档页面实际导入、离线资源、取消和再次选择；识别失败释放原资源，保存重载结果正确。 | 已完成，见第 4 批交接 |
| 5 | 学习记录双向转换、题库和媒体备份转换、WebDAV 页面归集。 | 空值/零分/多空回退矩阵、旧 Android JSON/ZIP 往返、失败数据保全、WebDAV mock 通过。 | 已完成，见第 5 批交接 |
| 6 | AI 结果与错误纯计算，以及导入、批量、单题、错题和训练复盘的各自会话。 | 补导入/批量忽略 AbortSignal 的迟到传输测试，现有 AI mock、训练复盘和账户变化回归通过。 | 已完成，见第 6 批交接 |
| 7 | 题库及编辑、收藏错题、记录复盘、共同题目渲染，最后练习和考试页面会话。入口统一管理事务、启动恢复和关闭检查。 | 页面主流程、分页懒加载、键盘焦点、计时、自评、重复提交、保存失败、恢复重入及桌面关闭通过。 | 已完成，见第 7 批交接 |
| 8 | 全批条件与状态审查，补完桌面 adapter、CodeBuddy/Harness 及 Rust 关联字段判断的此前候选。 | 条件候选逐项有处置和测试依据，完成适用 Rust 检查、最终构建与隔离 WebView2 验证。 | 已完成并经主会话审查，见第 8 批交接 |

## 每批的条件判断要求

- 复杂或重复条件采用业务名称，关联字段共用同一业务判断。避免复杂嵌套三元，保留已具名且容易理解的简单判断。
- 区分缺省、false、true，以及空答案、零分、空数组等契约语义。针对可能变化的状态，在原有异步或事务检查点重新计算谓词。
- 生命周期归当前操作或会话所有，切题、换轮、退出和恢复后拒绝旧响应。计时器、取消和回滚按原时序执行。
- 每批说明迁移的真实函数、条件改造、状态所有权、已保留的接口适配和清理情况，后续批避免再维护第二份实现。

## 验证与交接

1. 当前工作树开始时没有 npm 依赖和 Rust target。安装依赖前按路径或命令行核实相关进程，停止确属本工作树的占用，按 package-lock 安装并检查完整性。Rust 工具链先检查 `C:/Users/30728/.cargo/bin`。测试仅使用隔离目录、自建数据和 mock。
2. 每批运行最小回归后执行适用的 typecheck、lint、npm test。Web 业务用已有页面和 AI/WebDAV 回归验证。新增资源时验证桌面准备和 build，需要运行验证时再串行 build:test、test:desktop。文档与本计划补 UTF-8、围栏、本地链接及差异检查。
3. Rust 改动执行 fmt、Clippy、test，涉及 feature 时追加对应组合。联合收尾检查最新源码的 Web/file 入口、离线文档及 WebView2；记录实际覆盖的场景和环境缺口。
4. 本批完成后在下方追加独立交接节，记录会话标识、起止 HEAD、改动文件、真实验证命令及结果、失败原因与修复、下一批前置条件。结果有失败或未完成检查时按实际记录，由主协调会话解决或明确阻塞后再交接。

## 执行记录

准备阶段已核对本地 main 前移，创建 `codex/web-app-split`。原设计获得用户批准，并增加第 8 批以覆盖原条件判断审查的桌面和 Rust 范围。第 1—8 批均已执行并经主协调会话审查；所有成果仍在当前工作树未提交，最终状态见上表，各批历史交接如下。

### 第 1 批交接（2026-11-08）

- 执行会话：`/root/batch_1_training_core`；工作树和分支仍为本计划指定位置。起止 `HEAD` 均为 `9434786f01019e096f40c64e3023a66bd2b20ed4`，本批没有提交、推送或合并。两份设计/计划文件在开始时已未跟踪，继续保留；本计划的状态和本交接也是未提交内容。
- 真实实现：`apps/web/training.js` 持有题号解析与精确题号格式化；`apps/web/quiz-core.js` 持有多空归一化、去重和判定，以及它们依赖的题型、普通文本比较纯函数。`apps/web/app.js` 接入同一实现；页面范围、顺序/随机、题量、进度、分数、ID 和时间仍由原调用方处理。单个数字仍表示起点；收藏单题和复盘单题重练使用 `n-n` 表示精确单题。
- 条件和状态：共用待自评判断区分缺省、`false` 和 `true`；未作答不要求自评，总提交的读取和判分仍在事务回调内进行，不把状态检查跨异步边界缓存。多空和其他作答收集改为明确分支。原有业务注释保留，未改评分、持久化格式或权限边界。
- 修改文件：`apps/web/app.js`、`apps/web/training.js`、`apps/web/quiz-core.js`，以及 `test/dual-platform/business.test.cjs`、`quiz-core.test.cjs`、`training.test.cjs`、`source-loading.test.cjs`、`web-source.cjs`。本批复用已有脚本及桌面资源清单，没有新增资源入口或 lint 债务例外。测试桥接加载真实共享模块，加载顺序和原有唯一启动断言继续执行。
- 验证（最终代码，除单独注明外）：根目录的 `node --test test/dual-platform/business.test.cjs test/dual-platform/training.test.cjs test/dual-platform/quiz-core.test.cjs` 为 28/28；使用临时脚本 `node (Join-Path $env:TEMP 'shiroha-a4ce-compare.cjs')` 对照 `HEAD` 原实现和当前模块的 5200 组合成输入，结果或异常类型一致。`apps/desktop` 下 `npm run typecheck`、`npm run lint` 通过，`npm test` 的桌面测试 137/137、共享测试 262/262，`npm run test:web-platform` 为 107/107。
- 根目录运行 `node test/web-ai-practice/runner.cjs --executable-path 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'`，以进程级 `NODE_PATH` 指向下述现有 Playwright：完整 52/52（在最后一次局部格式和命名整理前）；整理后使用相同命令加 `--filter submit-modes`，总提交、自评及失败重试 3/3。测试均使用隔离浏览器、假密钥和 mock，没有调用真实收费服务。
- 桌面生成与构建串行执行：`npm run prepare:web`、`npm run build`、`npm run build:test` 均通过，生成的 `app.js`、`training.js`、`quiz-core.js` 与 Web 源文件 SHA-256 一致；`npm run test:desktop` 的隔离 WebView2 smoke 为 41/41，覆盖单题号起点跨库题量、总提交、训练复盘、资源、重启和恢复。普通及测试版首次构建分别耗时约 4 分 58 秒和 4 分 50 秒。干净系统安装、升级及真实外部服务不属于本批验收。
- 环境与权限：Node `C:/Software/nodejs/node.exe` 为 24.22.2，npm 11.19.1；Rust 1.99.1 的入口为 `C:/Users/30728/.cargo/bin`，工具链为 `C:/Users/30728/.rustup/toolchains/1.99.1-x86_64-pc-windows-msvc`，MSVC 编译器位于 `C:/Program Files/Microsoft Visual Studio/18/BuildTools/VC/Tools/MSVC/14.51.36231/bin/Hostx64/x64/cl.exe`。Edge 157.0.4341.42 位于 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`；桌面 `playwright-core` 为 1.64.1，AI runner 可通过进程级 `NODE_PATH=C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules` 使用已有 Playwright 1.62.1。
- 首次安装前经提升权限读取进程命令行，未发现本工作树的依赖占用进程；使用 `HUSKY=0`、临时 npm 缓存按 lock 执行 `npm ci`，`npm ls --all` 和 esbuild、TypeScript、ESLint、Tauri CLI 启动检查通过。沙箱内 npm 镜像请求出现 `EACCES`，安装改用本机权限；沙箱内 `npm test` 的 esbuild 临时 fixture 和 `npm run prepare:web` 因读取上级目录被拒绝，使用本机权限重跑通过。`npm run build`、`npm run build:test` 因包含同一资源生成而使用本机权限，`npm run test:desktop` 为隔离 GUI 和回环 mock 使用本机权限。AI runner 硬编码了旧用户名路径，按上述进程级 `NODE_PATH` 解决，没有更改全局配置或 lock。
- 两次 Tauri 构建将 16 个开始时干净的自动生成权限文件从 CRLF 改写为 LF；逐个确认归一化 Git 对象哈希与 `HEAD` 一致后，只恢复这些文件的原有行尾。沙箱不允许在共享 Git 元数据目录创建 `index.lock`，该定向恢复使用本机权限。后续批构建后应先核对起始状态和实际内容，不能无条件覆盖生成文件。
- 后续条件：主协调会话先审查本批未提交差异和结果，再串行启动第 2 批；保留当前工作树、两份未跟踪文档及忽略的依赖/构建目录，不将本批实现复制到其他工作树，也不自动提交。

### 第 2 批交接（2026-11-08）

- 执行会话：`/root/batch_2_zip`；工作树和分支仍为本计划指定位置，起止 `HEAD` 均为 `9434786f01019e096f40c64e3023a66bd2b20ed4`。第 1 批的未提交成果和两份未跟踪文档均予保留，本批未提交、推送或合并。
- 真实实现：新增 `apps/web/zip.js`，唯一持有中央目录解析、路径/数量/大小/目录与本地头校验、STORE/DEFLATE 解压、CRC32、存储式封包和 DOS 时间转换；`app.js` 仅绑定 `parseZipEntries`、`unzipEntry`、`unzipEntryBytes` 和 `zipStoreFiles`。XLSX、DOCX（含图片及外部内容块）、JSON/ZIP 备份读取和备份/OCR 文档导出均继续通过这些入口。文件授权、格式解释及备份路径命名仍留在原调用方；每次封包仍在原调用时取得一次当前时间。CRC 表由本页面 ZIP 模块惰性持有，页面卸载时随模块释放。
- 条件整理：路径前缀、条目大小、中央目录、重复/链接/加密条目、本地数据和解压输出使用具名判断；大小失败仍先于 CRC 校验，错误文案、原限额、目录条目及原调用顺序保留。原有目录条目说明随实现迁移，没有引入依赖、应用上下文或第二份实现。
- 本批修改：`apps/web/app.js`、`apps/web/zip.js`、`apps/web/index.html`、`apps/desktop/scripts/prepare-web.mjs`、`test/dual-platform/zip-safety.test.cjs`、`browser-page.cjs`、`source-loading.test.cjs`、`web-source.cjs` 和本计划。页面和桌面生成器均将 `zip.js` 排在应用入口之前；复制及必需资产清单已更新。测试桥接加载真实模块并验证与入口绑定为同一函数，未增加 lint 债务例外。
- 先在原实现执行根目录 `node --test test/dual-platform/zip-safety.test.cjs test/dual-platform/format.test.cjs test/dual-platform/contracts.test.cjs test/dual-platform/document-lifecycle.test.cjs`，55/55；迁移接线后再加 `source-loading.test.cjs` 为 65/65。最终整理后 ZIP、备份和文档生命周期小集为 30/30。新增样例覆盖目录、STORE/DEFLATE、CRC、固定时间与完整打包字节、穿越、重名、链接、加密、截断、限额和 OCR 文档回读；另用一次性 Node 对照 `HEAD` 原实现与新模块，5 组固定归档及 1000 组确定性字节变异的打包、解析、解压或报错结果一致。
- 最终代码在 `apps/desktop` 运行 `npm run typecheck`、`npm run lint` 和 `npm test` 均通过：lint 完整检查 81 个手写 JavaScript 文件，npm 桌面测试 137/137、共享测试 267/267。首次 lint 因新增测试中的单行 `if` 缺少大括号失败，修正后完整通过；后来新增浏览器 DEFLATE 测试后再次完整运行 lint 并通过。
- `npm run test:web-platform` 为 107/107，覆盖 Web 页面、旧 Android ZIP 和 `file://` 启动；之后新增的真实 Edge DEFLATE 测试与 file 加载测试使用 `node --test --test-name-pattern 'Web 和 file 入口|file URL 的静态 ZIP' ../../test/dual-platform/browser-page.cjs` 单独通过 2/2。`npm run test:documents` 为 1/1，实际离线导入并重载自建 DOCX、XLSX、文本 PDF 和中文扫描 PDF，覆盖 OCR 识别中取消和重试及模拟人工校对。
- 串行执行 `npm run build`、`npm run build:test`、`npm run test:desktop` 均通过；正式构建和测试版编译分别约 1 分 15 秒及 1 分 11 秒。生成资源中的 `app.js`、`training.js`、`quiz-core.js`、`zip.js` 与源码 SHA-256 一致，桌面 HTML 的 `zip.js` 位于 `app.js` 之前；隔离 WebView2 smoke 的 41 项检查全部通过，包含离线中文扫描文档、备份恢复和重启。构建前备份了 16 个干净的生成权限文件；两次构建后分别逐项确认正文相同、仅行尾变化，再恢复原始字节，没有覆盖内容变化。
- 环境：沿用第 1 批依赖与 Cargo 缓存，没有重新安装；`npm test` 和两个构建因已知 esbuild 上级路径限制使用本机权限，Edge 和 WebView2 使用本机权限、隔离 profile 与本地 mock。系统 `python` 别名不可访问，源码迁移改用现有 Node，未更改系统环境。未测试干净系统安装/升级、真实外部服务、超大实际文档或超过测试夹具规模的数据；大小限制使用构造的 ZIP 声明值验证。桌面文档样本使用 STORE，DEFLATE 已在 Node 和 Edge 的 HTTP/file 入口验证，未单独在 WebView2 验证。
- 后续条件：主协调会话先审查本批全部未提交差异和验证，再另开第 3 批；保留当前工作树和忽略的依赖/构建目录，不复制到其他工作树或自动提交。

### 第 3 批交接（2026-11-08）

- 执行会话：`/root/batch_3_text_parser`；起止 `HEAD` 均为 `9434786f01019e096f40c64e3023a66bd2b20ed4`，分支仍为 `codex/web-app-split`。第 1、2 批的未提交成果和未跟踪 ZIP、设计/计划均予保留，本批未提交、推送或合并。
- 真实实现：新增 `apps/web/text-parser.js`，迁入文本题库的选项修复、题型和答案归一化、题干分段、候选策略、原文定位、局部修复、共用材料、图片候选、质量评估和警告计算，以及它们共用的题目归一化与校验；原 `app.js` 真实调用均接入同一模块。答案表提取与重复题号匹配继续使用 `text-answers.js`，共享题型与多空规则继续使用 `quiz-core.js`，没有复制第二套实现。格式层提供 Word XML 与富文本/图片处理，应用入口提供 ID 与日志函数，均按原调用时机执行。
- 元数据和状态：`SOURCE_META_V58910` 与 `RECRUITMENT_OPTIONS_V58915` 各由解析模块持有唯一 Symbol；属性保持可写、可配置、可枚举且不会进入 JSON，展开与多次归一化后仍可读取。页面仍拥有导入报告、诊断和警告；解析器在诊断构造前同步发布报告，故诊断抛错时保留本次报告和上一次诊断，成功时再写入新诊断。没有把导入状态、ID 或时间迁入长期缓存。
- 条件整理：候选题量/分类判断和修复风险采用具名业务条件，复用候选修复的质量判断，消除不可达的重复分支；题目归一化和匹配强度中的嵌套三元改为明确分支。参数局部处理、选项和正则整理保留原有空值、答案和状态语义；新模块通过完整增量 lint，没有新增债务例外。源码区段提取调用已逐项核对，现有提取端点仍在 `app.js`；测试桥接和加载顺序改为装载真实解析模块。
- 本批修改 `apps/web/app.js`、`apps/web/index.html`、`apps/desktop/scripts/prepare-web.mjs`、`test/dual-platform/browser-page.cjs`、`source-loading.test.cjs`、`web-source.cjs` 和本计划；新增 `apps/web/text-parser.js`、`test/dual-platform/text-parser-cases.cjs`、`text-parser.test.cjs`、`fixtures/text-parser-expected.json`。桌面资源复制和必需资产清单、Web 与 `file://` 脚本顺序均已接通。
- 基线与对照：迁移前以确定性 ID 固定五类输入、四种策略共 20 组完整题目、Symbol 元数据、报告和诊断，覆盖重复题号、共用材料、全角/粘连选项、分卷、多空文本及图片；另固定实际发生的异常题局部修复，并验证双文件答案、元数据属性与跨解析器实例的 Symbol 一致性。迁移后以临时脚本对照迁移前源码的 480 组合成输入，题目、ID 序列、Symbol 元数据、报告、警告、诊断和异常一致；旧实现没有复制到生产。相关解析、业务与圈号回归最终为 38/38。
- 检查：`apps/desktop` 下 `npm run typecheck`、`npm run lint`、`npm test` 通过；完整 lint 检查 84 个手写 JavaScript 文件，共享测试 271/271，桌面测试通过。新增的跨实例 Symbol 断言在完整测试后运行其相关小集并通过；浏览器测试仅调整了测试名。根目录 `node --test test/web-webdav/request.test.cjs` 为 9/9。
- 实际页面：`npm run test:web-platform` 为 108/108，包含 `file://` 输入文本、预览、保存与重载；`npm run test:documents` 为 1/1，自建 DOCX、XLSX、文本 PDF、中文扫描 PDF 均实际导入并重载，覆盖 OCR 识别中取消和重试及模拟人工核对。`node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'` 使用进程级 `NODE_PATH=C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`，隔离浏览器和假密钥/mock 回归 52/52。
- 桌面按顺序运行 `npm run build`、`npm run build:test`、`npm run test:desktop` 均通过，前两次编译分别约 1 分 13 秒、1 分 08 秒；隔离 WebView2 smoke 返回 `ok=true`，脚本的 41 项检查覆盖实际导入、离线文档、持久化、重启和恢复。生成的 `app.js`、`text-parser.js`、`text-answers.js`、`quiz-core.js`、`zip.js` 与 Web 源码 SHA-256 相同，桌面 HTML 的解析脚本位于应用入口之前。两次构建分别核对起始时干净的 16 个权限文件，均仅有行尾差异，已按起始字节定向恢复。
- 测试修正：基线快照首次运行发现生成 ID 不固定、Symbol 插入顺序与原始对象不同；改为固定 ID 序列，并按 Symbol 身份集合和属性描述比较后通过。新增 `file://` 测试第一次将报告定位到诊断面板而超时，改为实际报告所在的 `#import-summary` 后通过；未为测试修改生产行为。复用现有依赖和 Rust 缓存，没有执行依赖安装。`npm test`、构建和隔离 GUI 依据已记录的沙箱限制使用本机权限。
- 文档与工作树：`npm run lint:docs` 通过；本计划及设计另检查 UTF-8、代码围栏、本地链接、尾随空白和冲突标记，`git diff --check` 通过。最终权限生成目录无差异，工作树保留第 1、2 批及本批所有未提交和未跟踪文件。
- 范围缺口：未验证干净系统安装/升级、真实外部服务、超大实际文档或全部可能的导入格式；测试数据均为自建样例或 mock。主协调会话审查本批未提交差异与结果后，再按计划决定后续批次；继续保留当前工作树与忽略的依赖、构建和测试目录。

### 第 4 批交接（2026-11-08）

- 执行会话：`/root/batch_4_documents`；工作树仍为 `C:/Users/30728/.codex/worktrees/a4ce/shiroha-quiz-desktop`，分支 `codex/web-app-split`，起止 `HEAD` 均为 `9434786f01019e096f40c64e3023a66bd2b20ed4`。前三批成果及其未跟踪源码、测试和设计文档均保留；本批没有提交、推送或合并。
- 真实格式接口：`apps/web/table-import.js` 接管 CSV 分隔、XLSX 工作簿关系与单元格读取，以及共享表头、行列映射和表格题库规则；`docx-import.js` 接管 Word 正文、图片关系、公式、表格和 HTML/MHT 外部内容块，向文本解析器提供唯一 `docxXmlToText` 与 `decodeXml`；`pdf-import.js` 接管 PDF.js 加载及文字层、轻量回退和释放。ZIP 仍只使用 `zip.js`，题型、答案和文本题目仍复用 `quiz-core.js` 与 `text-parser.js`，所选文件仍通过 `ShirohaPlatform.files` 读取。
- 会话和条件：`ocr-import.js` 独占当前 PDF、草稿、取消信号及本轮 Worker、Canvas、PDF 加载任务，重选/清空取消旧轮次，迟到结果仍在原检查点拒绝；退出确认使用会话的 `isRunning`/`cancel`。`import-preview.js` 持有题目草稿、表格结果、警告、报告、诊断、筛选、选择及来源元数据，并接管单/双文件读取和各自清空；AI 的 `snapshot`/`restore` 按原引用恢复。AI 与编辑仍操作同一草稿，确认新增/追加和保存失败回滚仍在 `app.js` 的原 `runMutation` 边界，未跨异步保存状态判断。DOCX 外部块判断、OCR 状态/按钮和表头评分的重复或嵌套条件已整理；保留原有空值、零和显式布尔语义、原有效注释及错误文案。
- 本批修改 `apps/web/app.js`、`index.html`、`apps/desktop/scripts/prepare-web.mjs`、`document-smoke.mjs`，以及 `test/dual-platform/ai-import-retry.test.cjs`、`browser-page.cjs`、`document-lifecycle.test.cjs`、`exit.test.cjs`、`json-import.test.cjs`、`source-loading.test.cjs`、`web-source.cjs` 和本计划；新增上述五个 Web 模块及 `document-formats.test.cjs`、`import-lifecycle.test.cjs`、`table-import.test.cjs`。页面顺序、桌面复制与必需资产清单和共享测试桥接接入真实实现；没有增加依赖、lint 债务例外或泛化源码提取器。
- 先固定并运行迁移前表格、DOCX、PDF 和取消/失败特征：包含 CSV 引号跨行与重复表头、XLSX 共享字符串和稀疏列、DOCX 图片/公式/表格顺序与缺失正文、PDF 排序及失败回退、OCR 失败/取消/重选/超限释放。随后按 CSV/XLSX、DOCX、PDF、OCR/预览顺序接线并运行小集；基线测试最初对现有表格归一化结果作了错误假设，按迁移前实际输出修正断言，没有改变业务结果。迁移后的导入、JSON、AI 失败、OCR 与文本解析小集为 29/29；最后补充确认退出取消 OCR 后，`node --test test/dual-platform/exit.test.cjs` 为 6/6。
- `apps/desktop` 下 `npm run typecheck`、`npm run lint` 通过，完整增量 lint 检查 92 个手写 JavaScript 文件；`npm test` 桌面测试 137/137、共享测试 279/279（最后追加的退出断言另跑上述小集）。`npm run test:web-platform` 为 108/108；根目录 `node --test test/web-webdav/request.test.cjs` 为 9/9。`node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'` 通过进程级 `NODE_PATH=C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules` 使用既有 Playwright，隔离浏览器和本地 mock 为 52/52，没有访问真实收费 API。
- `npm run test:documents` 与隔离 `npm run test:desktop` 均通过。自建 CSV、XLSX、含图片和 OMML 公式的 DOCX、HTML altChunk DOCX、文本 PDF 与中文扫描 PDF 均实际预览、保存并重载；OCR 包含识别中取消、重试和模拟人工校对。桌面 smoke 返回 `ok=true`、离线脚本错误 0，并覆盖重启、恢复及原生授权边界。未覆盖所有 MHT 编码、超大实际文档、干净系统安装/升级或真实外部服务。
- 串行执行 `npm run build`、`npm run build:test`、`npm run test:desktop`：正式及测试版构建分别约 1 分 40 秒、1 分 27 秒，均通过。11 个生成脚本与 Web 源码 SHA-256 一致，所有新模块位于应用入口之前。两次构建前后分别比较 16 个起始干净的自动生成权限文件，确认均仅有行尾差异后恢复构建前原字节；没有覆盖内容变化。沿用既有依赖与缓存，已知 esbuild 上级路径限制和隔离 GUI 按前批说明使用本机权限，没有重新安装依赖。
- `npm run lint:docs` 通过；本计划及设计文档另行检查 UTF-8、代码围栏、本地链接、行尾空白和冲突标记，`git diff --check` 通过。最终权限生成目录无差异，工作树保留所有既有及本批未提交和未跟踪文件。
- 后续条件：主协调会话先审查本批全部未提交差异与真实接口，再决定启动第 5 批；保留当前工作树、前三批及本批未跟踪文件、依赖与构建缓存，不自动提交或清理。

### 第 5 批交接（2026-11-08）

- 执行会话：`/root/batch_5_backup_webdav`；工作树仍为 `C:/Users/30728/.codex/worktrees/a4ce/shiroha-quiz-desktop`，分支 `codex/web-app-split`，起止 `HEAD` 均为 `9434786f01019e096f40c64e3023a66bd2b20ed4`。前四批未提交与未跟踪成果全部保留；本批没有提交、推送或合并。
- 学习记录：`ShirohaBackupCore.createRecordConverters({ makeId, now, serializeQuestion, toNativeQuestionType })` 返回 `toNative(record, bankMap)` 和 `toWeb(record)`，由完整备份和旧 Android 导入共用。题目快照优先级、按题库查找、缺失题目时生成 ID 及记录日期取得时机保留；转换器不持有页面状态或缓存。显式原生 `null`、零分与缺省分数分开；多空的直接非空作答优先，空数组在多空题按原规则回退 `userAnswer`；`autoScored` 仅明确 `false` 时关闭。
- 备份职责：`ShirohaBackupData.create(...)` 接收题库归一化、序列化及时间/ID 等明确依赖，提供 `buildBackupPayloadV23(state, banks, ...)`、`buildNativeInteropStateV24(state, banks)`、`buildNativeCompatibleBackupZipV611(state)`、`normalizeBackupPayloadV23(data, fileName)` 和 `mergeBackupBanksV23(state, normalized)`。其中同名/同 ID 合并通过已有 `remapBackupRecord` 同步映射记录、明细和复盘题库引用。`ShirohaBackupArchive.create(...)` 提供 `externalizeImages`、`readBackupFile`、`applyAssets`、`countUnresolvedImages`，复用唯一 `ShirohaZip` 和 `backup-core` MIME 规则，文件读取继续委托 `ShirohaPlatform.files`。
- WebDAV 页面：`ShirohaWebdavPanel.create(...)` 返回 `mount(container)`、`renderWebdavPanelV378(forceForm)`、`isBusy()`、`defaultWebdavConfigV378()`、现有请求和错误分类入口。面板模板、表单、绑定、诊断、忙碌状态、远端列表及待恢复项由页面模块所有；`mount` 先插入原模板再绑定和首次渲染，已有面板时不重复挂载。测试通过真实启动重入检查面板和弹窗各一个、处理器引用不变。设置页仍控制公共数据工具样式；网络、凭据保存和撤销继续通过 `ShirohaPlatform`，本地和远端合并/覆盖仍由入口的 `applyBackupImportV23`、`applyNormalizedBackupV378` 在原 `runMutation` 中执行，失败保留原事务回滚及重试语义。
- 条件整理：原生错题、收藏与收藏元数据共用题库/题目引用判断；记录转换显式区分空数组、空值和零分；WebDAV 状态提示共用错误摘要，忙碌及空列表显示改为明确分支，目录控制字符检查保持原范围。原注释随代码移动；旧 Android 的 `kind`、版本、字段和图片资产路径没有改名。没有新增依赖、lint 例外、通用应用上下文或第二份 ZIP/解析实现。
- 本批修改 `apps/web/app.js`、`backup-core.js`、`index.html`、`apps/desktop/scripts/prepare-web.mjs`，以及 `test/dual-platform/browser-page.cjs`、`exit.test.cjs`、`format.test.cjs`、`source-loading.test.cjs`、`web-source.cjs`、`test/web-webdav/request.test.cjs` 和本计划；新增 `apps/web/backup-archive.js`、`backup-data.js`、`webdav-panel.js`。Web、`file://` 和桌面资源清单按依赖顺序加载，测试使用真实模块接口。
- 基线与边界：迁移前新增多空缺省/空数组、空答案、零分/原生空值、明确关闭自动评分及同 ID 同名题库引用测试；相关小集 35/35。固定时间和 ID 的一次性对照比较 `HEAD` 原实现与新实现的 88 组合成 Android 导入、Web 完整备份及原生 ZIP 载荷，结果一致。最终 `node --test test/dual-platform/format.test.cjs` 为 22/22，包含旧 Android JSON、ZIP 经 Web JSON 和含图 ZIP 实际回读的跨格式往返，核对题库、图片、错题、收藏、时间、多空和得分。
- 检查：`apps/desktop` 下 `npm run typecheck`、`npm run lint`、`npm test` 通过；完整 lint 检查 95 个手写 JavaScript 文件，npm 桌面测试 137/137、共享测试 283/283。之后仅移动 WebDAV 模板并追加页面/往返测试：`npm run lint:incremental` 通过，源码加载测试 10/10、WebDAV 请求与退出测试 15/15、最终备份格式测试 22/22。模板首次增量 lint 报 5 处空格格式问题，定向修正后通过，没有新增规则例外。
- 页面：完整 `npm run test:web-platform` 为 113/113，覆盖旧 Android JSON/ZIP、Web 和 `file://`。模板归集后以 `node --test --test-name-pattern 'WebDAV|需要原生检查点' test/dual-platform/browser-page.cjs` 验证 5/5：本地 mock 上传、SHA-256 损坏拒绝、确认取消、合并/覆盖失败回滚并重试、网络取消和重复初始化。另有本地备份合并/覆盖失败重试及缺图保护 3/3。首次这 3 项因设置页的提示节点在隐藏导入页而等待可见超时，改为读取原节点文本后通过，生产行为未更改。
- 文档和 AI：`npm run test:documents` 为 1/1，实际离线导入并重载 CSV、XLSX、DOCX、altChunk DOCX、文本 PDF 和中文扫描 PDF，覆盖 OCR 取消、重试及模拟人工核对。隔离 Edge 与假密钥、本地 mock 的 `node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'` 为 52/52；WebDAV 模板移动后再用 `--filter unconfigured-settings-visible` 验证启动和 AI 设置入口 1/1。进程级 `NODE_PATH` 使用既有 Playwright，未调用真实收费 API。
- 桌面串行执行 `npm run build`、`npm run build:test`、`npm run test:desktop` 均通过；release 和测试版编译分别约 1 分 17 秒、58.64 秒。首次 build 因进程 PATH 缺少 Cargo 在编译前失败，逐项确认权限文件未变化后，后续命令仅为该进程加入 `C:/Users/30728/.cargo/bin`。两次成功构建后分别逐项核对起始干净的 16 个生成权限文件，均字节不变；15 个生成脚本与 Web 源码 SHA-256 一致，加载顺序正确。隔离 WebView2 smoke 为 41/41，覆盖原生 WebDAV/取消、备份、持久化、重启和恢复；离线阶段本地请求 668、远程请求 0、脚本错误 0。
- 文档与工作树：`npm run lint:docs` 通过；本计划及设计另检查 UTF-8、代码围栏、本地链接、尾随空白和冲突标记，`git diff --check` 通过。权限生成目录无差异，现有及本批未提交和未跟踪文件均保留。
- 局限与后续：未验证真实 WebDAV 服务、真实收费 AI、干净系统安装/升级或超大实际备份；测试均使用自建数据、隔离 profile 和 mock。主协调会话审查本批差异和交接后再启动第 6 批，继续保留当前工作树、所有前批与本批未提交/未跟踪文件及构建缓存。

### 第 6 批交接（2026-11-08）

- 执行会话：`/root/batch_6_ai_sessions`；工作树仍为 `C:/Users/30728/.codex/worktrees/a4ce/shiroha-quiz-desktop`，分支 `codex/web-app-split`，起止 `HEAD` 均为 `9434786f01019e096f40c64e3023a66bd2b20ed4`。本地 `origin/HEAD` 和 `origin/main` 均为 `e0764bf2a8d795d3fe6c70972bfd5925a8c18814`；未 fetch，不能据此推断服务器当前状态。前五批所有未提交及未跟踪成果保留；本批未提交、推送、合并或操作其他工作树。
- 真实接口与所有权：`ai-results.js` 持有结果模式、结构校验、HTTP 文案、批量与单题结果解析；`ai-prompts.js` 持有实际使用的导入、批量、单题和追问提示词及题目快照/指纹；`ai-transport.js` 持有平台请求、响应正文读取、格式兼容重试和共用超时计时器。`ai-settings.js` 管理配置归一化、诊断和表单展示，应用入口仍负责配置/凭据保存、撤销、清除和连接测试的事务适配，继续使用现有 `ShirohaPlatform.network`、`credentials` 和 Harness，不新增依赖或平台权限。
- 导入与批量：`ai-import-sessions.js` 独占两类请求身份、控制器、批量计时器及核对/解析建议 Map；使用第 4 批唯一 `importDraft` 及其 `snapshot/restore`，通过具名方法查询、删除或重置建议，按当前题目指纹过滤结果。AI 整理只替换内存预览，建议仍需人工采纳；确认新增/追加与保存失败回滚仍在入口原 `runMutation` 内。只有收到模型内容但业务结构无效时才请求文本兜底，传输失败、取消、结果未知和超时不触发业务重试；HTTP 400/422 仅在未取消时去掉 `response_format` 重试一次，保持先消费响应正文的顺序。
- 单题与复盘：`ai-question-sessions.js` 分别持有练习轮次的解析、追问、草稿、请求序号和控制器，以及错题/训练复盘按场景、来源和题目区分的草稿、保存状态与请求；换轮/退出、来源变化、列表卸载和停止操作使旧身份失效。异步返回后重新核对轮次、请求和指纹，复盘再检查当前来源；账户修订由原 Harness 边界在既有检查点校验。写入解析仍调用入口 `saveAiSingleAnalysisV613` 的原事务，在读取、确认和保存时重新检查来源，失败保留草稿并回滚，不改历史答案或分数。`needsReview` 缺省与 `false`、匹配结果 `null/false/true` 和图片未发送的低置信约束均保留。
- 第 7 批页面边界：入口目前仍拥有 AI 导入文本选择及范围表单、批量预览范围与筛选、建议行展示/采纳/忽略、练习及复盘面板渲染绑定，以及连接测试按钮编排；页面迁移应继续调用 `aiImportSessions` 的请求和建议方法、`practiceAiSessions`/`reviewAiSessions` 的会话方法以及 `aiSettings` 的配置/诊断接口，不复制其 Map 或请求状态。`ensureAiImportStateV99`、凭据读写、`saveAiSettingsV99`/`clearAiSettingsV99` 和 `saveAiSingleAnalysisV613` 仍是入口中的存储与事务适配，迁移展示代码不能绕过它们的确认、重读与失败回滚。
- 取消与超时：取消立即使页面会话身份失效并请求中止，提示“已请求取消”，旧响应、错误和 `finally` 不得修改新草稿、建议、状态、控制器或身份；原生 Harness 仍独立等待和核验终态。共用及批量超时在 `await` 后检查本次计时器，忽略中止的迟到成功也拒绝；HTTP 正文读取后若信号已中止则抛 `AbortError`，不再发格式重试。超时和主动取消保持不同提示，`finally` 按当前身份释放控制器与定时器；若底层完全忽略信号且永不返回，当前等待仍不会自行结束，未改变原生终态确认边界。
- 文件与接线：本批新增 `apps/web/ai-results.js`、`ai-prompts.js`、`ai-transport.js`、`ai-import-sessions.js`、`ai-question-sessions.js`、`ai-settings.js`；修改 `apps/web/app.js`、`index.html`、`apps/desktop/scripts/prepare-web.mjs`，以及 `test/dual-platform/ai-import-retry.test.cjs`、`ai-connection.test.cjs`、`ai-codebuddy-execution.test.cjs`、`ai-harness.test.cjs`、`exit.test.cjs`、`source-loading.test.cjs`、`web-source.cjs`、`browser-page.cjs`；新增 `ai-results.test.cjs`、`ai-settings-helper.cjs`、`ai-transport-helper.cjs`。Web、`file://` 和桌面资源按依赖顺序加载同一实现，新模块进入完整 lint，没有新增历史债务例外。
- 回归与对照：先补忽略 `AbortSignal` 的导入/批量假传输测试，原实现的取消后新任务接管四例先失败；修复后覆盖旧成功、旧错误和旧 `finally` 在新任务进行中或完成后迟到，以及结构化失败后文本兜底迟到。另以可控计时器确认两类请求超时后旧实现仍错误接受结果，新增两例先红后绿及超时→取消→重启后旧清理不干扰新控制器/计时器两例；迟到 HTTP 200/400 的取消检查先红后绿。最终 `node --test test/dual-platform/ai-import-retry.test.cjs test/dual-platform/ai-connection.test.cjs` 为 50/50，覆盖不重试、正文消费、超时/取消及忙碌释放。独立结果矩阵 4/4 覆盖模式别名、`needsReview`、匹配布尔值和 HTTP 分类；以自建题目对照迁移前后的 10 项提示词、载荷与指纹，输出逐字一致。
- 检查：`apps/desktop` 下 `npm run typecheck`、`npm run lint`、`npm test` 均通过；完整增量 lint 检查 104 个手写 JavaScript 文件，共享测试 306/306。首次 lint 暴露迁移后测试未再使用的源码变量，定向删除后通过；最初竞态测试漏配假凭据读取函数，补齐夹具后才得到上述有效红测。根目录 `node --test test/web-webdav/request.test.cjs` 为 9/9。
- 真实页面：完整 `npm run test:web-platform` 为 116/116；随后共用传输和提示词迁移后以 `node --test --test-name-pattern 'AI 导入与批量建议|file URL 支持|Web 和 file 入口|WebDAV' test/dual-platform/browser-page.cjs` 为 7/7，超时修复后再跑 AI 导入及 file 入口 2/2。新页面 mock 实际执行整理→批量解析→人工采纳→确认导入，确认前存储不变；首次断言误以为解析不含既有“答案：A。”归一化前缀，按实际现有规则修正断言后通过。`npm run test:documents` 为 1/1，实际离线导入并重载自建 CSV、XLSX、DOCX、altChunk DOCX、文本 PDF 和中文扫描 PDF，覆盖 OCR 取消、重试和模拟人工核对。
- 完整 AI mock：根目录以进程级 `NODE_PATH=C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules` 执行 `node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'`，最终 52/52；覆盖练习换轮、错题、训练复盘、追问、迟到响应、图片、人工保存、失败回滚和历史记录。测试使用隔离浏览器、自建数据、假凭据和本地 mock，没有调用真实收费 API。
- 桌面最终按顺序执行 `npm run build`、`npm run build:test`、`npm run test:desktop`，均通过；正式及测试版 release 编译分别为 59.41 秒及约 1 分钟。两次构建前后逐项比较 16 个起始干净的生成权限文件，均字节不变；生成的 21 个业务脚本与 Web 源码 SHA-256 一致且位于入口之前。隔离 WebView2 smoke 为 41/41，覆盖原生 AI、错题及训练复盘保存、Harness/CodeBuddy、离线文档、重启与恢复；离线阶段本地请求 661、远程请求 0、脚本错误 0。构建和 npm 测试按前批记录的 esbuild 沙箱路径限制使用本机权限，Cargo 仅加入构建进程 PATH；没有重新安装依赖。
- 文档与状态：`npm run lint:docs` 通过；本计划及设计文档另外检查 UTF-8、代码围栏、本地链接、尾随空格和冲突标记，`git diff --check` 通过。最终权限生成目录无差异，所有既有及本批未提交和未跟踪文件均保留。
- 局限与后续：未验证真实 AI/WebDAV 服务、干净系统安装升级或全部实际大文件；上述模拟与本地测试不代表这些场景已验收。主协调会话应审查本批全部未提交差异与本交接后再启动第 7 批；继续保留同一工作树、所有前批和本批未提交/未跟踪文件及构建缓存。

### 第 7 批交接（2026-11-08）

- 执行会话：`/root/batch_7_pages`；唯一工作树为 `C:/Users/30728/.codex/worktrees/a4ce/shiroha-quiz-desktop`，分支 `codex/web-app-split`，起止 `HEAD` 均为 `9434786f01019e096f40c64e3023a66bd2b20ed4`。`origin` 是 SSH 地址，本地 `origin/HEAD` 与 `origin/main` 均为 `e0764bf2a8d795d3fe6c70972bfd5925a8c18814`；未 fetch，不能推断服务器当前状态。前六批及本批全部未提交、未跟踪成果保留；没有提交、推送、合并或操作其他工作树。
- 页面与编辑：新增 `question-view.js`，归集真实共用的题干、选项、公式、图片、作答绑定和反馈；`bank-page.js` 负责题库列表、预览详情、选择和分页加载，`bank-editor.js` 独占题库二次编辑会话；`question-editor.js` 持有导入预览表及题目、多空和练习题编辑。`saved-questions-page.js` 负责收藏和错题页面及事件，`training-review-page.js` 负责记录与训练复盘页面、快照和请求序号。现有 `training`、`quiz-core`、文本解析、备份和 AI 模块继续作为唯一业务实现。
- 练习与考试：`study-sessions.js` 分别创建练习和考试的唯一会话所有者；练习会话持有当前轮次、请求序号、计时器和暂停弹窗，考试会话持有当前试卷、请求序号，试卷自身持有计时器和截止时间。`practice-selection.js` 管理练习范围及进度，`practice-page.js` 负责练习页面、时钟、总提交和自评，`exam-page.js` 负责考试页面、答卷与倒计时。换轮、重置和退出使旧读取或回调失效；旧考试计时回调绑定原轮次，不会提交新试卷。
- AI 页面与入口：`ai-import-panel.js` 负责导入范围、表单和建议展示，`ai-question-panels.js` 负责练习与复盘 AI 面板；请求身份、取消、超时和草稿继续使用第 6 批的会话接口，异步返回后重新检查当前身份。页面工厂可在无 DOM 时装配，实际事件在初始化/绑定阶段注册；复盘委托、输入监听及恢复重入避免重复绑定。`app.js` 保留启动、导航和平台装配、`runMutation`、关闭检查、数据变更和存储事务，以及既有导入/备份编排、格式识别、服务配置与媒体转换；没有引入通用巨大上下文或循环初始化。入口相对本批开始由 4191 行减少到 2745 行，任务基线 `HEAD` 为 10181 行。
- 事务与恢复：`runMutation` 先等待当前原生读取，再取得当时的练习和考试会话引用，与应用状态一起建立对象图检查点。保存失败且存储修订未变化时恢复原对象及引用；只有事务期间会话引用被替换才恢复旧会话并按原运行状态重新建立计时器，避免旧引用失效或重复计时。已保存但界面刷新失败继续沿用原提示，不把已提交数据当成可回滚；焦点、原生视图和重试按入口原时序恢复。练习异步读题及大题量确认在 `await` 后核对当前请求或轮次，旧结果不能重新开始或重置新轮。
- 接线与注释：本批修改 `apps/web/app.js`、`index.html`、`apps/desktop/scripts/prepare-web.mjs`，以及 `test/dual-platform/web-source.cjs`、`source-loading.test.cjs`、`browser-page.cjs`、`exit.test.cjs`、`ai-harness.test.cjs`、`test/web-ai-practice/harness.cjs` 和本计划；新增上述 12 个页面/会话脚本。HTML、桌面资源复制与必需资产清单、实际测试加载顺序均接入新模块。`HEAD` 中 `app.js` 的 209 条注释与当前根目录业务脚本逐项比较，缺失 0；练习进度区两条原注释随实现移入 `practice-selection.js`。未新增依赖或 lint 债务例外。
- 边界与最小回归：迁移前相关业务、训练与判分测试 31/31、对应浏览器测试 22/22。实际页面新增原生读题期间重置、旧大题量确认返回后新轮次仍保留两项竞态回归，先在旧实现失败再修复通过；另验证旧考试倒计时回调不能提交新轮、恢复重入不重复绑定及页面工厂无 DOM 装配。完整页面集运行后新增的旧考试计时回调测试单独执行 1/1；最后一次仅移动两条注释后运行源码加载和训练小集 17/17、增量 lint 通过。
- 项目检查：`apps/desktop` 下 `npm run typecheck`、`npm run lint`、`npm test` 通过；完整增量 lint 检查 116 个手写 JavaScript 文件，共享测试 307/307、桌面测试通过。沙箱内 `npm test` 因 esbuild 读取临时 fixture 上级目录被拒绝，使用本机权限重跑通过。根目录 `node --test test/web-webdav/request.test.cjs` 为 9/9。完整 `npm run test:web-platform` 为 118/118，覆盖 Web 与 `file://`、分页懒加载、旧响应、焦点、总提交、自评、重复提交、保存失败重试及到期交卷；新增考试旧回调测试随后单独通过。
- 离线与 AI：`npm run test:documents` 为 1/1，实际离线导入并重载自建 CSV、XLSX、DOCX、altChunk DOCX、文本 PDF 和中文扫描 PDF，覆盖 OCR 取消、重试及模拟人工校对。根目录以进程级 `NODE_PATH=C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules` 执行 `node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'` 为 52/52，含训练复盘、错题、追问、迟到响应和保存失败；测试桥接已改为读取真实当前练习会话。
- 构建与 WebView2：最终代码串行执行 `npm run build`、`npm run build:test`、`npm run test:desktop`；正式与测试版 release 编译分别约 54.89 秒和 57.31 秒。Cargo 仅加入构建进程 PATH，构建前后 16 个起始干净的生成权限文件逐项比较，均字节不变，无需恢复；33 个生成业务脚本 SHA-256 与 Web 源一致且依赖位于 `app.js` 之前。桌面首轮 41 项中仅“雾蓝首页、导入与原生窗口尺寸”因 `page.waitForFunction` 等待 30 秒超时，其余项通过；首轮日志未保存堆栈，截图时间只能将范围限定在默认首页截图之后、收起截图之前，具体原因不确定。随后仅增加错误堆栈输出、不更改检查或超时的临时诊断副本 41/41，删除副本后原始 `npm run test:desktop` 也 41/41；最终离线检查本地请求 773、远程请求 0、脚本错误 0。诊断与复验均使用隔离 profile、自建数据和本地 mock。
- 文档与后续：`npm run lint:docs` 通过；本计划和设计文档的 UTF-8、代码围栏、本地链接、尾随空白、冲突标记及 `git diff --check` 均通过。未验证真实 AI/WebDAV、干净系统安装/升级或所有实际大文件；本批不代表这些场景已验收。主协调会话审查本批后再决定第 8 批，继续保留所有未提交、未跟踪内容和构建缓存。

### 第 8 批条件审查表

本批在工作树当前源码上运行原候选扫描器的副本，扩展为包括 Git 未跟踪且未忽略的手写脚本：131 个脚本全部解析，初始列出 16 个嵌套三元、17 组函数内重复条件、115 个密集状态条件及 55 个布尔取反候选；最终复扫分别为 10、0、110、55。这些数字只用于定位，不是缺陷数量；原扫描也不会覆盖 Rust、对象字段里的所有条件或扫描范围以外的文件。以下记录人工复核的重点，不代表已证明全仓没有条件或并发缺陷。

| 复核范围 | 处理或保留理由 | 行为证据 |
| --- | --- | --- |
| 桌面凭据与浏览器凭据 | 桌面 `keep`、`replace`、`clear` 分支明确区分；浏览器先验证 MARKER 绑定，再按记住选择读写本地或会话存储。保留旧值先读本地后读会话、绑定变化拒绝复用及失败补偿次序。 | 两服务的绑定、用户名/端点变化、存储切换、清除与回滚矩阵；原生 stage/commit/rollback 和失败保全测试。 |
| CodeBuddy、CLI 与 Harness | 请求有效性和取消判断使用动态谓词，在原每个异步返回、异常与清理检查点读取 generation、序号、终止状态；不把一次布尔结果跨 `await` 缓存。清理期间旧授权保持禁用，执行仍等待原生终态。 | 现有迟到状态、取消、账户变化、终态查询期间停止、登录超时和手动刷新竞态测试。 |
| 练习与页面 | 总提交在事务前和事务内分别重算是否未完成；答题按钮及 AI 面板的相关展示共用业务判断。删除题库后的分组切换提示共享判断；题型分值改为明确分支，保留零分回退、题目自定分和未知题型默认。 | 自评分值和零分矩阵、总提交、失败重试、切轮与旧回调、题库删除及完整页面回归。 |
| 文本解析 | 原文修复目标、分析收集和上下文题型采用动态谓词，每次在原检查点读取当前主线、当前题目或当前题型；答案映射与图片补全共享“数量合格且质量未下降”条件。选项显式标对及词内字符边界通过纯谓词接收各循环自己的输入，保留原分支、短路和检查时点。 | 四种策略完整快照、异常局部修复、双文件答案、题目元数据及变更前后合成输入对照。 |
| AI 与备份三态 | 单题及追问共同提取人工核对条件；`needsReview` 缺省与明确 `false`、答案匹配的 `null/false/true` 仍分开，单题明确不匹配单独要求核对。备份 `autoScored !== false`、原生空值与零分优先级保持原契约；表单记住选项是归一化配置而非 PATCH。 | AI 置信度/缺省/答案匹配矩阵，旧 Android JSON/ZIP、多空、空值、零分及明确关闭的往返测试。 |
| Rust 组件准备 | Codex 和 CodeBuddy 各自在同一个失败分支内共享“已取消”判断，分别写入对应状态与提示，不引入跨模块状态机。 | 两提供方 × 取消/普通失败矩阵，前后比较状态与提示；原组件并发、停止和恢复测试。 |
| 测试追问与合法保留 | AI 测试 mock 在释放后共用“字符串追问保留已有解析”判断；期间无异步点或修改该条测试数据。`save-queue` 的 `pending → failed → saved`、入口通知及焦点栏的三态条件已具名或含义直接，保留简单三元。参数合法性、状态枚举和逐项早退不机械替换。 | 追问 mock、静态扫描与手工读取状态所有权；未新增 lint 债务例外或扩大权限。其他历史脚本、非候选表达式、运行时数据竞争及真实外部服务不能由本次静态扫描穷尽。 |

### 第 8 批交接（2026-11-08）

- 执行会话：`/root/batch_8_conditions_final`；唯一工作树 `C:/Users/30728/.codex/worktrees/a4ce/shiroha-quiz-desktop`，分支 `codex/web-app-split`，起止 `HEAD` 均为 `9434786f01019e096f40c64e3023a66bd2b20ed4`。本地 `origin/HEAD` 指向 `origin/main`，其本地值为 `e0764bf2a8d795d3fe6c70972bfd5925a8c18814`；未 fetch，不推断服务器当前状态。成果保留为未提交修改和未跟踪文件，没有 commit、push、merge、PR 或其他 worktree 操作。
- 本批直接修改 `apps/desktop/frontend/adapter.js`、`codebuddy-login.js`、`harness.js`、`apps/desktop/src-tauri/src/harness.rs`、`apps/desktop/test/native-services.test.mjs`、`apps/web/platform/browser-credentials.js`、`apps/web/app.js`，以及未跟踪的 `apps/web/ai-results.js`、`ai-import-panel.js`、`ai-question-panels.js`、`practice-page.js`、`text-parser.js`；测试为 `test/dual-platform/browser-credentials.test.cjs`、`business.test.cjs`、未跟踪的 `ai-results.test.cjs` 和 `test/web-ai-practice/harness.cjs`。`rules/javascript-style-guide.md` 将 P5 门禁数量标为历史快照并链接本计划。状态判断及保留理由见上表；不改变评分、备份格式、用户数据、IPC 或权限契约。
- 条件和数据边界：浏览器 MARKER 只有相同端点与账号绑定才能复用；本地/会话迁移、清除及失败补偿保持原次序。CodeBuddy、CLI、Harness 和练习事务的动态谓词均在原检查点计算，不跨 `await` 或事务缓存；原生任务终态仍需确认。AI 默认需要核对，只有明确 `false` 且置信度符合原规则才可取消核对，单题答案明确不匹配仍要求核对。Codex/CodeBuddy 的 Rust 准备失败各自共用局部取消判断。
- 先固定行为：凭据矩阵在改造前通过 11/11；登录、Harness、备份基线 137/137；Rust 两提供方 × 取消/普通失败的状态和提示矩阵在改造前、后各通过。AI 核对的缺省、明确布尔值、置信度与答案匹配先有矩阵再提取。文本解析最后两轮整理以保存的改前源码和最终实现对照 84 组合成题型、答案格式和四种策略，题目、元数据、诊断和错误一致；最终解析/业务/导入小集 33/33。
- 最终 JavaScript 门禁：`apps/desktop` 下 `npm run typecheck`、`npm run lint`、`npm test` 均通过；桌面测试 138/138、共享测试 308/308，均 0 失败、0 跳过；增量 lint 检查 116 个手写脚本。首次增量 lint 指出新增测试中不安全的可选链，改为显式断言后通过。根目录 `node --test test/web-webdav/request.test.cjs` 为 9/9。最后条件整理后对 AI 追问 mock 运行 `node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' --filter follow`，3/3；使用进程级 `NODE_PATH=C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`，未调用真实 API。
- Rust：先运行 `npm run prepare:web`，再在 `apps/desktop/src-tauri` 执行 `cargo fmt --all -- --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`，以及 `cargo clippy --all-targets --features custom-protocol,native-test -- -D warnings`、`cargo test --features custom-protocol,native-test`，均通过。两种测试组合的库测试均为 306 项，集成测试命令也成功；长输出被截断，未完整捕获每个测试二进制的汇总和跳过数，不据此补写总数。首次 fmt 只指出新增测试排版，修正后通过；最终 fmt 仍打印无法规范化 `C:/Users/30728` 的警告，退出码为 0。后续仅改 JavaScript 和文档，Rust 未再改变。
- 页面与离线：完整 `npm run test:web-platform` 为 119/119、完整 AI mock 为 52/52，均在最后文本解析与 mock 条件整理前通过；最终代码随后重跑受影响的旧备份、Web/file 入口和 AI 导入页面 5/5、追问 mock 3/3，以及 `npm run test:documents` 1/1。离线文档实际导入并重载自建 CSV、XLSX、DOCX、altChunk DOCX、文本 PDF 和中文扫描 PDF，覆盖 OCR 取消、重试及模拟人工核对。
- 最终代码依次通过 `npm run build`、`npm run build:test`、`npm run test:desktop`；正式版和测试版 release 编译分别约 50.71 秒和 1 分 17 秒。生成资源的 33 个业务脚本与 Web 源码 SHA-256 一致，其依赖脚本均在 `app.js` 之前加载；隔离 WebView2 为 41/41，离线阶段本地请求 767、远程请求 0、脚本错误 0。完整日志位于 `C:/Users/30728/.codex/visualizations/2026/11/05/01a1aa32-f883-7e11-849b-beed45fb21e9/desktop-smoke-final.log`。第 7 批首次首页/原生尺寸 30 秒超时及其两次通过复验记录保留在原交接，原因仍不明，本批没有再现。
- 生成文件：首次 Rust debug 编译使起始 Git 干净的 16 个自动生成权限文件变为 LF。每次构建前后逐项核对正文与 `HEAD` 一致，全部构建和桌面验证后按第 4—7 批交接所记录的起始 CRLF 恢复，重新逐项检查均为 CRLF 且 Git 状态干净；没有覆盖正文变化。原 `app.js` 的 209 条注释与当前业务脚本按空白归一化对照，缺失 0；入口现为 2762 行。
- 最终工作树清单：32 个已跟踪文件有修改，包括 `apps/desktop/frontend/{adapter.js,codebuddy-login.js,harness.js}`、`apps/desktop/scripts/{document-smoke.mjs,prepare-web.mjs}`、`apps/desktop/src-tauri/src/harness.rs`、`apps/desktop/test/native-services.test.mjs`、`apps/web/{app.js,backup-core.js,index.html,quiz-core.js,training.js,platform/browser-credentials.js}`、`rules/javascript-style-guide.md`，以及 `test/dual-platform/{ai-codebuddy-execution.test.cjs,ai-connection.test.cjs,ai-harness.test.cjs,ai-import-retry.test.cjs,browser-credentials.test.cjs,browser-page.cjs,business.test.cjs,document-lifecycle.test.cjs,exit.test.cjs,format.test.cjs,json-import.test.cjs,quiz-core.test.cjs,source-loading.test.cjs,training.test.cjs,web-source.cjs,zip-safety.test.cjs}`、`test/web-ai-practice/harness.cjs`、`test/web-webdav/request.test.cjs`。
- 39 个未跟踪文件包括 28 个 `apps/web/` 模块：`ai-import-panel.js`、`ai-import-sessions.js`、`ai-prompts.js`、`ai-question-panels.js`、`ai-question-sessions.js`、`ai-results.js`、`ai-settings.js`、`ai-transport.js`、`backup-archive.js`、`backup-data.js`、`bank-editor.js`、`bank-page.js`、`docx-import.js`、`exam-page.js`、`import-preview.js`、`ocr-import.js`、`pdf-import.js`、`practice-page.js`、`practice-selection.js`、`question-editor.js`、`question-view.js`、`saved-questions-page.js`、`study-sessions.js`、`table-import.js`、`text-parser.js`、`training-review-page.js`、`webdav-panel.js`、`zip.js`；另有本设计与计划，以及 `test/dual-platform/` 下的 `ai-results.test.cjs`、`ai-settings-helper.cjs`、`ai-transport-helper.cjs`、`document-formats.test.cjs`、`fixtures/text-parser-expected.json`、`import-lifecycle.test.cjs`、`table-import.test.cjs`、`text-parser-cases.cjs`、`text-parser.test.cjs`。
- 文档与差异：`npm run lint:docs` 通过；本设计和计划另检查 UTF-8、代码围栏、本地链接、尾随空格与冲突标记均通过。`git diff --check` 通过，Git 对既有 LF 工作文件提示后续 checkout 可能转换行尾；另对 39 个未跟踪文件检查 UTF-8、尾随空格和冲突标记，未发现问题。
- 局限与后续：静态扫描不是全仓或竞态正确性证明；未验收真实 AI/WebDAV、干净系统安装/升级或全部实际大文件。第 6 批记录的底层传输完全忽略中止且永不返回时仍等待终态的限制不变。主协调会话应审查全部未提交差异、测试与本交接；继续保留所有文件、依赖和构建缓存，不自动提交或清理。

### 主协调会话最终审查（2026-11-08）

- 8 批已逐批签收。任务分支仍为 `codex/web-app-split`，`HEAD` 保持 `9434786f01019e096f40c64e3023a66bd2b20ed4`；32 个已跟踪修改和 39 个未跟踪文件保留，没有提交、推送、合并或清理工作树。
- 独立核对 `app.js` 从基线 10181 行降至 2762 行，原 209 条注释在现有业务脚本中缺失 0。入口仍保留启动、导航、平台与事务装配、关闭，以及导入和备份编排、共享格式与媒体转换、服务设置装配。
- 独立复扫覆盖已跟踪和未跟踪的 131 个手写脚本，全部可解析，所识别范围内重复条件候选为 0；保留的简单三态及其他候选已记录审查理由。该结果不扩大为对所有条件或异步竞态的完整证明。
- 已核对最终测试记录、资源一致性、权限生成目录无差异和 Git 差异检查；收尾仅更新文档，并复查文档格式及链接。上述真实服务、安装升级、大文件、首页偶发超时根因和永不返回的底层传输限制均保留。
