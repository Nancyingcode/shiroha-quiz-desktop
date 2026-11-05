# Airbnb JavaScript 引入与重构实施计划

日期：2026-11-05。依据：[已批准设计](../specs/2026-11-05-airbnb-javascript-refactor.md)。状态：P0—P5 已按授权完成，实际结果见第 6—11 节；P5 交接后停止。本计划不包含提交、推送或发布授权。

## 1. 任务登记与依赖

- 阶段负责人：各阶段的独立新会话；P5 在现有工作树完成高风险状态审查，保留 P0—P4 的全部前置成果。
- 工作树：`C:/Users/30728/.codex/worktrees/8d15/shiroha-quiz-desktop`。
- 当前任务分支：`codex/docs-airbnb-refactor`；基线 `cbd56bfdfe3fdbc9e87689cb5df560e573b80fcb`。
- 工具和业务任务顺序执行，共享 `app.js`、加载器、ESLint 配置与 `prepare-web.mjs` 只由当前批次负责人修改。本计划不启动子代理或并行代码任务。
- 用户要求 P0—P5 各使用独立新会话，严格串行复用上述 8d15 工作树及现有任务分支交接。每阶段先核对 HEAD、未提交文件、前置成果和实际验证；不复制其他工作树改动。各阶段不自行创建后续会话或子代理；P5 是最后阶段，交接后停止。
- 每批交付记录实际文件、验证环境、通过/失败、缺口和待授权事项；未授权不创建提交、PR、标签或发布，不清理来源 worktree。

## 2. 分阶段任务

### P0：规范落地与基线核实

- [x] 引入 `rules/javascript-style-guide.md`，在 AGENTS、贡献指南和文档索引加入入口。
- [x] 盘点代码、实际 ESLint/类型覆盖、源码提取型测试与桌面资源生成约束。
- [x] 核对官方 Airbnb 与 ESLint 10 插件候选的上游声明，写清项目例外和未验证范围。
- [x] 用户已确认设计；在实施工作树重新核对基线和依赖占用进程，按现有 npm 锁安装；用 `npm ls` 和受影响命令验证依赖完整性，不停止其他 worktree 的进程。
- [x] 在修改工具配置前，运行现有 typecheck、lint、npm test、WebDAV 及受影响浏览器回归，记录实际测试数、已有失败和环境缺口。

退出条件：设计已确认，现有可运行检查有真实基线。不能将历史会话结果当作当前工作树基线。

### P1：先消除测试对源码排版的依赖

候选范围：`test/dual-platform/web-source.cjs`、WebDAV/AI 的函数提取入口、`test/web-ai-practice/harness.cjs`。

- [x] 逐项登记依赖引号、函数名、IIFE 尾部和脚本加载次序的测试；仅修改影响当前批次的入口。
- [x] 对确定会受影响的加载器先添加等价空白/分号变体用例使其失败，再以最小改动支持等价排版；保持启动边界唯一性和测试沙箱隔离。
- [x] 为未来抽取文件准备统一加载入口，仍执行真实源码；业务预期不因加载器调整而放宽，不复制业务实现到测试。

退出条件：原源码和等价排版均运行同一组有效断言；原有安全限制仍有效。若必须改变产品模块契约，先补充设计再执行。

### P2：建立兼容 ESLint 10 的增量门禁

候选范围：桌面两个 ESLint 配置、`scripts/lint-platform.mjs`、`package.json`、必要的锁文件和小型 lint fixture。

- [x] 核对 npm 已发布稳定版本和许可，先隔离验证 Stylistic；只有 ESM 导入检查确有需求时才评估 import-x。记录 peer、Node 24、ESLint 10.13.0 和 Windows resolver 的实际运行结果。
- [x] 新依赖限定 devDependencies，说明维护与安装成本，不安装 React/Next 整套预设；不降级 ESLint，不强制忽略 peer 依赖。
- [x] 先添加能证明违规被拒绝、合法例外被接受的检查 fixture；配置 Node ESM、CommonJS 和浏览器 classic script，各类全局变量只读且范围最小。
- [x] 保留已有 recommended/no-var/prefer-const/no-unused-vars。新增规则按文件和规则形成债务清单，逐批清零后设 error；对 app.js 建立可审阅的语义诊断，不将题库数据和第三方文件纳入格式重写。
- [x] 配置显式 Airbnb 格式规则；新建文件直接强制，已迁移文件加入强制清单。不能只检查改动行，避免同文件新增违规漏过；旧债务不能抵扣新增错误。
- [x] `import-x/no-unused-modules` 不纳入 ESLint 10 门禁；相对导入扩展名、具名导出和循环例外遵循项目适配。
- [x] 接入原有 `npm run lint`，保持 hooks 与 CI 只读；增加债务报告命令时在文档写明名称、范围和失败语义，不能用成功退出码隐藏执行失败。
- [x] 同步 CONTRIBUTING 和根规范的真实覆盖范围；评估将新增规范文档加入 lint:docs 的长期列表，并更新明确写出的文档数量。

退出条件：配置可在锁定依赖上运行，违规 fixture 必须失败，原有门禁不退化；试点目标无错误/警告，债务范围明确。不得为了首轮全绿而全局关掉有效规则。

### P3：小范围可读性试点

顺序：`apps/web/training.js` → 平台小文件 → 桌面脚本/测试；一次只处理一个范围。

- [x] 固定现有时钟停止/暂停/恢复、复盘顺序、答题快照和跨库 ID 行为，缺口先补特征测试。
- [x] 先整理声明、括号、换行和单行复合语句；语义条件提取、状态分支展开另批处理，保留 `ShirohaTraining` 等公开接口。
- [x] 处理 `== null`、`||`/`??`、参数修改、前后自增时逐点核对返回值、边界值及执行次序，不依赖 autofix 判断业务等价。
- [x] 每个完成文件进入正式风格门禁；验证实际浏览器和隔离 WebView2，记录检查耗时和工具噪声再决定扩大范围。

退出条件：试点行为与基线一致，规则错误/警告为零，无存储和公开接口变化。

### P4：按业务切片缩小 app.js

每个切片独立完成特征测试、抽取、接线和验收，建议顺序如下。

| 切片 | 已有入口/约束 | 主要验收 |
| --- | --- | --- |
| 分页与答案比较 | `listPageNumbers`、`listPageRange`、`sameAnswerForQuestion`；`scoreOf` 有 DOM 默认分依赖 | 分页边界、多选顺序、多空位置、无答案与简答自评不变 |
| 文本解析与答案合并 | `parseTextQuestions`、`parseAnswerEntries`、`mergeQuestionAnswers` | 题号/类型/选项/答案绑定、含圈号和异常输入的语义不变 |
| 备份纯转换与媒体 IO | `normalizeBackupPayloadV23`、`mergeBackupBanksV23`、`readBackupFileV24` | 旧 JSON/ZIP 字段、图片、重复合并、未知版本拒绝、失败保全不变 |

- [x] 每批先列调用图和输入/输出/副作用，确定最小接口；纯计算不依赖 DOM、storage 或原生 invoke，IO 继续留在现有边界。
- [x] 沿用现有 IIFE/global 加载模式和旧调用入口；新增文件同步 HTML 加载顺序、桌面资源条目、测试加载器与必要类型声明，不增加第二份业务源码。
- [x] 对比固定 fixture 的输入和输出；涉及文本时保留公式、换行、答案和 HTML 语义，涉及备份时验证数据保全及凭据排除。
- [x] 迁移完全部调用后才移除旧函数体，不使用注释保留废弃实现；重命名历史后缀不是这一阶段的必要条件。

退出条件：每个切片无双份实现，新增文件进入完整门禁，加载/CSP/离线行为通过实际验收。不要以 app.js 行数目标推动无测试拆分。

### P5：单独评估高风险状态重构

候选范围：练习/考试与 AI 会话、`frontend/adapter.js`、`frontend/harness.js`。

- [x] 根据 P4 后的调用图细化状态设计，分别列所有者、进入/退出、计时器、取消、错误、重试和清理条件；涉及新的公共接口时再次确认设计。
- [x] 先补迟到响应、重复提交、总提交草稿、保存失败/回滚、未加载正文拒绝写入、恢复后的 revision/generation 失效等测试缺口，再按状态流转最小步修改。
- [x] 保持 IPC 契约、凭据存储、持久化格式和权限不变；新增需求拆为独立设计任务。

退出条件：每个状态所有者均有明确生命周期和针对性验证；不能以增加通用状态管理框架代替业务拆分。

## 3. 各批验证矩阵

所有命令以实施时实际 package.json 为准；资源生成、构建与读取同一 dist 的测试串行执行。

| 改动范围 | 工作目录与检查 |
| --- | --- |
| 本次纯文档 | `apps/desktop`：`npm run lint:docs`；对脚本未覆盖的新增文件补严格 UTF-8、围栏、本地链接和差异检查 |
| ESLint/脚本/测试/桌面前端 | `apps/desktop`：`npm run typecheck`、`npm run lint`、`npm test`；新增配置必须执行违规/合法 fixture 验证 |
| 训练、解析、判分、备份 | 先在根目录运行受影响的 `node --test test/dual-platform/<实际测试文件>`；交付运行桌面 npm 三项及 `npm run test:web-platform` |
| WebDAV | 根目录：`node --test test/web-webdav/request.test.cjs` |
| Web 单题 AI | 根目录：`node test/web-ai-practice/runner.cjs`；依赖、浏览器与 mock 要求见[测试说明](../../../test/web-ai-practice/README.md)，self-test 不代替业务回归 |
| 文档/PDF/OCR 导入 | `apps/desktop`：`npm run test:documents`；记录真实覆盖范围，不以静态资源存在替代运行 |
| ESLint 依赖/构建配置、共享 Web 资源、加载行为 | `apps/desktop`：`npm run build`；涉及运行行为时再顺序执行 `npm run build:test`、`npm run test:desktop`，使用隔离 profile |

Rust 源码不在当前计划内；若后续必须修改，先读 Rust 指南并按根规范补 fmt、Clippy、cargo test 和实际 feature 检查。只有环境缺失时明确记录不能运行的步骤，不把它写成通过。

## 4. 回退与交付

每批保留输入 fixture、语义预期和检查记录。工具配置与业务抽取形成独立可审查差异；获得提交授权后才建立对应提交，不能为“方便回退”先擅自提交。

发现回归时停在当前切片，恢复本任务产生的接口接线/资源条目/源码改动并重验，保留无关用户修改；已合入的历史通过用户授权的新修复或 revert 处理，不重写主线。依赖变更的回退同时保持清单和锁文件一致。

交付必须说明：当前强制检查范围、仍在债务报告中的文件/规则、本次真实运行的测试与环境限制、尚未实施的批次。主线合并、push、PR、发布和旧 worktree 清理分别遵循后续明确授权。

## 5. 最初规范引入的历史文档验证记录

- `npm run lint:docs` 通过，检查项目现有列表中的 15 份文档。
- 本次变更的全部 6 份文档补充严格 UTF-8、代码围栏与本地链接检查；差异使用 `git diff --check`，新增文档另检查行尾空白。历史文档原有的 Markdown 双空格换行保留，不为本任务格式化。
- 只读查询 npm 官方仓库确认 Stylistic 5.10.0、import-x 4.17.1 的已发布版本声明支持 ESLint 10；airbnb-extended 3.3.0 仍声明 ESLint 9。
- 最初文档交付时 P1—P5 未实施，未安装或烟测插件，未运行业务测试或构建；当时无需代码门禁。后续 P0 的真实依赖与测试结果另记于下节，不能把历史文档检查当作重构验收。
- 改动保留在当前任务分支工作树，未提交、未推送。

## 6. P0 当前基线核实与交接（2026-11-05）

### 6.1 授权、工作树与实际环境

- 结论：P0 已完成，当前基线没有阻碍 P1 的测试失败；P1—P5 尚未执行。用户已批准按现有设计/计划实施，并要求每阶段使用独立新会话。主协调会话在本阶段交付后创建 P1 会话，严格串行复用 8d15 工作树；本阶段没有创建后续会话或子代理。
- 唯一任务工作树：`C:/Users/30728/.codex/worktrees/8d15/shiroha-quiz-desktop`；分支 `codex/docs-airbnb-refactor`，HEAD 仍为 `cbd56bfdfe3fdbc9e87689cb5df560e573b80fcb`。没有修改主工程或其他 worktree。
- 在实际工作树执行 `git remote get-url origin`，结果为 `git@github.com:Nancyingcode/shiroha-quiz-desktop.git`；未修改远程、未 fetch，不把已有远程跟踪引用当作实时远端核验。
- 完整读取本工作树 AGENTS、JavaScript 指南、设计、计划、协作分支规划，以及 `C:/Users/30728/.codex/global-rules/AGENTS_condition_rules.md`、`C:/Users/30728/.agents/AGENTS.md`；外部规则均读取成功，后者的 ok-wuthering-waves 专属正文不适用于本仓库。
- 当前实测为 Windows x64、Node `24.22.2`、npm `11.19.1`、TypeScript `7.0.2`、ESLint `10.13.0`、esbuild `0.28.2`；按锁安装的 playwright-core 为 `1.64.1`。现有 Edge 为 `156.0.4314.58`；AI runner 使用本机 bundled Playwright `1.62.1`。

### 6.2 依赖安装与完整性

1. 初次沙箱内 `Get-CimInstance Win32_Process` 返回“拒绝访问”；通过权限机制读取候选进程的可执行文件路径和命令行后，匹配本工作树的 Node/Electron/esbuild/桌面进程为 0，且安装前不存在本工作树 `node_modules`。安装前再次核对为 0，没有停止任何进程。
2. 在 `apps/desktop` 执行 `npm ci --registry=https://registry.npmjs.org --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000 --cache .reports/npm-cache`，退出码 0，安装 159 个包。锁文件中的 213 个 resolved 地址均指向官方 registry；缓存和日志写在本工作树忽略目录，没有更改系统或 npm 全局配置。
3. 安装命令仅在当前进程设置 `HUSKY=0` 并在结束后恢复，避免 prepare 重写多 worktree 共享的 Git hooks 配置；未安装新 hook。随后重新运行项目 typecheck、lint 和测试，未执行提交。
4. npm 提示 esbuild postinstall 未列入 allowScripts；未修改 allowScripts 或锁文件，直接调用已安装的 esbuild 原生转换成功。`npm ls --all --json`、`npm ls --depth=0` 均退出 0，TypeScript/ESLint 版本命令、Playwright Chromium 对象及 esbuild 原生转换检查均通过。
5. 安装前后 `apps/desktop/package-lock.json` SHA-256 均为 `5CF9A082AE99CE9B12A62C6495D23529F81AF5C2A25735BE3003426BE694646A`；package.json、锁文件、业务和测试源码均未改变。没有新增 Airbnb、Stylistic 或 import-x 插件，没有进行插件烟测。

### 6.3 当前工作树实际验证

下表均为本次 P0 实际执行，退出码全部为 0；测试无失败、取消、跳过或 TODO。报告目录为本工作树 `apps/desktop/.reports/`，产物不提交。资源生成测试完成后才启动浏览器回归，两套浏览器回归串行执行。

| 工作目录 | 实际命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| apps/desktop | `npm run typecheck` | Node 与 platform 两套配置通过 | `p0-typecheck.log` |
| apps/desktop | `npm run lint` | ESLint、平台 lint、15 份现有列表文档通过 | `p0-lint.log` |
| apps/desktop | `npm test` | 桌面 109 + 共享 232 = 341 项通过；约 32.82 s + 0.98 s | `p0-npm-test.log` |
| apps/desktop | `npm run test:web-platform` | 实际 Edge 页面 98 项通过；约 108.50 s | `p0-web-platform.log` |
| 根目录 | `node --test test/web-webdav/request.test.cjs` | mock 请求 9 项通过 | `p0-webdav.log` |
| 根目录 | `node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'` | 完整 AI 业务回归 47 项通过；约 78.86 s | `p0-web-ai.log` |
| apps/desktop | `npm ls --all --json`、`npm ls --depth=0` | 依赖树完整 | `p0-npm-ls.json`（完整树） |
| apps/desktop | `npm run lint:docs` | 本阶段最终文档校验另执行；覆盖现有列表 15 份文档 | `p0-lint-docs-final.log` |
| 根目录 | 六份变更文档补充检查、`git diff --check` | 严格 UTF-8、围栏、本地链接、未跟踪文档行尾空白和差异检查 | `p0-docs-supplemental.log` |

- Web 平台命令仅在当前进程设置 `SHIROHA_BROWSER_EXECUTABLE=C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`；AI 命令仅在当前进程设置 `NODE_PATH=C:/Users/30728/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules`。命令结束均恢复原值，没有安装 Playwright 或下载浏览器。
- 共享测试已覆盖 P1 会影响的现有 AI 源码提取入口，包括 `ai-connection.test.cjs`、`ai-harness.test.cjs`、`ai-import-retry.test.cjs` 和 `ai-codebuddy-execution.test.cjs`。47 项浏览器 AI 使用真实页面和现有只读 IIFE 桥接，`realApiAllowed=false`；没有用 self-test 代替业务回归。
- 测试沿用自建题库、假凭据、隔离 context/临时目录及 mock；没有操作真实题库或调用收费 API。除已记录的首次进程读取权限限制和安装提示外，本阶段未出现测试失败，未修改业务或有效断言来取得通过。
- 本阶段没有改工具/构建配置或业务资源，因此未执行 Rust、build、隔离 WebView2、文档/PDF/OCR、大文件或真实 AI/WebDAV 服务验收；以上不计入本次通过范围。后续阶段触及相应行为时按第 3 节补齐，Edge 基线不能替代桌面运行验收。

### 6.4 未提交文件与 P1 入口

全部成果仍未提交、未推送；没有 PR、标签、发布或 worktree 清理。未提交内容保持以下六份文档，不含源码、依赖清单或锁文件改动：

| 文件 | Git 状态 | 来源与本阶段处理 |
| --- | --- | --- |
| `AGENTS.md` | 已修改 | 保留前一会话新增的 JavaScript 规范入口，本 P0 未再修改 |
| `CONTRIBUTING.md` | 已修改 | 保留规范入口，更新已批准实施与 P0 状态 |
| `docs/README.md` | 已修改 | 更新设计/计划入口及独立新会话串行交接约束 |
| `rules/javascript-style-guide.md` | 未跟踪 | 保留项目适配正文，更新实施计划链接名称 |
| `docs/superpowers/specs/2026-11-05-airbnb-javascript-refactor.md` | 未跟踪 | 记录批准与 P0 完成；保留规划时基线和插件声明核对历史 |
| `docs/superpowers/plans/2026-11-05-airbnb-javascript-refactor.md` | 未跟踪 | 更新阶段状态并追加本次真实验证和交接 |

P1 可以开始：在独立新会话完整读取适用规则及本设计/计划，核对本节工作树、分支、HEAD、六份未提交文档和现有依赖后，仅处理源码加载器/提取器对排版的依赖。先登记所有受影响入口，再用等价空白/分号变体形成失败用例，最小修改加载器并保持业务断言、IIFE 启动唯一性和沙箱边界。P0 未实现这些变体用例，也未重构业务。

当前没有阻碍 P1 的依赖或测试环境缺口；后续仍不得自行进入 P2—P5、创建子代理、提交或发布。P1 完成交付后由主协调会话另建 P2 新会话。

## 7. P1 源码加载入口加固与交接（2026-11-05）

### 7.1 范围、规则与入口盘点

P1 已完成。实际工作树仍为 `C:/Users/30728/.codex/worktrees/8d15/shiroha-quiz-desktop`，分支 `codex/docs-airbnb-refactor`，HEAD 为 `cbd56bfdfe3fdbc9e87689cb5df560e573b80fcb`。实际 `origin` 为 `git@github.com:Nancyingcode/shiroha-quiz-desktop.git`；没有 fetch 或修改远程，不把远程跟踪引用视为实时服务器结果。

本阶段完整读取当前工作树 AGENTS、JavaScript 指南、设计、计划（包括第 6 节 P0 交接）、协作分支规划，以及两份绝对路径外部规则。外部规则均读取成功；共享入口中的 ok-wuthering-waves 专属规则不适用于本仓库。没有子级 AGENTS；只使用已有 P0 依赖，没有重新安装、停止进程或修改锁文件，没有操作主工程和其他工作树。

| 真实入口 | 原排版依赖 | P1 处理 |
| --- | --- | --- |
| `test/dual-platform/web-source.cjs` | KEY 必须使用紧凑单引号；`startApplication();` 与 IIFE 尾部必须符合固定正则 | 按字符串常量和唯一末尾启动节点定位；只替换启动语句，保留原 IIFE 与注释 |
| `test/web-webdav/request.test.cjs` | 通过固定 `function name(` 字符串截取请求/诊断区间 | 按同一作用域的唯一函数声明及先后顺序截取 |
| `test/dual-platform/ai-connection.test.cjs`、`ai-harness.test.cjs`、`ai-import-retry.test.cjs`、`ai-codebuddy-execution.test.cjs` | 固定函数签名、相邻函数文本、AI 导入结束注释标记 | 统一按函数名称定位区间；单函数使用完整语法节点，不再依赖结束标记或下一次任意 `function` 文本 |
| `test/dual-platform/json-import.test.cjs`、`document-lifecycle.test.cjs` | 固定签名与参数排版 | 同样改用唯一声明区间；它们也直接读取后续 P4 会迁移的 app.js，属于本次真实入口 |
| `test/dual-platform/exit.test.cjs` | 关闭钩子的紧凑条件、换行结束符，以及忙碌检测函数必须只有一行 | 定位受宿主存在性保护的完整 IfStatement，忙碌检测读取完整函数节点 |
| `test/web-ai-practice/harness.cjs` | 状态键必须带分号；只识别紧凑 IIFE 开头和固定行首结尾 | 与共享测试使用同一语法定位器；浏览器响应副本在真实 IIFE 闭括号前注入，保持 global lexical 回退模式 |
| 其他平台/训练测试与浏览器页面入口 | 直接执行已有文件，或通过真实 HTML 加载，无 app.js 排版截取 | 保持原样；桌面资源生成测试使用自建文件，不依赖真实 app.js 排版 |

新增 `test/dual-platform/source-tools.cjs`，复用已有 ESLint `Linter` 的解析结果，不增加解析包或自建词法分析器。它只选择当前作用域的具名声明、字符串字面量、启动与关闭钩子；缺失、重复、反向区间、非末尾启动或不唯一 IIFE 都直接失败，不扩大到任意嵌套声明搜索。普通命名函数 IIFE 的两种括号写法和现有 global lexical 读取模式均有验证；本阶段没有转换生产脚本的函数形态。

`runWebScripts(context, names)` 提供未来 IIFE/global 文件的统一显式加载入口，在同一 vm 中按调用者给定的列表顺序执行真实 apps/web 脚本，并校验真实路径不能越界。当前保持 validation → browser → 平台替身绑定 → training → app 测试副本的加载顺序；没有把 Node、require、文件系统或网络能力加入业务沙箱。函数名仍是有意保留的测试契约，未来重命名或移动到新文件时应同步调用者，不能靠模糊匹配自动猜测。

### 7.2 红—绿证据与运行前提取舍

- 先新增两种真实源码副本变体：双引号/空格/函数参数换行，以及同时去掉状态键、启动调用和 IIFE 尾部的可选分号；忙碌检测函数改为多行，关闭钩子增加空白。最初 2 项均失败：一项报 WebDAV 函数边界不存在，一项报 AI harness 无法读取 KEY，见 `p1-red.log`。
- 接线后两种变体各执行同一组 177 项既有业务测试（解析、评分、备份、分页、导入、文档生命周期、退出、AI、WebDAV），全部通过。业务函数来自真实 app.js，没有复制实现或放宽业务断言。子进程仅替换自身读取的源码副本，不写生产文件。
- 最后补充语法树等价校验：排除位置、注释及普通字面量的原始引号写法后，要求变体保留全部语法结构和字面量值，模板原文也保留比较；两种变体均通过。另有 8 项桥接、伪边界、唯一性、global 模式、函数/字符串、关闭钩子和脚本顺序/沙箱检查。
- 调试新增测试时发现并修正了子进程继承 Node runner 二进制事件协议、脚本全局名写错，以及语法树比较误含 start/end 位置字段的问题。它们均为本阶段测试工具问题；最终回归无失败、跳过、取消或 TODO，没有修改业务来迎合测试。
- 这里没有新增 npm 包，但**新增了对既有桌面开发依赖的运行前提**：WebDAV、共享源码测试和 AI harness 需要 Node.js 24+，以及按 `apps/desktop/package-lock.json` 安装的 ESLint。选择已有解析器是为了可靠区分代码、字符串、注释、嵌套函数和 IIFE 边界，避免再实现一套不完整的解析器。独立 Node 18/无桌面依赖的 WebDAV 运行方式不再适用；已同步 WebDAV、AI 和共享 fixture README。AI 仍需已有 Playwright 和浏览器，测试不会自行安装依赖或下载浏览器。
- 清单和锁文件没有变更；package-lock SHA-256 仍为 `5CF9A082AE99CE9B12A62C6495D23529F81AF5C2A25735BE3003426BE694646A`。Node `24.22.2`、ESLint `10.13.0`，实际执行已验证该依赖路线；不把“零新增包”写成“零新增运行依赖”。

### 7.3 实际验证与限制

日志均在本工作树忽略的 `apps/desktop/.reports/`。以下最终验证退出码均为 0：

| 实际命令 | 结果 | 日志 |
| --- | --- | --- |
| apps/desktop：`npm run typecheck` | Node/platform 两套配置通过；不声称整体检查历史 app.js 或所有 .cjs | `p1-typecheck.log` |
| apps/desktop：`npm run lint` | 既有 ESLint、平台/CommonJS 检查和 15 份文档检查通过；没有改变门禁覆盖或规则 | `p1-lint.log`、最终复核 `p1-lint-final.log` |
| apps/desktop：`npm test` | 桌面 109 + 共享 242 = 351 项通过；约 31.74 s + 39.42 s。共享数量包含 2 个变体包装用例及 8 个新增定位检查，变体内部各 177 项不重复计入 351 | `p1-npm-test.log` |
| 根目录：`node --test test/dual-platform/source-loading.test.cjs` | 最后追加语法树等价校验后 10 项通过，含两轮各 177 项业务断言；约 47.16 s（与 AI 浏览器回归重叠运行，非性能基准） | `p1-source-loading-final.log` |
| 根目录：`node --test test/web-webdav/request.test.cjs` | 独立入口实际执行，9 项 mock 请求通过 | `p1-webdav.log` |
| 根目录：`node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'` | 实际 Edge AI 业务回归 47 项通过，约 130.69 s；全部使用只读 IIFE 桥接，页面错误、意外请求和 mock 违规均为 0 | `p1-web-ai.log` |
| apps/desktop：`npm run lint:docs` | 最终 15 份既有列表文档检查通过 | `p1-lint-docs-final.log` |
| 根目录：补充全部变更文档检查、`git diff --check` | 9 份变更文档的严格 UTF-8、围栏、本地链接；未跟踪文档行尾空白和全部已跟踪差异检查通过 | `p1-docs-supplemental.log` |

完整 npm 测试中的资源生成测试结束后才启动 AI 浏览器；AI 仅在当前命令进程设置 P0 交接的 NODE_PATH，结束恢复原值。浏览器沿用 P0 的既有 Edge/Playwright，隔离 context、自建题库、假凭据与 mock，没有访问真实 AI/WebDAV 服务或用户数据。没有用 self-test 代替业务回归。

本阶段仅修改测试入口和文档；没有改生产 Web、桌面、Rust、HTML、资源生成器、配置或依赖，因此没有重跑 build、Rust、Web 平台页面 98 项、隔离 WebView2、真实 PDF/OCR、大文件和真实服务验收。Node 文档生命周期 mock 不等于真实文档导入通过。P0 的这些基线记录继续保留，不冒充 P1 的新执行证据。语法解析及嵌套变体增加共享检查耗时，后续扩大覆盖时应保留可运行的时间预算。

### 7.4 未提交文件、风险与 P2 入口

全部内容仍未提交。当前共 21 个未提交/未跟踪文件：前阶段 6 份文档、P1 的 12 个测试/工具文件及 3 份运行说明；没有 commit、push、PR、标签、发布或 worktree 清理。

- 前阶段文档：`AGENTS.md`、`CONTRIBUTING.md`、`docs/README.md`、`rules/javascript-style-guide.md`、本设计、本计划。本阶段只同步 CONTRIBUTING 和设计状态、更新本计划进度及第 7 节，保留第 6 节 P0 历史及其他前置成果。
- 新增：`test/dual-platform/source-tools.cjs`、`test/dual-platform/source-loading.test.cjs`。
- 修改测试入口：`test/dual-platform/web-source.cjs`、`ai-connection.test.cjs`、`ai-harness.test.cjs`、`ai-import-retry.test.cjs`、`ai-codebuddy-execution.test.cjs`、`document-lifecycle.test.cjs`、`json-import.test.cjs`、`exit.test.cjs`，以及 `test/web-webdav/request.test.cjs`、`test/web-ai-practice/harness.cjs`。
- 修改运行说明：`test/web-webdav/README.md`、`test/web-ai-practice/README.md`、`test/dual-platform/fixtures/README.md`。
- 保留全部既有注释；没有删除生产函数、改变业务断言、向测试复制业务实现或引入生产解析/求值能力。

当前无阻碍 P2 的已知测试失败。仍需注意共享加载器的桌面 ESLint 依赖、测试耗时，以及严格函数名/单一 IIFE/末尾启动契约；P2 不得通过放宽定位或业务断言隐藏问题。现有 lint 仍不覆盖历史 app.js 和整个测试树，也尚未安装 Stylistic/import-x 或形成新债务报告。

用户最新明确要求“执行完 P1 先停止，我后续给你继续的信号”。P1 完成交接后停止全部阶段工作；P2—P5 需等待用户后续继续信号，不能自动启动。获得继续信号后，P2 再由主协调会话新建独立会话，先完整读取规则、设计、计划第 6—7 节并核对这 21 份未提交文件、HEAD、SSH origin 和现有依赖。随后只实施第 2 节 P2：核对插件发布与许可，按锁定 Node/ESLint 做隔离兼容烟测、违规/合法 fixture 和增量门禁；需要安装/重建依赖时重新核对本工作树占用进程。保留本阶段运行前提说明，评估把新增规范/运行说明纳入长期文档门禁，并按原方案更新真实覆盖数量。

本会话在 P1 完成后按用户要求停止，没有进入 P2—P5，没有创建后续会话或子代理，也不请求提前启动。后续收到继续信号后仍按独立新会话严格串行交接。

## 8. P2 增量门禁实施与交接（2026-11-05）

结论：P2 已完成验收并停止；P3—P5 未启动，等待用户继续信号。

### 8.1 本阶段边界与依赖验证

用户已明确要求“继续执行 P2，使用新会话，完成后先停止”。本阶段在唯一工作树 `C:/Users/30728/.codex/worktrees/8d15/shiroha-quiz-desktop`、既有分支 `codex/docs-airbnb-refactor` 实施；起始 HEAD 仍为 `cbd56bfdfe3fdbc9e87689cb5df560e573b80fcb`，起始 21 份未提交/未跟踪文件与 P1 交接一致，全部保留。完整读取根规则、JavaScript 指南、设计、计划第 6—7 节、协作分支规划及两份绝对路径外部规则；实际 SSH origin 匹配本仓库，无额外仓库专属规则。没有子代理、后续会话、分支切换、提交、推送或发布。

- 重新查询官方 registry：`npm view @stylistic/eslint-plugin dist-tags version license engines peerDependencies dependencies dist.unpackedSize dist.tarball --json --registry=https://registry.npmjs.org`。稳定版 `5.10.0`，beta 为 `6.0.0-beta.6`，选择稳定版；MIT，Node `^18.18.0 || ^20.9.0 || >=21.1.0`，ESLint peer `^9.0.0 || ^10.0.0`，官方 unpackedSize 为 713,026 字节。来源为 [npm 官方发布元数据](https://registry.npmjs.org/@stylistic%2feslint-plugin/5.10.0)；没有把 beta 当成稳定版。
- 在忽略目录 `apps/desktop/.reports/stylistic-smoke` 隔离安装 Stylistic 5.10.0 与 ESLint 10.13.0，`--ignore-scripts`；以真实 ESLint API 验证双引号违规被拒绝、单引号合法代码通过。实际 Node `24.22.2`、npm `11.19.1`、ESLint `10.13.0`，烟测 bad=1、good=0。
- 安装前沙箱内 CIM 进程查询“拒绝访问”；随后通过权限机制读取可执行路径和命令行，安装前再次核实未发现匹配 8d15 工作树的 Node/Electron/esbuild/桌面依赖占用进程，没有结束任何进程。在本工作树 `apps/desktop` 使用 `npm install --save-dev --save-exact @stylistic/eslint-plugin@5.10.0`，保持官方 registry、原 npm/锁文件，不使用 force 或 legacy-peer-deps。仅命令进程临时设置并恢复 `HUSKY=0`，避免重写多 worktree 共享 hooks。
- 唯一新增直接依赖为开发包 Stylistic；锁中新增 5 个开发包条目，已有包版本全部不变：Stylistic、其嵌套 visitor-keys 4.2.1（Apache-2.0）、espree 10.4.0（BSD-2-Clause）、@typescript-eslint/types 8.72.1（MIT）、picomatch 4.0.7（MIT）。新增包实际文件共 1,038,945 字节（按包排除嵌套 node_modules 后求和，非磁盘簇占用）；没有新增原生 resolver 或安装脚本。后续需维护插件及这些传递依赖的兼容性，升级前重新验证 peer/fixture。
- `npm ls --all --json` 和 `npm ls --depth=0` 均退出 0；锁与直接 devDependencies 保持一致。npm 再次提示已有 esbuild postinstall 未列入 allowScripts，没有放宽 allowScripts；实际资源构建验证见下表。
- 不引入 import-x：当前新增需要由核心 `no-duplicate-imports` 满足，缺失模块和循环没有本阶段新增的 resolver 需求。没有启用 `no-unused-modules`，没有宣称验证 Windows 原生 resolver、缺失模块、循环或未使用模块分析。没有安装 React/Next/Airbnb 整套配置、降级 ESLint或新增生产依赖。

### 8.2 实现、强制范围与退出边界

共享 `eslint.rules.mjs` 给两个既有 flat config 使用，保留 recommended、no-var、prefer-const 和原 no-unused-vars 参数约定。新增 8 项语义规则：eqeqeq（null 例外）、no-nested-ternary、no-param-reassign（props=false）、no-duplicate-imports、no-eval、no-new-func、guard-for-in、curly；新增 14 项 Stylistic 规则，与 JavaScript 指南第 4 节逐项一致。没有启用弃用的核心格式规则，100 字符仍为人工参考。

运行时区分 Node ESM、CommonJS 与浏览器 classic script；`frontend/bridge.js` 根据真实 esbuild 入口单独按 ESM 处理，产物和加载方式不变。只读全局按运行时设置；只有明确列出的 8 个既有 Playwright 宿主工具允许其序列化浏览器回调需要的浏览器名称。ESLint 无法区分同一宿主文件中浏览器回调与其他代码，故这些名称仍是文件级例外；没有扩大到所有 Node 文件。

`lint:incremental` 使用只读 Git 文件列表，包含未忽略的未跟踪新文件。除明确的数据/第三方/生成物和固定历史名单外，任何新手写 JavaScript 路径默认整文件执行完整目标规则；不按 Git diff 行检查，不用总告警上限抵扣新错误。正式门禁当前覆盖 **71 个完整文件**，其中：

| 实际强制范围 | 数量 | 说明 |
| --- | --- | --- |
| 原正确性规则 | 71 | 既有门禁保持强度，新路径同样适用 |
| 全部新增语义规则 | 24 | 其余文件只暂缓实际存在的特定规则 |
| 全部 14 项 Stylistic | 27 | 已零债务的 16 个旧文件直接收紧，没有为此改写源码 |
| 以上完整目标规则同时强制 | 18 | 三种计数有重叠，不可相加 |

完整目标规则的 18 个文件如下；原 P1 文件只是收紧检查，未改写其业务或测试预期：

- 桌面配置：`eslint.config.mjs`、`eslint.platform.config.mjs`、`eslint.rules.mjs`、`eslint.migration.mjs`、`commitlint.config.mjs`。
- 桌面 scripts：`check-docs.mjs`、`lint-incremental.mjs`、`lint-debt.mjs`。
- 桌面 test：`check-docs.test.mjs`、`config.test.mjs`、`distribution.test.mjs`、`git-hooks.test.mjs`、`platform-checks.test.mjs`、`lint-config.test.mjs`。
- `test/dual-platform/`：`ai-import-retry.test.cjs`、`pagination.test.cjs`、`source-loading.test.cjs`、`fixtures/dataset.cjs`。

正式门禁仍不是全仓已完成 Airbnb 迁移：

- `eslint.migration.mjs` 显式记录 44 个文件尚有特定 Stylistic 债务、47 个文件尚有 curly/no-nested-ternary/no-param-reassign 的特定语义债务；配置只暂缓真实未清零的文件/规则，其他零债务规则继续 error，不整批关闭格式规则。
- `legacyOutsideFiles` 固定 16 个原门禁之外的历史文件：app.js、6 个 CodeBuddy stdio 工具、8 个 Web AI 测试文件及 1 个 WebDAV 测试文件。新文件不继承整个目录的排除。它们目前进入语义报告，app.js 不做整体格式检查。
- `question-bank.js`、`apps/web/libs`、原始 `test/fixtures`、node_modules、dist、.reports、.git 和 src-tauri 产物不进入 JavaScript 门禁。当前已受检查的 `test/dual-platform/fixtures/dataset.cjs` 保留门禁，不因“fixture”名称而排除。
- 暂缓的同类规则尚不能阻断该文件内新增的同类问题；人工审查仍须遵守规范。后续逐规则/文件清零后删除例外，已清零范围不得退回。本阶段没有用总数预算声称全面防止历史债务增长，也没有为了全面清零而提前执行 P3—P5 的业务格式化或重构。
- 新增/迁移工具均只读检查源码和暂存区；`lint:fixtures` 写入的自建样例、Git 仓库及依赖 junction 全部位于隔离临时目录，测试结束清理。真实项目没有提交操作。

### 8.3 真实 fixture、债务报告与文档集成

- 初始 6 项 fixture 在旧配置下 5 失败、1 通过，记录于 `p2-lint-red.log`；真实报错验证新的语义/风格规则和运行时覆盖缺口。接线后补齐为 14 项，覆盖全部新增规则、合法项目例外、只读全局、桥接 ESM、未跟踪新文件发现、整文件只读，以及报告缺失/语法错误的非零退出。
- 收尾先补“历史文件的已清零格式规则仍须阻断”用例，初次真实失败于 training.js 的 quotes，记录 `p2-style-scope-red.log`；随后将暂缓配置进一步收窄为逐文件逐规则，最终 14 项全部通过。没有放宽任何有效断言。
- `npm run lint:debt` 输出 JSON：kind、文件、规则数量、行列和消息；默认对 69 个存在暂缓规则或原门禁之外的历史文件生成语义报告，另对其中 44 个文件生成格式报告。既有债务成功输出；解析、缺失文件、忽略导致未实际执行、配置或规则执行异常均失败，未使用成功退出码掩盖错误。
- 当前语义报告合计 curly 2,786、no-nested-ternary 52、no-param-reassign 45；app.js 单独为 1,907 / 43 / 39，其他 5 项新增语义规则在当前报告范围没有违规。格式债务合计 7,492 项：arrow-parens 598、object-curly-spacing 1,416、key-spacing 1,301、comma-spacing 2,676、space-infix-ops 1,116、keyword-spacing 296、space-before-blocks 57、semi 31、indent 1。零数量不是未来豁免；完整逐文件位置见本工作树 `apps/desktop/.reports/p2-debt.json`，可重跑生成。
- `npm run lint` 依次运行原 ESLint、platform、incremental、fixtures、docs；原 pre-commit 与 Windows CI 已调用此入口，因此不修改 hook/工作流文件，也不声称远程 CI 已执行。lint fixture 及 hook fixture 同步拷贝共享配置；hook 的原有首提交只读/暂存区保护断言保留。
- `lint:docs` 增加 JavaScript 指南、当前设计/计划、Web AI/WebDAV 运行说明，由 15 份变为 20 份；同步根规范和贡献说明，新增 5 份文档同样测试非法 UTF-8、围栏和链接拒绝。P0/P1 历史记录的 15 份保持历史事实，不改写成当前覆盖。
- 新配置初次 typecheck 暴露 JSDoc 类型上下文不足，已用 ESLint 的规则、全局和配置类型修正，没有 any、ts-ignore 或禁用检查。最终验证见下表。

### 8.4 本工作树最终验证

日志均保留于忽略目录 `apps/desktop/.reports/`，测试使用自建 fixture、隔离目录和 mock，没有真实账户、收费 API 或生产用户数据。

| 命令 | 实际结果 | 日志 |
| --- | --- | --- |
| `npm run typecheck` | Node/platform 两套配置通过 | `p2-typecheck.log` |
| `npm run lint` | 原门禁、71 个整文件增量检查、14 项真实 fixture、20 份文档通过，0 错误/警告 | `p2-lint.log` |
| `npm test` | 桌面 128 + 共享 242 = 370 项通过，无失败/跳过/取消/TODO；约 33.67 s + 43.15 s。P1 两轮各 177 项变体内断言不重复计入 | `p2-npm-test.log` |
| 根：`node --test test/web-webdav/request.test.cjs` | 独立入口 mock 请求 9 项通过 | `p2-webdav.log` |
| `npm run build` | 退出 0；真实资源生成/esbuild 及 Tauri release 构建成功，优化编译约 5m 22s；未打包发行安装器 | `p2-build.log` |
| `node scripts/lint-debt.mjs` | 实际输出语义/格式清单；执行失败路径由真实 fixture 证明返回非零 | `p2-debt.json` |
| `npm ls --all --json`、`npm ls --depth=0` | 完整依赖树通过；已有包版本无漂移 | `p2-npm-ls.json` |
| `npm run lint:docs`、全部变更文档补充检查、`git diff --check` | 最终 20 份长期文档检查、9 份变更 Markdown 的严格 UTF-8/围栏/本地链接、10 份未跟踪文本行尾空白及已跟踪差异通过 | `p2-lint-docs-final.log`、`p2-docs-supplemental.log`、`p2-diff-check.log` |

本阶段没有修改生产 Web/Rust/HTML/CSP、资源生成器、IPC 或用户数据运行行为，因此未重跑真实浏览器平台/AI、隔离 WebView2、PDF/OCR、大文件、安装升级或真实服务验收；P0/P1 的相关历史结果不冒充 P2 新执行证据。本次独立 WebDAV 复验补充确认共享 ESLint 解析入口仍正常。Rust 源码未改，不额外扩大到 fmt/Clippy/cargo test。构建需要已有 Rust 工具链，本进程临时补充 `C:/Users/30728/.cargo/bin` 后恢复 PATH，不修改系统环境。

### 8.5 交付状态与停止点

P2 已完成全部退出条件：锁定插件实际运行、违规被拒绝、合法例外被接受、已清零范围为 error、前置回归与构建通过，债务范围和真实缺口已写明。没有实现 P3—P5。

最终共 34 个未提交/未跟踪文件（24 个已修改 + 10 个未跟踪），包含全部 21 份前置成果。P2 新增 5 个工具文件：eslint.rules.mjs、eslint.migration.mjs、scripts/lint-incremental.mjs、scripts/lint-debt.mjs、test/lint-config.test.mjs；修改 8 个既有配置/工具文件：两个 ESLint config、package.json/package-lock.json、check-docs.mjs 及其测试、git-hooks.test.mjs、platform-checks.test.mjs。同步根规范、贡献指南、JavaScript 指南、当前设计/计划这 5 份前置文档；P1 的生产源码定位器、业务测试和运行说明成果保留，没有复制或回滚其他工作树内容。

构建自动重写了 16 个 permissions/autogenerated 文件的换行，Git 状态曾标 M 而规范化差异为空。逐文件确认起始无修改、索引等于 HEAD、规范化工作内容等于索引后，仅使用受限路径的 git restore --worktree 恢复本次构建造成的换行变化；没有改写权限内容、暂存区或前置成果，验证记录为 p2-generated-eol.json。最终 Rust、生产 Web、.github 和 .husky 无内容差异；没有手工编辑生成资源。

最终 package-lock SHA-256 为 `9E43872DEF93AC3E8ADBCB3BD9D40A61F5DF7A98EAB968048B6FA8D0F9C74D82`；完整性复核确认直接依赖与锁一致、旧包版本不变、所有暂缓规则都有真实对应违规（无多余豁免），见 p2-integrity.json。HEAD 和分支保持起始值，没有真实项目 commit、push、PR、标签、发布、分支/worktree 清理；报告和构建产物留在忽略目录。

本会话按用户要求在 P2 交付后停止。后续只有收到继续信号，主协调会话再按用户要求创建独立 P3 新会话；P3 需先读取第 8 节、全部当前规则并核对这 34 份前置文件，保持严格串行。本会话不创建后续会话或子代理。

## 9. P3 小范围可读性试点与交接（2026-11-05）

P3 已达到退出条件：三个试点文件与基线行为一致，完整目标规则无错误或警告，公开接口、存储键和数据格式未变。用户最新信号已授权继续剩余阶段，主协调会话应严格串行创建 P4、再创建 P5 的独立新会话；本 P3 会话只交接并停止，不创建后续会话或子代理。

### 9.1 范围、行为与规则收紧

起始工作树为 `C:/Users/30728/.codex/worktrees/8d15/shiroha-quiz-desktop`，分支 `codex/docs-airbnb-refactor`、HEAD `cbd56bfdfe3fdbc9e87689cb5df560e573b80fcb`，SSH origin 为 `git@github.com:Nancyingcode/shiroha-quiz-desktop.git`。起始 34 个未提交/未跟踪文件与第 8 节一致并全部保留；没有修改主工程或其他工作树。完整读取工作树根规范、JavaScript 指南、设计、计划、协作分支规划，以及 `C:/Users/30728/.codex/global-rules/AGENTS_condition_rules.md`、`C:/Users/30728/.agents/AGENTS.md`；两份外部规则读取成功，共享入口的另一仓库专属正文不适用。没有新增依赖或修改锁文件。

| 文件 | 实际工作与已清零债务 |
| --- | --- |
| `apps/web/training.js` | 拆分声明、整理回调括号和复盘结构、展开单行条件；清零 5 个 `curly` 和 5 个 `@stylistic/arrow-parens`。`ShirohaTraining` API、时钟、复盘和快照语义不变 |
| `apps/web/platform/index.js` | 展开桌面已注入平台检查、存储事件和平台对象；清零 2 个 `curly` 和 3 个箭头括号问题。原注释、存储键、事件处理和对象所有权保留 |
| `apps/desktop/scripts/lint-platform.mjs` | 展开输出和失败退出条件；清零 2 个 `curly` 和 1 个箭头括号问题，保留原注释和退出行为 |
| `apps/desktop/eslint.migration.mjs` | 仅移除上述三个文件已实际清零的语义和格式例外；没有新增例外 |
| `test/dual-platform/training-characterization.test.cjs`、`platform-index.test.cjs` | 增加时钟边界与所有权、未提交题目的嵌套及草稿快照、桌面注入优先级和浏览器存储事件的特征测试 |
| `apps/desktop/test/lint-config.test.mjs` | 对三个试点逐一验证所有适用的目标规则确实阻断违规；保留 P2 既有测试 |

未更改 `||`、`??`、宽松比较、参数修改或自增的业务语义；没有以 autofix 推断等价。对三个试点与 HEAD 的真实语法树做规范化对照，在忽略单语句 `if` 的新增花括号以及同一声明拆成独立声明后均一致，字面量和调用保留。既有测试覆盖暂停、恢复、停止、复盘顺序、跨库同 ID、已答与未答记录；补充测试固定其余边界。分别在内存源码副本中模拟未答题快照共用原对象、覆盖桌面已注入平台，新增测试均先按预期失败，真实源码随后通过；没有改生产文件制造红灯。三个试点的 lint 收紧测试在旧例外存在时分别因 `curly` 失败，移除对应例外后全部通过。

当前正式增量门禁覆盖 73 个完整手写文件：23 个执行全部目标规则、29 个执行全部新增语义规则、32 个执行全部 Stylistic 规则，数量有重叠。仍有 41 个文件列有格式债务、44 个文件列有语义债务；其他规则仍强制。当前债务报告为 `curly` 2,777、`no-nested-ternary` 52、`no-param-reassign` 45，格式合计 7,483；app.js 仍仅做语义诊断，不能把历史暂缓范围说成全仓通过。贡献指南和 JavaScript 指南的覆盖数量已同步。

### 9.2 实际验证与限制

Node 24.22.2、npm 11.19.1、Edge 156.0.4314.58、Rust/Cargo 1.99.1；沿用本工作树已有依赖，没有重新安装。以下为本阶段实际运行，全部退出码为 0：

| 命令或检查 | 结果与范围 |
| --- | --- |
| 训练/业务最小回归 | `node --test test/dual-platform/training-characterization.test.cjs test/dual-platform/training.test.cjs test/dual-platform/business.test.cjs`，18 项通过 |
| 平台/存储最小回归 | `node --test test/dual-platform/platform-index.test.cjs test/dual-platform/browser-storage.test.cjs`，8 项通过 |
| 桌面脚本最小回归 | `node --test test/platform-checks.test.mjs`，3 项通过；试点全规则 fixture 3 项通过 |
| `npm run typecheck`、`npm run lint` | 两套类型配置通过；73 个完整文件、17 项 lint fixture 和 20 份文档检查通过，零错误/警告 |
| `npm test` | 桌面 131 + 共享 246 = 377 项通过，无失败、取消、跳过或 TODO；约 81 秒，见 `p3-npm-test.log` |
| `npm run test:web-platform` | 本机 Edge 独立上下文 98 项通过，约 111 秒；见 `p3-web-platform.log` |
| `node --test test/web-webdav/request.test.cjs` | 9 项 mock 请求通过 |
| `node test/web-ai-practice/runner.cjs --executable-path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'` | 47 项真实页面 mock 回归通过，约 124 秒；无页面错误、意外请求或 mock 违规，见 `p3-web-ai.log` |
| `npm run build` | 真实资源生成和 Tauri release 构建成功，约 85 秒，未打包安装器；见 `p3-build.log` |
| `npm run build:test` | 独立 native-test release 构建成功，约 305 秒；见 `p3-build-test.log` |
| `npm run test:desktop` | 隔离 WebView2 39 项全部通过，约 127 秒；包括复盘重启、离线、中文扫描 PDF/DOCX/XLSX 自建样例导入，见 `p3-desktop.log` |
| 文档与差异检查 | `npm run lint:docs`、变更文档补充检查和 `git diff --check` 通过 |

类型检查约 2 秒，完整 lint 约 10 余秒；共享测试的两种源码变体各运行 177 项已有断言，明显增加测试耗时。通过两种实际 ESLint 配置再次核对三个试点，22 条新增语义和格式规则均为 error。`git diff --check` 返回 0，但 Git 对部分前置文件提示 LF 下次检出会转换为 CRLF；未为消除提示而改写这些文件。

日志均在本工作树忽略的 `apps/desktop/.reports/`。浏览器和桌面测试使用隔离上下文/profile、自建题库、假凭据及 mock；桌面离线检查记录 514 次本地资源、0 次远程请求、0 个脚本错误。中文扫描 OCR 结果经过测试中的人工复核模拟，不代表所有扫描质量均可自动识别。没有调用真实收费 API 或访问真实用户数据；没有验收真实 WebDAV/AI 服务、大文件压力、干净系统安装/升级或正式发行。构建进程临时加入 Cargo PATH，AI 回归进程临时设置已有 Playwright 的 `NODE_PATH`，均未修改系统环境。

构建前确认 `permissions/autogenerated` 无工作树或暂存区改动。构建后 16 个文件因检出行尾显示修改；逐一确认起始干净、暂存区等于 HEAD、当前原始内容及规范化内容与暂存区一致，仅对这 16 个已核验文件恢复检出行尾。没有覆盖前置修改或其他文件。锁文件 SHA-256 仍为 `9E43872DEF93AC3E8ADBCB3BD9D40A61F5DF7A98EAB968048B6FA8D0F9C74D82`。

### 9.3 未提交状态与 P4 入口

最终共 39 个未提交/未跟踪文件（27 个已修改、12 个未跟踪），包含 P0—P2 的 34 个前置文件和 P3 新增的 3 个已跟踪试点修改、2 个未跟踪特征测试；没有提交、推送、PR、标签、发布或工作树清理。构建与验收报告保留在忽略目录。

P4 可开始：由主协调会话创建独立新会话，先完整读取规则与本计划并核对 39 个未提交文件、分支、HEAD 和依赖；按已批准计划逐切片核对调用图、补特征测试，再处理分页/答案比较、解析/答案合并、备份转换/媒体 IO。必须维持 IIFE/global 加载、既有调用入口、数据格式与安全边界，并在每个切片完成相关测试及资源接线；不可把本阶段规则清零误当作 app.js 已迁移。本会话不执行 P4/P5；主协调会话在 P4 交付后再创建 P5，会话顺序及全部剩余阶段完成后的停止点遵循用户最新授权。

## 10. P4 业务切片实施与交接（2026-11-05）

P4 已完成。唯一工作树为 `C:/Users/30728/.codex/worktrees/8d15/shiroha-quiz-desktop`，分支 `codex/docs-airbnb-refactor`，HEAD 为 `cbd56bfdfe3fdbc9e87689cb5df560e573b80fcb`。实际 origin 为该项目的 SSH 地址；起始 39 个前置改动全部保留，没有修改主工程、其他 worktree、依赖或锁文件。按用户要求，本会话只完成 P4，P5 由主协调会话另建独立新会话执行。

### 10.1 切片、调用图与所有权

| 切片 | 已抽取的真实实现 | 留在原边界及原因 |
| --- | --- | --- |
| 分页与答案比较 | `apps/web/quiz-core.js` 持有页码范围、页码列表和单选/多选/判断/多空/文本答案比较；多空和文本归一化通过原有纯规则函数传入 | 页面分页状态、DOM、练习和考试状态仍在 `app.js`；`scoreOf` 继续读取界面默认分，题目自定分和简答人工自评语义不变 |
| 文本解析与答案合并 | `apps/web/text-answers.js` 持有答案表解析、原文题号识别，以及按重复题号选择答案候选的计算；原应用先完成文本预处理再调用 | `parseTextQuestions` 仍拥有候选策略、导入报告与诊断等状态；题目归一化、合并警告和结果接入仍在 `mergeQuestionAnswers`，避免移动依赖时间、元数据或状态的操作 |
| 备份转换与媒体 | `apps/web/backup-core.js` 持有备份版本拒绝、记录及复盘的题库引用映射、图片 MIME 选择 | `normalizeBackupPayloadV23` 仍负责题库归一化、生成缺失 ID/时间和旧格式转换；`mergeBackupBanksV23` 持有状态修改；`readBackupFileV24`、图片绑定、文件读取、取消及失败回滚保持原受控边界 |

页面按 training → quiz-core → text-answers → backup-core → app 的 classic script 顺序加载；桌面资源生成器的条目与必需资产列表、共享测试桥接和加载顺序测试同步更新。新模块不自行访问 DOM、存储或原生 invoke；文本预处理仍在原调用侧。各旧入口为绑定或薄适配，原计算函数体已移走；对函数定义及调用点核对没有第二份业务实现。原 `app.js` 的 217 条注释经语法树比较均保留，移动的答案表注释仍随原逻辑保留。没有变更 CSP、持久化格式、IPC 权限或凭据策略。

先在原实现上固定负页码、空答案、重复选项、多空位置、粘连答案表、重复题号以及题干/答案/解析区分；新模块独立加载测试先因文件或接口缺失失败，接线后通过。版本判断的短路顺序和文本预处理边界分别增加失败用例并修正。最终源码与基线对照了 3,622 组分页、比较、答案表、匹配与题号识别输入，包含全角字符和 Word XML；自建旧 Android JSON/ZIP、图片、学习记录、未知版本、失败/取消保全及假凭据排除继续由实际业务回归覆盖。

### 10.2 最终验证与限制

Node 24.22.2、Edge 156.0.4314.58、Cargo 1.99.1；沿用既有依赖，仅命令进程临时设置 Edge、Playwright 和 Cargo 路径。测试使用自建题库、假凭据、隔离 profile 与 mock。

| 检查 | 实际结果 |
| --- | --- |
| 各切片最小回归 | 分页/评分、文本/圈号/双文件、JSON/ZIP/旧 Android 及失败保全回归通过；新增无 DOM 脚本加载测试通过 |
| `npm run typecheck`、`npm run lint` | 通过；79 个整文件进入增量门禁，其中 29 个完整目标规则、35 个全部新增语义、38 个全部 Stylistic；17 项 lint fixture 和 20 份文档检查通过。类型检查仍不覆盖整个历史 `app.js` 或新共享计算脚本 |
| `npm test` | 桌面 131 + 共享 255 = 386 项通过，无失败、取消、跳过或 TODO；两种源码排版变体各运行 183 项业务断言 |
| `npm run test:web-platform` | 实际 Edge 98 项通过；整理新增断言后单独复验 `file://` 启动和脚本顺序通过 |
| `npm run test:documents` | 离线中文扫描 PDF、文本 PDF、DOCX、XLSX 导入保存重载及识别取消通过；OCR 结果按测试模拟人工核对 |
| WebDAV、单题 AI | `node --test test/web-webdav/request.test.cjs` 9 项；实际 Edge AI mock 47 项通过，无页面错误或 mock 违规 |
| `npm run build`、`npm run build:test` | 真实资源生成、普通 release 与独立 native-test release 构建通过；未打包安装器 |
| `npm run test:desktop` | 隔离 WebView2 39 项通过；离线记录 552 次本地请求、0 次远程请求、0 个脚本错误，包括复盘重启、备份及中文扫描文档 |
| 文档与差异 | `npm run lint:docs`、全部变更 Markdown 的 UTF-8/围栏/本地链接及 `git diff --check`；Git 仅提示部分既有文件下次检出会转换行尾 |

日志保存在工作树忽略的 `apps/desktop/.reports/p4-accept-*.log`，补充报告包括 `p4-final-debt.json`、`p4-file-url-final.log` 和权限文件核验记录。测试构建首次启动时工具会话中断，确认无遗留构建进程后保留 `p4-interrupted-build-test.log` 并重新构建成功。构建前记录的 16 个权限生成文件均无工作树或暂存改动；构建后逐项核对 HEAD、索引和规范化内容一致，且当前字节等于索引后，才恢复构建前的精确字节。最终权限目录状态干净。锁文件 SHA-256 仍为 `9E43872DEF93AC3E8ADBCB3BD9D40A61F5DF7A98EAB968048B6FA8D0F9C74D82`。

当前债务报告为 `curly` 2,757、`no-nested-ternary` 52、`no-param-reassign` 43，格式合计 7,483；`app.js` 仍只做语义诊断，不能将其描述为全文件已迁移。历史文件的暂缓规则仍需人工审查。没有验收真实 AI/WebDAV 服务、大文件压力、干净系统安装/升级或正式发行；OCR 样例通过不代表所有扫描质量可自动识别。

### 10.3 工作树与 P5 入口

最终共 52 个未提交/未跟踪文件（34 个已修改、18 个未跟踪），包含全部 39 个 P0—P3 前置成果以及 P4 的 7 个新改动已跟踪文件、6 个新文件。P4 新文件为三个共享脚本及对应 `quiz-core.test.cjs`、`text-answers.test.cjs`、`backup-core.test.cjs`。既有测试桥接、计划和说明中的前置修改均保留；没有提交、推送、PR、标签、发布或工作树清理。

P5 可以由主协调会话按授权创建独立新会话并开始：先完整读取适用规则、设计和本计划，核对上述工作树、HEAD、52 个未提交文件及 P4 结果；在保留本阶段接口和测试的前提下，按计划分别评估练习/考试、AI 会话和桌面适配器的状态所有权。P5 应先固定迟到响应、重复提交、草稿和失败回滚等行为；若需要新的公共接口，按已批准流程确认设计。本 P4 会话不执行 P5，不创建后续会话或子代理。

## 11. P5 高风险状态审查与最终交接（2026-11-05）

本阶段在既有 8d15 工作树串行执行；起始分支、HEAD 与第 10 节一致，34 个已修改及 18 个未跟踪文件均保留。以下记录调用关系、状态所有权、实际改动和验证结果。

| 状态所有者与调用链 | 进入、退出与清理 | 失败、重试与迟到屏障；已有覆盖 |
| --- | --- | --- |
| 练习：`app.js` 的 `practice`、计时器及答题状态；`startPractice → loadNativeItems → renderPracticeQuestion → submitPractice/submitTotalPractice → finishPractice → runMutation` | 新轮次更换对象并释放旧计时器和单题 AI；暂停捕获草稿，离开总提交前需确认，锁定后须完成自评及保存 | 练习正文请求序号防止旧启动覆盖新启动；总提交确认标记防连击，保存事务冻结界面并恢复对象与正文视图；训练、总提交、退出和浏览器保存失败测试覆盖 |
| 考试：`app.js` 的 `exam`、倒计时和答卷；`startExam → loadNativeItems → renderExamPaper → submitExam → runMutation` | 新考试替换对象并清除旧计时器；到期触发自动交卷，保存成功才清除计时器 | 正文请求序号拒绝旧启动；提交状态和事务互斥阻止重复，保存失败恢复答卷及记录，禁止计时器自动重试失败事务；页面测试覆盖失败、重复和迟到输入 |
| AI 会话：练习题会话 Map 归当前轮次，错题解析 Map 归当前页面；`runAiSingleAnalysis/FollowUp → requestAiChat → saveAiSingleAnalysis` | 换轮/题目变化时中止并清理；停止请求保留草稿和历史；解析须人工确认保存 | 会话对象、请求序号、题目指纹和轮次共同阻挡迟到响应；失败保留草稿，保存失败回滚。Edge mock 覆盖取消、新轮迟到、重试和保存失败 |
| 桌面 adapter：当前页面持有原生 revision、摘要 baseline 和已加载正文集合；`initialize/read → ensureQuestions/Records → write` | 初始化清空视图；正文按需加载，事务通过 `checkpointView` 同步回滚；释放只卸载未修改正文 | 未加载正文不得作为修改写入；写入失败查持久回执区分丢包，修订变化拒绝旧读取；既有测试覆盖摘要释放、回滚及回执，直接拒绝写入和恢复后旧读取需补回归 |
| 桌面 harness：当前窗口持有配置、在途任务、准备与轮询；`initialize/control → execute/cancelAll`，设置与账户变化推进失效边界 | 初始化、切换、取消和退出废弃旧流程并清除定时器；执行完成后等待停止并查询终态 | generation、revision、请求序号、查询屏障及账户 epoch 联合阻挡旧结果；失败阻断执行并保留设置草稿供重试。现有 Harness/CodeBuddy 测试覆盖恢复、迟到、取消、失败和重试 |

### 11.1 逐项审查与修改边界

- 练习与考试：本轮对象分别由 `practice`、`exam` 持有；启动正文读取以前递增请求序号。练习时钟按运行段累计，暂停和确认前捕获草稿，换轮和退出释放计时器；总提交在异步确认期间阻止连击，锁定后完成简答自评并由单一写入事务生成记录。考试按墙钟截止，退出确认不暂停倒计时，保存成功才清除计时器；提交失败由 `runMutation` 回滚答卷、记录和正文视图，自动交卷不会绕过失败状态重复写入。将练习当前题和锁定条件命名，并由同一考试会话共享可编辑条件；未调整提交、计时、草稿或回滚顺序。既有 `training*.test.cjs`、`exit.test.cjs`、`browser-page.cjs` 和 AI runner 的 `submit-modes` 覆盖时钟、草稿、自评、重复提交、失败重试及迟到事件。
- 单题与错题 AI：单题会话按本轮对象、题库/题目键、内容指纹和请求序号归属；换轮或题目变化中止并清理，停止、超时或失败保留已生成解析、历史与追问草稿，成功结果须仍属于原会话。单题解析与追问共用原本相同的有效性判断；保存仍由用户确认并保留失败回滚。错题解析另以场景/来源和上下文持有会话，卸载时中止并删除；不合并两种生命周期。现有 Edge AI mock、`ai-codebuddy-execution.test.cjs` 覆盖新轮、切题、停止、迟到、失败和重试。
- AI 导入与批量预览：两个任务互斥，分别持有控制器及运行状态，超时/取消释放计时器；导入失败恢复先前预览，只有收到内容但业务结构无效才可请求文本兜底；批量结果以题目指纹拒绝已更改内容，已生成建议保留人工确认。此处保留原有状态和调用次序，未引入与单题不同生命周期的通用状态机；`ai-import-retry.test.cjs` 覆盖传输失败不重试与结构失败兜底。导入及批量对不遵守 AbortSignal 的假传输没有独立迟到响应端到端覆盖，不将单题测试延伸为该场景通过。
- 桌面 adapter：初始化失败禁止写入，摘要 baseline、已加载题目和记录集合由页面所有；事务检查点一并回滚这些集合。题目、记录及完整数据补读在响应后校验同一个原生修订；恢复成功变更 revision，旧响应不得写入视图。提炼重复的修订校验，不改变 IPC、持久化或持久回执查询；已有测试覆盖读取、释放、失败视图回滚及丢失回包后的回执确认，本阶段新增五项未加载正文拒绝写入及恢复后旧读取拒绝、重新读取测试。
- 桌面 harness：配置、准备、授权轮询和在途执行归当前窗口；取消、初始化、切换或退出使 generation/setupGeneration 失效，取消等待原生终态，观察序号和变更屏障防止同 revision 的旧查询覆盖新状态，账户 epoch 另保护 CodeBuddy。状态不明时保持不可执行，设置失败保留草稿供主动重试。六处授权轮询计时器清理改为共用原有操作；保留查询屏障、generation、revision、账户状态和异步顺序。既有 `ai-harness.test.cjs`、`ai-codebuddy-execution.test.cjs` 覆盖取消、重试、恢复、迟到状态及账户变化。
- 回滚、计时器及任务注册表仍留在各自所有者中：这些代码直接依赖 DOM、事务、原生回执或不同的取消语义，共用会改变调用次序或混淆生命周期；本阶段未引入公共接口、全局状态库、依赖、IPC、权限、凭据或持久化格式，也未改 P4 脚本次序和旧备份兼容。

### 11.2 回归、受控变异与实际验证

新增五项 adapter 回归：分别拒绝未加载题目/记录的修改并允许原摘要重试保存；恢复点使 revision 从 1 变为 2 后，迟到的题目、记录与完整数据补读均不能改写旧视图，重新读取使用恢复后的内容。真实源码通过；在临时副本分别移除题目和记录写入守卫、三个读取修订守卫后，五项测试均因预期拒绝未发生而失败，再以真实源码通过。没有在生产文件上制造红灯，也没有放宽原有断言。

本阶段直接使用本机 Node 24.22.2、npm 11.19.1、Edge 156.0.4314.58、Cargo 1.99.1；Edge、Playwright 和 Cargo 路径仅在相应命令进程设置。测试使用自建题库、假凭据、mock 和隔离 profile，不调用真实收费 API 或操作真实用户数据。

| 检查 | 本阶段实际结果 |
| --- | --- |
| 切片最小回归 | adapter/服务 24 项、Harness/CodeBuddy 89 项、训练/退出 12 项通过；真实 Edge 练习/考试针对性 3 项、单题 AI 迟到响应 5 项通过 |
| `npm run typecheck` | Node 与平台两套类型配置通过；历史 `app.js` 不做全文件类型检查 |
| `npm run lint` | 最终复验通过：79 个完整文件、17 项 lint fixture 与 20 份文档检查 |
| `npm test` | 桌面 136 项、共享 255 项，共 391 项通过，无失败、取消、跳过或 TODO；两种排版变体各执行 183 项既有业务断言 |
| `npm run test:web-platform` | 真实 Edge 页面 98 项通过，包括总提交、考试超时与失败重试、旧 Android JSON/ZIP 及 `file://` 启动 |
| Web 单题 AI、WebDAV | 完整 Edge AI mock 47 项、WebDAV mock 9 项通过；没有页面异常、意外远程请求或 mock 违规 |
| `npm run test:documents` | 离线中文扫描 PDF、文本 PDF、DOCX、XLSX 导入保存重载及识别中取消通过；中文 OCR 结果在测试中模拟人工核对 |
| `npm run build`、`npm run build:test` | 普通 release 和独立 native-test release 成功；分别约 2 分 17 秒、2 分 32 秒，未打包安装器 |
| `npm run test:desktop` | 首次 36/39：Harness 登录步骤 30 秒超时，随后 Harness 切换按钮不可见，重启窗口尺寸为 1280×860 而预期 1100×760；没有记录第一个超时的具体等待步骤。未更改源码或重建，使用新隔离 profile 完整重跑 39/39 通过，包括上述三项；原因未确定。重跑离线记录 555 次本地请求、0 次远程请求、0 个脚本错误 |

正式增量门禁仍覆盖 79 个完整手写文件，其中 29 个执行全部目标规则、35 个执行全部新增语义规则、38 个执行全部 Stylistic 规则；计数有重叠。没有改变迁移清单或例外，`app.js` 仍仅做语义诊断。实际债务报告为 `curly` 2,753、`no-nested-ternary` 52、`no-param-reassign` 43、格式合计 7,474；历史暂缓文件的同类新增问题仍须人工审查，不等于全仓迁移完成。

### 11.3 工作树、构建副作用与停止点

本阶段开始时 52 个前置未提交/未跟踪文件与 P4 交接一致。P5 额外修改 `apps/desktop/frontend/adapter.js`、`apps/desktop/frontend/harness.js`、`apps/desktop/test/native-adapter.test.mjs`，并在已有 `apps/web/app.js`、本计划及规则入口文档内追加本阶段内容；前置成果均保留。两个桌面前端文件在内存中展开新辅助函数后与阶段前 HEAD 文本一致。没有新增依赖、提交、推送、PR、标签、发布或工作树清理；锁文件 SHA-256 为 `9E43872DEF93AC3E8ADBCB3BD9D40A61F5DF7A98EAB968048B6FA8D0F9C74D82`。

构建前 16 个生成权限文件均无工作树或索引改动，索引、HEAD 与规范化内容一致；构建后再次逐项核对并确认与原始内容只相差行尾，才恢复记录的原始字节，权限目录状态恢复干净。日志与债务报告位于本工作树忽略目录 `apps/desktop/.reports/p5-*.log`、`p5-debt.json`；首次 WebView2 失败和重跑日志分别保留。

P0—P5 交付后停止，不创建后续会话或子代理。未覆盖真实 AI/WebDAV 服务、忽略 AbortSignal 的 AI 导入/批量假传输、大文件压力、独立干净系统安装/升级和正式发行；这些不由本阶段通过结果替代。
