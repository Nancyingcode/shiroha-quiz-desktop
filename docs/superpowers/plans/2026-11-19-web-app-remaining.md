# app.js 剩余拆分实施计划与验收

2026-11-19 编制计划时，基线为本地 `main` 的 `ac4f4c6`，第七至十七批均待实施。编制分支为 `codex/docs-web-app-remaining`，工作树为 `C:/Users/30728/.codex/worktrees/bb31/shiroha-quiz-desktop`。每次开始一批时，从届时的 `main` 核对以下函数与测试。各批基线、分支和验收结果见[实际执行记录](#实际执行记录)。[职责边界与依赖](../specs/2026-11-19-web-app-remaining.md)

第七、八批已实施并完成验收。第九至十七批按下述顺序推进。

## 第七批 · 题库删除

1. **先跑基线。** 从题库卡片、跨页勾选工具栏和二次编辑进入。已有浏览器回归覆盖取消、失效 ID、重复点击、跨页删题、进行中的练习／考试阻止删题，以及编辑器保存空库。已有 WebView2 用例跨页删除 16 题并在重载后检查本库余下 49 题、旁库 65 题及历史成绩，保留这些断言。[浏览器用例](../../../test/dual-platform/browser-page.cjs) · [原生用例](../../../apps/desktop/scripts/smoke.mjs)
2. **补齐失败路径。** 用两个含同 ID 题的多页测试库，注入一次写入失败，再离开题库页释放正文，返回后点击全局重试。从 SQLite 重载，核对只删除最初选中的题，本库未删题与旁库的题干、答案、解析和扩展字段逐项保留。另测整库删除写失败时活动库、练习范围和库勾选恢复。成功删掉分组最后一库时范围回退，删除全部库后重启仍为空。确认框取消、原生预读失败均应零写入。若复现错误，保留失败测试后修复，再迁文件。[可复用的延迟读取与重试夹具](../../../apps/desktop/scripts/bank-operations-smoke.mjs)
3. **接入同一删除模块。** 迁出 `bankQuestionDeletionBlocked`、`confirmBankQuestionDeletion`、`removeBankQuestionReferences`、`deleteBankQuestions` 与 `deleteBanksV32`。列表传入点击时的库和题 ID，编辑器传入相对原快照实际移除的 ID。删题预读指定库后在事务内重取有效 ID，需重试时重新从预读开始。整库删除按选中库 ID 清理，保留保存、选择重置及成功提示的时机。[题库页接线](../../../apps/web/bank-page.js) · [编辑器保存](../../../apps/web/bank-editor.js)
4. **核对最终数据。** 从卡片删库和批量删库分别验证未选库、历史成绩保留。删题成功与二次编辑移除原题使用相同的会话保护及关联清理。重试最终生效一次，界面、重新打开后的数据和原生写入结果一致。

## 第八批 · 导出与题库勾选

1. 固定三个入口的输出。卡片导出指定库，工具栏导出当前库，批量按钮导出选中库。单库输出题库对象，多库输出 `question_banks`。按“选 A → 延迟读 A → 切换为 B”测试当前库和勾选两条路径。核对文件名、文件内库 ID、第二页题目正文和媒体。读失败或目标变动触发中止时，下载次数应为零。
2. 把选择范围、预读、序列化和下载移到导出模块。导出记录只补记录详情，导出所选库只补这些库，完整 JSON、兼容 ZIP 与复制完整备份走 `loadNativeAll`。保留 `exportSettingsV1` 对导出配置的筛选，归档与图片装配复用现有模块。批量工具栏保持全选、反选、仅选当前和三态反馈，与第七批共用选择集合。
3. 用第六批的多页夹具比较导出前后源数据，核对首题和末页题、空图片字段、带图片 ZIP、学习记录详情与旧 Android 往返。完整备份可以交给下一批按原格式恢复。测试从实际下载或剪贴板读取结果。[格式往返](../../../test/dual-platform/format.test.cjs) · [图片字段兼容](../../../test/dual-platform/backup-serialization-empty.test.cjs) · [桌面分页与完整导出](../../../apps/desktop/scripts/smoke.mjs)

## 第九批 · 本地与 WebDAV 恢复

1. 分别走设置页选文件、导入页识别备份、WebDAV 列表恢复。用同一脱敏夹具覆盖合并与覆盖两种模式，导入页走现有的合并路径。比较成功重载后的题库、分组、错题、收藏、学习记录和设置，记录每条路径原有的确认次数、成功提示与预览清理时机。[文件入口回归](../../../test/dual-platform/backup-entry-performance.test.cjs) · [WebDAV 请求回归](../../../test/web-webdav/request.test.cjs)
2. 在 `applyBackupImportV23` 和 `applyNormalizedBackupV378` 之间提取相同的字段应用与保存步骤。本地 ZIP 先回填图片，桌面遇到缺图在改动数据前拒绝，Web 保留原有缺图数量提示。WebDAV 保留面板确认和传输错误反馈。导入页沿用已进入的事务，云端保留自己的事务入口，避免重复确认和异步嵌套写入。
3. 在原生完整读取、检查点、保存三个位置分别注入故障。读取或检查点失败时不得开始替换，保存失败时核对修订、界面和重载内容。模拟 WebDAV 密码保存及清除，核对 `operationId`、撤销和成功后的 `finalize` 顺序，检查导出中无凭据。WebDAV 仅用本地 mock。[平台回归](../../../apps/desktop/test/native-adapter.test.mjs) · [浏览器凭据](../../../test/dual-platform/browser-credentials.test.cjs)
4. 保留正常恢复点、损坏 SQLite 从恢复点修复、损坏 SQLite 从兼容文件修复三条实际入口。前者等待保存队列后重载，后两者可以在加载失败状态运行，修复成功后重走启动。用隔离 profile 检查原数据副本、新数据和恢复后页面事件只触发一次。[原生恢复场景](../../../apps/desktop/scripts/smoke.mjs)

## 第十至十七批 · 按现有调用方逐批迁移

| 批次 | 实施动作 | 完成该批时核对什么 |
| --- | --- | --- |
| 10 · 范围与来源 | 从 `normalizePracticeScopeV8916` 至范围 UI 分步迁移。先接组名、库查询和范围设置，再接本轮条目、来源标识与显示。用回调触发原有分页重置。 | 分组成员变化、分组消失、旧设置指向不存在的库、零题库时均得到可保存的范围。切分组保留活动库。两个库有同 ID 题、历史 ID 含 `#` 或重复后缀时，顺序、来源、答案键正确，练习和考试均能重载成绩。[分组和跨库答题回归](../../../test/dual-platform/browser-page.cjs) |
| 11 · 学习数据 | 先迁按库读写错题、复习排期、收藏元信息和清空操作。再把练习与考试共用的题目快照、来源题号、逐空答案及复盘摘要生成接入训练模块，显式传入已取到的题目、分值和时间。 | 连续答对、再次答错后计数与到期日符合原规则。旧字符串／对象错题与旧计数可读。收藏保留原有时间与扩展字段。改原题后历史记录保留当时的正文和分数，复盘不会定位到同 ID 的旁库题。[训练记录](../../../test/dual-platform/training.test.cjs) · [历史数据与多空题](../../../test/dual-platform/business.test.cjs) |
| 12 · 首页 | 迁出统计、到期按钮及 `dueReviewTimer` 与可见性监听，首页复用第十批范围和原有 `dueReviewItems`。 | 测本地零点、夏令时、后台恢复可见，以及恢复重入后只剩一个下一次刷新。验证放弃未完成练习的确认、取消保持原轮、同意后按范围开始复习并定位首题。[日期边界](../../../test/dual-platform/due-review.test.cjs) · [首页交互](../../../test/dual-platform/browser-page.cjs) |
| 13 · 内置库 | 将内置库数据来源、两个手动入口、加载状态与占位库替换接到同一工厂，保留启动时的默认库策略。 | HTTP 下读取本地资源，直接打开 HTML 时可使用 `window.questionBank`。测试主动清空后冷启动、手动重新加载、占位库替换、资源缺失或保存失败后的重试。从重载后的活动库和题量判定结果。[内置数据](../../../apps/web/question-bank.js) · [浏览器页面](../../../test/dual-platform/browser-page.cjs) |
| 14 · 导入与 OCR | 先接单／双文件识别、示例、目标选择、自动命名和拖放，再接 OCR 回填、复制和 DOCX 下载。导入 AI 的匿名键、选区上下文和唯一定位与现有导入会话一起装配。 | `questions` 只进草稿，`banks` 经确认合并。原有诊断、双文件兜底顺序、第四批目标校验有效。恢复草稿或更换文件后旧读取、AI 建议不能覆盖新输入。重复 ID 拒绝误写。OCR 回填后由用户发起解析，空文本保留原文。用下载按钮生成含中文、换行和 XML 特殊字符的 DOCX，再读回核对。[草稿覆盖与归属](../../../test/dual-platform/import-ownership.test.cjs) · [草稿恢复](../../../test/dual-platform/import-draft-page.test.cjs) · [OCR 导出格式](../../../test/dual-platform/zip-safety.test.cjs) · [桌面文档导入](../../../apps/desktop/scripts/document-smoke.mjs) |
| 15 · AI 设置 | 迁出保存、清除与连接测试，保留 API 和 Harness 两条路径及任务进行中的操作限制。跨会话忙碌判断仍供退出守卫使用。 | 假凭据验证写入、保存失败撤销、成功确认。复验 API 配置已保存而切换执行方式失败的反馈，Harness 模式保留直接 API 配置。连接取消、错误与成功均恢复按钮状态。[连接](../../../test/dual-platform/ai-connection.test.cjs) · [Harness](../../../test/dual-platform/ai-harness.test.cjs) |
| 16 · 单题解析 | 将练习与复盘的保存入口接同一实现。按来源库、题 ID 和指纹确认原题，更新普通／富文本解析和相应练习、考试、错题及收藏副本。 | 换题或离页后丢弃迟到响应。原题变更、删除或取消覆盖时，草稿保留且题库无写入。保存失败时还原相关副本。同意覆盖后重载只更新来源题及对应副本。核对总提交、自评与已有历史记录，使用假 AI 响应。[单题端到端验证](../../../test/web-ai-practice/README.md) · [复盘来源回归](../../../test/dual-platform/review-options.test.cjs) |
| 17 · 分页与界面 | 先抽两端共用的页码控件和按列表保存的状态。按需再单独抽侧栏与专注栏的折叠、尺寸监听。入口继续协调原生读取、释放、离页取消及全局视图切换。 | 空列表、末页删除、四档每页条数、快速翻页迟到结果、窄屏键盘焦点均有对照。升级／恢复重置分页键及页码，保留条数。切页时在练或在考正文仍可用，专注模式退出只还原自动收起的侧栏。[分页规则](../../../test/dual-platform/pagination.test.cjs) · [浏览器与键盘](../../../test/dual-platform/browser-page.cjs) · [退出协调](../../../test/dual-platform/exit.test.cjs) |

## 每批接线与交付

1. **先固定当前行为。** 对已覆盖场景先跑原测试。待复验窗口先用可控的延迟、失败或重入从真实按钮触发，记录输入、预期和实际结果。出现偏差时让新增回归先失败，再修复、迁移并重跑。数据库、浏览器存储和凭据使用隔离夹具。
2. **每个新脚本在两端加载一次。** 更新 HTML 的经典脚本顺序、桌面 `businessScripts` 精确路径、测试加载器、ESLint 适用规则及对应测试。把按入口源码片段取函数的测试改接真实模块，特别核对备份修复、AI 连接与导入重试。测试保留唯一的末尾启动点和原业务断言。[HTML](../../../apps/web/index.html) · [桌面生成器](../../../apps/desktop/scripts/prepare-web.mjs) · [测试桥接](../../../test/dual-platform/web-source.cjs) · [加载验证](../../../test/dual-platform/source-loading.test.cjs) · [制品字节校验](../../../apps/desktop/test/prepare-web-actual.test.mjs)
3. **按改动运行验证。** 在根目录跑该批的定向用例。共享业务变更在 `apps/desktop` 跑 `pnpm run typecheck`、`pnpm run lint`、`pnpm test` 和 `pnpm run test:web-platform`。新增资源依次跑 `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test`、`pnpm run test:desktop`，分别从 HTTP、本地 HTML 和隔离 WebView2 验证实际加载。第九批追加根目录 `node --test test/web-webdav/request.test.cjs`，第十四批追加桌面工程 `pnpm run test:documents`，第十六批追加根目录 `node test/web-ai-practice/runner.cjs`。[项目脚本](../../../apps/desktop/package.json)
4. **记录结果与剩余职责。** 记录基线、已迁入口、仍借用的跨域操作、实际命令与重载结果。保留每批独立变更边界，测试发现的行为修复注明复现条件。第十七批结束时复查入口剩余实现，将启动、事务、恢复和关闭顺序与设计逐项对照。

## 实际执行记录

### 第七批 · 题库删除

- 负责人为 `batch07_deletion`（GPT-6.2-Sol Max），基线为 `ac4f4c64adc773040eb2b06bf5831003c2803ab0`。分支为 `codex/web-app-remaining`，工作树为 `C:/Users/30728/.codex/worktrees/31f4/shiroha-quiz-desktop`。
- 将会话占用判断、删除确认、错题与收藏引用清理、删题及整库删除迁至 [`banks/deletion.js`](../../../apps/web/banks/deletion.js)。列表和编辑器复用确认与引用清理。应用继续负责事务、原生读取、练习范围和回滚，`bankSelection.get/set` 访问题库页与删除操作使用的当前选择。`app.js` 由 5,349 行、195 个入口闭包内直接声明的具名函数减至 5,268 行、190 个。
- 修改业务代码前，题库删除与跨页选择的 7 条既有浏览器回归通过。隔离 WebView2 基线的前 50 项通过，原有跨页删 16 题用例继续核对本库余 49 题、旁库 65 题及历史成绩。新增用例先拒绝原生预读、再取消确认，SQLite 修订均未推进。注入一次写失败并离页后，旧全局重试在提交前漏读目标库的 `q11` 至 `q23`。该次重载的未删字段仍完整，失败断言定位到预读顺序。
- 在旧入口修复后，定向隔离 WebView2 回归通过。两库共享题目 ID，目标库重载后余 21 题，旁库保留 22 题。逐项比较了题干、选项、答案、解析、扩展字段和历史成绩；写失败回滚后的全局重试补读，并且 SQLite 修订只推进一次。
- 二次编辑的受控正文缓存回归中，旧重试在离开编辑页后读取 0 次、写入尝试 1 次，草稿未保存。修复固定原编辑会话及其目标题库，重试重新预读后通过。两次写入尝试中第一次按夹具设置失败，第二次生效。原快照校验仍用于阻止过期编辑覆盖。

在 Windows 10（19045）、Node 24.22.2、pnpm 12.16.1 和 Rust 1.99.1 上验证。桌面依赖通过 `pnpm install --frozen-lockfile --offline` 从本地缓存安装，锁文件无变更。构建用 `CARGO_NET_OFFLINE=true`，生产构建通过进程级 `CARGO_TARGET_DIR` 复用本工作树的 Cargo 缓存，后续按原脚本重新构建带 `native-test` 的隔离版。日志保存在本工作树的 `apps/desktop/.reports/batch07/`。

| 验证项 | 实际命令与结果 |
| --- | --- |
| 定向浏览器与接线 | 仓库根目录运行 `node --test --test-name-pattern='题库删除\|跨页选择导出内容\|file URL 支持 ZIP' test/dual-platform/browser-page.cjs`，9 项通过。运行 `node --test test/dual-platform/source-loading.test.cjs`，14 项通过。HTTP 和本地 HTML 均加载新模块。 |
| 类型和 lint | 在 `apps/desktop` 运行 `pnpm run typecheck` 和 `pnpm run lint`。类型检查通过，完整 JavaScript 检查覆盖 176 个文件；规则夹具 89 项通过，1 项按测试规则在大小写不敏感的临时目录跳过。 |
| 桌面与共享测试 | `pnpm test` 首轮与构建、浏览器测试同时执行，共享阶段的 `spaced-quotes` 子进程达到现有 60 秒限时。等构建与浏览器流程退出后独占复跑 `pnpm test` 通过，含桌面 283 项通过及 1 项环境跳过、共享 510 项通过。该用例复跑用时约 14 秒。 |
| 完整浏览器测试 | `pnpm run test:web-platform` 的 239 项全部通过。 |
| 资源与构建 | `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test` 依次通过，生成的 `dist/banks/deletion.js` 与 Web 源码 SHA-256 一致。 |
| 真实 WebView2 与 SQLite | `pnpm run test:desktop` 的 53 项全部通过。零写入、离页后全局重试及两库内容保全通过。整库写失败后重绘确认活动库、分组范围及共享勾选恢复，卡片与批量删除均保留未选库及历史成绩。分组末库删除后范围回退，删空后退出并重新启动仍为空，完整 SQLite 快照与重启前一致。 |

本批使用自建题库、隔离 profile、假凭据和本地 mock。正式安装升级及真实用户存档的验收未纳入本批。第八批可以沿用 `bankSelection.get/set` 和现有 `runMutation` 回滚边界，批量删除入口仍使用同一个选择集合。

### 第八批 · 只读导出与题库勾选

- 负责人为 `batch08_export`（GPT-6.2-Sol Max）。在第七批已验收的工作树上继续，分支为 `codex/web-app-remaining`，工作树为 `C:/Users/30728/.codex/worktrees/31f4/shiroha-quiz-desktop`，`HEAD` 为 `ac4f4c64adc773040eb2b06bf5831003c2803ab0`。
- 原页面只有 `#export-json-btn` 的可选事件绑定。按计划在题库工具栏补齐当前库按钮，并把卡片、当前库、已选库、学习记录、完整 JSON/ZIP 和复制备份的读取及输出迁至 [`backup/export.js`](../../../apps/web/backup/export.js)。设置筛选、题目序列化、记录转换与 ZIP 图片装配沿用原有契约。题库页负责批量控件和三态反馈，继续通过 `bankSelection.get/set` 和删除共享选择。应用保留原生读取及事务协调、本地恢复和 WebDAV 入口。`app.js` 由 5,268 行、190 个入口闭包内直接声明的具名函数减至 4,936 行、171 个。
- 基线的跨页批量导出、兼容 ZIP 下载及下载失败反馈 3 项通过。补齐当前库按钮后，延迟 `bank-a` 的正文读取，再用真实下拉框或复选框切换到 `bank-b`。旧当前库按钮写出了 `跨题库同ID.json`，旧批量按钮写出了 `shiroha-quiz-bank-跨题库同ID-2026-11-19.json`，两份实际文件的库 ID 都是 `bank-b`。当前库红测在测试宿主中将浏览器下载交到页面解锁后执行，复现窗口仍使用真实切库事务。修复后两条用例都提示重新导出，下载为零，上一次的预览仍在。选中 ID 相同、排序重绘替换了集合的情况下，导出仍成功。[浏览器交互和实际下载](../../../test/dual-platform/browser-page.cjs)

本批在 Windows 10（19045）、Node 24.22.2、pnpm 12.16.1 和 Rust 1.99.1 上验证。沿用本工作树依赖和构建缓存。首轮 `pnpm test` 在默认沙箱内遇到 esbuild 临时目录父路径与 `icacls` 完整性标签的权限拒绝。经自动审查放行后用原命令独占复跑，桌面及共享测试通过。默认沙箱首轮和复跑日志均保存在 `apps/desktop/.reports/batch08/`。

| 验证项 | 实际命令与结果 |
| --- | --- |
| 浏览器定向 | 根目录运行 `node --test --test-name-pattern='第八批导出' test/dual-platform/browser-page.cjs`，4 项通过。HTTP 实读卡片、当前和勾选下载及完整备份剪贴板。本地 HTML 实读当前库 JSON，核对了媒体。 |
| 格式定向 | 根目录运行 `node --test test/dual-platform/format.test.cjs test/dual-platform/backup-serialization-empty.test.cjs test/dual-platform/contracts.test.cjs test/dual-platform/training.test.cjs test/dual-platform/backup-entry-performance.test.cjs`，70 项通过。覆盖旧 Android JSON/ZIP 往返、显式空图片与缺失字段、设置筛选、记录及旧恢复入口。 |
| 类型和 lint | 在 `apps/desktop` 运行 `pnpm run typecheck` 与 `pnpm run lint`，均通过。完整 JavaScript 检查覆盖 177 个文件，规则夹具 90 项通过，1 项因临时目录大小写不敏感跳过。 |
| 桌面和共享测试 | `pnpm test` 桌面 284 项通过、1 项环境跳过，共享 510 项通过。共享源码加载测试验证导出脚本注册顺序、工厂装配无 DOM 访问及唯一启动入口。 |
| 完整浏览器 | `pnpm run test:web-platform` 的 243 项全部通过。 |
| 资源与构建 | `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test` 依次通过。`dist/backup/export.js` 与源文件 SHA-256 一致。生产构建通过进程级 `CARGO_TARGET_DIR` 使用本工作树的缓存，用 `build:test` 重新生成隔离测试版。两次构建均使用 `CARGO_NET_OFFLINE=true`。 |
| WebView2 与 SQLite | `pnpm run test:desktop` 最终 56 项全部通过。旧 C8 用例直接调用 `ensureAll`。新增三项从真实按钮验证导出文件名、适配器交付字节及剪贴板写入，覆盖三库 13、14、12 道题的首末页、跨库同 ID、空图片字段、去重 ZIP 媒体、记录详情及 SQLite 重载。失败预读和两种目标变化均零文件输出并保留预览。只在显式切库时有一次预期 SQLite 写入。 |

桌面首轮读取失败用例等待注入异常的原始文案，实际桌面适配器显示已有的通用本地操作提示。按实际提示修正测试断言后，重新通过类型、完整 lint 和 WebView2 检查。保留 `test-desktop.log` 和 `test-desktop-final.log` 两份日志。桌面的文件授权与剪贴板由隔离测试宿主捕获。浏览器另从实际下载及系统剪贴板接口读取了导出结果。系统保存对话框和安装升级未纳入本批验收。[桌面导出用例](../../../apps/desktop/scripts/bank-operations-smoke.mjs)

### 第九批 · 本地与 WebDAV 恢复

- 负责人为 `batch09_restore`（GPT-6.2-Sol Max）。沿用第七、八批已验收的工作树。分支为 `codex/web-app-remaining`，工作树为 `C:/Users/30728/.codex/worktrees/31f4/shiroha-quiz-desktop`，`HEAD` 为 `ac4f4c64adc773040eb2b06bf5831003c2803ab0`。
- [`backup/restore.js`](../../../apps/web/backup/restore.js) 持有设置页备份面板、文件选择、附件回填、共享的备份字段应用及原生 WebDAV 配置事务。设置页合并直接应用，覆盖时单次确认。导入页保留一次合并确认和保存后的预览清理。WebDAV 面板保留文件哈希校验、模式确认、传输诊断与完成反馈。三条入口共用应用事务及保存队列，正常恢复点与损坏数据库修复仍由应用入口协调重入。`app.js` 由 4,936 行、171 个入口闭包内直接声明的具名函数减至 4,763 行、164 个。
- 在旧实现的实际浏览器按钮注入一次写失败。WebDAV 全局重试写入后待恢复弹窗仍保留，面板未报告完成。浏览器模拟原生凭据接口，使用真实保存队列复现保存和清除各自暂存、写失败、撤销待处理 ID 后，再点按钮仍不恢复写入。接线后原生配置由表单按钮重新发起事务并暂存。全局备份重试固定输入、模式和来源。WebDAV 成功后关窗并把焦点还给发起按钮，模式变更时旧重试不写入。[浏览器用例](../../../test/dual-platform/browser-page.cjs)
- 首次迁移后的定向浏览器测试发现导入页的读取代次检查只在草稿工厂内部可用。公开同一检查方法后，原文本和预览继续保留到保存成功，导入页全局重试也可成功。历史 ZIP 先回填附件，桌面缺图在修改数据前拒绝，Web 继续提示缺图数量。覆盖对原生凭据的撤销由宿主管理，其结果独立于 SQLite 修订与界面回滚。[文件与修复入口](../../../test/dual-platform/backup-entry-performance.test.cjs)

在 Windows 10（19045）、Node 24.22.2、pnpm 12.16.1 和 Rust 1.99.1 上验证。使用本工作树原有依赖及构建缓存。完整测试、生成和桌面验收按现有 Windows 夹具需要经自动审查运行，在隔离目录使用合成数据、假凭据和本地模拟服务。两个桌面构建使用 `CARGO_NET_OFFLINE=true`，生产构建通过进程级 `CARGO_TARGET_DIR` 复用本工作树缓存。第九批日志位于 `apps/desktop/.reports/batch09/`。

| 验证项 | 实际命令与结果 |
| --- | --- |
| 原始回归和接线 | 根目录运行 `node --test test/dual-platform/backup-entry-performance.test.cjs test/dual-platform/json-import.test.cjs test/dual-platform/format.test.cjs test/dual-platform/source-loading.test.cjs test/web-webdav/request.test.cjs`，61 项通过。单独运行 `node --test test/web-webdav/request.test.cjs`，10 项通过。 |
| 类型和 lint | 在 `apps/desktop` 运行 `pnpm run typecheck`、`pnpm run lint`。完整 JavaScript 门禁覆盖 179 个文件。规则夹具 91 项通过，1 项按规则在大小写不敏感的临时目录跳过。 |
| 桌面和共享 Node 测试 | `pnpm test` 桌面 285 项通过、1 项环境跳过，共享 510 项通过。 |
| 完整浏览器 | `pnpm run test:web-platform` 的 246 项全部通过，覆盖 HTTP、本地 HTML、恢复失败重试、确认与预览。 |
| 资源与构建 | `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test` 依次通过。`dist/backup/restore.js` 与源文件 SHA-256 一致。 |
| WebView2 和 SQLite | `pnpm run test:desktop` 最终 60 项全部通过。用同一份实际导出产物验证设置页合并 JSON 和覆盖 ZIP、导入页合并 JSON、模拟 WebDAV 合并和覆盖 JSON。逐题核对 13、14、12 道题，另检查同 ID 旁库、分组、末页图片、错题、按库和题目 ID 定位的收藏时间及扩展字段、历史记录和设置。历史 ZIP 不含 Web 设置时沿用原值。 |

- 三库逐题使用独立预期。既有导入规范会为样本客观题解析补答案前缀，并在有图题干中补内联图片 Markdown。重载核对了这两种明确的格式变化，题干正文、选项、答案、解析正文、题目扩展字段及图片内容仍按对应题目比较。[恢复桌面用例](../../../apps/desktop/scripts/backup-restore-smoke.mjs)
- 桌面缺图、完整读取失败和检查点失败均未替换题库。读取和检查点故障均未撤销凭据。写入失败后内存活动库、SQLite 修订和 SQLite 数据保持原值，正确重试后修订只推进一次。原生 WebDAV 实测保存与清除的暂存 ID 对应写入 `operationId`，失败后撤销，成功后确认。另模拟确认失败，重载根据实际写入回执完成凭据核对。上传元数据只写一次设置，实际上传请求正文无测试密码。正常恢复点操作等待保存队列完成后才切换和重载。
- 两条损坏库修复都在未就绪页触发一次原生修复，启动后输入事件各调用一次原文来源与 AI 选区监听器，并保留原主库字节和旧活动代。首次全量桌面运行把这两个既有监听器误计为一个，第二次在人工构造的无效 WAL 断言处停止。复验在用户点击前记录旧路径上的 WAL，两条路径在进入恢复界面时该无效侧车文件均已不在原路径。有效且尚未 checkpoint 的 WAL 在损坏数据库修复中的保全未由此场景验收。保留两次原始日志及 `test-desktop-final.log`。[启动修复用例](../../../apps/desktop/scripts/smoke.mjs)

文件授权由现有桌面测试协议接收实际备份字节，未人工验收系统文件对话框。WebDAV 使用本地或页内模拟，未连接真实服务。交付边界截至第九批，下一批迁移题库组名时可继续通过现有归一化回调连接备份转换和恢复。

### 第十批 · 练习范围与题目来源

- 负责人为 `batch10_scope`（GPT-6.2-Sol Max）。在第七至九批已验收的工作树上继续。分支为 `codex/web-app-remaining`，工作树为 `C:/Users/30728/.codex/worktrees/31f4/shiroha-quiz-desktop`，`HEAD` 为 `ac4f4c64adc773040eb2b06bf5831003c2803ab0`。
- [范围模块](../../../apps/web/study/scope.js)提供当前库查询、练习范围校准和设置、四处范围摘要及本轮题目的标识和来源。应用通过 `resetPages` 在主动切换到不同当前库时归零页码，通过来源库和题 ID 请求及保留原生正文。原生读取、释放和保存事务由应用入口协调。选题及续练进度仍由 [practice-selection.js](../../../apps/web/practice-selection.js) 持有。`app.js` 由 4,763 行、164 个入口闭包内直接声明的具名函数减至 4,599 行、142 个。
- [题库元数据](../../../apps/web/banks/metadata.js)提供组名归一化、显示默认值、历史 JSON 别名、同名比较键和分组建议。导入、状态升级及备份沿用同一规则，显式空组名保留未分组含义。工具栏选择器切换当前库，组范围保留。卡片设为当前库时同步设置单库练习范围。修订了工具栏提示，并实测从另一个库所在的分组选取范围时保留当前库。
- 用启动后实际保存的快照逐字段对照原题和旁库。迁移前从二次编辑保存按钮复现两处提示偏差，只改名时多提示一次，移出组内最后一库时缺少提示。修正为修改前后读取已校准的范围，且在成功保存后显示。题库改名已有用例继续覆盖组内仍有成员及保存失败回滚。补测失效题库、失效分组及显式空库，保存后重载检查范围与计数。[浏览器回归](../../../test/dual-platform/browser-page.cjs)
- 练习与考试各有 5 道题，两库共享一个 ID，一组旧 ID 同时造成跨库键冲突并占用 `#1`。原算法按题库和题目原序分配 `#2`，在迁移前后均正确。经实际提交、重载记录页和打开复盘，核对原题号、来源库、题干、各题答案和分数。库内 ID 唯一的存储校验继续生效，历史库内重复 ID 的本轮键分配由[模块测试](../../../test/dual-platform/study-scope.test.cjs)覆盖。

本批在 Windows 10（19045）、Node 24.22.2、pnpm 12.16.1 和 Rust 1.99.1 上验证。沿用本工作树依赖和构建缓存。生产构建通过进程级 `CARGO_TARGET_DIR` 复用缓存，两次构建使用 `CARGO_NET_OFFLINE=true`。浏览器和桌面使用隔离测试配置、自建题库及模拟服务。日志位于 `apps/desktop/.reports/batch10/`。

| 验证项 | 实际命令与结果 |
| --- | --- |
| 浏览器定向 | 根目录运行 `node --test --test-name-pattern='第十批范围\|题库分组：\|特殊字符与跨题库键碰撞\|清空选项：.*跨库同 ID\|训练复盘：提前结束\|file URL 支持' test/dual-platform/browser-page.cjs`，16 项通过。HTTP 与本地 HTML 验证了范围脚本的加载，兼容场景继续使用真实保存与复盘入口。 |
| 共享定向 | 根目录运行 `node --test test/dual-platform/study-scope.test.cjs test/dual-platform/due-review.test.cjs test/dual-platform/practice-selection-performance.test.cjs test/dual-platform/training.test.cjs test/dual-platform/json-import.test.cjs test/dual-platform/preview-performance.test.cjs test/dual-platform/format.test.cjs test/dual-platform/source-loading.test.cjs test/dual-platform/backup-entry-performance.test.cjs`，78 项通过。验证旧备份与旧键、无 DOM 工厂装配、加载次序及唯一末尾启动点。 |
| 类型和 lint | 在 `apps/desktop` 运行 `pnpm run typecheck` 和 `pnpm run lint`，均通过。完整 JavaScript 门禁检查 181 个文件，规则夹具 92 项通过，1 项按规则在大小写不敏感的临时目录跳过。加强切组浏览器夹具后，该文件通过定向 ESLint。 |
| 桌面与共享测试 | `pnpm test` 桌面 286 项通过、1 项环境跳过，共享 514 项通过。 |
| 完整浏览器 | `pnpm run test:web-platform` 的 254 项全部通过。 |
| 资源与构建 | `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test` 依次通过。生成的 `dist/study/scope.js` 与 Web 源码 SHA-256 一致。 |
| WebView2 与 SQLite | `pnpm run test:desktop` 最终 61 项全部通过。从实际按钮提交两库 5 题的练习与考试，两轮均答对 3 题，考试为 6 分。重载后读 SQLite 记录并从记录页打开复盘，按原顺序验证答案、不同库的同 ID、原题号和来源正文。另通过既有的换组、原生按需读取和零库冷启动场景。 |

首轮桌面烟测在新增用例的练习提交确认处停下，前 48 项通过。补齐点击实际确认按钮的步骤后，最新类型检查和烟测文件定向 ESLint 通过，同一隔离构建的桌面套件复跑通过。保留 `test-desktop.log` 和 `test-desktop-final.log`。[桌面用例](../../../apps/desktop/scripts/bank-operations-smoke.mjs)

应用入口生成训练快照和答题明细，来源库、原题号和题目引用通过范围模块查询。第十一批可继续复用这些查询。第十二批首页统计可继续通过同一范围读到题库集合。

### 第十一批 · 学习数据

- 负责人为 `batch11_learning`（GPT-6.2-Sol Max）。在第七至十批已验收的工作树上继续。分支为 `codex/web-app-remaining`，工作树为 `C:/Users/30728/.codex/worktrees/31f4/shiroha-quiz-desktop`，`HEAD` 为 `ac4f4c64adc773040eb2b06bf5831003c2803ab0`。`app.js` 由 4,599 行、142 个入口闭包内直接声明的具名函数减至 4,428 行、128 个。
- [学习数据模块](../../../apps/web/study/saved-questions.js)负责按库读写错题、复习排期、手动掌握、收藏 ID 和元信息，以及两个列表的当前库清空动作。错题读写使用当前状态映射，练习和考试在原事务内同步累计。清空、移出和收藏切换继续通过应用提供的确认、保存、重试和刷新回调执行。错题和收藏页继续展示、筛选和分页，收藏界面由现有静态控件进入。[记录页](../../../apps/web/training-review-page.js)承接全部学习记录的清空，应用入口保留事件绑定。
- [训练模块](../../../apps/web/training.js)接收已补读的题目、范围模块解析的来源、已判分值和时间，生成开轮快照、逐空作答明细、复盘条目和摘要。练习和考试共用读取界面分值的回调，逐空规则在调用时注入，训练模块可以按现有顺序先于题型规则脚本加载。两种提交继续沿用各自的计时和记录形状。复盘用来源库 ID 和题 ID 对应历史明细。
- 测试区分旧字符串默认一次错误、旧对象直接读取缺省为零和状态升级缺省为一，保留文本零值及扩展字段。固定时钟下答对两次，核对第一次排期一天、第二次三天并掌握。再次答错清零连对并重新排期一天，同时保留上次答对日期。用实际按钮确认收藏新增只写新时间，原收藏时间、题目快照和扩展字段保留。取消清空、写失败及全局重试分别核对保存内容，重载后目标库清空而同 ID 旁库保留。
- 通过真实提交保存两轮分组记录，再从二次编辑修改甲库同 ID 题目的正文、答案和分值。浏览器重载保留两份旧记录的满分 7、4 和实际得分 7、0，复盘仍显示两库各自原题、答案和题库第 1、2 题。首轮用例的定位同时命中考试结果和记录页按钮，限定为记录页后原实现的新增用例全绿。迁移后用相同用例复验，无需改动产品规则。[浏览器用例](../../../test/dual-platform/browser-page.cjs)

本批在 Windows 10（19045）、Node 24.22.2、pnpm 12.16.1 和 Rust 1.99.1 上验证。沿用本工作树依赖与编译缓存。生成、生产构建和测试版构建串行执行，两次构建使用 `CARGO_NET_OFFLINE=true`。生产构建通过进程级 `CARGO_TARGET_DIR` 复用本工作树缓存。日志位于 `apps/desktop/.reports/batch11/`。

| 验证项 | 实际命令与结果 |
| --- | --- |
| 定向基线 | 根目录运行 `node --test test/dual-platform/business.test.cjs test/dual-platform/training.test.cjs test/dual-platform/training-characterization.test.cjs test/dual-platform/due-review.test.cjs test/dual-platform/review-options.test.cjs test/dual-platform/format.test.cjs`，71 项通过。用 `node --test --test-name-pattern='旧错题字符串' test/dual-platform/business.test.cjs` 单独验证旧计数，再用 `node --test --test-name-pattern='第十一批学习数据' test/dual-platform/browser-page.cjs` 验证新增的 4 个真实入口，两条均通过。 |
| 迁移后定向 | 同一共享命令追加 `test/dual-platform/source-loading.test.cjs`，86 项通过。运行 `node --test --test-name-pattern='第十一批学习数据\|第十批范围：.*成绩重载\|今日错题复习：掌握状态\|训练复盘：提前结束\|file URL 支持' test/dual-platform/browser-page.cjs`，9 项通过，含 HTTP、本地 HTML、无 DOM 工厂装配和单次脚本加载验证。 |
| 类型与 lint | 在 `apps/desktop` 运行 `pnpm run typecheck` 与 `pnpm run lint`，均通过。完整检查覆盖 182 个手写 JavaScript 文件。规则夹具 93 项通过，1 项按规则在大小写不敏感的临时目录跳过。 |
| 完整 Node 与浏览器 | `pnpm test` 桌面 287 项通过、1 项环境跳过，共享 515 项通过。`pnpm run test:web-platform` 的 258 项全部通过。 |
| 桌面资源与构建 | `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test` 依次通过。7 个改动的业务脚本的桌面生成文件和 Web 源码 SHA-256 一致，见 `resource-sha256.log`。 |
| WebView2 与 SQLite | `pnpm run test:desktop` 的 61 项全部通过。实际提交同一组 5 道跨库题并重载后，练习和考试各答对 3 道，考试为 6 分，练习沿用原生顶层空分值。核对复盘原题号、来源和原错选，并通过单条记录删除重载、旧数据恢复和分页正文读取等回归。 |

Web 和桌面验收使用隔离配置、自建题库、假凭据和本地模拟服务。改题后的历史快照及收藏清空写失败由浏览器实测，桌面覆盖真实 SQLite 重载、原生按需正文和复盘。正式安装升级仍属于发行验收，第九批记录的有效且尚未 checkpoint 的 WAL 修复专项仍待验证。

### 第十二批 · 首页统计与到期复习

- 负责人为 `batch12_dashboard`（GPT-6.2-Sol Max）。从第十一批冻结的工作树继续，分支为 `codex/web-app-remaining`，工作树为 `C:/Users/30728/.codex/worktrees/31f4/shiroha-quiz-desktop`，`HEAD` 为 `ac4f4c64adc773040eb2b06bf5831003c2803ab0`。`app.js` 由 4,428 行、128 个入口闭包内直接声明的具名函数减至 4,345 行、123 个。
- 首页工厂按当前练习范围读取题库与未掌握错题，使用现有到期队列，重绘时读取当前学习记录。保留本地日期归档、旧缺省日期按当天统计、非空无效日期排除、数字字符串统计、正确率取整和到期按钮文案。练习页、题目编辑器和全局重绘共用同一个统计回调。[首页模块](../../../apps/web/study/dashboard.js)
- 同文档修复后再次启动失败时，原代码仍留有一个上次运行安排的午夜任务。应用重新启动前和失败处理时停用首页实例，清除定时器、可见性监听和复习按钮绑定。初始化重新绑定并重绘后，首页只保留一个下一次本地午夜刷新任务和一个可见性监听。正常恢复点切换继续等待保存队列后重载页面。启动、保存事务、跨页与关闭顺序仍由应用协调，已有练习入口继续负责按需补读原生题目。[应用入口](../../../apps/web/app.js)
- 用可控时钟核对纽约实际夏令时切换日距离下一次本地零点为 23 或 25 小时，以及零点前后队列变化。真实首页按钮验证取消后留在首页、返回保留原轮和答题反馈、再次确认后按当前分组从第一道到期题继续且聚焦作答控件。取消后续大题量确认时，继续按钮接管焦点，继续后焦点回到计时暂停按钮，保留原轮进度。[计时与统计测试](../../../test/dual-platform/dashboard.test.cjs) · [浏览器用例](../../../test/dual-platform/browser-page.cjs)

本批在 Windows 10（19045）、Node 24.22.2、pnpm 12.16.1 和 Rust 1.99.1 上验证。沿用本工作树依赖与编译缓存。生成、生产构建、隔离测试版构建与 WebView2 验收串行执行。两次构建使用进程级 `CARGO_NET_OFFLINE=true`，生产构建通过进程级 `CARGO_TARGET_DIR` 复用缓存。日志位于 `apps/desktop/.reports/batch12/`。

| 验证项 | 实际命令与结果 |
| --- | --- |
| 定向基线 | 根目录用 `node --test` 执行 `due-review.test.cjs`、`source-loading.test.cjs`，17 项通过。用 `--test-name-pattern='今日错题复习'` 运行 `browser-page.cjs`，6 项通过。新增同文档修复用例先失败，启动失败后待执行午夜任务实际为 1，期望为 0。 |
| 迁移后定向 | `node --test` 执行 `dashboard.test.cjs`、`due-review.test.cjs`、`ai-harness.test.cjs`、`source-loading.test.cjs`，124 项通过。首页和本地 HTML 浏览器定向 8 项通过，重复初始化定向另有 1 项通过。 |
| 类型与 lint | 在 `apps/desktop` 运行 `pnpm run typecheck` 和 `pnpm run lint`，通过。完整 lint 覆盖 184 个手写 JavaScript 文件，规则夹具 94 项通过，1 项因临时目录大小写不敏感跳过。 |
| 完整 Node 与浏览器 | `pnpm test` 桌面 288 项通过、1 项环境跳过，共享 518 项通过。`pnpm run test:web-platform` 最终 259 项通过。 |
| 桌面资源与构建 | `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test` 依次通过。`app.js` 和 `study/dashboard.js` 的桌面生成文件与 Web 源码 SHA-256 一致，见 `resource-sha256.log`。 |
| WebView2 与 SQLite | `pnpm run test:desktop` 的 61 项通过，覆盖共享首页资源实际加载、保存队列等待后正常恢复点重载、从恢复点和兼容备份修复损坏库。 |

保留首次失败日志。共享定向初轮的两个 Harness 启动夹具缺少新增工厂，改为加载实际首页模块后仍执行原有启动断言。定向 lint 初轮报新测试的对象属性换行，调整格式后通过。完整浏览器首轮通过 258 项，唯一失败将预期的首页可见性监听解绑与重绑计为重复绑定，现精确断言一次解绑和一次重绑使用同一个回调，同时保留 WebDAV 单面板、单对话框和其他监听未重绑的断言。

Web 和桌面均使用隔离配置、自建题库、假凭据和本地模拟服务。午夜期限和后台恢复可见的时机由受控时钟和浏览器事件验证。桌面覆盖真实 WebView2 和 SQLite 恢复，系统挂起后恢复属于实机专项。
