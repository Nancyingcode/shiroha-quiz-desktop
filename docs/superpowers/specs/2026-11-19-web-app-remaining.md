# 第六批之后的 app.js 拆分设计

2026-11-19，基线为本地 `main` 的 `ac4f4c6`。建议**第七批先迁题库删除，第八批迁只读导出，第九批再处理备份恢复**。删题与二次编辑已经共用两项操作，可以先固定数据清理的边界。导出能够独立验证桌面正文与旧备份格式，产物再用作恢复的对照输入。[分批实施与验收](../plans/2026-11-19-web-app-remaining.md)

## 基线与终点

入口有 5,349 个物理行，应用闭包内直接声明了 195 个具名函数。前六批已迁出导入查找替换、题目富文本、双文件答案匹配、导入确认保存、题库名称与分组及空库创建、题库复制合并去重。前约 1,300 行已有大量工厂装配。后续以一项业务能否在所属模块修改并通过真实入口验证为完成标准，行数用于比较各批前后差异。[应用入口](../../../apps/web/app.js) · [前六批设计](./2026-11-19-web-directory-app-split.md) · [第六批验收](../plans/2026-11-19-web-bank-question-operations.md)

## 剩余职责与建议归属

下表用基线中的函数名定位。反引号中的新路径均为相对 `apps/web/` 的建议位置。复用现有模块时保留其路径，单纯搬目录可独立核对脚本引用。

| 批次 | 入口现有职责 | 建议归属与调用关系 |
| --- | --- | --- |
| 7 · 题库删除 | `deleteBankQuestions`、`deleteBanksV32`、会话检查、引用清理 | 新增 `banks/deletion.js`。题库页继续拥有分页与题目勾选，编辑器继续拥有编辑草稿和保存事务，两者复用同一删题确认与清理实现。 |
| 8 · 只读导出 | `exportBankById`、`exportCurrentBank`、`exportSelectedBanksV23`、完整 JSON/ZIP、备份文本和学习记录导出 | 建议 `backup/export.js` 处理选定范围、按需读取及输出。跨端题目／题库序列化接已有 `backup-data.js`、`backup-core.js` 和 `questions/rich-content.js`。题库工具栏按现有选择读写同一个集合。 |
| 9 · 备份恢复 | `importBackupJsonFileV23`、`applyBackupImportV23`、`applyNormalizedBackupV378` 与设置页备份控件 | 建议 `backup/restore.js` 共享已归一化数据的应用步骤。本地文件、导入页识别、WebDAV 面板各自负责原有的确认和反馈。WebDAV 配置写入与撤销在此批单独接线，网络请求继续由现有面板与平台执行。 |
| 10 · 练习范围与题目来源 | `ensurePracticeScopeV8916`、两个范围设置器、`practiceSessionItemsForBanksV8916`、来源与范围标签 | 建议 `study/scope.js` 统一解析范围、来源库和本轮题目标识，向题库、练习、考试、首页提供同一结果。组名归一化随本批迁到题库域，导入与备份复用。`practice-selection.js` 继续负责选题与进度。 |
| 11 · 学习数据 | `getWrongEntries`、`addWrong`、`markRight`、`setFavoriteIdsV27`、`trainingSessionItems`、`makeAnswerDetail` | 错题和收藏的更新归 `study/saved-questions.js`。练习和考试共用的记录快照接已有 `training.js`，分步迁。列表展示沿用 `saved-questions-page.js`，复盘和计时沿用现有模块。练习与考试仍通过同一个回调读取界面分值。 |
| 12 · 首页统计与到期复习 | `todayPracticeStats`、`renderStats`、`scheduleDueReviewRefresh`、`startDueReview` | 建议 `study/dashboard.js` 负责本地日期、计数、午夜计时器、恢复可见和开始复习。直接使用现有到期队列与练习入口。 |
| 13 · 内置题库 | `defaultBank`、`loadBuiltInBankV252`、加载按钮与状态 | 建议 `banks/built-in.js` 负责资源查找、占位题库与手动加载。启动和恢复继续通过 `ensureDefaultBank` 决定是否补库。`question-bank.js` 保留本地 HTML 的数据入口。 |
| 14 · 导入识别与 OCR 输出 | `bindImportControls`、`parseImport`、`parseDualImport`、目标控件、文件名、表格预览、OCR 回填与 DOCX 输出 | 建议 `import/page.js` 编排从控件到草稿的操作，OCR 输出可单独在 `import/ocr-output.js` 完成。读取与草稿沿用原实例，匹配与保存复用第三、四批模块。导入 AI 的选区上下文和匿名题目键交给既有导入会话，由提示词和面板共享。 |
| 15 · AI 设置与连接 | `saveAiSettingsV99`、`clearAiSettingsV99`、`testAiConnectionV99` | 建议 `ai/settings-actions.js` 调用现有设置、传输、凭据与 Harness 接口。设置面板负责表单，应用入口向设置和关闭守卫提供同一项任务忙碌判断。 |
| 16 · AI 单题解析写回 | `saveAiSingleAnalysisV613`、`aiSingleWithAnalysisV613`、`reviewAnalysisSource` | 建议 `ai/analysis-save.js` 负责来源校验、人工确认、题目副本同步和写入失败后的草稿。练习、复盘请求仍由既有会话负责。 |
| 17 · 共享列表与界面收尾 | `nativePage`、`renderNativePageActions`、侧栏折叠、专注栏定位 | 分页控件为 Web 和桌面共用，建议提到 `ui/pagination.js`。侧栏和专注栏如仍需在入口处理布局细节，再独立迁到 `ui/shell.js`。全局导航调用这些控件。 |

实施按表中顺序串行修改入口。其中，第 8 批产物供第 9 批验证，第 10 批的范围与来源标识供第 11、12 批使用，第 14 批通过第 9 批提供的合并入口处理备份 JSON。内置库、OCR 输出和 AI 设置分别有独立入口，调整它们的时间不会改变这些依赖。

## 三处需要共同维护的状态

**删除目标与选择。** 单题和批量删题按库 ID 与题 ID 定位，进入事务前补读目标库，检查未完成练习和未交卷考试是否占用题目。编辑器移除原题时复用这项检查。清理限于该库的错题（含旧字符串条目）、收藏和收藏元信息，历史成绩快照保留。整库删除按库 ID 清理，现有流程使用摘要，若删去活动库则选择余下首库，若删空则写入 `suppressDefaultBank`。删题的会话拦截属于题目操作。勾选的库同时供导出与整库删除使用，`runMutation` 单独备份、恢复这个 Set，所有调用方须读取同一份当前选择。[题库页](../../../apps/web/bank-page.js) · [编辑器](../../../apps/web/bank-editor.js) · [应用事务](../../../apps/web/app.js)

**预读对象与实际输出。** 卡片导出按显式 ID 读取。当前库导出和勾选导出会在 `await loadNativeBanks(...)` 前后分别读取活动库或选择集合。删题的通用失败重试也值得核对，因为切页可释放之前加载的正文。这两条都是从源码定位的待复验窗口。实施时先延迟原生读取或注入一次写失败，分别检查实际导出文件、重新加载后的 SQLite 内容，再决定修正。若确实导出到未预读的新目标，建议中止本次输出并提示重新导出。[现有预读重试实现](../../../apps/web/banks/question-operations.js) · [桌面多页夹具](../../../apps/desktop/scripts/bank-operations-smoke.mjs)

**恢复与写入结果。** 本地覆盖由本地入口确认。WebDAV 在面板确认后进入事务。导入页识别到多库备份时确认合并。覆盖步骤依次为完整读取、创建可用的原生恢复点、取消 Harness、按平台处理凭据、替换和升级业务数据、保存。旧 Android 备份缺少 Web 设置时沿用原设置。内存回滚、原生凭据操作与存储修订各有结果，测试分别核对。正常恢复点切换需要等保存队列空闲再重载。数据库损坏时还要能在应用尚未就绪时修复并重新启动。[归档读写](../../../apps/web/backup-archive.js) · [备份转换](../../../apps/web/backup-data.js) · [WebDAV 面板](../../../apps/web/webdav-panel.js)

## 最终留在应用入口的工作

- **应用装配与生命周期。** `startApplication`、`init`、全局重绘、加载与升级快照、默认库策略、恢复重入和唯一启动点。工厂按现有经典脚本顺序创建。编辑器保存草稿等回调仍在实际调用时取得稍后创建的实例。
- **共享写入与原生读取。** `readNative` 追踪在途读取，`runMutation` 等待这些读取并协调修订、回滚、保存队列、重试、焦点和会话计时器。业务提供需要重新预读的重试入口。页面可以拥有页码和控件，切页时仍由应用统一决定何时释放题目，并保留在练、在考的题目。
- **跨页与关闭。** 保留手动导航和程序切页的确认、取消、专注状态切换，以及 Web 关闭提示、桌面 `canClose` 和损坏恢复入口。日期、格式化、复制与通知等多处使用的小函数按调用关系保留或注入。等各批完成，再按真实调用面决定是否值得移动最后的装配代码。

当入口能读出启动、装配、切页、数据写入和关闭的先后顺序，且上表业务可以从各自模块独立修改和验证，本轮即可收尾。[源码加载验证](../../../test/dual-platform/source-loading.test.cjs) · [退出守卫回归](../../../test/dual-platform/exit.test.cjs)
