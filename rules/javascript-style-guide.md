# JavaScript 风格指南：Airbnb 项目适配

引入日期：2026-11-05。适用于本仓库手写 JavaScript；TypeScript 沿用适用的语言规则，类型要求以项目配置为准。修改 JavaScript/TypeScript 前阅读本文和[根开发规范](../AGENTS.md)。

## 1. 来源、定位与执行状态

- 上游：[Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)。本次核对版本为提交 [8ed19247](https://github.com/airbnb/javascript/blob/8ed19247bef145e3cc41b24a02dd1fe6d9b5e681/README.md)，采用来源链接和中文适配说明，不复制整份上游指南；上游采用 MIT 许可。
- 本文是项目适配规范。冲突时依次遵循项目安全边界、根规范的流程与行为规则、实际自动化配置、本文及上游参考。发现规范与配置不一致时记录并修正，不静默换用另一套风格。
- 新增代码和本次实际修改的逻辑按本文编写；历史文件按重构批次迁移，不要求为一个小修复格式化整个文件。
- P2 自动化采用 `@eslint/js` recommended、`no-var`、`prefer-const`、现有 `no-unused-vars`、显式语义规则和 Stylistic 5.10.0；保持 ESLint 10 和原有类型检查。没有安装 Airbnb 整套配置、import-x、Prettier 或 React/Next 预设。实际强制范围与暂缓规则见第 4 节，不表示全部历史业务已经通过目标规则。
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
- `apps/web/app.js` 由现有 IIFE 持有业务状态，按解析/判分、备份、练习、AI 等业务切片处理；完整文件的正确性检查与格式迁移分别推进，不用全面禁用规则隐藏问题。
- `apps/web/question-bank.js` 是内置题库数据载体，保留题库内容及本地文件兜底。`apps/web/libs/`、生成的 `apps/desktop/dist/`、构建产物和历史 fixture 不参与风格批量重写。
- 手写测试工具可以逐批纳入；原始样例、题库文本和预期数据按数据契约维护，不能用格式化结果替换行为断言。
- `npm run lint:incremental` 在现有门禁之外发现 Git 跟踪和未忽略的新手写 `.js/.mjs/.cjs`，新路径默认执行完整目标规则。P5 交付时的历史快照为 79 个整文件，其中 29 个达到全部新增目标规则，35 个执行全部新增语义规则，38 个执行全部 Stylistic 规则，三个数量有重叠。[本次 app.js 拆分计划](../docs/superpowers/plans/2026-11-08-web-app-js-split.md)记录新增模块按现有完整增量门禁检查；最新覆盖数量以该命令输出为准。
- 语义规则为 `eqeqeq`（仅允许有意 `== null`）、`no-nested-ternary`、`no-param-reassign`（允许属性修改）、`no-duplicate-imports`、`no-eval`、`no-new-func`、`guard-for-in` 和 `curly`。格式规则为 `indent`、`quotes`、`semi`、`comma-dangle`、`arrow-parens`、`space-infix-ops`、`space-before-blocks`、`keyword-spacing`、`comma-spacing`、`key-spacing`、`object-curly-spacing`、`array-bracket-spacing`、`space-in-parens`、`eol-last`，均使用 `@stylistic/` 前缀。100 字符仍是人工换行参考，不机械限制长字符串、正则或 JSDoc。
- [迁移清单](../apps/desktop/eslint.migration.mjs) 固定列出 41 个带特定格式暂缓规则的文件、44 个带有特定语义债务的文件，以及尚未正式检查的 app.js 和 15 个既有测试文件。只有实际未清零的语义规则暂缓，其余规则仍阻断；文件迁移后删除对应例外。新文件不自动加入债务，已清零范围不能退回。暂缓规则仍需人工审查同类新增问题，不声称全面拦截历史文件中的新违规；没有可相互抵扣的总告警上限。
- P5 完成四类高风险状态审查及局部提炼，没有新增规则豁免或扩大正式门禁；P5 时的债务实测和当时未覆盖竞态见[实施计划第 11 节](../docs/superpowers/plans/2026-11-05-airbnb-javascript-refactor.md)。
- `npm run lint:debt` 输出逐文件/规则数量及行列消息，包含暂缓格式文件，app.js 只做语义诊断。报告已有债务不阻断；解析、配置、缺失文件或执行失败非零退出。正式门禁和报告都不写业务文件。`npm run lint:fixtures` 用真实 ESLint 验证违规拒绝、例外接受和失败传播，隔离样例不进入业务资源。
- 浏览器源码按 classic script 解析；`frontend/bridge.js` 是 esbuild 输入，单独按 ESM 解析，产物仍为既有 IIFE。Node `.mjs`、`.cjs` 及 `.js` 按实际包边界分类，全局变量只读；Playwright 序列化回调所需浏览器名称只在明确列出的 8 个既有宿主工具文件开放。没有放宽生产 CSP 或提供新的求值能力。
- import-x 本阶段没有引入；核心规则覆盖重复导入，扩展名与具名导出保留。缺失模块、循环和未使用模块分析没有专门 lint 覆盖，仍需实际执行/构建和审查，不启用 ESLint 10 下无效的 `no-unused-modules`。
- 一次只改一个可验收切片。格式调整与逻辑抽取分批审查；不能顺带修改答案、评分、备份格式、持久化键、凭据或权限。
- 不在本次规范引入中迁移 React/TypeScript、不重写 Rust、不改包管理器。自动化与结构重构须按设计和实施路线确认后执行。
