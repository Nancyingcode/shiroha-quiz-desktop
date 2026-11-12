# JavaScript 风格指南：Airbnb 项目适配

引入日期：2026-11-05。适用于本仓库手写 JavaScript；TypeScript 沿用适用的语言规则，类型要求以项目配置为准。修改 JavaScript/TypeScript 前阅读本文和[根开发规范](../AGENTS.md)。

## 1. 来源、定位与执行状态

- 上游：[Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)。本次核对版本为提交 [8ed19247](https://github.com/airbnb/javascript/blob/8ed19247bef145e3cc41b24a02dd1fe6d9b5e681/README.md)，采用来源链接和中文适配说明，不复制整份上游指南；上游采用 MIT 许可。
- 本文是项目适配规范。冲突时依次遵循项目安全边界、根规范的流程与行为规则、实际自动化配置、本文及上游参考。发现规范与配置不一致时记录并修正，不静默换用另一套风格。
- 新增代码和本次实际修改的逻辑按本文编写；历史文件按重构批次迁移，不要求为一个小修复格式化整个文件。
- P2 自动化采用 `@eslint/js` recommended、`no-var`、`prefer-const`、现有 `no-unused-vars`、显式语义规则和 Stylistic 5.10.0；保持 ESLint 10 和原有类型检查。没有安装 Airbnb 整套配置、import-x、Prettier 或 React/Next 预设。实际强制范围与暂缓规则见第 4 节；门禁通过不代表全部历史业务行为均已验证。
- 2026-11-08 结合风格审查与上游指南，分批处理语义和 Stylistic 规则及其历史命中；插件和依赖版本不变。下方规则列表以实际配置为准。
- 自动化引入与历史重构见[设计](../docs/superpowers/specs/2026-11-05-airbnb-javascript-refactor.md)和[已批准实施计划](../docs/superpowers/plans/2026-11-05-airbnb-javascript-refactor.md)。上游更新先核对差异和兼容性，再更新本地规范，不随上游默认分支自动漂移。

## 2. 日常编写约定

| 主题 | 项目采用方式 |
| --- | --- |
| 变量与作用域 | 默认 `const`，需要重新赋值时使用 `let`，禁止新增 `var`；一条声明定义一个变量，避免链式赋值和隐式全局变量 |
| 对象与数组 | 优先字面量、清晰的属性简写和适量解构；纯计算不修改输入，展开运算符只保证浅复制，不能当作嵌套数据隔离 |
| 函数 | 业务函数采用明确名称，普通回调优先箭头函数；依赖动态 `this`、事件处理语义或提升的函数保留原形态；默认参数和 rest 参数优先于手工处理 `arguments` |
| 条件与状态 | 默认严格相等比较；可空值、数字零、空字符串和显式 `false` 的语义必须保留。复杂条件提取业务名称，相关字段共享判断，避免嵌套三元表达式 |
| 字符串 | JavaScript 使用单引号，插值使用模板字符串；不能为统一引号破坏正则、公式反斜杠、HTML、题干或换行内容 |
| 格式 | 使用 2 空格缩进和分号，控制语句使用花括号；多行列表采用尾逗号，箭头函数参数使用括号；可读代码以 100 字符为换行参考，长字符串、URL、正则和 JSDoc 类型不机械拆分 |
| 命名 | 普通变量和函数使用 camelCase，类使用 PascalCase；稳定业务常量可用 UPPER_SNAKE_CASE。存储字段、IPC、DOM ID、CSS 类和历史备份标识不因命名风格更改 |
| 错误与异步 | 保留错误传播、取消、失败回滚和重试语义；不能用空 `catch`、默认成功值或未等待的 Promise 掩盖失败 |
| 注释 | 解释业务原因、生命周期、不变量和兼容边界；TODO 描述明确动作。保留既有有效注释，删除注释仍遵循根规范的确认要求 |

完整语言风格参考上游的 References、Objects、Functions、Comparison Operators、Whitespace、Naming Conventions 等章节；项目例外见下节。

## 3. 与上游不同的项目约定

| 上游主题 | 本项目处理与原因 | 重新评估条件 |
| --- | --- | --- |
| Babel、polyfill 假设 | 不因引入指南安装 Babel 或浏览器 shim；沿用 Node 24、现有浏览器/WebView2 和 esbuild 资源处理 | 有明确兼容缺口且独立验证后再评估 |
| ESM 与 IIFE | 桌面 `.mjs` 保留 ESM，测试 `.cjs` 保留 CommonJS；浏览器脚本继续按现有 IIFE/global 接口加载 | 独立批准加载方式变更并验证 Web、本地文件入口、桌面 CSP 后 |
| 导入扩展名与导出 | 原生 Node ESM 使用正确扩展名，保留已有具名导出；不强制 default export、不为省略扩展名增加 bundler 或 resolver | 实际运行方式改变后 |
| 函数声明与提升 | 不为上游函数表达式偏好批量改写现有函数声明；先检查调用顺序和测试加载方式 | 按业务切片抽取并验证时 |
| `for...of`、顺序 `await` | 允许需要提前退出、顺序写入、取消或节制内存的循环；有纯映射语义时再用数组方法，避免异步 `forEach` | 具体性能或行为证据表明应改写时 |
| 参数对象修改 | 新增纯计算不改输入；现有状态所有者、DOM 和 IPC 适配器允许在明确边界内修改拥有的对象，不为通过规则深复制全部状态 | 对应模块拆分并验证所有权后 |
| `== null` | 仅允许有意同时判断 `null` 与 `undefined` 的场景；不能扩展到其它宽松比较，也不把所有 `||` 自动替换成 `??` | 业务明确只接受其中一种值时 |
| 下划线名称与历史版本后缀 | 保留测试 `_` 参数、既有公开名称和 `V23` 等内部后缀；在调用者、HTML、生成脚本和测试引用全部迁移后才局部改名 | 对应切片完成迁移时 |
| 格式工具 | 目标格式采用上表；使用已验证兼容 ESLint 10 的 Stylistic 5.10.0，不新增已弃用的核心格式规则 | 插件升级前重新核对发布、peer 和运行烟测 |

## 4. 覆盖范围与迁移边界

- 首批关注 `apps/desktop/scripts/`、`apps/desktop/test/`、桌面配置、`apps/web/platform/`、`apps/web/training.js`、`apps/desktop/frontend/` 和 `test/dual-platform/`；保持现有运行时分类，不将 classic script 错配成实际 ESM 模块。
- `apps/web/app.js` 由现有 IIFE 持有业务状态；该入口已进入完整基础、语义和 Stylistic 门禁。现有业务切片、数据与状态边界保持不变。
- `apps/web/question-bank.js` 是内置题库数据载体，保留题库内容及本地文件兜底。`apps/web/libs/`、生成的 `apps/desktop/dist/`、Tauri 的 `target/` 与 `gen/`、构建产物和历史 fixture 不参与风格批量重写；Tauri 目录中的手写 JavaScript 仍进入门禁。
- 手写测试工具已纳入增量门禁；原始样例、题库文本和预期数据按数据契约维护，不能用格式化结果替换行为断言。
- `npm run lint:incremental` 在现有门禁之外发现 Git 跟踪和未忽略的新手写 `.js/.mjs/.cjs`，扩展名大小写均纳入检查，新路径默认执行完整目标规则，不继承其他文件的专属全局变量或排除项。工作树中已删除的索引路径不阻断其他文件的检查；其他文件访问错误仍会失败。P5 交付时的历史快照为 79 个整文件，其中 29 个达到全部新增目标规则，35 个执行全部新增语义规则，38 个执行全部 Stylistic 规则，三个数量有重叠。[本次 app.js 拆分计划](../docs/superpowers/plans/2026-11-08-web-app-js-split.md)记录新增模块按现有完整增量门禁检查；最新覆盖数量以该命令输出为准。
- 除基础规则外，语义门禁包括 `eqeqeq`、`no-nested-ternary`、`no-param-reassign`、`no-duplicate-imports`、`no-eval`、`no-new-func`、`guard-for-in`、`curly`、`no-new-object`、`object-shorthand`、`no-array-constructor`、`array-callback-return`、`prefer-rest-params`、`prefer-spread`、`prefer-arrow-callback`、`no-useless-constructor`、`dot-notation`、`prefer-exponentiation-operator`、`no-unneeded-ternary`、`no-else-return`、`no-new-wrappers`、`radix`、`no-restricted-globals`、`prefer-object-spread`、`default-param-last`、`no-multi-assign`、`one-var`、`arrow-body-style`、`new-cap`、`camelcase`、`class-methods-use-this`、`prefer-destructuring`、`no-use-before-define`、`no-loop-func`、`no-plusplus`、`prefer-template` 和 `no-unused-expressions`。允许有意的 `== null` 和参数对象属性修改；`forEach` 回调不强制返回值，依赖动态 `this` 的回调保留函数写法；限制全局 `isNaN`、`isFinite`。
- 命名检查不限制接口属性名，保持 IPC 和备份字段兼容；模拟 `ResizeObserver` 的实例方法保留一处有说明的局部例外。解构检查仅要求同名对象属性的变量声明，不强制数组索引、改名属性或赋值表达式。MathJax 配置继续使用 `Object.assign` 保留特殊属性的赋值行为，并有回归测试。
- 格式门禁使用 `@stylistic/` 前缀，包含 `indent`、`quotes`、`semi`、`comma-dangle`、`arrow-parens`、`space-infix-ops`、`space-before-blocks`、`keyword-spacing`、`comma-spacing`、`key-spacing`、`object-curly-spacing`、`array-bracket-spacing`、`space-in-parens`、`eol-last`、`array-bracket-newline`、`template-curly-spacing`、`wrap-iife`、`implicit-arrow-linebreak`、`generator-star-spacing`、`spaced-comment`、`computed-property-spacing`、`function-call-spacing`、`no-trailing-spaces`、`comma-style`、`arrow-spacing`、`block-spacing`、`space-before-function-paren`、`function-paren-newline`、`operator-linebreak`、`brace-style`、`padded-blocks`、`no-multiple-empty-lines`、`nonblock-statement-body-position`、`quote-props`、`no-confusing-arrow` 和 `no-mixed-operators`。数组首尾括号换行要求一致，IIFE 两种括号位置均允许；100 字符仍是人工换行参考，不机械限制长字符串、正则或 JSDoc。
- `@stylistic/max-statements-per-line`（每行最多 1 条语句）先对已零命中的 `apps/web/quiz-core.js`、`apps/web/training.js` 和 `apps/web/practice-selection.js` 按文件级配置启用；历史模块一次性启用会产生 4,399 处命中，因此其余模块随业务修改逐个纳入，新增路径不继承该试点。试点范围由 `apps/desktop/test/lint-config.test.mjs` 的`statement-per-line pilot` 用例约束，扩大范围需同时更新该用例。
- 复杂度棘轮（`complexity 15`、`max-depth 4`、`max-params 5`、`max-nested-callbacks 4`）同样按文件级配置启用，当前只覆盖基线为零的 `apps/web/quiz-core.js`、`apps/web/platform/index.js` 和 `apps/web/platform/save-queue.js`；`frontend/adapter.js`、`practice-selection.js`、`training.js` 已有超标函数，随业务拆分逐个纳入。`max-lines-per-function`（120 行）与 `max-lines`（600 行，均跳过空行与注释）并入同一棘轮：实测这三个模块无命中；`practice-selection.js` 的 `create` 函数有 271 行，不纳入，随拆分单独处理。
- `no-unused-expressions` 禁止借短路表达式承担赋值副作用：题库导出与学习记录导出的输出框写入改为先取值再用 `if` 判断，避免 `&&` 同时表达存在性与赋值。
- `no-use-before-define` 允许函数声明提升和不同执行上下文中的延迟引用，仍检查同一执行上下文中的变量、类提前读取及直接执行的 IIFE；它不能判断所有提前调用的闭包。`no-loop-func` 检查循环内引用可变绑定的回调，保留确需读取最新状态的行为。
- `no-plusplus` 与 `prefer-template` 已作为 error 运行。可由调用方替换的练习状态、练习/考试/AI 会话请求序号及来源区间起点保留 18 处局部自增例外，因为它们可接受字符串和 BigInt；错误、凭据及历史数据等保留 44 处局部拼接例外，因为对象在 `+` 和模板插值中的类型转换可能不同。每处注释说明原因及移除条件，测试限制例外数量不得增加并检查说明；不要机械替换这些表达式。
- `max-len` 与本项目仅作换行参考的约定不符；`no-warning-comments` 会禁止有明确后续动作的 TODO，因此均不纳入门禁。禁止 `for...of`、参数属性修改、函数声明或既有下划线名称的上游规则也继续遵循第 3 节的项目例外。
- [迁移清单](../apps/desktop/eslint.migration.mjs) 中的文件级历史语义和格式例外已全部清零；手写 JavaScript 文件执行目标规则，包括 `app.js` 和此前门禁外的 15 个测试工具，上述局部例外由独立测试约束。`lint:debt` 只报告迁移清单，不统计行内例外；新路径默认完整检查，已清零范围不能退回。覆盖数量随新增或删除文件变化，以增量检查输出为准。
- P5 完成四类高风险状态审查及局部提炼，没有新增规则豁免或扩大正式门禁；P5 时的债务实测和当时未覆盖竞态见[实施计划第 11 节](../docs/superpowers/plans/2026-11-05-airbnb-javascript-refactor.md)。
- `npm run lint:debt` 输出历史债务的逐文件/规则数量及行列消息；清单为空时返回空报告，显式指定文件仍可查看语义诊断。解析、配置、缺失文件或执行失败非零退出。正式门禁和报告都不写业务文件。`npm run lint:fixtures` 用真实 ESLint 验证违规拒绝、项目例外与失败传播，隔离样例不进入业务资源。
- `pre-commit` 直接运行 [暂存区检查脚本](../apps/desktop/scripts/lint-index.mjs)，按索引中的完整文件检查本次暂存的手写 JavaScript。部分暂存和首次提交同样适用。钩子会校验检查入口及所用配置的一致性，拒绝非普通 JavaScript 文件，保留工作区和索引内容。
- Windows CI 的 `npm run lint:ci` 对普通 PR 校验检出的合并提交，并与该合并提交的目标分支父提交比较，检查整个 PR 改动涉及的手写 JavaScript 完整文件。只有目标提交已有成功的 Windows push 检查及全量 lint 记录时才使用增量范围；记录不可用、历史或父提交不匹配时回退全量。检查配置、忽略规则、锁文件、工具版本、类型配置或 CI 工作流变化也回退全量，重命名与删除的原路径同样参与判断。增量与全量检查均拒绝非普通手写 JavaScript 文件；对已跟踪文件还核对 Git 索引类型，防止 Windows 将符号链接检出为普通文件后绕过检查。主线 push、合并队列、手动运行和发行检查始终执行全量 `npm run lint`。文档链接检查和项目级 typecheck 保持全量，规则回归由同一 CI job 的 `npm test` 执行；手动完整检查仍可运行 `npm run lint`。
- 浏览器源码按 classic script 解析；`frontend/bridge.js` 是 esbuild 输入，单独按 ESM 解析，产物仍为既有 IIFE。Node `.mjs`、`.cjs` 及 `.js` 按实际包边界分类，全局变量只读；Playwright 序列化回调所需浏览器名称仅在明确列出的宿主工具和 Web AI 测试文件开放，测试桥接的应用状态名称仅在对应文件开放。没有放宽生产 CSP 或提供新的求值能力。
- `eslint-plugin-import-x` 只取 `no-unresolved`、`no-cycle`（`maxDepth: 10`）和 `no-extraneous-dependencies` 三条，覆盖缺失模块、循环依赖与越权依赖，试点全仓实测零命中；范围限于 `.mjs`、`test/dual-platform/**/*.cjs`、`apps/web/platform/**/*.js` 和 `frontend/bridge.js`，浏览器 classic script 不设模块边界。未使用模块分析仍无专门 lint 覆盖（ESLint 10 下 `no-unused-modules` 无效），仍需实际执行、构建和审查。
- `typescript-eslint` 的类型感知规则（`no-floating-promises`、`no-misused-promises` 等）暂不接入：`typescript-eslint@8.72.2`（latest）与 `8.72.3-alpha.8`（canary，含 `@typescript-eslint/parser`）声明的 peer 均为 `typescript >=4.8.4 <6.1.0`，而本仓库锁定 `typescript 7.0.2`，安装会直接 ERESOLVE。复核命令为 `npm view typescript-eslint@latest peerDependencies` 与 `npm view typescript-eslint@canary peerDependencies`；待上游 peer 范围覆盖 TypeScript 7 后再评估，不用 `--force`、`overrides` 或降低 TypeScript 版本的方式绕过。缺少类型感知检查期间，未等待的 Promise、误用 Promise 回调等仍需通过实际执行、测试与审查把关。
- 一次只改一个可验收切片。格式调整与逻辑抽取分批审查；不能顺带修改答案、评分、备份格式、持久化键、凭据或权限。
- 不在本次规范引入中迁移 React/TypeScript、不重写 Rust、不改包管理器。自动化与结构重构须按设计和实施路线确认后执行。
