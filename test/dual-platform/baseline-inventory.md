# 阶段 A1：调用点与性能基线登记

登记日期：2026-10-23。依据[双端实施计划](../../docs/superpowers/plans/2026-10-23-web-desktop-dual-platform.md)的 A1，供 B—E 阶段逐项迁移和回归使用。

本文件记录当前源码语义和测量协议，不代表这里列出的缺陷已经修复。环境版本、实际命令结果和测量值由[阶段 A 验证记录](./README.md)登记。源码锚点以本次未修改的 `apps/web/app.js` 为准，SHA-256 为 `f690f30287054a65ac123e58005de3702b850db5107056d4235f8021295f63cb`；后续代码移动时，以函数和控件名称重新定位并更新行号。

## 1. 盘点范围与复核方法

范围是 `apps/web` 手写业务代码、HTML 文件入口和 `apps/desktop/src-tauri` 的关闭边界；第三方 `libs` 内的 fetch/缓存实现不当作业务调用点，PDF/OCR Worker 的资源加载另列。桌面 `dist` 是生成物，不重复盘点。当前未发现自有业务代码中的 `beforeunload`、`pagehide`、`visibilitychange`、`window.close` 或 Tauri `CloseRequested` 拦截。

在仓库根目录复核：

```powershell
rg -n 'saveSilent\(|saveState\(|localStorage|sessionStorage|fetch\(|XMLHttpRequest' apps/web/app.js
rg -n 'files\[|createObjectURL|download\(|downloadBlob\(|location\.reload|beforeunload|pagehide|visibilitychange|window\.close' apps/web/app.js
rg -n 'type="file"' apps/web/index.html
rg -n 'CloseRequested|on_window_event|onCloseRequested' apps/desktop/src-tauri
```

`saveSilent()` 共 **31 个调用表达式**，分布在 29 行；简答自评和错题操作各有两个同一行调用。`saveState()` 由“保存全部”按钮引用一次。两个包装器均把整个 `state` 同步序列化写到同一个主键，不是增量保存，也没有修订号或提交队列。

以下表格的“未捕获”指当前调用链没有面向用户的保存异常处理。同步 `setItem` 抛错会中止后面的成功提示/刷新，但此前内存和部分界面可能已经改变；不能据此推断已经持久化。未来异步适配如果只把包装器改成 `async`，会进一步让这些路径提前提示成功。

后续测试归属使用任务编号和测试类别；除明确标记“已有”者外，均是 B—E 待新增验证，不声称阶段 A 已执行。A2 的业务/格式特征测试只证明已有逻辑，不能代替各按钮的延迟、失败和重试测试。

## 2. 主状态保存调用清单

所有行号指向 [Web 业务源码](../../apps/web/app.js)。数据范围列说明本次业务修改；实际写入仍是整包主状态。

| 编号 | 函数 / 控件（行） | 修改范围与当前成功语义 | 当前失败语义 | 后续任务 / 测试归属 |
| --- | --- | --- | --- | --- |
| S00 | `saveState`（50），`bindEvents` 的 `save-all-btn`（161） | 整包；写入完成后提示“已保存到浏览器本地” | 未捕获；没有统一失败提示 | B3/B5，手动保存、quota、重复点击 |
| S01 | `bindEvents` 的 `active-bank-select`（161） | 当前题库、练习范围；保存后刷新 | 内存先变；未捕获 | B3，设置/选择顺序与失败 |
| S02 | `bindEvents` 的 `clear-wrong-btn`（166） | 当前题库错题数组；确认后清空并刷新 | 内存先清空；未捕获 | B3，错题清空失败保全 |
| S03 | `bindEvents` 的 `clear-records-btn`（167） | 全部练习/考试记录；确认后清空并刷新 | 内存先清空；未捕获 | B3，记录清空失败保全 |
| S04 | `saveAiSettingsV99`（356） | AI 非敏感配置；独立 Key 写入后保存主状态，再提示成功 | 主状态失败会恢复旧配置，并尽力恢复两种 Key；恢复写入结果未检查。主 Key 写入失败发生在内层回滚之前，已改的内存配置不会回滚 | B3/B4/D2，配置与凭据分步失败、记住状态切换 |
| S05 | `clearAiSettingsV99`（368） | 默认 AI 配置，先删除两个 Key；保存后提示清除 | Key 删除返回值被忽略；主状态失败有警告，但已改内存/已删 Key 不回滚 | B3/B4/D2，清除/删除失败 |
| S06 | `renderBankList` 的 `data-openbank`（1078） | 当前题库、练习范围；保存后刷新 | 内存先变；未捕获 | B3，选择顺序与失败 |
| S07 | `renderBankList` 的 `data-practice-group-v8916`（1079） | 分组练习范围；保存后刷新和成功提示 | 内存先变；未捕获 | B3，分组切换失败 |
| S08 | `savePracticeEditQuestionV120`（6868） | 来源题目、题库更新时间、当前练习题对象；保存后刷新并提示 | 来源题目和练习引用已替换；未捕获。编辑会话尚在，但内存旧值未恢复 | B3，题目编辑失败保草稿、延迟期间第二次编辑 |
| S09 | `appendImportToBankV5911`（6927） | 追加题目、更新时间、题库选择/范围；忙碌按钮防重入，写入后提示追加成功 | 同步异常恢复原题目数组、时间和选择/范围，保留导入预览，恢复按钮 | B3/C6，追加 quota、序列化失败、排他/交错保存 |
| S10 | `confirmImport`（6972） | 新题库、题库选择/范围；忙碌按钮防重入，写入后提示导入成功 | 同步异常恢复原题库数组和选择/范围，保留预览/识别报告 | B3/C6，新增导入失败保全与重复点击 |
| S11 | `renameActiveBank`（6991） | 名称、分组、更新时间、可能调整练习范围；保存后刷新 | 已改内存且清空名称输入，可能已提示范围切换；未捕获 | B3，重命名/分组失败、保留输入 |
| S12 | `duplicateBankById`（6993） | 克隆题库、新题目 ID、选中副本；保存后刷新 | 副本已进入内存；未捕获 | B3，复制失败/重试不重复新增 |
| S13 | `newEmptyBank`（6994） | 新建空库、选择/范围；保存后刷新 | 内存已新增；未捕获 | B3，空库新增失败/重试 |
| S14 | `mergeBankIntoActive`（6995） | 目标库题目、更新时间；按题干去重，保存后显示合并数量 | 合并已修改目标数组；未捕获，无局部回滚 | B3，合并失败/重复执行 |
| S15 | `dedupeActiveBank`（6998） | 当前题库题目与重新编号；保存后显示删除数量 | 内存已去重；未捕获 | B3，去重失败保全 |
| S16 | `finishPractice`（7496） | 条件性追加记录、练习进度；保存后退出或显示结果 | 记录/进度先变，AI 会话已重置；未捕获，重复调用可能追加重复记录 | B3，结束/退出练习失败重试、计数只提交一次 |
| S17 | `ensureBankManageExportPanelV23` 的 `bank-current-select-v28`（7592） | 当前题库 ID；保存后刷新 | 内存先变；未捕获 | B3，管理页选择与练习范围一致性 |
| S18 | `deleteBanksV32`（7699） | 删除题库、对应错题/收藏/收藏元信息；调整选择/范围，最后一库删除设置 `suppressDefaultBank=true`，历史记录保留 | 内存先删除，导出选择也已删除；未捕获 | B2/B3/C8，最后一库重启仍空、删除失败、历史仍可读 |
| S19 | `loadBuiltInBankV252`（7852） | 新增/替换默认库、清除默认库抑制、选择/范围；保存后提示成功 | 外层捕获并提示失败，但已经修改的内存题库不回滚 | B2/B3，内置资源失败与持久化失败区分 |
| S20 | `submitPractice`（8022） | 客观题回答状态、统计、错题；揭示答案也调用保存 | 答题状态/反馈先变；未捕获，内存 answered 防重不能证明持久化成功 | B3，答题失败/重试不重复计数；已有 AI 用例覆盖正常答题 |
| S21 | `showSubjectiveFeedback` 的 `p-self-right`（8024） | 简答自评正确、计数和错题；保存后重绘 | 两个自评按钮在写入前禁用；未捕获 | B3，简答自评正确失败重试 |
| S22 | `showSubjectiveFeedback` 的 `p-self-wrong`（8024） | 简答自评错误、计数和错题；保存后重绘 | 同上 | B3，简答自评错误失败重试 |
| S23 | `saveAiSingleAnalysisV613`（8235） | 来源解析及富内容、练习引用、错题/收藏快照解析；确认替换后保存 | 按局部补丁逆序恢复内存，保留 AI 草稿并显示失败；当前只对同步错误有效 | B3/D3；已有 `quota-save-rolls-back-memory-storage-and-preserves-draft`，需补延迟/之后编辑隔离 |
| S24 | `toggleFavoriteV27`（8247） | 指定题库的收藏 ID；保存后提示收藏/取消 | 收藏先变；未捕获 | B3，收藏与取消失败重试 |
| S25 | `clearCurrentFavoritesV596`（8251） | 当前题库全部收藏；确认后保存、刷新、提示清空 | 内存先清空；未捕获 | B3，清空收藏失败保全 |
| S26 | `renderWrongBook` 的 `data-remove-wrong`（8271） | 当前题库单题移出错题本；确认后保存、刷新 | 内存先变；未捕获 | B3，移出失败保全 |
| S27 | `renderWrongBook` 的 `data-toggle-master-wrong`（8271） | 掌握状态、正确次数/时间；保存后刷新 | 内存先变；未捕获 | B3，掌握状态失败重试 |
| S28 | `importBackupJsonFileV23`（8626） | 全量覆盖或合并题库/错题/收藏/记录/设置/跨端元信息；写入后提示完成并清文件输入 | 同步写入失败恢复整包旧内存并 `upgradeState`；所有错误被描述为容量不足。失败也清文件输入，原预览文本仍在 | B3/C6，恢复排他、错误分类、富字段/快照保全 |
| S29 | `applyNormalizedBackupV378`（8841） | WebDAV 已验证包的覆盖/合并；调用者成功后关闭确认框、刷新并提示恢复完成 | 先序列化旧状态；失败整包回滚、升级并抛出，外层显示失败；确认数据未清除 | B3/C6/D4，远程恢复失败/交错编辑、保留确认数据 |
| S30 | `submitExam`（9000） | 考试结果、错题、明细/分题型成绩；写入后显示已交卷 | 写入前已 `submitted=true`、停计时、修改错题并插入记录；失败未捕获，下次提交被开头直接拒绝 | B3，考试提交失败可重试、重复/自动交卷只一条记录 |
| S31 | `saveBankEditSessionV45`（9099） | 原库名称/分组/时间/全部题目，可能调整范围；写入后才清会话、选择/报告并离开编辑 | 会话/预览仍在，题库对象已修改；未捕获 | B3，二次编辑失败保草稿、异步期间再编辑 |

预览编辑的 `saveEditQuestion`（6825）只更新 `importCache`，其“已保存”表示预览草稿，不写主存储。题库二次编辑最终由 S31 提交，刷题编辑由 S08 提交；B3 不应误把预览的逐题修改变成即时入库。

## 3. 直接存储、凭据与启动

| 入口（源码行） | 数据范围 / 当前语义 | 失败与后续归属 |
| --- | --- | --- |
| `loadState`（27—35），顶层 `state=loadState()`（21） | 主键 `shiroha_quiz_state_v28_4_c1`，当前旧键列表为空；JSON 成功后 `migrateState` | `getItem` 在 try 外，访问拒绝可中断启动；解析错误只警告后返回空状态。B2 startup：损坏原值保全、过新版本、延迟加载禁写 |
| `saveState`（50）、`saveSilent`（187）、`serializeState`（7802） | 整包 JSON；含 schemaVersion 与 favorites | 同步抛错；没有写入 revision 或操作 ID。B3 save-queue：冻结、顺序、暂停、查询未知结果 |
| `clearStoredState`（49）、`resetData`（9012） | 主键、两个历史清理键、AI Key、独立 WebDAV 配置/密码；确认后重新加载页面 | 每个删除失败被吞掉，仍 reload；侧栏键不在清理列表。B2/B3：重置成功与“删最后题库”分开；失败不得刷新或假报清除 |
| `safeStorageGetV99` / `safeStorageSetV99`（202—203） | AI Key 的 local/session storage 包装 | 读取失败当空值，写入/删除失败返回 false；调用者部分忽略。B4/D2：明确失败，凭据状态独立 |
| `readStoredAiKeyV99`（204—206） | 按 `rememberKey` 选择持久或会话明文 | 读取调用者：诊断脱敏（252）、设置表单回填（344）、批量审查/解析（793）、AI 重构（834）、单题配置（8117）。B4/D2/D3：秘密读取收进平台内部，页面只读配置状态 |
| `writeStoredAiKeyV99`（208—214） | 写目标存储后删另一副本 | 目标失败返回 false；旧副本删除失败被忽略。S04 另读两个旧值（350—351）并尝试回滚（356），S05 直接删除（367）。B4/D2：记住切换、部分成功、补偿失败 |
| `readWebdavConfigV378`（8639—8641） | 独立 `shiroha_webdav_config_local_v378` 配置/最近上传摘要 | 读取/JSON 错误都返回默认配置。B2/B4/C7：独立配置迁移，不把不可读当未配置 |
| `readWebdavPasswordV378`（8643—8645） | 根据 rememberPassword 读 local/session 密码 | 错误当空；`fillWebdavFormV378`（8682）明文回填表单，操作通过 `webdavPasswordFromFormV378`（8679）取值。B4/D2：状态与替换输入分离、端点/账号绑定 |
| `storeWebdavConfigV378`（8668—8673） | 先写配置，再写选中的密码存储，最后删旧副本；配置仅删除 password/authorization 字段 | 写入可以部分成功，删除旧副本异常被吞。调用者设置保存（8742）捕获失败；上传后摘要保存（8784）失败会让已远程上传的操作显示失败。B4/D2/D4：部分结果、凭据绑定、配置提交补偿 |
| `clearWebdavStorageV378`（8675—8677） | 删除独立配置、持久/会话密码 | 删除异常被吞，按钮（8743）仍提示清除并回填。B4/D2：删除验证、失败状态 |
| `setSidebarCollapsedV47`（8863—8866）、`setupSidebarCollapse`（8885—8896） | 直接读写 `shiroha-sidebar-collapsed`；点击写，专注模式自动收起默认不写 | UI 先切换后写，错误未捕获；启动读取失败也未捕获。B2/B3：非主状态设置归属和失败 |

现有配置不把 AI Key、WebDAV 密码塞进主状态，WebDAV 配置也不是主状态字段。A2 的假凭据排除覆盖导出/日志；C7 迁移必须分别登记数据、独立配置和凭据，不得以主状态迁移成功代替全部迁移成功。

## 4. 文件、媒体、网络与关闭入口

| 入口 | 当前数据范围与成功/失败语义 | 后续任务 / 测试归属 |
| --- | --- | --- |
| `index.html:147`，`readImportFile`（1571） | 用户单文件 `.txt/.json/.csv/.xlsx/.docx/.doc/.pdf`；取消无文件直接返回；读成功填预览文本/表格结果，失败提示并保留可手动粘贴入口；`.doc/.xls/.xlsm` 明确拒绝 | B4/C5/E1：文件取消、错误、原生选择授权、完整文档链路 |
| `index.html:206—207`，`readDualFile`（1595） | 题目/答案双文件分别读取；成功只替换对应文本框，失败 toast | B4/C5/A2：双文件匹配、失败不污染另一文本框 |
| `ensureBackupFileInputV23`（7567—7573），`importBackupJsonFileV23`（8609） | 隐藏 `.json/.zip` 输入，来自快捷恢复和数据工具按钮；取消直接返回；读包/预览后确认覆盖或合并 | B4/C5/C6：选择取消、无效 ZIP/JSON、图片引用；保存见 S28 |
| `readFileToText`（1613）、`readPlainTextFileV49`（1630）、`extractXlsxSheetsV49`（1718）、`extractDocxText`（1931）、`extractPdfText`（2483） | File.text/arrayBuffer、FileReader 以及本地解析库；错误由选择入口捕获 | B4/C5/E1：解析错误、超限、取消、资源释放；仅输入文件属于用户主动选择范围 |
| `startPdfOcrImport`（2605）、`downloadOcrDocx`（2686/2691） | 选中 PDF 的 OCR，结果先在内存；DOCX 通过 `downloadBlob` 导出 | B4/E1：中文扫描 PDF、完整确认保存、取消/Worker 释放；已有 smoke 仅英文 Canvas OCR |
| `makeOptimizedDocxImageMarkdown`（1982—2000） | DOCX 位图压缩的临时 Blob URL；finally 撤销 URL，解码/压缩失败退原图片 Markdown | B4/C3/E1：图片读取失败、媒体生命周期；不等于持久化图片服务 |
| `readBackupFileV24`（8592）、`bytesToDataUriV24`（8591）、`applyBackupAssetsV24`（8600） | JSON/ZIP/`assets/` 图片读取与内联；缺图计数提示，不能静默声称图片完整 | B4/C3/C6：共享图片、缺图、重复内容与元信息引用 |
| `download`（8509—8514） | JSON 文本先写导出框；Android 桥接返回成功则结束，桥接失败警告后走 Blob `<a download>`；1 秒后撤销 URL | B4/C5：用户取消、实际写文件失败、最终成功确认；当前点击锚点不证明文件落盘 |
| `downloadBlob`（8516—8524） | Blob 锚点下载并 1 秒后撤销 URL，没有异步结果或用户取消状态 | B4/C5：原生原子写入/下载结果、释放 URL |
| `exportBankById`（6996）、`exportCurrentBank`（7552）、`exportSelectedBanksV23`（7713） | 题库 JSON；选中题库导出后立即提示完成 | A2/B4/C6：所选库边界、不含记录/设置、ID/富字段往返、下载失败 |
| `exportRecords`（7550）、`exportAll`（7553）→`exportAllBackupV23`（7718） | 学习记录 JSON 或 Web 完整备份 JSON；完整备份导出后立即提示已生成 | A2/B4/C6：字段保全、秘密排除、下载结果 |
| `exportNativeCompatibleBackupZipV611`（7720—7728） | Android 兼容 ZIP，提示外置图片数量；生成异常提示改用 JSON | A2/B4/C6：容器/版本、图片映射/缺图、端间往返；不宣称 Android 应用运行验收 |
| `requestAiChatV99`（533—553；唯一 AI fetch 在 540） | POST 自定义服务；非流式，明文 Key 由调用者传入并作 Bearer 头；AbortSignal、no-store、omit；首次 400/422 可去掉 response_format 再试 | B4/D1/D3：mock HTTP/取消/超时/格式降级/迟到响应；已有 AI 页面回归。真实收费接口不用于测试 |
| `fetchJsonLocalV252`（7824—7828）及 `loadBuiltInBankV252`（7830） | 内置索引/题库本地 fetch；失败退 XHR，最终可退 window.questionBank | B1/B4：静态站/ZIP/Tauri 路径、资源缺失；保留本地资源读取与远端服务请求的边界 |
| `webdavRequestV378`（8697 起；fetch 在 8702） | PROPFIND/MKCOL/PUT/GET；Basic 头在函数内构造，超时 AbortController、omit、no-store；错误分类交给 UI | B4/D1/D4：已有 request.test.cjs 的 HTTP/HTTPS、状态码和超时回归；新增原生 redirect/TLS/目录/体积限制 |
| `uploadWebdavBackupV378`（8776—8787） | 完整备份→历史文件→latest.json→本地配置摘要→列表；latest/list 失败会提示部分成功，摘要保存异常未单独区分 | D4：远端未知结果、部分成功、重试核实；A2：上传包秘密排除 |
| `prepareWebdavRestoreV378`（8818—8826）、`confirmWebdavRestoreV378`（8844） | 下载→哈希/格式核验→确认→恢复提交；下载成功只表示等待确认 | B3/C6/D4：哈希错误不修改数据、恢复失败保留确认包；提交见 S29 |
| 页面导航 `bindNav`（144—159）、AI 取消/收起按钮 | 离开导入页取消导入/预览 AI；练习/考试切导航仅退出专注布局；收起单题 AI 面板不等于取消请求 | B5/D3/D5：切会话与迟到结果、任务归属；已有 AI 用例覆盖部分切题/切会话/取消 |
| `closeEditModal`（6802）、`cancelBankEditSessionV45`（9109） | 前者隐藏并清刷题编辑会话；后者确认后丢弃二次编辑草稿；均不提交 | B3/B5：保存中不得误清草稿、焦点恢复 |
| `finishPractice(true)`（7490）、`reset-practice-btn`（165） | 退出完成路径见 S16；重置按钮直接丢当前练习会话，不新增完成记录 | B3/B5/E2：结束与放弃区分、未保存提示 |
| `exam-exit-focus`（8938）、`exitExamFocus`（8900） | 明确“退出本次考试”确认后停计时/清会话且不评分保存；普通 `exitExamFocus` 仅恢复布局 | B5/D5/E2：未交卷退出与窗口关闭，不增加续考承诺 |
| `resetData`（9012）、浏览器标签关闭/刷新、桌面窗口 X | reset 无条件 reload（见存储表）；[Rust 入口](../../apps/desktop/src-tauri/src/main.rs)仅 Builder.run，无关闭协调。未交卷会话、AI 草稿在内存 | B5/D5/E2：正常/保存中/失败/网络运行/考试关闭，必须先取得确定提交结果；profile 重启 smoke 不覆盖这些场景 |

第三方资源入口还包括 PDF.js `getDocument`/Worker（2483、2621 附近）、Tesseract 创建 Worker（OCR 路径）及 HTML 本地脚本/图片/公式资源。它们不经过上面三个业务 fetch；E1 需在断网环境从选择文档到保存重启实际验证，不能只测试文件存在。

## 5. 固定样本与已有测量边界

| 样本 / 来源 | 固定内容与目的 | 当前覆盖与缺口 |
| --- | --- | --- |
| 小库：桌面 smoke 内置单题 | [smoke.mjs](../../apps/desktop/scripts/smoke.mjs) 的 `FIXTURE_QUESTION`（18）及 `importAndPractice`（280—294）：`TAURI PROTOTYPE 1+1 = ?`，单选 A=2/B=3、答案 A、解析 `1 + 1 = 2` | 从 JSON 文本预览、确认入库到练习并重启；题库名/ID 每轮随机，不用于字节级比较。smoke 本身未计时；`--fixtures` 性能模式改用 A2 固定第 2 库的 1 题 JSON |
| 默认库启动负载 | [benchmark.mjs](../../apps/desktop/scripts/benchmark.mjs) 每版 5 次；第一轮 fresh profile，后 4 次 reused；1280×860 默认窗口、默认题库 | 已有协议只测启动和空闲内存；fresh profile 不等于操作系统冷启动 |
| 图片/交换格式 | A2 [dataset.cjs](./fixtures/dataset.cjs) 的 `webState()`：2 库 8 题，首库 7 题覆盖单选/多选/判断/多空/简答/无答案/富文本，第二库 1 题含跨库重复 ID。同一 1×1 PNG 重复放入题干、选项、解析、images、错题/收藏元信息和历史快照。`androidBackup()`：version 3、1 库 1 多空题、1 图片及错题/收藏/记录 | 固定逻辑样本的 ZIP 预期只外置 1 份共享图片；不代表大图性能。转换生成的字节须登记哈希、题数、图片字节、缺图数，不能以当前有损输出为无损预期 |
| 文字 PDF | smoke `textPdf()`（170—189）：单页 400×200、Helvetica 24、正文 `DESKTOP SMOKE` | 直接验证 PDF.js 真 Worker 提取文本；没有文件选择→解析预览→入库，不覆盖中文文字 PDF |
| OCR 图像 | smoke `ocrSmoke`（240—258）：600×180 Canvas，Arial 100px，黑白 `TEST`，仅 eng，禁用语言缓存 | 仅验证非空英文 OCR 与 Worker 释放，不是中文扫描 PDF，不构成扫描文档基线 |
| 双文件/解析样例 | [题目](./fixtures/dual-questions.txt)及[答案](./fixtures/dual-answers.txt)：3 题，各题型题号均为 1；[材料题](./fixtures/material.txt)：共享材料 2 题；另可复用[原生解析回归样例](../native-parser-regression/README.md) | 复用已登记文本和预期，不直接修改 Android 预期；文档实际导入性能需要另测 |

本次未把历史 README 的毫秒/MiB 数值搬成新测量结果；阶段 A 实测是否完成以验证记录为准。中文扫描 PDF、DOCX、XLSX、大文件和连续多轮文档处理的端到端固定样本与测量仍需 E1/E3 补齐；未完成时必须保留缺口，不以英文 Canvas 或小文本替代。

阶段 A 新增 `--fixtures` 可选模式，默认模式保留原启动测量行为。在 `apps/desktop` 串行执行：

```powershell
npm run bench:desktop
npm run bench:desktop -- --fixtures
```

`--fixtures` 使用上述 A2 的第 2 库（1 题 JSON）、第 1 库（7 题图片 JSON）和 `material.txt`（2 题文本），每种 5 轮、每轮新 profile，共 15 次启动。沿用默认模式的进程所有权核验、整树采样和清理；通过实际文件输入、解析按钮、确认入库和“保存数据”按钮测量，不调用业务内部函数或直接修改 state。报告保存为 `.reports/performance-fixtures.json`，包含输入哈希/字节/题数、EXE 和源码哈希；失败保留临时 profile 和已完成轮次，`complete=false`。

计时字段为 `parseMs`（文件选择至可确认预览）、`importCommitMs`（点击确认至题库出现在选择器）、`manualSaveMs`（点击保存至成功提示）；它们包含 UI 自动化往返开销，不能解读为纯存储调用耗时。每轮另核对持久化题数、只有一份样本题库，并验证顺序练习可用；`storedBytes` 是含默认库在内的整个主状态字节数。`fixture.workingSetMiB/privateMiB/processes` 为开始顺序练习后空闲 5 秒的整树单点数据，顶层同名字段仍是导入前首页数据，二者不可混算。该模式补充最小导入/保存基线，不覆盖大图或峰值，也不代替重启持久化 smoke。

首次实际运行在第一个样本的保存成功定位处触发 Playwright strict mode：`saveState` 调用 `toast`，而 `toast` 会把同一文案同时写到导入摘要和成功通知。该轮 `complete=false`、有效样本为 0，未计入性能基线。测量脚本已将等待范围限定为 `#app-toast .toast-item.ok` 内的精确保存成功文案，保留严格唯一匹配；这是测量脚本定位修复，没有改变业务保存行为。修复后须重跑全部 15 轮，以验证记录中的新结果为准。

## 6. 在优化前登记的性能协议与判定

登记后，B/C/D 阶段不得根据结果调整本节标准。需要改变协议时，先解释不可比原因、保留旧报告，并对基线和候选版按新协议重新测量。

1. **可比条件。** 同一机器、Windows 构建、WebView2、显示缩放/窗口、release 来源和样本；记录 Git SHA/未提交差异、EXE SHA-256、样本哈希/字节/题数/图片数、运行时版本、CDP 状态、计时端点与失败次数。先保留旧 EXE；基线和候选版同轮串行测试，禁止同时跑两版或混入其他性能测试。无法保留/运行旧版时，不报告改善百分比。
2. **启动。** 保留当前 5 轮协议和原始数据：进程 spawn 前到页面 load 为 `domMs`，到遮罩隐藏为 `visibleMs`。另列 first/fresh 和 reused 的四轮中位数，不能把 CDP 连接耗时说成纯渲染耗时。未来异步启动另加“首页 ready 且可练习”的指标，原有指标继续保留。操作系统冷启动只有实际重启系统的独立实验才可使用该名称。
3. **导入。** 固定同一自建小库和图片 fixture，独立计“读文件/解析→预览可操作”和“确认导入→成功后题库出现”；每次从等价的干净隔离状态开始，5 次重复。确认后的指标包含序列化/媒体/存储，不能停在网络或解析完成；持久化回读和可练习另作有效样本断言。使用本节 `--fixtures` 模式计时，A1 实际结果未测时填写未测。
4. **保存与查询。** 固定单题编辑、收藏切换、练习回答、完成练习和交卷；每种 5 轮，从点击/事件开始到平台确定成功并更新界面结束。批量写入、列表切换另列，不能把不同操作平均混算。保存后重启/导出校验内容和记录数量；错误和重试单列，不能只统计最快成功样本。异步队列在入队时和提交确定时分别打点。
5. **内存。** 当前 benchmark 在可见后空闲 5 秒，取 Rust 主进程及所有 WebView2 后代的一次工作集/私有提交读数，MiB=1,048,576 字节，并按路径/创建时间防 PID 复用。它不记录峰值或稳定区间。E3 在操作前、过程中、完成后统一采样完整进程树，报告峰值及完成后固定空闲窗口的中位数；采样周期、窗口和每轮原始数据在开始测量前写入报告。工作集求和可能重复计入共享页；私有提交不是驻留物理内存；JS heap 只作补充。
6. **长时间使用。** E3 固定 20 轮“导入/切换/练习/删除测试库”，分别记录第 1/5/10/20 轮相同空闲窗口的完整进程树数据；同一数据结果下判断是否持续增长。不能靠主动清工作集、强制 GC、关闭 GPU 或删除功能获得改善。媒体/Worker/blob 释放同时做可观察验证。
7. **回归阈值。** 数据字段、图片引用、计数、导出秘密排除必须全部一致；任何数据损失直接不通过。性能的每个可比耗时与稳定内存指标，候选中位数比同轮基线增加超过 10% 时列为回归并复测一整组，不能挑删慢样本；复测仍超出则 E3 不通过，需修复或明确登记限制后由阶段验收处理。5 次样本只报告原始值、范围和中位数，不假称稳定的 p95。此 10% 是预登记的工程回归触发线，不是已测置信区间或承诺下降幅度。
8. **优化完成证据。** C8 必须同时证明桌面高频保存不再重写整库、首页不必载入全部图片，且查询/统计/组卷/历史结果未缩小；只有耗时下降或数据库文件存在不够。A1 尚缺的导入/保存/图片/峰值测量在补齐之前不能用于声称优化通过。

## 7. 进入后续阶段时必须保留的已知缺口

- 同步主状态保存路径并非都有回滚；S08/S11—S22/S24—S27/S30/S31 的内存/界面与磁盘可能分离。S30 尤其先锁定已交卷，失败后无正常重试入口。
- 加载损坏 JSON 可退空状态，读取存储失败可能中断启动；尚无 loading/ready/recovery_required 可观察门禁、修订冲突或跨标签变更处理。
- AI/WebDAV Key 清除和记住切换存在未检查删除结果，独立配置/凭据与主状态没有共同事务；当前 UI 会明文回填，不具备 D2 的系统凭据语义。
- 导入/AI/恢复同步回滚不能直接搬到异步环境；整包旧快照可能覆盖后续编辑。需按 B3 的队列/排他与操作归属验证。
- 下载点击没有实际落盘结果；当前桌面没有原生文件、数据库、媒体、任务或退出协调，profile 隔离只适用于当前原型，新增原生副作用前必须先完成 C1。
- 现有 WebDAV 请求单元测试不覆盖整套备份恢复；AI quota 用例不覆盖所有主状态写入；桌面 smoke 正常重启不覆盖保存失败、关闭临界点或未交卷考试。
- 默认 benchmark 只提供启动与空闲单点内存；阶段 A 的 `--fixtures` 补小库/微型图片库/文本文件的导入与手动保存计时，实际通过情况见验证记录。大图负载、峰值/稳定区间和系统冷启动仍未覆盖；E1 的完整文档链路也不能由现有 PDF/OCR 原语测试代替。

## 6. 阶段 B 调用点迁移结果

保留上方阶段 A 的历史行号/行为作为来源盘点；当前源码位置已移动。S01—S31 和保存全部均已 await 提交，并由 runMutation 统一处理暂停交互、失败反馈和原位回滚。

| 原调用编号 | 本轮处理 |
| --- | --- |
| S01—S07、S17 | 选择/设置等待保存后刷新；AI 凭据与配置失败补偿，秘密读取归浏览器适配器 |
| S08、S31 | 题目/题库编辑会话及预览在写入成功后才清理；失败保留输入 |
| S09—S10、S28—S29 | 新增/追加/本地恢复/WebDAV 恢复进入互斥事务；失败保留原库与预览，本地文件选择支持重试 |
| S11—S15、S18—S19 | 重命名/复制/新库/合并/去重/删除/内置库在成功后刷新，失败恢复原对象 |
| S16、S20—S22 | 练习计数和记录失败可重试；客观题在提交成功后才显示完成反馈，简答按钮失败恢复 |
| S23 | 保留局部 AI 补丁回滚与会话身份；await 后才提示写入成功 |
| S24—S27 | 收藏/错题成功后再刷新与提示；失败恢复旧集合 |
| S30 | 考试失败恢复 submitted 与记录，重试只插入一次，成功后才停计时 |

独立 WebDAV 配置、记住/会话凭据、侧栏、原始数据恢复导出、静态资源请求已移至平台。浏览器文件输入仍提供用户授权与取消语义，读取/下载/图片显示由适配器处理。旧同步保存 helper 不再直接访问浏览器存储。原位回滚只在本页面暂停编辑期间执行，不用于跨标签合并。具体测试覆盖和未验证范围见 [阶段 B 记录](./README.md)。
