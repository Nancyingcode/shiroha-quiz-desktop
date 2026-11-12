# codex/shared-project-js-optimization 代码审查报告

- 审查时间：2026-11-11
- 审查对象：`codex/shared-project-js-optimization`，单一提交 `584fbbe refactor(shared): 完成全项目 JavaScript 优化与回归`
- 对比基线：本地 `main`（`49a2007`）；`git merge-base main HEAD` 同为 `49a2007`，分支仅领先一个提交
- 变更规模：53 个文件，+6200/−337。Web 业务 19 个、桌面前端 1 个（`adapter.js`）、桌面脚本与配置 9 个、桌面测试 5 个、仓库级测试 15 个、文档 4 个
- 设计与计划：[全项目规划](../superpowers/specs/2026-11-11-project-javascript-optimization.md)、[AI 导入面板专项](../superpowers/specs/2026-11-11-ai-import-panel-optimization.md)、[实施计划与交接](../superpowers/plans/2026-11-11-project-javascript-optimization.md)、[逐文件清单](../superpowers/plans/2026-11-11-project-javascript-inventory.md)
- 审查方式：`git diff main...分支` 全量只读比对，配合 `adapter.js`、`lint-incremental.mjs`、`smoke-control.mjs`、`bank-page.js`、`exam-page.js`、`saved-questions-page.js`、`training-review-page.js`、`import-preview.js`、`webdav-panel.js`、`text-parser.js` 的关键函数上下文取证，并与 `AGENTS.md` 及两份全局规则（条件判断与状态流转、输出风格）对照
- 未执行：`npm test`、`npm run typecheck`、`npm run lint`、`npm run test:web-platform`、`npm run build`、`npm run test:desktop`、`cargo test`。计划文档记录的批次门禁结果本次未复核，下文所有判断均来自静态阅读

## 1. 总体结论

方向正确。代次（generation）与所有权（owner）守卫贯穿本批核心改动：`import-preview.js` 为三个输入槽位建立独立读取代次，`bank-page.js`、`saved-questions-page.js`、`training-review-page.js`、`exam-page.js` 在异步读取前后比较渲染版本与页面归属，`ai-import-sessions.js` 用请求代次约束迟到回写。`adapter.js` 的索引化改写刻意保留原「题库 ID 重复时 `find` 取首个、`Map` 取末个」语义并写明注释，`lint-incremental.mjs` 把重复扫描 252→163 且保留桌面/平台双配置逐文件比对，都是正确的性能改法而非单纯抄写优化。

但仍有 4 处需要修复后再合入：一处交接记录与 Git 事实直接冲突，两处让异步读取在特定状态下永久不收敛或静默失效，一处把「用户折叠节点」当成整表失效。

| 级别 | 数量 | 结论 |
| --- | --- | --- |
| P1 | 4 | 需修复后合入 |
| P2 | 5 | 行为一致性与工程可维护性，建议同批修复 |
| P3 | 6 | 覆盖、文档结构与历史遗留 |

## 2. P1 缺陷

### P1-1 交接文档记录的 Git 状态与实际不符

位置：[实施计划与交接](../superpowers/plans/2026-11-11-project-javascript-optimization.md) 第 1、4、5 批各节

- 文档多处写明「前四批和本批均保留未提交」「未提交、推送、合并、创建 PR 或发布，也未使用真实用户数据和收费服务」，主协调收尾复核一节还写「分支仍为 `codex/shared-project-js-optimization`，HEAD 未变，无暂存、提交、推送或合并」。
- 实际：`git -C <worktree> status --short` 输出为空，`git log --oneline -3` 只有 `584fbbe`、`49a2007`、`7e7c535`，`git log --oneline main..HEAD` 只有 `584fbbe`，`git diff --stat main...HEAD` 即完整的 53 文件 / +6200 −337。
- 影响：交接记录是本批唯一的证据索引（哪一批做了什么、哪一次门禁对应哪一版代码）。记录与实际提交状态矛盾后，无法判断某条「已验证」结论对应哪个工作树状态，也无法据此决定回滚边界。

建议：以实际提交为准更新交接文档的 Git 段（说明该提交的来源与包含范围），或补齐分批次提交后重述。两者择一，但必须与 `git log`/`git status` 可复核。

复核命令：`git -C <worktree> status --short; git log --oneline main..HEAD; git diff --stat main...HEAD`。

### P1-2 收藏页用对象身份判定读取归属，可能永久停在加载中

位置：`apps/web/saved-questions-page.js` 的 `renderFavoritesPageV596`（新增 `isCurrentRead` 约 :47–49）

```js
const isCurrentRead = () => renderVersion === nativeRenderVersions.get('favorites') && activeBank() === bank
```

- 同文件 `renderWrongBook` 用的是 `activeBank().id === bid`，`bank-page.js` 的 `renderBankPreview` 用的是 `activeBank().id === bank.id`。三处同构守卫只有收藏页用对象引用比较。
- 保存链路（`runMutation` + `save`）会用新的 `state` 快照替换题库对象。若在 `loadNativeItems` 在途期间发生一次其他保存（例如同一页的取消收藏、标记已掌握触发的 `renderAll` 之外的写入路径），`activeBank()` 返回的是新对象，`activeBank() === bank` 恒为假：
  - 失败分支 `if (!isCurrentRead()) return;` 直接返回，错误提示不显示；
  - 成功分支 `if (!isCurrentRead() || !nativeViewVisible('favorites')) return;` 同样返回，表格保持 `:44` 段落写入的「正在加载题目……」与后续被禁用的按钮状态。
- 与设计意图相反：守卫本意是「迟到的旧读取不得覆盖当前页面」，此处却使当前页面的读取永远不被接受。

建议：改为 `activeBank().id === bank.id`，与 `renderWrongBook`、`renderBankPreview` 统一；补一条回归，模拟读取在途时发生一次无重绘的保存，断言表格最终落到题目行而非加载态。

### P1-3 考试文本作答绑定收窄，根节点缺失时静默失效

位置：`apps/web/exam-page.js` 的 `renderExamQuestion`/`bindExamAnswerCardV30` 区域（约 :168–188）

原实现按全卡扫描绑定：

```js
$$('#exam-card .text-answer').forEach((el) => { el.oninput = () => { ... box.dataset.qid ... } });
```

现实现收窄到每题根节点内部：

```js
const box = $(root);                 // root = '#exam-card [data-qid="' + CSS.escape(key) + '"]'
box?.querySelectorAll('.text-answer').forEach((el) => { el.oninput = () => { if (!canEdit()) return; ... } });
```

- 新绑定只在 `box` 非空时成立。只要某题的 `data-qid` 与 `CSS.escape(key)` 拼出的属性选择器不匹配（不同容器结构、属性值被转义成不同形式），该题文本输入完全没有监听器：`session.answers` 不写入，`updateExamAnswerV30` 不触发，答题卡进度停在未答。
- 提交路径 `collectExamTextAnswers`（:33–42）使用同一 `[data-qid=...]` 选择器定位 `box`，因此该题文本答案在 `submitExam` 时同样采不到，属数据正确性问题，不只是 UI 停滞。
- 旧实现不依赖根节点存在；收窄换来了「按题归属」的正确性，但把「定位失败」从可降级变成静默。
- 另：`updateExamAnswerV30`（:210–225）依赖 `renderExamAnswerCardV30`（:207）在拼 HTML 阶段写入的模块级 `examAnswerCard`，并在 `!card || card.owner !== session || !card.box?.isConnected` 时直接 `return`。缓存失效时只静默冻结进度，不报错、不回退到整体重绘。

建议：`box` 缺失或题内无 `.text-answer` 时保留一次全卡兜底绑定（并保持 `canEdit` 守卫）；`updateExamAnswerV30` 在缓存失效时回退到 `refreshExamAnswerCardV30` 等价的重建路径，而不是静默 `return`。补一条「同一 key 出现两次」和「根节点缺失」的定向用例。

### P1-4 训练记录补读把「任一节点被折叠」当成整表失效

位置：`apps/web/training-review-page.js` 的 `renderRecords`（新增守卫约 :140–146）

```js
const openDetails = [...list.querySelectorAll('[data-native-record]')].filter((node) => openIds.includes(node.dataset.nativeRecord));
const isCurrentRead = () => renderVersion === nativeRenderVersions.get('records') && nativeViewVisible('records')
  && openDetails.every((node) => node.isConnected && node.open);
```

- 意图正确（`ontoggle` 可能晚于补读完成，已关闭的节点不能被旧读取重新展开），但 `every` 让「用户折叠了其中一条记录」变成整表失效：`ensureRecords` 返回后直接 `return`，其余记录的新详情一并丢弃，页面停在补读前的状态。
- `openIds` 已按「需要补读的记录」筛选，但 `openDetails` 取的是当前 DOM 中所有已展开节点，二者不是同一集合；`every` 的实际语义是「本次渲染的所有展开节点必须仍然展开」。

建议：把守卫降为逐节点粒度——补读结果仅回填仍 `isConnected && open` 的节点，其余跳过；整表守卫只保留 `renderVersion` 与 `nativeViewVisible`。

## 3. P2 缺陷

### P2-1 text-parser 复用 `eval.localRisk` 依赖不变量未声明

位置：`apps/web/text-parser.js:1931`

```js
const localRisk = primaryHasQuestions ? primary.eval.localRisk : countLocalRepairWarnings(primary.questions || [], profile);
```

`localRisk` 会参与 `localRiskIsLimited` → `localRepairWorthTrying`（:1933–1934）与结构化候选比较（:1959）。只有当 `primary.eval` 确由 `evaluateCandidate`（:1889–1890）在同一 `questions` 与同一 `profile` 上算出时才与重算等价。`primary` 在 :1927 处已被 `{ ...primary, eval: primary.eval || evaluateCandidate(primary) }` 重新包装——该行为说明作者已知 `eval` 可能缺失，但未处理「`eval` 存在却已过期」（候选生成后题集被补题或替换）。

建议：在取用前断言 `eval` 与 `questions` 的同步关系（例如比对 `questions.length` 与评分时的题数），或保留重算并只对已评分的候选走缓存；至少补注释说明该不变量。

### P2-2 lint-incremental 以进程级替换拦截 ESLint 读取

位置：`apps/desktop/scripts/lint-incremental.mjs:147–177`

```js
const originalReadFile = fsPromises.readFile;
const guardedReadFile = async (...args) => { ... await verifyOrdinaryPath(file); ... };
if (!Reflect.set(fsPromises, 'readFile', guardedReadFile)) { throw new Error('无法保护 ESLint 发现阶段读取'); }
try { ... } finally { Reflect.set(fsPromises, 'readFile', originalReadFile); }
```

- 依赖「ESLint 10 通过 `fs.promises.readFile` 读取文件」这一内部实现细节。ESLint 升级改用其他读取路径时，`verifyOrdinaryPath` 不再被调用，链接/非普通文件越界保护静默失效，而 `npm run lint` 仍是绿的。
- 替换目标是 `node:fs/promises` 模块对象，进程内全局；当前只在发现阶段生效并 `finally` 恢复，但任何并发导入 `fsPromises` 的代码都会看到补丁后的函数。
- 注释与探针（同步、回调、流、Promise 四种读取）只覆盖自检，不覆盖「ESLint 真实路径是否变化」。

建议：把探针纳入 `npm test`（构造一次真实 `lintFiles` 读取并断言守卫被调用），并在 ESLint 主版本升级清单中显式登记该依赖；若可行，改用 ESLint 的 `lintFiles` 前置形态或自有文件遍历替代补丁。

### P2-3 smoke-control.shutdown 只上报首个关闭失败

位置：`apps/desktop/scripts/smoke-control.mjs:114–124`

```js
const results = await Promise.allSettled([...children].map((child) => options.stopChild(child)));
const failed = results.find((result) => result.status === 'rejected');
if (failed?.status === 'rejected') { throw new SmokeStopFailedError(failed.reason); }
```

多进程同时关闭失败时只有第一条原因进入 `SmokeStopFailedError`，其余被 `allSettled` 吞掉；`SmokeUnsettledError` 之后也无法再看到那些原因。结合 `reportSmoke`（:50–60）在 `forceExit` 时用 `process.exit(1)`，未 flush 的 stderr 会被截断，现场诊断信息不完整。目录保留策略本身正确。

建议：聚合全部拒绝原因（`reasons.map(...)` 拼进 message，或用 `AggregateError`）；`forceExit` 前 await stdin/stdout flush 后再退出。

### P2-4 题库勾选取消整表重绘后，全选态没有显式同步点

位置：`apps/web/bank-page.js:123–136`（`[data-bank-bulk-v23]` 的 `onchange`）、`:156–164`（`renderBankToolbarV28`）

勾选单个题库后只做 `x.closest('.bank-item')?.classList.toggle('selected-bank-v28', ...)` 与 `renderExportBankSummaryV23()`，不再 `renderBankList()`。方向正确（消除整表重建），但：

- `renderBankToolbarV28` 只重建 `#bank-current-select-v28` 的选项，不涉及题库勾选的全选/半选态；全选态目前只能由 `renderExportBankSummaryV23()` 顺带刷新。
- 若日后汇总区与全选控件拆分，`indeterminate` 会静默失步，且没有任何测试能在不整表重绘的情况下发现它。
- `canSelectExportBanks()` 为假时回滚 `x.checked` 的分支（:125–128）是正确的，但同样不在测试断言范围内。

建议：把「勾选状态 → 全选控件 `checked`/`indeterminate`」提成一个具名函数，由勾选回调与整表渲染共同调用；补定向断言：勾选单个题库后全选区 `checked`/`indeterminate` 正确，`canSelectExportBanks()` 为假时勾选被回滚。

### P2-5 提交粒度与仓库提交规范冲突

位置：整分支

`AGENTS.md` §6 要求「每个提交只包含可独立解释的任务」，分支规划要求多任务场景「各子任务在各自分支独立提交，再合并到整合分支」，并以此保留回滚边界。实际 5 个批次、53 文件、6200 行落在单一提交里：

- 文档声称的 5 批边界（AI 会话 / 页面渲染 / 导入备份 / 工程脚本 / 文档）在历史中不可见；
- 出问题时无法按批回滚，也无法只回退某一批的测试；
- 与 P1-1 叠加后，交接记录与提交历史的对应关系彻底丢失。

建议：按批或按可在 CI 上独立通过的最小单元拆分提交（至少：AI 会话与预览守卫 / 页面渲染局部更新 / 导入与备份 / 工程脚本与 lint 合并 / 文档与清单）。拆分前先修 P1，避免把待修代码固化进历史。

## 4. P3 问题

1. `apps/web/import-preview.js:110–113`：新的 `clearSingle()` 不再经 `clearDual()`，因此清空单文件输入不会失效 `question`/`answer` 两个槽位的在途读取。旧实现没有代次概念，故不构成回归，但两个清空入口语义不再对称，且未加注释说明这是有意为之。建议补一行注释写明「单文件清空只失效单文件槽位，双文件槽位由各自入口负责」。
2. `apps/desktop/frontend/adapter.js:227–230` 的兜底重建分支在当前控制流下不可达：`indexedSnapshot` 与 `baseline` 在 `try` 入口同源，`index` 在 `try` 内必被赋值（或 `baseline` 为 `null` 时两者同时为 `null`），`catch` 分支也不修改 `baseline`；而 `baseline && !index` 在 `baseline` 为真时不可能成立。建议删除该分支，或改为断言，避免读者误以为存在「回执成功后基线已变」的路径。
3. [实施计划与交接](../superpowers/plans/2026-11-11-project-javascript-optimization.md) 超过 300 行，把批次结论、逐条命令、日志路径、红灯/绿灯说明与失效的 Git 状态混排在同一层。建议拆为「交接摘要（状态、门禁结果、未验收项）」与「证据附录（命令、日志、失败记录）」两份，摘要里只保留可复核结论。
4. `apps/desktop/test/lint-dedup.test.mjs`（新增 309 行，已并入 `package.json` 的 `lint:fixtures`）依赖「仅大小写不同的双文件名」场景，在不区分大小写的文件系统上跳过 1 项。需在 Linux CI 上确认该项实际执行，否则去重逻辑的边界只有本地部分覆盖。
5. `apps/web/app.js` 仍有大量单行超长语句（如 `:588–598` 多个 `onclick` 串联绑定），本次改动在其上继续追加。属历史遗留、本次未扩大问题范围，但审查成本已被这批改动显著放大。建议把新增的事件绑定从这些超长行中析出为具名函数，作为后续独立小任务，不在本分支扩散。
6. 计划文档的「未验收」项散落在各批次末尾：真实 AI 调用、真实 WebDAV 与真实 TLS 证书、干净系统安装/升级、最低运行时、真实用户文档、`text-parser` 25 组之外的新增样例、第三批首次 42/44 桌面超时根因。建议在摘要层汇总成可勾选清单，避免合入后无人认领。

## 5. 已核对可信的部分

- `adapter.js` 的 `indexSnapshot` 用 `firstBankQuestions` 保留「重复题库 ID 时回执判断取首个」的原语义，`changes` 的删除/排序判断改用 `Set` 与预先计算的 id 顺序，`put_header`/`put_question`/`question_order` 的产出顺序与旧实现一致；「身份索引仅归本次写入」的注释与作用域相符。
- `webdav-panel.js` 的列表节点缓存（`renderedListV378`/`renderedListContentV378`）与恢复按钮禁用分离：内容不变时保留节点与绑定，`busy` 变化只改 `disabled`，不再整表重写；`onWebdavListClickV378` 析出后两处绑定共用同一处理器。
- `prepare-web.mjs` 复用单一业务脚本列表，`prepare-web-actual.test.mjs` 从真实 Web HTML 反推脚本顺序并与生成结果比对，删除/调换/损坏均能被发现——这是「测试独立于实现」的正确形态。
- `lint-incremental.mjs` 对未跟踪文件、大小写扩展名、Git 索引类型（`100644`/`100755` 之外一律拒绝）、链接祖先的拦截顺序正确，`--complete` 下的双配置比对只在差异文件上补跑，未扩大执行范围。
- `saved-questions-page.js` 的 `preparePracticeNavigation()` 位置正确：位于最后一次 `isCurrentRequest()` 之后、导航前调用，自身代次递增不会把当前请求判成失效。
- `bank-page.js:125` 的 `box.contains(x)` 与 `state.banks.some(...)` 组合守卫，能在 `$$` 全局查询命中容器外节点或题库已删除时回滚勾选，属必要防御。

## 6. 合入前建议

1. 修 P1-1～P1-4，其中 P1-2 是一行级别的修改但影响可用性，优先处理。
2. P2-1、P2-4 各补一条能失败的回归，再改实现，符合仓库「先复现再修复」的要求。
3. P2-5 的提交拆分在 P1 修复后执行，避免把待修代码固化进历史。
4. 本轮所有门禁（`npm test`、`npm run typecheck`、`npm run lint`、`npm run test:web-platform`、`npm run build`、`npm run test:desktop`）需在拆分后的最终代码上重跑并记录实际结果；本文所有「通过」均为计划文档自述，本次未复核。
5. 未验收项（第 4 节第 6 条）建议在合入前登记责任人，或明确标注为后续版本范围。
