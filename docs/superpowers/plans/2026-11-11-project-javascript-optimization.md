# 全项目 JavaScript 优化实施计划

2026-11-11。用户已明确要求按[全项目优化规划](../specs/2026-11-11-project-javascript-optimization.md)实施，逐批新建独立会话，模型使用 `gpt-6.1-terra`、`max` 和 Fast。AI 导入范围同时依据[专项设计](../specs/2026-11-11-ai-import-panel-optimization.md)。

**提交后补记（2026-11-12）：**五批成果及本文的原交接记录已按用户要求合为提交 `584fbbe`，基线为 `49a2007`，共 53 个文件。下文“未提交”“HEAD 未变”等描述均为各批结束及提交前收尾时的历史状态，不代表提交后的状态。回归记录对应各自所述的累计工作树，非独立批次提交；本次审查修复另在该提交之上进行。未授权改写已有提交历史。

## 1. 执行与交接

- 主协调会话维护总体进度，五批分别新建具有独立上下文的 Codex 会话，按 1 → 2 → 3 → 4 → 5 顺序执行。下一批在上一批实现、回归和协调审查完成后启动。新会话显式选用 Terra max，实际实施使用同模型 priority 子代理通道，记录实际会话和执行身份。
- 唯一写入工作树为 `C:/Users/30728/.codex/worktrees/724b/shiroha-quiz-desktop`，任务分支 `codex/shared-project-js-optimization`。起始 `HEAD` 和本地 `main` 均为 `49a2007844bf09805c4ab744fee019a1bd3a092f`。既有三份文档改动属于本轮规划，随本工作树保留。主协调会话与批次执行会话交替写入。
- 各会话首次执行前完整读取根规则、JS 指南、协作规划及两份外部规则。在当前工作树安装独立 npm 依赖，安装前按路径与命令行确认相关进程占用。资源准备、构建、桌面 GUI 和性能测量独占执行。
- 用户已授权实现、测试和批次交接。成果按批保留未提交差异。继续沿用既有 Git 授权边界。其他工作树的未提交文件、历史任务线和用户数据由其所有者维护。
- 文件级覆盖以设计中的 150 份手写脚本为初始清单，各批记录完整路径、调用入口、处置结论与证据。审查后已有行为与维护成本合理的文件登记“保留现状”，发现具体问题则实施最小调整。新增或删除脚本在收尾时对 Git 清单重新核对。

## 2. 第一批 · 数据正确性和开始条件

实施、验证和主协调审查已完成。交接见第 8 节。

1. 使用真实 AI 导入会话加可控延迟传输，先写失败回归。覆盖整理等待期间普通识别、表格替换、编辑及原文/选区改变，在结构化成功、传输失败、清洗兜底前后分别确认新草稿、选择、诊断和提示保全。
2. 复用取消和请求所有者边界，验证回写、回滚和追加兜底仍有权修改当前草稿。原位修改、题数超过提示摘要上限的变化也要纳入。旧任务收敛后正确释放状态。
3. 批量开始时固定有序目标身份与内容指纹。逐批发送和响应回写按原目标定位。模拟 A～E 中选择 B、D，首批等待时删除 A，仍发送 B、D。目标被删除、改动或身份不唯一时明确停止剩余批次。覆盖同题面不同 ID、无 ID、重排、取消重启和迟到响应，并核对建议采纳、编辑后使用的归属。
4. 分离 Web 存储的读取、JSON 解析、结构验证和写入错误。用真实 DOMException 覆盖 SecurityError 与 QuotaExceededError，坏 JSON/结构、未来版本、原文导出和失败后禁写分别断言。
5. 统一导入与预览开始按钮对这两类任务的忙碌判断，保留共享就绪状态与任务能力。批量编辑保留原始值，共用 1～30 整数校验。非法值实际发送 0 个请求，31 题且每批 30 时预计与实际均为 2 批。默认值核对 20、补解析 10，普通刷新和显式重置分别验收。
6. 审查八份 AI 模块及相关草稿、平台存储调用方，保留取消、人工核对、收费请求主动触发和账户/配置变化后的有效性。

主要范围为 `ai-import-sessions.js`、`ai-import-panel.js`、`ai-results.js`、`app.js`、`import-preview.js`、`question-editor.js`、`platform/browser.js`，并审查其他 AI 模块。

最小回归包括 `ai-import-retry.test.cjs`、`ai-results.test.cjs`、`browser-storage.test.cjs`、`import-lifecycle.test.cjs`，以及新增的真实面板交互与请求载荷用例。执行 `npm test`、typecheck、lint、Web 页面、AI 模拟服务回归及共享资源的构建和隔离桌面验证。完成后登记实际命令、通过数、未覆盖项和下一批接口。

## 3. 第二批 · 保存与预览性能

实施、验证和主协调审查已完成。性能结论按第 8 节的计数与样本口径记录。

1. 先修复 benchmark 样本预检对过时存储键格式的依赖。固定真实原生读回与持久化断言，保留隔离 profile。小样本与 500/1,000 题的自建大题库分别记录。
2. 桌面保存对题库、题目、记录使用本次提交内的身份集合，消除双向成员扫描的平方增长。保持变更命令、顺序、惰性正文保护和回执语义。
3. 普通导入预览在一轮渲染中复用报告与表格的诊断结果。500 题完整刷新由 1,000 次诊断降至至多 500 次，编辑后的结果与此前语义等价。
4. AI 目标选择按范围分支计算。500 题的 range/selected/all 和 visible+all 诊断为 0 次，需要状态的可见筛选至多 500 次。基础索引、最终索引、去重和顺序逐项比较。
5. 消除重复同步，单次初始化或 Harness 通知每个可见面板至多刷新一次。保留隐藏导入面板的失效选区纠正、练习和复盘刷新、sticky 状态。范围下拉框只在初始、模式切换或节点替换时重建。
6. 为性能改动比较相同输入的操作计数。实际耗时使用改前和改后相同机器、相同 fixture 的多轮数据。

主要范围为桌面 `adapter.js`、`benchmark.mjs`，以及 Web `question-editor.js`、`ai-import-panel.js` 和其同步调用方。最小回归包括原生适配器、导入生命周期、目标选择和面板计数。执行公共门禁、页面、构建、隔离桌面与适用基准。

## 4. 第三批 · 题库、作答和页面事件

实施、验证和主协调审查已完成。首次桌面冒烟超时及完整重跑结果见第 8 节。

1. 练习与考试复用现有基础筛选。随机模式只同步起点控件时枚举题数为 0，顺序继续、自选起点、题量和跨库身份保持正确。
2. 考试答题卡按受影响答案局部更新，连续输入保留其余节点与焦点。测试空 → 已答 → 改写 → 清空、超时交卷、重复提交与保存失败重试。
3. 单个题库勾选更新本行与选择摘要，整列表重写 0 次。覆盖跨页、全选/反选、导出、删除和键盘焦点。
4. 整理 app 装配、全局刷新与恢复重入调用链。AI 六个固定按钮采用局部绑定辅助并逐项验证映射、直接处理器和可选节点。Web 七处内联事件与桌面生成事件分别核对。
5. 逐一审查 `bank-editor`、`bank-page`、`exam-page`、`practice-page`、`practice-selection`、`question-view`、`quiz-core`、`saved-questions-page`、`study-sessions`、`text-answers`、`training-review-page` 和 `training` 的正常入口、状态、计算与异步归属。按已确认问题调整，登记其余保留依据。

最小回归涵盖评分、训练特征、分页、题目视图、复盘与浏览器页面。执行公共门禁、Web 页面、AI 模拟服务及构建/隔离桌面，检查焦点、窄屏和恢复后重复绑定。

## 5. 第四批 · 解析、备份和平台生命周期

本批实施、验证和主协调审查已完成。空数组保全与既有兼容规则的严格回归见第 8 节。

1. 为文本解析候选生成、归一化、评分和诊断记录同输入的调用次数及完整输出。复用确有重复的计算，核对题目、答案、来源、候选排序、诊断及 Symbol/元数据。
2. DOCX、CSV/XLSX、PDF、OCR 与导入预览逐模块审查。用自建文档验证图片/公式、重复题号、双文件、取消、重选、失败释放和离线运行。
3. 空资产表的 JSON 备份跳过无用的替换遍历。缺图检测、旧 Android JSON/ZIP 往返和失败恢复继续使用相应断言。
4. WebDAV 开始状态一次同步，列表未变时保持节点。验证停止、恢复禁用、失败和重试。
5. 浏览器其余平台文件、桌面 Harness、账户 UI、桥接、标题栏和对话框全部登记。复用重复状态分类，保留就绪 Promise、generation、账户/配置修订、关闭保存、逐项凭据清理和原生参数检查。

最小回归涵盖 parser、format、document-lifecycle、import-lifecycle、ZIP、backup-core、browser-credentials、contracts、platform-index、harness、codebuddy、titlebar 等对应文件。执行公共门禁、页面、文档页面、AI/WebDAV mock、构建和隔离 WebView2。运行过哪些文档与离线场景写明实际范围。

## 6. 第五批 · 工程检查、资源与测试交付

五批实施、对应回归和主协调审查均已完成。逐路径入口、处置与资源证据见[全项目 JavaScript 逐文件处置清单](2026-11-11-project-javascript-inventory.md)。

1. 比较全量 lint 与两个子入口的实际文件和有效配置，消除重复扫描。保留单项入口、未跟踪文件、扩展名大小写、索引/链接类型、规则 fixture、失败码和 CI 回退。
2. 生成器复用业务资源清单。独立从实际 Web/桌面 HTML 验证存在、先后依赖、字节一致、mtime、离线资源、许可与路径/junction 边界。
3. 对 smoke 的超时与迟到动作做故障注入。共享运行时中旧步骤未收敛时结束该阶段或先清理，正确保存原始失败并回收自有进程。
4. 审查全部 20 个 scripts、6 个配置、22 个 desktop/test 和 57 个 test 工具文件。覆盖测试桥接、fake 数据、fixture 边界、发布参数、制品选择、隔离清理和退出码。发布脚本用 mock/临时目录验收。
5. 核对第三方脚本、题库数据与七处内联事件的部署路径。逐文件覆盖清单全部给出结论，新增文件同步登记。
6. 串行执行联合门禁、全部适用页面/文档/AI/WebDAV 回归、正式/测试构建和隔离桌面验证。记录最终 Git 差异和剩余真实环境验收。

## 7. 命令与交付标准

各批先运行最小相关用例。公共命令在 `apps/desktop` 执行 `npm test`、`npm run typecheck`、`npm run lint`。涉及页面运行 `npm run test:web-platform`，文档导入追加 `npm run test:documents`。根目录 WebDAV 为 `node --test test/web-webdav/request.test.cjs`，AI 为 `node test/web-ai-practice/runner.cjs`，按其 README 使用本机浏览器和既有 Playwright。

共享资源与桌面行为按顺序运行 `npm run build`、`npm run build:test`、`npm run test:desktop`。基准预检修复后再使用 `npm run bench:desktop -- --fixtures`，新增大题库性能场景明确输入与计量口径。Rust 代码若确需改变，先读 Rust 指南并执行 fmt、Clippy、test 的对应检查。

每批交接写入下方。包含会话 ID、实际执行模型/推理/通道、起止 HEAD、修改路径、红绿回归、命令/结果、覆盖文件及处置、既有失败与环境问题、下一批注意点。协调审查检查代码差异与测试证据，修复可恢复失败后才交接。文档运行 lint:docs，并对新增计划和设计额外检查 UTF-8、围栏、本地链接和差异。

## 8. 批次交接记录

五批实施、验证和主协调审查均已完成，成果保留为当前任务分支的未提交差异。

### 第一批 · 数据正确性和开始条件

- 协调会话：`01a1c8fe-0637-7c72-80a5-a25998e7bc71`；第一批独立会话：`01a1c920-1e83-7a11-9173-971d19a6b155`；实施代理：`/root/batch1_implementation`，实际模型 `gpt-6.1-terra`、推理 `max`、`priority`（Fast）通道。工作树和分支见第 1 节，起止 HEAD 均为 `49a2007844bf09805c4ab744fee019a1bd3a092f`；成果保留为未提交差异。
- 代码：`apps/web/ai-import-sessions.js` 固定整份草稿、原文和活动范围，失效即撤销请求所有权并显示准确状态，迟到成功、失败、兜底和回滚不得覆盖新内容；本地解析失败恢复原草稿和临时诊断。批量固定初始题目身份、指纹和载荷，在每批及兼容重试前检查全部尚未处理的目标；已有建议显示、采纳和编辑都重新校验归属。题目编辑后复原仍使本轮目标失效，取消重启不继承旧状态。
- `apps/web/app.js` 为无 ID 的题目对象分配仅本页使用的弱引用身份；相同对象移动可继续，重复 ID、同一无 ID 对象重复出现或对象被替换时不猜测身份。`question-editor.js` 连接编辑/删除失效，并修复删除前先过滤选中索引、再移动后续索引；`ai-import-panel.js` 区分全文和选区，全文任务仅移动光标不失效，选区变化及复原仍失效；两个开始按钮共用忙碌判断，UI 与请求共享 1～30 整数校验。`ai-results.js` 不将未知返回 ID 降级到其他题；`ai-transport.js` 在 400/422 格式兼容重试前再次检查任务有效性。`platform/browser.js` 分离读取、JSON/结构/版本验证和写入异常，保留外部变更冲突的短路优先级。
- 测试改动：`test/dual-platform/ai-import-retry.test.cjs`、`ai-harness.test.cjs`、`ai-results.test.cjs`、`browser-storage.test.cjs`、`browser-page.cjs`、`json-import.test.cjs`。整理回归比较题目、选择、警告、报告、诊断、筛选、表格与来源，包含摘要上限之外的原位修改、完整原文和选区坐标、不同位置相同选中文本及 ABA；覆盖首请求成功/失败、兜底前及兜底挂起、原草稿未变而本地解析器先写诊断后返回空或抛错、取消重启和两轮请求实际收敛。批量覆盖 B/D 删 A、同题面不同 ID、无 ID 移动/替换、重复 ID、重排、第三批目标提前变化、400/422 不再重试、编辑复原及建议人工采纳。真实 DOMException 的读取与写入分别覆盖 code 18/22，另覆盖损坏 JSON、结构、未来版本和外部冲突。
- 红绿：新增回归先暴露整理迟到覆盖（25 个阶段/修改组合）、固定目标/删除及重复身份、无 ID 与第三批失效、非法批量（双模式 14 个输入）、选区 ABA、列表和编辑弹窗删除选中索引、400/422 迟到兼容重试、目标编辑后复原；实现后均转绿。存储最初 3 类错误表现为坏 JSON 错映射或真实 DOMException 未转为业务错误，修复后 `browser-storage.test.cjs` 11/11。开发期部分红灯分组未独立保存完整命令日志，具体失败与回归断言保留在上述测试文件；以下绿灯均保留可复现命令、退出结果及报告。

#### 依赖和验证

- 安装前用 Windows 进程的可执行路径及命令行核查本工作树 Node/Vite/esbuild 等占用：无属于该工作树的进程，无需停止；沙箱内 CIM 读取被拒后经授权提升读取成功。`apps/desktop` 中执行 `$env:HUSKY='0'; npm ci` 退出 0，安装 240 个包；HUSKY=0 避免改写共享 Git hook 配置。npm 11 提示 `esbuild@0.28.2` 的 postinstall 未被 allowScripts 覆盖；本工作树 `npm ls --depth=0` 退出 0、`.\node_modules\.bin\esbuild.cmd --version` 为 0.28.2，随后资源准备、项目命令及构建成功，相关 hook fixture 亦通过。未借用其他工作树的 node_modules，lock 未变。
- 仓库根目录最小回归：`node --test test/dual-platform/ai-import-retry.test.cjs test/dual-platform/ai-harness.test.cjs test/dual-platform/ai-results.test.cjs test/dual-platform/browser-storage.test.cjs test/dual-platform/json-import.test.cjs test/dual-platform/import-lifecycle.test.cjs`，退出 0，216/216（`apps/desktop/.reports/batch1-focused-final.log`）。真实下载补充断言通过 `node --test --test-name-pattern='延迟初始化不允许编辑' test/dual-platform/browser-page.cjs`，1/1：下载文件内容与可读取的损坏原文一致，存储原值未改。存储权限被拒时原文无法读取，也无法声称可导出；权限恢复前只保证失败禁写与保留可重试状态。
- `apps/desktop`：`npm test` 退出 0，桌面 196/196、共享 431/431；`npm run typecheck` 退出 0；`npm run lint` 退出 0，规则 fixture 41/41、150 个手写 JS 完整文件；`npm run test:web-platform` 退出 0，148/148。报告分别为 `.reports/batch1-npm-test-aba.log`、`.reports/batch1-lint-aba.log`、`.reports/batch1-web-platform-aba.log`。完整门禁运行后仅增加上述真实下载断言、补一个说明 ABA 的注释并规范三个测试文件行尾，未改变业务行为；真实下载单例及 `npm run lint:incremental`（全 150 文件）在其后通过。
- 仓库根目录以本机 Edge 和框架自带 Playwright、隔离 context 与 mock 运行：`$env:NODE_PATH='C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'; node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'`，最终退出 0、52/52（`apps/desktop/.reports/batch1-web-ai-aba.log`），未调用真实 API。一次较早完整运行 51/52，`practice-review-ai-unsubmitted-total` 报告超时且计时异常为 11,877,979 ms，原因未确定；`--filter practice-review-ai-unsubmitted-total` 单独重跑 1/1、2,826 ms，再两次完整运行均 52/52，相关日志为 `batch1-web-ai.log`、`batch1-web-ai-retry.log`、`batch1-web-ai-final.log` 和 `batch1-web-ai-aba.log`。另一次中途发现 fixture 注入缺失的共享测试失败后已修复，最终完整测试见上。
- `apps/desktop` 串行构建：`npm run build` 冷构建退出 0、约 6 分 13 秒，最终注释/行尾变更后增量构建退出 0、约 1 分 06 秒；`npm run build:test` 退出 0、约 5 分 45 秒。正式 EXE 的 SHA-256 为 `60221EF2F9E32362BCC3F7E19A2AA9638985C9AEB09B3E39090F6A2794CA99BB`，native-test EXE 为 `BF793B81B126CD155128791A381DA386C057E03CC842D762AE56B88A37AF5B73`；日志为 `.reports/batch1-build.log`、`batch1-build-final.log`、`batch1-build-test.log`。
- `npm run test:desktop` 退出 0，项目既有隔离 WebView2 smoke 44/44（`.reports/batch1-desktop-smoke.log`），包括原生 AI/WebDAV mock、凭据隔离、SQLite/IPC/恢复、离线 MathJax/PDF Worker/OCR、自建中文扫描 PDF/DOCX/XLSX 导入与重载；此 smoke 不等于第一批新交互逐项验收。
- 第一批独立 WebView2 验收在 `apps/desktop` 运行 `node .reports/batch1-webview-check.mjs`，退出 0，14/14、页面错误 0、外网请求 0（`.reports/batch1-webview-check-final.log`）。脚本和日志位于 Git 忽略的 `.reports`，供本工作树复现，未加入提交清单；使用临时 native-test profile、假凭据、假 AI 传输、本地拒绝代理和出站拦截，仅清理自己启动的进程及经校验的测试目录。真实页面依次覆盖 31 题预计和实际 30+1 两批、删 A 后 B/D 请求及采纳/编辑归属、选区 ABA、重新识别/表格替换/题目编辑后的迟到结果、目标删除/修改/修改后复原停止及保留建议、双模式 200/201 边界。就绪失败、重试/检查及双任务同时忙碌使用仅隔离页面启动时的包装和状态模拟，已断言原有 bind/create 实际调用、资源与当前生成文件一致、页面无错误；模拟测试不能证明真实订阅服务故障。
- 文档检查：`apps/desktop` 执行 `npm run lint:docs`，退出 0，22 份文档的 UTF-8、围栏与本地链接通过；另在仓库根目录运行 `node apps/desktop/.reports/batch1-check-docs.cjs`，对三份规划文档和 `docs/README.md` 执行同等检查并检查冲突标记及异常行尾，`git diff --check` 通过。补充检查首次将 README 两处既有 Markdown 双空格换行误判为空白问题，已核对 HEAD 并保留，修正检查后通过。
- 专项初次运行通过前 11 项后因测试钩子缺失退出 1，诊断确认该次 Tauri 资源未命中 CDP 路由；未改磁盘生产资源，改为隔离页面启动前包装并先独立探针验证原有 bind/create 各调用一次，再完整通过。相关日志 `batch1-webview-check.log`、`batch1-webview-probe.log`、`batch1-webview-probe-wrapped.log`。系统为 Windows 10 19045、WebView2/Edge 157；未验收真实收费 AI、真实账户、真实用户数据、干净系统安装升级和所有生产网络故障。

#### AI 模块逐文件处置

| 文件 | 本批结论 |
| --- | --- |
| `apps/web/ai-import-sessions.js` | 修改：草稿所有权、完整快照、固定批量目标及失效后的结果保全。 |
| `apps/web/ai-import-panel.js` | 修改：两任务忙碌、批量校验、来源与选区事件和建议归属。 |
| `apps/web/ai-results.js` | 修改：拒绝未知 ID 静默落到旧索引。 |
| `apps/web/ai-transport.js` | 修改：兼容重试前检查当前任务及目标。 |
| `apps/web/ai-prompts.js` | 审查并保留：现有请求内容、题目载荷及主动发起语义仍适用。 |
| `apps/web/ai-question-panels.js` | 审查并保留：单题/复盘入口、可用性和人工确认不依赖本批导入状态。 |
| `apps/web/ai-question-sessions.js` | 审查并保留：已有请求所有者、取消和草稿/题目指纹边界。 |
| `apps/web/ai-settings.js` | 审查并保留：配置、就绪能力与凭据边界延续现有实现。 |

`apps/web/import-preview.js` 已审查并保留其快照契约。后续批次复用同一工作树，先进行协调审查；第二批涉及保存/预览性能及面板刷新次数时，先计数再优化：当前守卫会序列化完整草稿并多次定位目标，题目身份、指纹、ABA 失效、建议采纳及取消/重启均为行为不变量，不得退回截断摘要或按旧索引取题。日志和隔离专项脚本是本地忽略文件；其他工作树的用户成果、既有 `docs/README.md` 与三份规划文档的已有内容均予保留，本计划按要求追加了交接；未提交、推送或合并。

### 第二批 · 保存与预览性能

- 协调会话 `01a1c8fe-0637-7c72-80a5-a25998e7bc71`；第二批独立会话 `01a1ca21-dd87-75e1-a4a1-245a81a2b857`；实施代理 `/root/batch2_implementation`，模型 `gpt-6.1-terra`、推理 `max`、`priority`（Fast）。工作树和分支见第 1 节，起止 HEAD 均为 `49a2007844bf09805c4ab744fee019a1bd3a092f`；第一批和本批成果均保留为未提交差异，未提交、推送或合并。
- 首次并行读取规则时，一条只读 `Get-Content` 在主工作树目录读取了主工作树的 `AGENTS.md`，不符合本批统一使用目标 worktree 作为工作目录的约定。随后已完整读取实际 `724b` 工作树根规则、JS 指南、协作规划、两份外部规则和两份设计；本批没有向主工作树写入。后续命令均显式指定目标工作树或其 `apps/desktop`，测试产生的数据使用各自隔离临时 profile。
- `benchmark.mjs` 删除已无消费者的旧存储键正则和传参，保留真实 `local_read`、持久化题数及练习断言、临时 profile、样本信息与 `appSource` 的 SHA-256。新增 `benchmark.test.mjs` 先复现旧正则使样本模式无法启动，再验证隔离启动及来源摘要；修复后真实 `--fixtures` 完整运行。
- `adapter.js` 的 `indexSnapshot` 在本次提交内索引旧题库、各库题目与记录；`changes` 用本轮新身份集合检测删除并复用顺序，回执后用同一旧身份索引更新已加载集合。基线引用在等待回执期间被替换时重建索引；重复题库 ID 的回执判断沿用旧的首次匹配。变更命令、顺序、跨库题目身份、未读取正文保护和回执/重试语义保持原有契约。
- `question-editor.js` 的 `renderImportPreview` 同轮共享表格与报告的诊断，下一轮编辑后重新计算。`ai-import-panel.js` 的范围收集只在异常/正常/异常优先等确需状态的分支诊断；范围选项仅在模式或节点变化时重建，同模式普通刷新不写选项。`app.js`、面板和 `ai-import-sessions.js` 合并初始化、Harness、全局渲染与取消/结束的重复同步；最后一批渲染由结束同步统一刷新，中间批次仍即时显示，编辑器公开渲染入口默认仍独立同步。隐藏面板中的原文变化、取消/结束以及选区变空均可纠正失效 selection 为全文，不重绘隐藏面板；普通刷新保留 sticky 提示，主动改条件仍清除。无效范围值回退自定义范围。

#### 红绿与性能口径

| 相同输入的操作计数 | 修改前 | 修改后与行为校验 |
| --- | --- | --- |
| 单库单个收藏变更：100 / 200 / 500 / 1,000 题 | 题目成员比较 10,100 / 40,200 / 250,500 / 1,001,000 次 | 比较均为 0；带 getter 的身份读取分别 900 / 1,800 / 4,500 / 9,000 次。真实 JS 适配器配模拟 IPC，仅发送相同的一个 `put_header`；计数不是原生耗时。 |
| 普通预览 500 题：首次 / 勾选 / 编辑后刷新 | 各 1,000 次诊断 | 各 500 次；异常优先顺序、选中数、报告统计和编辑后最新诊断一致。 |
| AI 目标选择 500 题 | range / selected / all 各 500；visible 各 1,000 | range / selected / all 和 visible+all 均为 0；visible 的 problem / normal / priority 各 500，review problem 为 500。两模式共 108 组独立比较基础/最终索引与顺序，并覆盖范围错误、空解析及去空白后 19/20 字边界。 |
| 双面板可见的绑定 / Harness 通知 | 导入/预览分别 1/2、2/2 次 | 均为 1/1；同模式两次普通刷新范围选项写入 2→0。取消、失败、成功结束均为每个可见面板一次；真实浏览器和 WebView2 另验证末批完成 1/1、首批建议即时显示及按钮解锁。 |

- `batch2-adapter-red.log` 保存原始计数红灯，`batch2-adapter-behavior-before.log` 保存改前有序载荷/回执基线，`batch2-adapter-final.log` 为 27/27。覆盖题库与题目增删排序、记录增删排序、新题/新记录在回执后再编辑、跨库同 ID、惰性正文拒写、失败后重试及丢回执查询。可控延迟下等待回执期间重新读取替换基线：原实现和最终实现均通过；仅在隔离副本中关闭索引重建后测试红灯，见 `batch2-adapter-baseline-race-{before,after,negative}.log`。
- 普通预览及 AI 范围的红绿分别见 `batch2-preview-{red,green}.log`、`batch2-ai-target-{red,green}.log`。初始化、通知及会话重复刷新见 `batch2-panel-refresh-red.log`、`batch2-session-refresh-red.log`、`batch2-panel-refresh-green.log`；真实成功路径的 1/2→1/1 见 `batch2-success-refresh-{red,green}.log`。协调审查补出的隐藏面板选区变空先红后绿，见 `batch2-hidden-selection-{red,green}.log`；无效范围回退见 `batch2-invalid-scope-{red,green}.log`。
- 环境为 Windows 10 19045、Node 24.22.2 x64、Edge/WebView2 157.0.4341.42。修复后在 `apps/desktop` 分别执行 `npm run bench:desktop -- src-tauri/target/native-test/release/shiroha-quiz-desktop.exe .reports/batch2-benchmark-before.json --fixtures` 和同一命令将报告改为 `.reports/batch2-benchmark-after.json`，改前和改后各运行 3 种固定样本 × 5 次；样本 SHA-256、协议一致，每次新建 profile，所有 30 次原生 `local_read` 题数分别为 1、7、2。改后 15 次耗时 220.1 秒；原始数据、各次耗时和哈希见 `.reports/batch2-benchmark-{before,after,comparison}.json`。每行是五次中位数，单位毫秒：

| 样本 | 解析前→后 | 导入提交前→后 | 手动保存前→后 |
| --- | --- | --- | --- |
| 1 题 JSON | 316→286 | 231→212 | 149→153 |
| 7 题含图 JSON | 311→297 | 201→211 | 163→154 |
| 2 题材料文本 | 305→309 | 231→187 | 152→153 |

前后是在同机、相同 fixture 和各次全新 profile 下的两份不同构建；系统、WebView2 与文件缓存没有清空。小样本耗时有增有减，不能据此声称整体加速，也不能替代大题库用户等待时间的统计。500 / 1,000 题操作计数与下述真实原生读回分别记录，未把模拟 IPC 计数当作实测耗时。

#### 最终检查与桌面验收

- `apps/desktop` 中 `npm test` 退出 0：桌面 204/204、共享 448/448，总耗时约 166.5 秒；`npm run typecheck`、`npm run lint` 退出 0，lint 的规则 fixture 41/41、152 份手写 JS。测试文件随后仅统一 CRLF 行尾，语义未变；其后再次运行 typecheck、完整 lint 和关键回归 130/130（`.reports/batch2-focused-crlf.log`）。`git diff --check` 通过。
- `npm run test:web-platform` 150/150（约 189.5 秒），包含 Web 和 file 入口、两类 AI 任务及本批真实输入/成功结束；`npm run test:documents` 1/1（约 12.3 秒），实际覆盖离线中文扫描 PDF/OCR、DOCX、XLSX、CSV、取消与人工核对模拟。仓库根目录将 `NODE_PATH` 设为 `C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`，用项目 mock 执行 `node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'` 52/52（约 96.1 秒），无真实收费 API 调用。日志依次为 `batch2-npm-test-final.log`、`batch2-typecheck-crlf.log`、`batch2-lint-crlf.log`、`batch2-web-platform.log`、`batch2-documents.log`、`batch2-web-ai.log`。
- `npm run build` 退出 0、约 105.7 秒，正式 EXE SHA-256 为 `6B89283DED69B1BF9BB9208656DD58C0825FC47878CB71A353DEB9232D82CDCA`；`npm run build:test` 退出 0、约 68.6 秒，native-test EXE 为 `ABE363D900B5CB4676DC542097B3ECDD8873317ED8EF2E843721BAA9B233F2DD`。日志 `batch2-build.log`、`batch2-build-test.log`。
- `npm run test:desktop` 在临时隔离 profile 中 44/44（约 156.7 秒），包含本地资源、SQLite/IPC、恢复、原生 AI/WebDAV mock、假凭据和自建文档。为不覆盖第一批的通用截图，本轮设置 `NODE_OPTIONS=--import=file:///C:/Users/30728/.codex/worktrees/724b/shiroha-quiz-desktop/apps/desktop/.reports/batch2-smoke-paths.mjs`，将该工作树 `.reports` 直接子级 PNG 写入 `batch2-` 前缀；未改变页面、产品资源或 smoke 断言。原 38 张 PNG 名称与 SHA-256 前后完全一致，本轮 38 张 PNG 均通过签名、分块 CRC、解压、尺寸和扫描行检查。`batch2-desktop-smoke.log` 中 smoke 自报的原截图路径对应实际同目录的 `batch2-` 前缀路径；验证记录 `batch2-png-validation.log`、`batch2-png-check.json`。
- `node .reports/batch2-webview-check.mjs` 的隔离专项最终 19/19、约 62.7 秒，页面错误 0、拦截外网请求 0。先在无包装的 native-test 制品中确认 `harness.js`、`app.js`、`adapter.js`、`ai-import-panel.js`、`ai-import-sessions.js`、`question-editor.js` 的嵌入资源、生成资源与本次源码一致；再在隔离启动时包装工厂计数与 Harness 通知，保留第一批草稿、固定目标、ABA、人工采纳和 200/201 边界，新增 500 题真实页面诊断和范围计数、选项/通知同步、隐藏选区、两批即时建议及两种成功结束，并在 500 和 1,000 题自建库中分别确认大题量练习、收藏一题及原生 `local_read` 的题数和收藏。就绪失败、重试及两任务同时忙碌使用隔离包装模拟，不能证明真实订阅服务故障。日志为 `batch2-webview-probe.log`、`batch2-webview-check-retry.log`。
- 文档检查：`apps/desktop` 的 `npm run lint:docs` 通过 22 份文档；仓库根目录 `node apps/desktop/.reports/batch2-check-docs.cjs` 对本计划、两份设计和 `docs/README.md` 补充 UTF-8、围栏、本地链接、冲突标记及异常行尾检查，`git diff --check` 通过。日志 `batch2-docs-lint.log`、`batch2-docs-extra.log`。
- 可恢复过程：首次完整 lint 报本批 10 处风格/浏览器全局问题，首次 typecheck 报新增测试类型标注问题，均已修复重跑通过；一次字符串替换误将 `$$` 变成 `$`，定向回归立即发现并修复。浏览器 `fill()` 同时触发独立 select 与 input 事件，最初将两个事件合计为两次；改为明确派发单次 input 后验证该事件内一次刷新。桌面专项初次等待 `#p-favorite` 超时，隔离 `batch2-large-probe.log` 确认 500 题已保存且等待既有大题量确认框；专项补充接受确认后完整重跑通过，原失败日志 `batch2-webview-check.log` 保留。上述均非未解决的门禁失败。

#### 本批文件处置与下一批注意点

| 文件 | 结论与依据 |
| --- | --- |
| `apps/desktop/scripts/benchmark.mjs`、`apps/desktop/test/benchmark.test.mjs` | 修改 / 新增：移除过时预检，保留真实读回、题数和摘要；红绿及 15+15 次样本验证。 |
| `apps/desktop/frontend/adapter.js`、`apps/desktop/test/native-adapter.test.mjs` | 修改：单次保存身份索引及有序 IPC、惰性正文、回执和并发基线回归；27/27。 |
| `apps/web/question-editor.js` | 修改：同轮复用诊断，保留直接调用默认同步和中间批次渲染；500 题计数与报告/排序回归。 |
| `apps/web/ai-import-panel.js` | 修改：按范围诊断、节点/模式维护选项、隐藏选区纠正及单次同步；108 组矩阵和页面/桌面验证。 |
| `apps/web/ai-import-sessions.js`、`apps/web/app.js` | 修改：取消/结束、输入及 `renderAll` 同步收敛；保留第一批草稿快照、固定身份/指纹、`invalidatedIds`、无 ID 弱引用身份、两种 scope 和整数批量校验。 |
| `test/dual-platform/preview-performance.test.cjs`、`test/dual-platform/ai-import-retry.test.cjs`、`test/dual-platform/browser-page.cjs` | 新增 / 扩展：真实模块计数、会话结束、真实页面输入、两批即时建议与按钮恢复；详见上述日志。 |
| `apps/desktop/frontend/harness.js`、`apps/web/import-preview.js`、`apps/web/text-parser.js` | 已审查，保留：沿用 Harness 回调及练习/复盘刷新、草稿快照契约和诊断规则；通过现有 Harness/会话、预览与桌面专项验证。 |
| `docs/superpowers/plans/2026-11-11-project-javascript-optimization.md` | 更新本批状态和交接；其他既有第一批差异与规划文档保留。 |

下一批继续使用当前未提交工作树，先由协调会话审查本批；不要提前开始第三批或重置第一批安全守卫。`syncAiImportActionV99` 已负责两面板，`syncAiPreviewToolsV991` 和编辑器渲染仍可单独调用；调整 `renderAll` 或页面事件时避免恢复重复刷新。AI 会话最后一批的 `syncPreviewTools: false` 依赖 finally 同步，不能影响中间批次即时展示、取消及 sticky 提示。样本基准、桌面报告和隔离专项脚本在 `.reports` 中被 Git 忽略；未验收真实收费 AI/订阅故障、真实用户数据、干净系统安装升级及全部生产网络故障。
### 第三批 · 题库、作答和页面事件

- 协调会话 `01a1c8fe-0637-7c72-80a5-a25998e7bc71`；第三批独立会话 `01a1ca57-0fbc-7661-9428-5b1d78b109fa`；实施代理 `/root/batch3_implementation`，模型 `gpt-6.1-terra`、推理 `max`、`priority`（Fast）。唯一工作树与分支见第 1 节；起止 HEAD 均为 `49a2007844bf09805c4ab744fee019a1bd3a092f`，第一、二批及本批成果均保持未提交。未提交、推送或合并，未操作其他工作树。
- 本批新增 `test/dual-platform/practice-selection-performance.test.cjs`、`test/dual-platform/ai-fixed-bindings.test.cjs`、`test/dual-platform/desktop-inline-events.test.cjs`，并扩展 `test/dual-platform/browser-page.cjs`。使用独立依赖、临时数据和假凭据；没有运行 `npm ci`，没有调用真实收费服务或操作真实用户数据。前两批完整草稿、目标身份与指纹、弱身份、ABA、整数批量、适配器写入回退及 AI 面板同步约束保留。

**性能和事件**

- `apps/web/practice-selection.js:64` 将练习和考试的基础筛选统一到 `practiceBaseItemsV58916`；`:132` 随机模式仅同步起点控件时跳过题目枚举。两库各 250 题样本由 500 次降为 0 次；顺序模式仍枚举 500 次并继续到第二库第 1 题。定向 2/2 覆盖错题/收藏/题型、顺序继续、自选起点、随机顺序、题量和跨库同 ID；原实现的随机断言先红后绿。
- `apps/web/exam-page.js:140`、`:193`、`:210` 在完整绘卷时建立属于当前会话和答题卡 DOM 的索引与已答计数，退出或结果页失效，重绘重新建立；答案始终以会话答案为准，交卷仍从答案计算。单题事件捕获原会话、题目及仍连接的节点，并守住提交/事务忙碌；回滚不会自动恢复外部 Map，但交卷期间不写此缓存，失败后原缓存与回滚答案一致，重绘可重建。40 题真实页面的单次选项操作原为身份查找 80、答案判断 80、答题卡整写 1；修改后连续四次空 → 已答 → 改写 → 清空各为身份查找 0、答案判断 2、答题卡整写 0，其他节点和焦点保留。另测同卷重绘旧节点、新会话旧事件、超时自动交卷、保存失败后继续编辑并重试及重复提交。
- `apps/web/bank-page.js:75` 单项选择仅更新原行和汇总，不替换列表；守住就绪、事务忙碌、节点仍属于当前列表及题库仍有效。浏览器与桌面均验证整列表写入 0、键盘焦点、跨页、全选/反选、旧节点和忙碌事件；真实下载 JSON 核对选中库载荷，实际取消及确认删除核对未选库保全。
- `apps/web/app.js:535`、`:1773`、`:1978`、`:2011`、`:2195` 在有启动/覆盖恢复实际调用证据处去重，题库选择器每次由 2 次渲染降为 1 次。先过滤无效导出选择再决定默认全选，覆盖旧、新题库 ID 完全不重叠的备份恢复。保留原有就绪、事务和导航路径。
- `apps/web/ai-import-panel.js:47` 的六个固定按钮局部 `bindClick` 直接设置原 `onclick`，保留真实单数 Diagnostic 处理器。新增测试逐一断言处理器身份、选择器、事件参数、`this`、返回值、缺失可选节点和重复绑定后每次点击一次动作；原有双面板同步及 108 组合仍通过。
- Web 入口实际 7 处内联事件为五个导航、图片出错与折叠；浏览器测试验证全部入口、键盘和图片失败。桌面 `prepare-web` 先移除包含图片的侧栏 brand，随后外置剩余 6 个 click；`desktop-inline-events.test.cjs` 对真实 Web HTML 运行 `optimizeDesktopHtml`、`externalizeEvents`，核对六个映射、无内联事件及生成脚本的导航/折叠行为，实际 WebView2 再核对制品。既有 `prepare-web.test.mjs` 的合成 error fixture 仅验证生成器能力，不代表生产桌面图片入口。

**十二个范围模块逐项审查**

| 路径与入口 | 处置与正常入口/回归证据 |
| --- | --- |
| `apps/web/bank-editor.js:71`，题库行编辑 | 修改：记录请求代次、原库和原按钮归属，离页/返回、切库、忙碌及旧节点不可续写；当前有效按钮目标不存在仍提示。`第三批入口迟到`、`第三批入口失败`、`第三批题库编辑` 及已有编辑/删除测试通过。 |
| `apps/web/bank-page.js:75`、`:165`，题库选择和分页预览 | 修改：局部选择、页面读取归属及错误提示；`第三批题库` 两项实际选择/导出/删除、`第三批分页失败`、原分页迟到/重试与窄屏测试通过。 |
| `apps/web/exam-page.js:64`、`:140`、`:210`，考试开始、作答、交卷 | 修改：开始请求归属及局部答题卡；`第三批考试` 两项、`第三批入口迟到/失败`、原超时交卷与重复提交测试通过。 |
| `apps/web/practice-page.js:309`、`:442`、`:574`、`:731`，练习开始、切题和答题 | 修改：开始归属和已脱离节点的输入/清空守卫；`第三批练习` 四项、`第三批入口迟到/失败`、原总提交、单题、焦点与计时测试通过。 |
| `apps/web/practice-selection.js:64`、`:83`、`:132`，练习/考试筛选与起点 | 修改：复用基础筛选并跳过随机起点无用枚举；`practice-selection-performance.test.cjs` 2/2，原自选起点、题量、跨库练习及考试测试通过。 |
| `apps/web/question-view.js:356`、`:372`、`:400`，题目显示和选项控制 | 保留：共用渲染/选项 API 符合调用边界，本批由调用方校验事件归属；原各题型选项清空、键盘焦点、富内容与新增练习/考试旧节点测试通过。 |
| `apps/web/quiz-core.js:4`、`:127`，分页与答案判断 | 保留：分页和评分为独立计算，未发现重复或归属问题；原列表分页、全题型、多空、总提交和考试评分回归通过。 |
| `apps/web/saved-questions-page.js:20`、`:36`、`:98`、`:139`，收藏/错题页与单题练习 | 修改：读取、错误反馈及快捷练习绑定原库、原按钮、实际活动页和请求代次；覆盖离页返回、直接切页、切库事务、新请求先返回、当前失败重试及跨库同 ID。`第三批收藏`、`第三批收藏错题失败` 和原收藏详情测试通过。 |
| `apps/web/study-sessions.js:10`、`:41`，练习与考试会话生命周期 | 修改：复用各自请求代次取消挂起开始，不重置已开始会话及其时钟；`第三批入口迟到`、原旧计时器、暂停与恢复焦点测试通过。 |
| `apps/web/text-answers.js:4`、`:94`，编号答案解析与匹配 | 保留：既有纯计算接口未发现本批问题；原文本解析、重复编号/答案匹配和多空回归随 `npm test` 通过。 |
| `apps/web/training-review-page.js:118`、`:207`、`:284`，记录详情、打开复盘和复盘正文 | 修改：读取成功/失败均检查请求及页面归属；记录 `<details>` 同时检查原展开节点，关闭一项后其他仍展开项继续补读。`第三批记录列表明细`、`第三批记录详情失败`、`第三批复盘详情失败`、跨库同 ID 重练/返回焦点及原迟到正文测试通过。 |
| `apps/web/training.js:7`、`:58`、`:80`、`:100`，题号范围、时钟与复盘快照 | 保留：现有计算/快照接口符合入口要求；原自选范围、暂停/恢复、跨库复盘与重练测试通过。 |

异步失败由 `apps/web/app.js:75` 的既有 `readNative` 追加可选归属谓词，仅各相关调用方传入；当前失败仍提示并可重试，离页或离页再返回的旧失败不会覆盖当前状态。普通导航、`switchViewV45` 和错题/收藏快捷入口统一取消相关待处理请求；Web 隐藏页正常预渲染路径保留。

**红绿与最终门禁**

- 先复现再修复：`batch3-page-red.log` 暴露考试整写与题库整写，`batch3-page-green3.log` 5/5；`batch3-init-red*.log` 暴露启动/恢复重复渲染与选择不同步，最终 Web 全量覆盖通过；收藏离页/切库 0/3、失败提示 1/2、直接切页 ABA 0/1 分别转绿（`batch3-favorite-*-red/green.log`）；练习旧节点与练习/考试/编辑入口 0/10 转为 12/12（`batch3-practice-entry-red/green.log`）；分页/复盘失败 3/7 转为 9/9，收藏/错题失败 2/4 转为 13/13，记录列表明细 2/5 转绿并补多展开及空态（`batch3-read-failure-*`、`batch3-saved-read-*`、`batch3-record-list-*`）。
- 两个测试初稿错误也保留记录：`batch3-entry-review.log` 在 1280 宽度要求响应式折叠按钮可见，改为 1600 后 2/2；`batch3-bank-export-delete.log` 把初始化前原 fixture 当作未选库基线，应用会规范化题目字段，改为在操作前读取实际已初始化状态后 1/1。均未修改产品行为或放宽实际断言。
- 冻结产品与测试代码后，在 `apps/desktop` 串行运行：`npm test` 204/204 桌面及 452/452 共享（120.64 秒）；`npm run typecheck` 通过（1.49 秒）；`npm run lint` 通过（17.99 秒，41/41 规则 fixture，155 个 JS 文件）；`npm run test:web-platform` 201/201（225.39 秒）。根目录用现有 Playwright 与 Edge 运行 `node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'`，模拟服务 52/52（约 89.2 秒）。对应 `.reports/batch3-{npm-test,typecheck,lint,web-platform,web-ai}-frozen.log`；冻结测试后仅将测试文件既有/新增交界的一处孤立 LF 规范成 CRLF，无语义改动。
- `npm run build` 105.67 秒及 `npm run build:test` 83.16 秒均通过；正式 EXE SHA-256 `32F4CFF924E270CD7488EC83AEFBDECC849F07C108CCF117F6BD72FB9F49DE9C`，native-test EXE SHA-256 `6F9190A7351D65BE87107117B6AF6383319A6E76C5DEECA5C349B7352F53DBFC`；日志为 `batch3-build.log` 和 `batch3-build-test.log`。
- 首轮 `npm run test:desktop` 42/44、213.0 秒：`CodeBuddy CLI 过期引导、重启复用与退出跨重启验证` 及其后 `恢复后页面重载仍须主动确认 Codex` 各等待 30 秒超时。第一项原报告仅保存超时文本，未记录具体阶段，无法判定其众多等待中哪一处超时；第二项源码中的等待是 `scripts/smoke.mjs:1293`，条件为 `mode === api` 且 `restoreRequired`，可能受第一项失败后的共享状态影响，不能断言独立根因。`batch3-desktop-smoke.log` 保留原结果；按可执行文件路径检查无遗留本工作树进程。隔离探针在未配置模型时复现 `codebuddy-cli-smoke.mjs:151` 等待 `mode === 'api'` 超时，状态为表单 API 模式、模型为空且提示填写模型；这与首轮全量已有假模型的前置条件不同，不能作为首轮根因。补齐相同假模型与本地 mock 地址后独立探针通过（`batch3-codebuddy-probe2.log`、`batch3-codebuddy-probe3.log`）。
- 不改产品、不放宽 smoke 断言或超时，注入只读等待诊断并以独立 `batch3-retry-` 截图前缀完整重跑，44/44、171.14 秒（`batch3-retry-desktop-smoke.log`），两处此前超时均通过；首轮根因仍未确定。原有 77 张 PNG 及首轮 38 张的名称与 SHA-256 未变；复测新增 38 张 PNG 的分块校验、解压和尺寸通过（`batch3-png-check.json`、`batch3-retry-png-check.json`）。
- `npm run lint:docs` 通过（22 份文档）；另外对新增计划、两份设计及 `docs/README.md` 校验 UTF-8、围栏、本地链接、尾随空白和冲突标记均通过；`git diff --check` 通过。
- 在隔离 native-test WebView2 运行 `batch3-webview-check.mjs` 7.03 秒通过，十份本批业务脚本的制品嵌入资源、生成文件及源码逐字一致；入口生成文件与 Web 源码经生成器转换及桌面壳插入逐字一致，制品响应与浏览器标准 DOM 序列化结果逐字一致，实际脚本顺序与六处事件映射一致。首次将 HTML 原文直接比较失败：首差异为 doctype 后换行，响应还将自闭合标签、换行序列规范化；记录在 `batch3-webview-check-resource-failure.log`，未无条件移除 HTML 验证。第二轮脚本在异步开考完成前捕获空节点，补充等待真实答题卡/题号节点后通过，日志 `batch3-webview-check-html-normalized.log` 保留。最终 `batch3-webview-check-final.log` 核对五处真实导航、折叠、自建三题正常导入及原生读回、题库焦点和零整写、真实练习/考试/原生记录；旧 DOM 事件与延迟读取 ABA 为受控模拟，均通过。监听安装后页面 JS 错误 0、外网请求 0；启动阶段已有拒绝代理保护。

下一批保持本工作树及前三批未提交差异，继续保留 AI 草稿全量快照、初始身份/指纹、`invalidatedIds`、无 ID 弱身份和 ABA 失效、整数批量；适配器索引按基线替换回退；诊断计数 500/0/500 与 108 组合；范围选项按 node + mode 更新。`syncAiImportActionV99` 已覆盖双面板，编辑器公开 `render()` 默认仍同步；AI 最后一批 `render({ syncPreviewTools: false })` 依赖 `finally` 统一同步，中间批次即时显示、隐藏面板纠正、取消与 sticky 提示均为已验收不变量。浏览器、模拟延迟与隔离桌面结果不替代干净系统安装/升级或真实 AI、WebDAV 服务验收；首轮桌面冒烟间歇超时留待第五批按计划进一步故障注入。日志、隔离专项脚本和截图为本地忽略文件，等待主协调审查后才进入第四批。

### 第四批 · 解析、备份和平台生命周期

- 协调会话 `01a1c8fe-0637-7c72-80a5-a25998e7bc71`；第四批会话 `01a1ca97-bc40-79b0-ad08-af4e2110e361`；实施代理 `/root/batch4_implementation`，模型 `gpt-6.1-terra`、推理 `max`、`priority`。唯一工作树与分支见第 1 节，起止 HEAD 均为 `49a2007844bf09805c4ab744fee019a1bd3a092f`。前三批和本批均保留未提交；未提交、推送、合并、创建 PR 或操作其他工作树。
- 启动时完整读取工作树根规范、JavaScript 指南、分支规划、两份绝对路径规则与适用设计；`origin` 为本仓库 SSH 地址，共享入口中其他仓库的专属规则不适用。使用任务工作树独立依赖、自建题库和假凭据，未安装依赖或使用真实用户数据、真实收费 API。
- 本批未改浏览器或原生网络权限、IPC 契约和 OCR 人工核对语义，未新增备份字段、格式或版本；既有空图片数组现会被保留。前三批 AI 草稿身份与指纹、适配器保存索引、预览诊断复用、页面迟到读取归属和错误重试保护继续保留。

**实现、红绿与计数**

- `apps/web/text-parser.js:1930` 只复用主候选已完成评价中的纯风险数量；空候选仍走原计数路径。候选生成、归一化、评分和诊断保持原调用顺序，特别是不复用会调用 `makeId` 的归一化。标准、重复题号、共用材料、粘连选项、分卷多空和 Word 图片各四种策略，加双文件，共 25 组相同输入：完整题目/答案/来源、全部候选及顺序、评分、报告、诊断、Symbol 与非枚举属性描述、ID 参数与生成顺序逐项相等；自动模式风险计数每组减少 1 次，标准/重复题号/共用材料/双文件由 14 降为 13，分卷多空和 Word 图片由 5 降为 4，其他策略计数不变。不据此推断整体耗时提升。采集脚本和完整前后记录为 `.reports/batch4-parser-capture.cjs`、`.reports/batch4-parser-before.json`、`.reports/batch4-parser-after.json`；性能断言先 0/4、后 4/4，现有解析快照及元数据测试通过。
- `apps/web/import-preview.js:14`、`apps/web/app.js:589` 和 `:1244` 等以独立单文件/题目/答案读取代次、共享预览代次与题库名代次保护迟到结果。TXT/DOCX/PDF 和 CSV/XLSX 同槽位重选、清空、手动编辑及复原、程序填入示例/OCR、双文件并行、跨入口命名、空文本误点识别与当前失败提示分别验证。双文件识别或清空只失效旧表格自动预览，不取消独立文本读取；表格的旧成功和旧失败均按共享预览归属检查。
- `question-editor.js:143`、`:168`、`:442`，`bank-editor.js:91`，`ai-import-panel.js:686` 和 `ai-import-sessions.js:425` 在实际选择、筛选、编辑、删除、进入二次编辑或采纳/生成 AI 草稿时失效旧表格自动回写；普通重新校验不失效。模块回归初次 0/7、跨入口 0/2；真实页面先分别复现编辑/删除、二次编辑、采纳建议和勾选被覆盖，修复后相应用例通过。开发期红灯原始输出未另存完整日志；最终用例和可复现命令保留。一次页面测试初稿因隐藏 OCR 框被 Playwright 等待 30 秒，以及一次关闭按钮被提示遮挡，分别改为设置模拟 OCR 结果和键盘关闭后通过，未改产品以绕过断言。
- `apps/web/app.js:2225`、`:2459` 两个本地导入/恢复入口仅在资产表非空时调用替换遍历，之后均独立调用缺图检测；空资产、缺图和含图六项先 2/6、后 6/6。新增恢复入口失败保全和重试测试用隔离 mock 直接再次调用同一 `onchange` 处理器：失败时模拟持久数据、文件选择和可再次操作状态保留，成功后才切换；不据此声称浏览器再次选择同一文件一定触发 change。旧 Android JSON/ZIP 含图与无图往返及错误回滚另由格式和页面回归验证；无图严格对象期望、历史兼容策略及红绿记录见下方。
- `apps/web/webdav-panel.js:80`、`:159` 把开始操作的忙碌和提示合为一次同步（实测 2→1）；列表内容不变保留节点，独立同步恢复按钮禁用，列表节点更换时重新绑定；latest、顺序、大小、etag 单独变化均触发相应更新。停止 mock 只表示已请求取消：若该 mock 随后成功，旧语义仍显示成功；若失败则显示失败并允许重试。桌面适配器另有 generation 和原生取消保护，不能把该模拟描述成真实服务的取消保证。

**逐文件审查**

| 路径 | 修改或保留与依据 |
| --- | --- |
| `apps/web/text-parser.js` | 修改主候选风险计数；25 组完整前后记录及 `text-parser.test.cjs`、`parser-risk-performance.test.cjs`。 |
| `apps/web/docx-import.js` | 保留：正文、图片关系、OMML 和外部内容块按原逻辑处理；`document-formats` 及离线自建 DOCX/altChunk 实测。 |
| `apps/web/table-import.js` | 保留：CSV 引号/跨行/重复表头及 XLSX 稀疏列、共享字符串解析不改；读取归属由预览调用方守住。 |
| `apps/web/pdf-import.js` | 保留：PDF.js 文字层及轻量回退，成功/失败释放加载任务；自建文字层 PDF 和资源释放回归。 |
| `apps/web/ocr-import.js` | 保留：Worker、页面画布和 PDF 的取消/失败释放与当前结果归属；离线中文扫描 PDF 实际识别、识别中取消并重试，识别内容仍经模拟人工核对。 |
| `apps/web/import-preview.js` | 修改三个读取槽位、共享预览和名称归属；DOCX/PDF/CSV/XLSX/TXT 重选、清空、迟到成功/失败、双文件独立并行及当前错误回归。 |
| `apps/web/question-editor.js` | 在第二批已有诊断复用基础上，实际编辑、删除或选择变化时失效旧表格；普通渲染/重新校验仍可接收当前读取。 |
| `apps/web/app.js` | 修改输入、示例、OCR、有效识别的读取失效接点、两个备份入口，以及跨端导出时原有空图片数组的保全；保留前三批导航、页面加载归属与 AI 草稿保护。 |
| `apps/web/bank-editor.js`、`ai-import-panel.js`、`ai-import-sessions.js` | 在前三批已有请求与草稿保护上，实际进入二次编辑、采纳建议或整理成功时保护共享预览；浏览器竞态及原有 AI mock 通过。 |
| `apps/web/backup-core.js`、`backup-archive.js`、`backup-data.js`、`zip.js` | 保留：格式和递归缺图检测未变；旧 Android JSON/ZIP、含图 ZIP、完整学习数据、凭据排除、ZIP 边界和失败保全回归。 |
| `apps/web/webdav-panel.js` | 修改一次开始同步、内容与节点归属缓存、恢复按钮禁用；页面 mock、失败/重试及实际原生受控请求另测。 |
| `apps/web/platform/browser-credentials.js` | 保留：绑定端点与账号、记住/会话切换及失败补偿；`browser-credentials.test.cjs`。 |
| `apps/web/platform/browser-network.js` | 保留：浏览器 Fetch、CORS/TLS 与中止/超时诊断；`test/web-webdav/request.test.cjs` 为假 Fetch，不代表真实证书或原生逐跳。 |
| `apps/web/platform/browser.js` | 保留第一批已修复的读取、JSON/结构/版本和写入错误分类及外部修订冲突；见第一批记录与 `browser-storage.test.cjs`。 |
| `apps/web/platform/dialogs.js` | 保留模态队列、键盘约束与焦点恢复；页面对话框回归。 |
| `apps/web/platform/index.js` | 保留平台选择和 storage 事件失效；`platform-index.test.cjs`、Web/file 页面。 |
| `apps/web/platform/save-queue.js` | 保留快照克隆、串行保存、失败阻断及显式恢复；存储/退出和页面写失败回归。 |
| `apps/web/platform/validation.js` | 保留操作 ID、修订、敏感字段及任务状态契约；`contracts.test.cjs`。 |
| `apps/desktop/frontend/adapter.js` | 保留第二批已修改的保存索引；本批复核受控 WebDAV 参数、取消 generation、凭据暂存与成功后逐项清理；`native-adapter`、`native-services` 和原生 mock。 |
| `apps/desktop/frontend/bridge.js` | 保留受控主窗口桥接和等待 `canClose`；构建、退出及真实桌面冒烟。 |
| `apps/desktop/frontend/codebuddy-login.js` | 保留账户修订、请求代次、取消/退出清理和页面释放；`codebuddy-login.test.mjs` 与桌面 mock。 |
| `apps/desktop/frontend/harness.js` | 保留就绪 Promise 的代次归属、账户/配置修订、恢复确认及停止未确认阻塞；`ai-harness.test.cjs` 与桌面 smoke。检查中/失败/恢复等判断的上下文和优先级不同，未找到安全可复用的实际重复分类，未强行抽取。第二批对本文件的预览同步审查见第 8 节第二批。 |
| `apps/desktop/frontend/titlebar.js` | 保留窗口操作互斥、缩放查询代次、失败反馈及键盘入口；`titlebar.test.mjs` 和 WebView2 冒烟。 |

**验证和证据**

- 根目录定向 `node --test` 覆盖 parser、format、document-formats/lifecycle、table/import-lifecycle、ZIP、backup-core/入口、browser-credentials、contracts、platform-index、AI Harness、CodeBuddy、titlebar、native-adapter/services：275/275、5.52 秒（`.reports/batch4-focused.log`）。随后补充双文件两槽位旧/当前失败，`node --test test/dual-platform/import-ownership.test.cjs test/dual-platform/import-lifecycle.test.cjs` 为 19/19、0.43 秒（`batch4-import-final.log`）。
- 在 `apps/desktop` 的 `npm test` 为桌面 204/204、共享 478/478，162.50 秒（`batch4-npm-test-final.log`）；此轮开始于 13:09 UTC，已包含 `document` 改为 `globalThis.document`、移除未用变量和双文件两槽位新增测试，但早于本节下方的严格空资产测试，不能作为当前全部测试通过的证据。`npm run typecheck` 1.26 秒通过（`batch4-typecheck.log`），开始于 12:54 UTC，早于后补 `.cjs` 测试；这些测试不在该 TypeScript 配置检查范围。完整 `npm run lint` 在原冻结状态通过（`batch4-lint-frozen.log`），补充空资产测试后再次通过，检查 158 份手写 JS、规则 fixture 41/41，22.58 秒（`batch4-lint-empty-assets.log`）。首轮 lint 因新页面测试 29 处裸 `document` 和 1 处未用变量失败（`batch4-lint.log`），按项目方式修正后通过；`browser-page.cjs` 后续仅统一原有 CRLF 换行。
- `npm run test:web-platform` 为 214/214、270.29 秒（`batch4-web-platform.log`）；`npm run test:documents` 1/1、12.38 秒（`batch4-documents.log`）。离线管线实际处理自建 CSV、XLSX、含图片和公式 DOCX、altChunk DOCX、文字 PDF 和中文扫描 PDF；OCR 在真实 Worker 识别中取消并重试，最终人工校对步骤为模拟。大文件和真实用户文档未测。
- 根目录 `node --test test/web-webdav/request.test.cjs` 为 10/10、0.38 秒（`batch4-webdav-request.log`）。用已有 `NODE_PATH=C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules` 与本机 Edge 运行 `node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'`：AI mock 52/52、106.70 秒（`batch4-ai-mock-final.log`）；首次未设置该路径时退出 2，保留 `batch4-ai-mock.log`，未安装依赖。
- 顺序执行正式 `npm run build`（108.87 秒，`batch4-build.log`）、`npm run build:test`（70.21 秒，`batch4-build-test.log`），随后隔离原生重定向和 WebView2 专项，再执行桌面 smoke。正式首构建 EXE SHA-256 `4A7719F9CDE6FCA9808A8B0D693AA6197804F714CFBCFA7D104FBF73BE6D5C69`；native-test EXE `525163ED208DC01EFD1D308899B1293A37FB4532E85C06A77112442ACA528455`。
- `node .reports/batch4-native-redirect.mjs` 通过 5/5、3.79 秒（`batch4-native-redirect.log`）：隔离 native-test 应用的实际受控 WebDAV 请求对本机 mock 允许同源同目录 307/308 且保留方法和假凭据，拒绝跨源、越界及 302，目标未收到请求。现有 `cargo test --offline --release --test service_config` 3/3、203.14 秒（`batch4-redirect-policy.log`）在配置策略层覆盖 HTTPS→HTTP 降级拒绝；未建立真实 TLS 服务或验证真实证书。
- `node .reports/batch4-webview-check.mjs` 5/5、4.32 秒（`batch4-webview-check.log`）：8 份第四批脚本的嵌入资源、生成文件和源码一致；隔离 WebView2 的真实导入界面配受控迟到 Promise、双文件槽位、缺图备份与原生数据保全、WebDAV mock 列表状态通过，页面错误及外部请求均为 0。
- 首轮 `npm run test:desktop` 44/44、160.87 秒（`batch4-desktop-smoke.log`），但与补充导入定向测试重叠 0.43 秒，仅作参考；原 153 张截图哈希未变，首轮 38 张 PNG 完整性通过。全部其他测试结束后，以 `NODE_OPTIONS=--import=file:///C:/Users/30728/.codex/worktrees/724b/shiroha-quiz-desktop/apps/desktop/.reports/batch4-final-smoke-paths.mjs` 独占重跑 `npm run test:desktop`，44/44、164.92 秒（`batch4-final-desktop-smoke.log`）；之前 191 张截图名称和 SHA-256 未变，复验 38 张 PNG 的签名、CRC、解压和尺寸通过（`batch4-final-png-validation.log`）。
- 上述 Rust 策略测试在独占 smoke **之前**重建了正式目录的 EXE，中间 SHA-256 为 `F93A97C32F0AFCE91F3E18603C596DAE02427283826ABED3B42A11F57F86D834`，不作为正式制品。独占 smoke 后重新执行正式 `npm run build`，74.82 秒（`batch4-build-final.log`），空数组修复前的正式 EXE SHA-256 `A1D7252EE6EBFC5FD5823054606CA5BE1D874AA8D212871597100AD3B318C90F`。重建前后 `dist` 全部 403 个文件的内容哈希及 native-test EXE 哈希均一致（`batch4-dist-before-rebuild.json`、`batch4-dist-compare.log`），因此独占 smoke 对应相同测试制品；不同 EXE 哈希不作为可复现构建结论。

**空资产往返、兼容策略与最终验证**

- 在既有门禁、构建和独占 smoke 后，新增自建旧 Android 无图 JSON/ZIP 往返：实际读取输入、Web 完整 JSON 与原生兼容 ZIP，三次 assets 均为 `{}`，ZIP 仅含 `backup.json` 且 assetCount 为 0。记录的完整比较曾因 `nativeQuestion.images` 从 `[]` 变成缺失而 0/2（`batch4-empty-assets-fullcheck2.log`）；初步较窄断言的 2/2 和更早失败也保留在 `batch4-empty-assets-final.log`、`batch4-empty-assets.log`、`batch4-empty-assets-fullcheck.log`。独立序列化回归先 3/4，修复后 4/4：仅保留输入本有的空数组，原本缺失、无效非空媒体及题干中有效图片仍按原规则处理（`batch4-serialization-empty-red.log`、`batch4-serialization-empty-green.log`）。`apps/web/app.js:945` 的 JSON 克隆继续不修改输入，不引入新字段或版本。
- 固定隔离 VM 时钟，分别加载 HEAD `49a2007844bf09805c4ab744fee019a1bd3a092f` 与修复前工作树的测试所需 Web 脚本，JSON/ZIP 完整输入及各步结果完全一致（`batch4-empty-assets-audit.cjs`、`batch4-empty-assets-baseline-audit.json`、`batch4-empty-assets-current-audit.json`）。首次归一化与 ZIP 回读归一化原有 31 处差异：错题、训练记录和收藏快照各省略空 `images`，错题及收藏快照各增加 14 个已归一化字段。修复后该样本剩 28 处，完整逐路径记录在 `batch4-empty-assets-empty-fix-audit.json`：两处各增加 `volume/group/category/subject/grade/difficulty/knowledgePoints/tags/source/sourceFileId/reviewStatus/aiConfidence/warnings/normalized`。这些字段变化来源于 `backup-data.js` 现有的当前题优先规则，未把它们当作字段等价或从比较中删去。
- 独立样本令当前题与错题、收藏历史快照的题干、答案和扩展均不同，起初尝试期待历史快照优先，两个用例均红灯（`batch4-history-snapshot-red.log`）。旧 Android 的错题和收藏界面直接显示导出条目的唯一 `question`，协调审查确认沿用代码既有的当前题优先规则；无当前题时保留原有历史快照回退。最终测试按自建样本的独立完整字面对象分别检查原始错题/收藏、ZIP 中当前题、两类孤儿回退、全部错题进度、收藏时间、完整训练记录及 Web JSON 中错题、收藏、记录和收藏元数据；输入和数据库导出前后均保留。无字段投影或 `images || []`，完整无图往返 2/2（`batch4-empty-assets-exact-green.log`），备份/格式/ZIP 定向 38/38（`batch4-backup-contract-style.log`）。
- 自动审批曾拒绝递归删除比较双方空 `images: []` 的命令，原始理由为“该操作会放宽现有回归断言、忽略历史记录中的空图片字段差异，违反项目规则中不得放宽有效断言或隐藏错误的要求。”该命令未执行。之后更新新测试时，审批还拒绝从函数边界截断并重写的命令，理由是“该命令会从指定函数起截断并重写测试文件，可能删除其后的既有测试；用户明确禁止删除测试，应改为最小追加或精确替换并先核对边界。”该命令亦未执行；后续按建议核对唯一边界和测试声明数量，以精确替换实现按既有规则核实的完整预期，并保留原失败证据。没有跳过测试或用归一化抹去差异。
- 最终代码 `npm test` 桌面 204/204、共享 486/486，177.50 秒（`batch4-npm-test-post-empty.log`）；`npm run typecheck` 1.50 秒通过（`batch4-typecheck-post-empty.log`）；完整 `npm run lint` 159 份 JS、规则 fixture 41/41，24.63 秒（`batch4-lint-post-empty-final.log`）。lint 初轮发现新测试 1 处解构风格（`batch4-lint-post-empty.log`），改为等价解构后定向 38/38 再通过；上述 npm test 在该唯一测试语法调整之前，产品代码和测试语义未变。`npm run test:web-platform` 独占 214/214、293.40 秒（`batch4-web-platform-post-empty.log`）。离线文档、WebDAV 和 AI mock 的此前结果见上；本次最后产品变更仅涉及备份序列化。
- 串行执行正式 `npm run build` 83.23 秒（`batch4-build-post-empty.log`）和 `npm run build:test` 71.10 秒（`batch4-build-test-post-empty.log`）。最终正式 EXE SHA-256 `AAF9B7BA83A661C5B18F1A60AE09C0300CEE7C3BDC992957AC895FC5BB3B8E3B`，native-test EXE `C3A3E936F685D911EF705F2FC3A15215E44E6380CD21CB88AB87F17AB05891C9`。前后 403 份 dist 资源只有 `app.js` 内容因空数组修复变化（`batch4-post-empty-dist-compare.log`）；构建未修改 Rust 或权限。
- 隔离 WebView2 专项 6/6、5.69 秒（`batch4-webview-empty-final.log`）：8 份嵌入资源、生成资源与源码一致；真实界面点击 ZIP 导出按钮，使用受控 `ShirohaPlatform.download` 替身捕获 ZIP 并检查空数组、原本缺失字段、错题/收藏当前题和训练历史快照，真实原生数据库导出前后相等。保存对话框和写文件未由此专项验收；延迟读取和 WebDAV 为模拟，页面错误与外部请求均为 0。
- 其后以 `NODE_OPTIONS=--import=file:///C:/Users/30728/.codex/worktrees/724b/shiroha-quiz-desktop/apps/desktop/.reports/batch4-post-empty-smoke-paths.mjs` 独占运行 `npm run test:desktop` 44/44、163.59 秒（`batch4-post-empty-desktop-smoke.log`），使用新截图前缀。原 229 张截图名称及 SHA-256 未变，新 38 张 PNG 的签名、分块 CRC、解压及尺寸通过（`batch4-post-empty-png-validation.log`）。
- 文档检查 `npm run lint:docs` 交接后通过 22 份文档、0.37 秒（`batch4-lint-docs-handoff.log`）；补充脚本 `batch4-doc-check.cjs` 检查四份变更文档的 UTF-8、围栏、本地链接、空白和冲突标记，交接后通过（`batch4-doc-check-handoff-final.log`）。首次 `batch4-doc-check.log` 把 `docs/README.md:19` 基线已有 Markdown 双空格硬换行误判为尾随空白；保留原文，修正检查器识别合法硬换行，`batch4-doc-check-final.log` 通过。更新交接时系统 `python` 指向不可运行的 WindowsApps 别名，未产生修改；改用已有 Node 完成。`git diff --check` 检查已跟踪变更通过，新增空数组回归前的 11 个未跟踪文件以 `git diff --no-index --check` 补查（`batch4-diff-check.log`）；Git 提示 `app.js` 和 `format.test.cjs` 的 LF 将来会转换为 CRLF。首次补查误把 `--no-index` 的正常差异退出码 1 当作失败，随后用无空白错误和含行尾空白的人造文件确认分别为 1、3，再按正确退出码复核。最终交接的 22 份文档、四份补充文档及全部未跟踪文件复核日志为 `batch4-lint-docs-post-empty.log`、`batch4-doc-check-post-empty.log`、`batch4-post-empty-diff-check.log`。

第四批已通过主协调只读审查，进入第五批。后续保持三槽位和共享预览/名称代次的独立性，尤其不要将双文件清空扩大为取消单文件文本读取；保留空输入误点时在途读取、AI 草稿守卫、第三批当前失败提示与旧失败抑制。真实 AI/WebDAV、真实 TLS 证书、干净系统安装升级、真实用户文档及浏览器同文件重选事件仍未验收；第三批首轮桌面超时根因仍未确定，第五批按原计划继续故障注入。

### 第五批 · 工程检查、资源与测试交付

- 协调会话 `01a1c8fe-0637-7c72-80a5-a25998e7bc71`，第五批会话 `01a1cae7-fe51-7ba2-9c93-8f49585c6eb7`，实施代理 `/root/batch5_implementation`，实际执行身份 `gpt-6.1-terra`、`max`、`priority`（Fast）。唯一工作树、分支与起止 HEAD 见第 1 节；前四批和本批均保留未提交。未提交、推送、合并、创建 PR 或发布，也未使用真实用户数据和收费服务。
- 工程检查：`lint-runner.mjs` 的完整编排运行一次完整规则检查，独立 `lint:eslint`、`lint:platform` 和 `lint:incremental` 入口保留。完整模式用 ESLint 自身发现旧入口范围，包括 Git 忽略但旧入口可见的文件；逐路径比较桌面与平台有效配置，差异项保留双配置检查。发现前检查配置、路径祖先与索引类型，ESLint 当前以 `fs.promises.readFile` 读取文件的阶段再验证实际路径，检查结束恢复原函数；同步、回调、流和 Promise 读取探针及其自检留作升级回归。未跟踪、大小写扩展、索引中链接、CI 基线不明回退和规则 fixture 均保留；`git-hooks.test.mjs` 继续验证失败传播与完整模式参数。
- 资源：`prepare-web.mjs` 两处复用同一业务脚本列表；独立的 `prepare-web-actual.test.mjs` 从真实 Web HTML 推导脚本，并核对生成桌面完整脚本顺序、源文件字节、全部 88 个第三方 JS、许可与未变 mtime；故意删除、调换或损坏生成文件均被测试发现。生成只在校验过的临时目录，清理前单独移除临时 node_modules junction；源/目标重叠和链接拒绝由既有用例继续验证。
- 冒烟：`smoke-control.mjs` 跟踪本次启动、动作和自有子进程；外层超时或任何步骤失败后记录原错并终止共享检查，等待操作收敛再清理 profile。启动在途时禁止迟到进程逃逸；进程停止未确认或动作不收敛时保留目录并报告失败。`network-smoke.mjs` 在监听后写入标记失败时关闭自己创建的服务；实际 smoke 入口在标记或 mock 启动失败时清理经 realpath、父目录和前缀验证的本次 profile，关闭未确认时保留目录并输出两个原错及非零状态。
- [逐文件清单](2026-11-11-project-javascript-inventory.md) 已由协调方只读核对：初始 150 份手写、当前 163（新增 13），另有 88 第三方 JS 和 1 题库；Git 路径 252，缺失、额外及重复均为 0。逐行登记入口、处置和证据，第三方逐路径记录资源及兼容范围；Web 七处事件与桌面六处 click 的区别见清单。当前临时目录不支持仅大小写不同的双文件，专项测试明确跳过；原有混合大小写扩展回归通过。

**冻结前定向验证**

- `node --test test/smoke-timeout.test.mjs`：10/10，退出 0，2.187 秒（`.reports/batch5-smoke-fault-final.log`）。真实入口故障注入仅使用临时假 EXE 和假配置，不启动桌面应用；相关两项只在 Windows 运行。最初外层超时、步骤失败、迟到启动的三个红灯仅保留交互输出，未另存日志；随后分别覆盖真实自有子进程、独立旁侧子进程、动作不收敛及关闭失败。
- 服务启动同名标记故障 0/1→1/1（`batch5-network-start-red.log`、`batch5-network-start-green.log`）；实际 smoke 启动标记/mock 失败后的 profile 遗留 0/1→1/1（`batch5-profile-start-red.log`、`batch5-profile-start-green.log`）；mock 原始 EEXIST 与关闭失败同时发生时错误和目录保留 0/1→1/1（`batch5-network-cleanup-red.log`、`batch5-network-cleanup-green.log`）。红灯均为隔离目录故障注入，未涉及真实用户目录。
- `node --test test/lint-dedup.test.mjs`：8 项中 7 通过、1 因大小写不敏感目录跳过，退出 0，9.341 秒（`batch5-lint-dedup-final.log`）；原始去重和 Git 忽略范围红灯仅保留交互输出。嵌套链接及特定文件名忽略误导在读取前拦截，扩展探针自检通过（`batch5-lint-links-final.log`、`batch5-read-watch.log`）。定向 ESLint 退出 0、1.318 秒（`batch5-focused-lint.log`）；使用项目等价编译选项的定向 checkJs 退出 0、0.342 秒（`batch5-focused-typecheck.log`），不作为最终全量门禁。
- `node --test test/prepare-web-actual.test.mjs test/prepare-web.test.mjs`：23/23、退出 0、11.011 秒（`batch5-assets-green.log`）。`node --test` 的发布/安装器、CI、混合扩展、工作树、删除路径与 Git Hook 专项：53/53、退出 0、104.070 秒（`batch5-engineering-focused.log`）；发布调用由假 gh 完成，制品和 Git 提交均限临时测试目录。
- 仓库根目录 `node --test test/dual-platform/desktop-inline-events.test.cjs test/dual-platform/source-loading.test.cjs`：13/13、退出 0、19.472 秒（`batch5-source-events.log`）。单独 `node --test test/codebuddy-cli-stdio/guard.test.mjs`：回环假 SSE 28/28、退出 0、0.394 秒（`batch5-codebuddy-guard.log`）。未运行真实 CodeBuddy 可执行文件探针。
- 真正改前/改后测时：从 HEAD 提取原 `lint-incremental.mjs` 到同层 `.reports/batch5-lint-incremental-before.mjs`，与旧桌面/平台入口并行，对同一工作树和同一依赖的 252 个脚本交替测三轮。旧墙钟 10.701/11.652/11.491 秒，新 9.326/9.330/8.913 秒，所有子命令退出 0，输入前后 SHA-256 均为 `b1ab0a1ea56b38e9b3142c15b37846ce2eb3083fd18048159f7a908d3412339c`（`batch5-lint-beforeafter.json`、`batch5-lint-beforeafter.log`）。完整手写 163，旧桌面入口 53、平台入口 62，分别全部重合且桌面有效配置差异为 0，减少 115 次规则执行；为覆盖旧入口仍进行无规则文件读取。该计时早于随后 mock 启动修复、测试同步调整及首次启动双故障修复，不是最终代码完整 lint 耗时，也不代表其他设备。更早一轮测时因新增 Git Hook 测试一处引号违规而两侧均退出 1，交互输出保留、未写日志；已修复并以上述三轮重测。
- `npm run lint:docs`：22 份、退出 0、0.332 秒（`batch5-docs-lint.log`）；五份变更文档额外检查 UTF-8、围栏、空白、冲突标记和本地链接，退出 0、0.113 秒（`batch5-docs-extra.log`）。已跟踪差异和全部 17 个未跟踪文件的空白检查通过（`batch5-diff-check.log`）；Git 提示既有 `app.js` 和 `format.test.cjs` 的 LF 将来转为 CRLF。

**冻结后的故障补充和联合验证**

- 协调审查指出首次 launch 的 CDP 错误与进程关闭失败会互相覆盖，浏览器关闭失败被吞掉且其超时可能悬挂。先对真实 smoke 入口注入虚拟进程和临时浏览器替身，3 项红灯 0/3、退出 1、16.671 秒（`batch5-launch-cleanup-red.log`）：分别丢失原 CDP 错、吞掉 browser.close 失败，以及 15 秒内不能退出。最小修复分别尝试进程关闭和有界浏览器关闭，聚合原错与实际清理结果；任一未确认关闭都保留 profile 并非零退出。原 3 项绿灯 3/3、退出 0、9.711 秒（`batch5-launch-cleanup-green.log`）；随后补充进程和浏览器同时关闭失败，完整 `node --test test/smoke-timeout.test.mjs` 14/14、退出 0、13.058 秒（`batch5-smoke-fault-postfreeze.log`）。上述注入不会结束真实进程；生产关闭期限未放宽。协调方复审后再次冻结。
- 冻结后 `npm test` 退出 0、144.941 秒：桌面 227 项中 226 通过、1 项因临时目录大小写不敏感跳过，共享 486/486（`batch5-npm-test-postfreeze.log`）；`npm run typecheck` 退出 0、1.508 秒（`batch5-typecheck-postfreeze.log`）；`npm run lint` 退出 0、21.721 秒，完整检查 163 份手写 JS、CSS 和 22 份文档，规则 fixture 48 通过、同一大小写场景跳过 1（`batch5-lint-postfreeze.log`）。首次冻结前的同命令分别退出 0、139.626/1.142/21.612 秒（`batch5-npm-test.log`、`batch5-typecheck.log`、`batch5-lint.log`），后续 smoke 清理修复后以上述结果为准。
- `npm run test:web-platform` 214/214、退出 0、248.603 秒（`batch5-web-platform.log`）；`npm run test:documents` 1/1、退出 0、18.010 秒，实际执行离线中文扫描 PDF/OCR、文档导入及模拟人工核对（`batch5-documents.log`）。仓库根目录设置 `NODE_PATH=C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`，执行 `node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'`，隔离浏览器 mock 52/52、退出 0、92.808 秒，明确禁用真实 API（`batch5-web-ai.log`）；`node --test test/web-webdav/request.test.cjs` 为 10/10、退出 0、0.386 秒（`batch5-webdav.log`）。这些检查在最后的 smoke Node 清理修复前完成，产品页面、网络及文档代码未因此变更。
- 在 `apps/desktop/src-tauri` 先执行 `cargo test --offline --release --test service_config`，3/3、退出 0、90.160 秒（`batch5-native-policy.log`）；再依次执行 `npm run build`（退出 0、80.613 秒，`batch5-build.log`）和 `npm run build:test`（退出 0、8.080 秒，增量命中，`batch5-build-test.log`）。最终正式 EXE SHA-256 为 `10E91D16A9223496CDB3DF609F9FF427A8B6146BC34D195B289BC5478D59DEDF`，native-test EXE 为 `C3A3E936F685D911EF705F2FC3A15215E44E6380CD21CB88AB87F17AB05891C9`；路径、大小、时间与哈希留在 `batch5-artifacts.json`，采集退出 0、0.553 秒；GUI 后再次核对两个制品大小及哈希一致，退出 0、0.670 秒（`batch5-artifacts-verified.log`）。
- 构建后串行独占 WebView2：`node .reports/batch2-webview-check.mjs` 19/19、退出 0、63.470 秒（`batch5-webview-batch2.log`），包括 500/1,000 自建题库的原生导入、收藏、读回、预览计数及 AI 固定目标、ABA、人工采纳；就绪和网络为隔离模拟。`node .reports/batch4-native-redirect.mjs` 5/5、退出 0、2.866 秒（`batch5-native-redirect.log`），为原生请求配回环 mock；`node .reports/batch4-webview-empty-check.mjs` 6/6、退出 0、4.165 秒（`batch5-webview-batch4.log`），验证空图片/备份入口及脚本一致性，保存由替身捕获。三个专项页面错误均为 0，第二及第四批页面专项的阻断远程请求为 0。
- 最后独占运行 `npm run test:desktop`，44/44、退出 0、156.330 秒（`batch5-desktop-smoke.log`），覆盖本地资源、原生 mock、存储恢复、重启、中文扫描 PDF/OCR 和文档导入。使用 `NODE_OPTIONS=--import=file:///C:/Users/30728/.codex/worktrees/724b/shiroha-quiz-desktop/apps/desktop/.reports/batch5-smoke-paths.mjs` 将截图重定向到 `batch5-` 前缀；旧 267 张名称及 SHA-256 未变，新 38 张 PNG 的签名、分块 CRC、解压和尺寸检查通过，退出 0、1.055 秒（`batch5-png-validation.log`）。统计 smoke 报表时首次交互式 `node -e` 因 PowerShell 引号转义错误退出 1，未留日志；随后用 PowerShell 读取同一 JSON 得到 44/44。
- 各次命令、开始时间、工作目录、退出码和耗时写在对应 `apps/desktop/.reports/batch5-*.log` 首行；其中标记同名故障红/绿分别退出 1/0、5.222/0.326 秒，入口初始化故障红/绿退出 1/0、0.694/1.154 秒，mock 双故障红/绿退出 1/0、0.669/0.677 秒。无日志的早期红灯已在上文明确区分，未当作持久证据。
- 最终 `batch5-verify-inventory.cjs` 退出 0、0.726 秒（`batch5-inventory-final.log`）：Git 及未跟踪 JS 与清单均为 252 路径，缺失、额外、重复与处置状态差异均为 0；163 手写中 Web 40、桌面前端 5、脚本 21、配置 6、桌面测试 26、仓库测试 65，另 88 第三方和 1 题库。本批另有 16 个 Git 忽略的一次性本地辅助脚本，逐个登记在清单末尾，不计入上述 252。当前累计 `git status --short` 为 36 个已跟踪修改和 17 个未跟踪路径，无已暂存项；分支与 HEAD 保持第 1 节记录。交接文档检查：`npm run lint:docs` 22 份、退出 0、0.402 秒（`batch5-docs-lint-final.log`）；额外五份文档的 UTF-8、围栏、空白、冲突标记和本地链接退出 0、0.136 秒（`batch5-docs-extra-final.log`）。首次差异检查误在桌面子目录运行，只检查了 5 个未跟踪路径（`batch5-diff-check-final.log`）；随后从仓库根运行，已跟踪及全部 17 个未跟踪路径均通过、退出 0、1.334 秒（`batch5-diff-check-root-final.log`）。补充本段后再检查文档及全仓差异，日志以 `batch5-*-handoff-final.log` 命名。所有测试、制品与截图只在本工作树、自建 fixture 和隔离 profile 内；无真实用户数据、真实收费 API、真实 CodeBuddy 账户或发布。

第三批首次 42/44 的超时根因仍未知，本批处理共享状态与回收风险不代表查明或根治该次超时。真实收费 AI、真实 WebDAV/TLS、真实用户文档、干净系统安装/升级、最低运行时与发行验收仍未完成；浏览器和桌面 mock 不代替这些人工验收。

主协调收尾独立复核：252 条脚本路径、文件链接和修改/新增/保留状态与 Git 完全一致，未发现遗漏、额外或重复；当前手写 163、第三方 88、题库数据 1。直接读取最终桌面报告确认 44/44、失败 0，重新计算两份 EXE 的 SHA-256，与第五批记录相符。五个批次均使用独立会话，实施代理为 `gpt-6.1-terra`、`max`、`priority`（Fast）。任务分支仍为 `codex/shared-project-js-optimization`，HEAD 未变，无暂存、提交、推送或合并；文档状态更新后再次执行文档与差异检查。
