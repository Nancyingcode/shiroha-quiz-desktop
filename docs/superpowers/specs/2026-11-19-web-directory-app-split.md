# Web 目录整理与 app.js 第二阶段拆分设计

2026-11-19。前三批的起始基线为 `faea738`。查找替换、题目富文本和双文件答案匹配均已合入本地 `main`。在 `359e1d3` 上复查后，建议第四批先拆导入确认保存，见[第四批范围与验收](#batch-four)。

## 现状与目标

[上轮设计](./2026-11-05-web-app-js-split.md)和[八批实施记录](../plans/2026-11-08-web-app-js-split.md)已经覆盖解析器、文档读取、AI 会话、备份转换以及练习和考试页面。在起始基线 `faea738` 上，[app.js](../../../apps/web/app.js) 有 6,337 个物理行，应用闭包内有 243 条直接具名函数声明。当时展开控制块与语句的提交就净增了 1,670 行。评估下一轮时，行数只作参考，更值得看的是改一个功能还要跨几个文件、入口是否仍持有该功能的私有实现。

当前入口里混合了三种工作。前约 1,200 行已包含大量工厂装配。中段仍直接实现查找替换、答案匹配、富文本和图片处理。后段同时协调页面操作、持久化事务、故障恢复和窗口关闭。目标是从入口读得出应用如何启动、各页如何连接、何时可以安全写入和退出。查找词怎样匹配、图片如何排序等问题，应当能直接在所属模块找到答案。

## 目录怎么调

仓库顶层按交付物划分已经清楚。共享业务归 `apps/web/`，桌面宿主、资源生成、Rust 和 SQLite 归 `apps/desktop/`。根 `test/` 放 Web 与双端场景，`apps/desktop/test/` 放桌面工程专项。根 `assets/` 放宣传素材，运行时媒体归 `apps/web/media/`。这轮优先整理 Web 根目录，目前这里平铺着 34 个 JavaScript 文件。参见[仓库结构](../../../README.md)。

| 建议位置（相对 `apps/web/`） | 放什么 | 何时整理 |
| --- | --- | --- |
| 根目录 | 保留 `index.html`、`app.js`、样式入口及 `question-bank.js`。后者是直接打开 HTML 时内置题库的本地兜底。 | 入口位置稳定，供 Web、Pages 与桌面生成器共同使用。 |
| `import/` | 查找替换、导入预览、格式读取、双文件合并。 | 首批只放 `find-replace.js`。已有 `import-preview.js`、`docx-import.js` 等待实际整理该组时单独移动。 |
| `questions/` | 题目内容的跨页面表示与展示，例如富文本、内嵌图片和已有的 `question-view.js`。 | 第二批新建 `rich-content.js`。显示逻辑继续由题目视图负责，跨端备份字段由备份模块负责。 |
| `banks/`、`study/` | 前者放题库列表、编辑与管理操作，后者放练习、考试、错题、收藏和复盘。 | 对应业务进入拆分时，先接现有 `bank-editor.js`、`practice-page.js`、`exam-page.js`、`study-sessions.js`。 |
| `ai/`、`backup/` | 前者放现有 AI 设置、请求、会话与面板。后者放备份转换、归档与 WebDAV 备份面板。 | 同一业务内分批归位。通用 ZIP 由文档导入与备份共用，仍作为两者的底层依赖。 |

现有 `platform/` 继续定义平台接口，`libs/`、`data/`、`media/`、`styles/` 各自维护对应资源。桌面 `dist/` 由生成器写入。新增目录随第一个有明确归属的模块建立。已有模块单纯改路径时，单独核对内容一致性和引用，便于把加载问题定位到那一次移动。

## 拆分顺序与验收

下表行号对应 `faea738`。每批先以现有输入固定输出或界面行为，再迁移实现及其调用者，接通同批测试。原实现和业务注释随模块迁移，每条规则保留一个维护位置。

| 顺序 | 从入口迁出什么 | 迁移完成的判断 |
| --- | --- | --- |
| 1 · 导入查找替换 | 第 2797–3077 行，含 `buildFindRegExpV51`、面板和查找／替换操作。落在 `import/find-replace.js`。导入页按钮只接“打开”，模块复用正则转义，并通过一次编辑通知清理旧表格结果、发出原有冒泡 `input`。 | 用真实按钮检查普通文本、正则捕获组、拒绝匹配空串的规则、从末尾回绕、全部替换及无命中。编辑后草稿能感知更改，旧表格预览失效。现有[表达式测试](../../../test/dual-platform/business.test.cjs)继续覆盖底层规则。 |
| 2 · 题目富文本和图片 | 第 3971–4227 行，从 `pickRichTextFieldV57` 到 `exportQuestionImagesForCrossExportV83`。把与题目内容有关的计算交给 `questions/rich-content.js`，由文本解析、渲染和备份复用。第 2661 行的序列化函数作为调用方，继续决定导出字段形态。 | 同一题在解析、预览、导出后保留公式、题干图片顺序和去重结果。长文本截断保留完整图片。分别比对 `images: []`、缺少字段和无效非空数组，并确认源题未被改写。参见[空图片兼容样例](../../../test/dual-platform/backup-serialization-empty.test.cjs)。 |
| 3 · 双文件答案匹配 | 第 3372–3579 行的候选评分、去重、按顺序／题号／分组匹配，归入 `import/dual-answers.js`。复用已有 `text-answers.js` 的答案表解析和 `findNumberedAnswer`。第 1217 行的 `parseTextQuestions` 会写草稿报告与诊断，完整题库解析兜底和预览更新由导入流程按原顺序驱动。 | 对同一对题目、答案文件比对题序、逐题答案、警告和自动选择的匹配方式。覆盖跨题型重号、缺答、数量不等、解析兜底及原题完整性。参见[答案表规则](../../../apps/web/text-answers.js)与[双文件样例](../../../test/dual-platform/fixtures/dual-answers.txt)。 |

**前三批之后按实际维护成本选做。** 优先选下一处仍要反复编辑入口才能完成的业务，逐项验收。

| 后续候选 | 迁移边界 | 必须守住的行为 |
| --- | --- | --- |
| 导入保存与题库管理 | 将 `bindImportControls`、`confirmImport` 的导入侧编排，以及重命名、复制、合并等题库命令分开归位。复用现有草稿和题库编辑会话。 | 文件重选、恢复草稿后旧响应失效。追加或新增保存失败时原数据与可重试草稿都还在。题库与关联错题、收藏通过同一事务修改。 |
| 学习与首页 | 把练习范围、错题排期和首页统计交给实际使用它们的模块。把首页午夜刷新、可见性监听及重入时的去重放在一起。 | 两个题库含同号题时来源独立。跨本地零点后统计刷新一次，恢复重入后计时器和事件订阅数量稳定。 |
| 备份与 AI 操作 | 将导出选择面板归入备份业务，维持归档与数据转换的现有分工。将 AI 设置操作与单题解析保存分别交给对应的设置和题目会话。 | 桌面导出先补齐原生正文。旧 Android JSON/ZIP 往返保留学习数据与图片。换题或恢复后拒绝迟到 AI 结果，凭据写入失败可回滚。 |

<a id="batch-four"></a>

## 第四批优先拆导入确认保存

2026-11-19 复查本地 `main` 的 `359e1d3`。前三批分别迁出了[查找替换](../plans/2026-11-19-web-import-find-replace.md)、[富文本和图片](../plans/2026-11-19-web-question-rich-content.md)、[双文件答案匹配](../plans/2026-11-19-web-dual-answers.md)。入口还剩 5,643 行，应用闭包内直接声明了 208 个具名函数。以下行号均对应这次复查。

| 候选 | 入口仍承担的职责 | 排序依据 |
| --- | --- | --- |
| 导入确认保存 | `confirmImport` 和 `appendImportToBankV5911` 编排编辑分流、新建、追加、保存提示及失败恢复。单文件和双文件在第 1740、1748 行绑定同一个确认入口。 | 两个真实按钮即可覆盖整个提交边界。预览、草稿持久化和二次编辑均已有所有者，适合先迁这一组。 |
| 题库管理 | 列表、分页预览归[题库页面](../../../apps/web/bank-page.js)，二次编辑归[题库编辑器](../../../apps/web/bank-editor.js)。入口还处理改名、新建、复制、合并、去重、删题和整库删除。 | 后续先考虑改名（含分组）与新建空库，两者都无需补读题目正文。复制、合并、去重需要桌面正文。删题与编辑器共用练习／考试保护；删库还会清理错题、收藏元信息和导出选择，并处理删空后的重启。 |

首页统计与到期刷新、练习范围、备份导出与恢复、AI 设置和单题解析保存也仍在入口。第四批之后再按业务分别评估。启动恢复、导航、原生读取协调、全局事务和关闭守卫继续由入口统筹。[应用入口](../../../apps/web/app.js)

### 迁移边界

- 建议新增 `apps/web/import/commit.js`，通过项目现有的经典脚本工厂公开一个确认操作。从入口第 3146–3347 行迁出两个按钮的忙碌反馈、绘制等待、导入失败提示和新建／追加编排。第 41 行的忙碌标记随该工厂实例保存。字符串超限判定也供 WebDAV 使用，由入口注入同一实现。[应用入口](../../../apps/web/app.js) · [WebDAV 面板](../../../apps/web/webdav-panel.js)
- `bindImportControls` 只调整两处确认按钮的接线。文件读取、OCR、AI、识别及预览继续走现有入口。确认时先检查题库编辑会话，有会话就委托 `saveBankEditSessionV45`。直接使用当前导入草稿，在编辑器与草稿持久化实例就绪后装配保存模块。[题库编辑器](../../../apps/web/bank-editor.js) · [导入草稿](../../../apps/web/import-preview.js)
- 模块借用 `loadNativeBanks`、`runMutation`、`saveSilent` 和切换练习范围的既有操作。事务前预读点击时选中的目标题库，事务内复核保存方式、目标和编辑会话。新建与追加都由同一层应用事务协调。保存失败时局部代码恢复目标数据并提示用户，`saveSilent` 记录的错误仍交给外层按存储修订决定回滚或提示重开。成功后先重绘，再调用 `importDraftPersistence.imported()`，只清理本页拥有、内容一致且修订匹配的 IndexedDB 草稿。[事务与保存实现](../../../apps/web/app.js) · [草稿清理实现](../../../apps/web/import-preview.js)

### 实施前先固定的行为

1. **新建与编辑分流。** 从单文件和双文件的真实确认按钮入库，重载核对题目、答案、顺序、活动库和练习范围。在已有题库的二次编辑中用同一确认入口保存，只更新被编辑的库。复用[双文件与离线页面回归](../../../test/dual-platform/browser-page.cjs)和[草稿回归](../../../test/dual-platform/import-draft-page.test.cjs)。
2. **有效目标追加。** 用含原题的目标库，延迟桌面正文读取与存储写入。核对原题正文和 ID、追加题的新 ID 和续编号，再交错触发两个确认按钮，重载后应只有一份新增题。另测原生读取失败时不写入。现有“恢复草稿后目标已消失”用例只覆盖未选择有效目标的分支。
3. **保存失败与重试。** 对新建、追加分别注入写入失败。核对题库内容、更新时间、活动库、练习范围、预览和已存草稿，两个按钮恢复原文字和可用状态。解除故障后重试，只提交一次。补测存储修订已推进、后续重绘出错时已入库的数据仍在。[草稿写入失败用例](../../../test/dual-platform/import-draft-page.test.cjs) · [存储队列回归](../../../test/dual-platform/browser-storage.test.cjs)
4. **追加目标在等待期间变化。** 旧实现预读目标 A 的正文后再次读取控件。若在等待期间改选 B，旧确认传给保存回调的是 B。隔离 WebView2 复验确认 SQLite 中 A 仍为一题，B 从一题变成两题。第四批修复会在选择变化时提示重新确认，再按新目标补读。[实施记录](../plans/2026-11-19-web-import-commit.md)

实现时在 [HTML](../../../apps/web/index.html)、[桌面业务脚本清单](../../../apps/desktop/scripts/prepare-web.mjs)、[共享测试桥接](../../../test/dual-platform/web-source.cjs)、[加载顺序回归](../../../test/dual-platform/source-loading.test.cjs)与 ESLint 文件规则里接入新路径。首批已实现按文件登记父目录；用[桌面资源回归](../../../apps/desktop/test/prepare-web-actual.test.mjs)核对生成字节与加载顺序。先运行上述定向回归，再在 `apps/desktop` 执行 `pnpm run typecheck`、`pnpm run lint`、`pnpm test`、`pnpm run test:web-platform`。串行执行 `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test`、`pnpm run test:desktop`，用 HTTP、本地 HTML 和隔离 WebView2 制品验证入库后重载。

## app.js 最后负责什么

- **创建并连接模块。** 沿用本地经典脚本和现有的 `Shiroha*.create(...)` 工厂。一个业务域的工厂参数已能收敛为少数对外操作时，再把域内装配放回该域。举例说，题目编辑器通过回调保存草稿，而 `importDraftPersistence` 在编辑器之后才创建。工厂创建时提前读取它会导致启动失败。依赖应显式传递，回调仍在实际操作时取值。
- **启动、恢复与导航。** 集中保留 `startApplication`、全局视图切换、离页取消和关闭守卫。恢复会重新初始化页面，上一轮的 AI、原生分页和文件读取结果须在原来的检查点判断是否仍有效。入口完成全部装配后首次启动一次。
- **协调持久化写入。** `runMutation` 会等待在途原生读取，保存前记录存储修订、原状态对象、练习和考试会话以及当前选择。保存失败且修订尚未前移时恢复原引用、相关计时器与焦点。修订已前移则保留已保存数据。各业务通过这个入口提交，页面私有状态由所属会话持有。

每批完成后记录入口剩余的直接具名函数、消失的私有实现，以及仍需跨域的回调。一个功能已能在所属目录独立修改并从真实按钮验证，即可结束该批。全局协调逻辑可以保留它解释时序所需的篇幅。

## 脚本搬到子目录时如何验证

1. **Web 和离线。** Pages 直接发布 `apps/web/`。在 [index.html](../../../apps/web/index.html) 按依赖顺序加载本地经典脚本，业务入口排在最后。验证 HTTP 和 `file://` 两条路径，覆盖直接打开页面、启动和本次迁出的交互。[Pages 工作流](../../../.github/workflows/pages.yml) · [浏览器回归](../../../test/dual-platform/browser-page.cjs)
2. **桌面制品。** [prepare-web.mjs](../../../apps/desktop/scripts/prepare-web.mjs) 的 `businessScripts` 会参与源文件存在性检查，但 `collectAssets` 按路径的第一段筛选，且要求父目录已登记。只把 `import/find-replace.js` 写进数组，会出现源检查通过、生成内容漏文件。首批同步登记所需父目录并按具体脚本筛选，保留路径与链接校验。用[实际制品回归](../../../apps/desktop/test/prepare-web-actual.test.mjs)检查 Web 与桌面的模块字节、顺序和桥接注入位置，再从 WebView2 打开功能。
3. **测试与 lint。** [共享测试桥接](../../../test/dual-platform/web-source.cjs)列出脚本及闭包内函数，[源码加载测试](../../../test/dual-platform/source-loading.test.cjs)还验证唯一启动点。迁移时将相关断言接到真实模块，并核查直接按源码区段取函数的测试。新路径承接该段实现原有的文件级规则，例如 `app.js` 的每行单语句和控制块排版。原文件改名时同批更新 [ESLint 配置](../../../apps/desktop/eslint.rules.mjs)、检查脚本中的路径和对应试点断言。
4. **执行顺序。** 首批先跑根目录的 `node --test test/dual-platform/business.test.cjs test/dual-platform/source-loading.test.cjs` 和新面板回归。在 `apps/desktop` 跑 `pnpm run typecheck`、`pnpm run lint`、`pnpm test`、`pnpm run test:web-platform`。涉及资源时串行执行 `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test`、`pnpm run test:desktop`。后续按范围追加 `pnpm run test:documents`、根目录的单题 AI 或 WebDAV mock 回归。测试副本与真实制品分别验证业务等价和资源接线。

第一批可独立交付。若新脚本在离线或桌面入口缺失，先修正该批的清单与测试，再推广目录结构。
