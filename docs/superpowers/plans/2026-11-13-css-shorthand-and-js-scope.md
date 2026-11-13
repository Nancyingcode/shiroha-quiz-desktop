# 下一轮风格优化：CSS 简写、AI 导入面板变量命名与状态模块复杂度

规划基线为 2026-11-13 的本地 `main@2574746`。上一轮已把单行语句检查扩到 9 个 Web 模块，启用了 CSS 动画名检查，并修复了发布工作流断言和 600px 下的 AI 预览网格溢出。本轮优先处理上次留下的两个候选，再把已有复杂度检查扩到两个零命中模块。三个批次均使用项目锁定的开发依赖。[上一轮实施记录](./2026-11-13-eslint-stylelint-next-round.md) · [依赖与检查入口](../../../apps/desktop/package.json)

| 顺序 | 目标 | 基线 → 验收目标 |
| --- | --- | --- |
| 1 | Stylelint 检查 CSS 简写中的重复值 | 9 份手写 CSS 中，5 份共 12 处 → 启用规则后 0 处，现有抑制计数无变动 |
| 2 | 在 AI 导入面板试点 ESLint `no-shadow` | 该文件 5 处 → 0 处，批量估算、设置入口和就绪重试的行为与基线一致 |
| 3 | 对学习会话和浏览器存储启用现有六项复杂度及规模检查 | 覆盖由 3 个模块增至 5 个，新纳入的两份源码均无须修改 |

## 第一批　清理 12 处 CSS 冗余简写

对正式 `lint:css` 的文件范围临时追加 `shorthand-property-no-redundant-values: true`，Stylelint 17.16.0 的命中如下。四值简写按上、右、下、左展开，例如 `18px 32px 32px 32px` 收为 `18px 32px 32px` 后，底部仍为 32px。

| 文件 | 处数 | 命中位置 |
| --- | ---: | --- |
| [styles.css](../../../apps/web/styles.css) | 1 | 通知卡片的 `padding` |
| [ai-panels.css](../../../apps/web/styles/ai-panels.css) | 1 | 720px 及以下练习 AI 面板的 `padding` |
| [app-shell.css](../../../apps/web/styles/app-shell.css) | 5 | 两处主内容区的 `padding` 及三处导航项的 `padding` |
| [dashboard-and-media.css](../../../apps/web/styles/dashboard-and-media.css) | 3 | 首页两处 `margin` 和统计卡的 `padding` |
| [responsive-artwork.css](../../../apps/web/styles/responsive-artwork.css) | 2 | 移动底部导航的 `gap` 与 `padding` |

1. 在现有隔离 fixture 中先写正反例。保留有方向差异的 `padding: 10px 12px` 和 `gap: 8px 12px`。对 `padding: 10px 10px`、`margin: 0 1px 2px 1px`、`gap: 8px 8px !important`，断言分别命中目标规则，并检查 lint 后源文件内容相同。[CSS 门禁测试](../../../apps/desktop/test/lint-css.test.mjs)
2. 逐处缩写这 12 个值，在现有配置中全量启用规则。内存对照已验证四边和行列间距的展开值相同，10 处 `!important` 均可保留。采用逐项编辑，因为本地版本的自动修复会删除夹在两个值中间的注释。[Stylelint 配置](../../../apps/desktop/stylelint.config.mjs) · [历史抑制清单](../../../apps/desktop/stylelint-suppressions.json)
3. 在相同页面状态下对比改动前后的 `getComputedStyle`。对实际命中的导航、主内容区和练习 AI 面板取 720/721px，对桌面导航再取 1099/1100px 与 1280/1281px，记录相关元素的四边 `padding`、`margin` 或行列 `gap`。若兼容选择器在当前页面无对应元素，用隔离 DOM 样例加载原样式验证。保留已有的六档 AI 预览网格回归，桌面 WebView2 复核常规及折叠侧栏。[共享样式加载器](../../../test/dual-platform/styles.cjs) · [浏览器页面回归](../../../test/dual-platform/browser-page.cjs)

## 第二批　消除 AI 导入面板的 5 处变量遮蔽

按项目 ESLint 配置在 163 个手写 JS 文件上临时开启 `no-shadow`，共 24 个文件、66 处命中。首批选择 `apps/web/ai-import-panel.js`，因为它的 5 处都有明确的业务名称，而且已有浏览器断言覆盖请求数和重试行为。现有 `create` 工厂注入了 `preview`、`settings`、`label` 和 `requests`，内部的 DOM 元素、选项文本和数量又复用了这些名字。[面板源码](../../../apps/web/ai-import-panel.js) · [ESLint 配置](../../../apps/desktop/eslint.rules.mjs)

| 局部绑定 | 建议名称 | 处数 |
| --- | --- | ---: |
| 显示预览题数的元素 `preview` | `previewCountElement` | 1 |
| 导入、批量预览两处设置按钮 `settings` | 各自在函数内使用 `settingsButton` | 2 |
| 范围选项的文本 `label` | `optionLabel` | 1 |
| 预计请求次数 `requests` | `estimatedRequestCount` | 1 |

历史提交 `12881bd` 可复用命名和规则测试。该补丁与当前面板上下文已不匹配，实施时在当前函数内重命名绑定及其引用。尤其要保留 `openSettingsOrRetry` 对“重试检查”和“前往 AI 设置”的分流，以及无效批量输入对应的 `null` 状态。[面板源码](../../../apps/web/ai-import-panel.js)

- 以精确文件路径启用 `'no-shadow': 'error'`。在 fixture 中，同名内层绑定须触发该规则，改名后的样例须通过；把同一反例放在 `ai-import-sessions.js` 上，确认试点边界。同步更新指南中的覆盖说明。[配置回归](../../../apps/desktop/test/lint-config.test.mjs) · [JavaScript 指南](../../../rules/javascript-style-guide.md)
- 使用本地样题和模拟 AI。31 道题、每批 30 道时应显示“2 次”；批量大小为空、为 0 或超限时应显示“—”并禁用开始按钮。就绪检查失败后点“重试检查”，只触发一次重试，模型调用数仍为 0。补解析和核对两种模式均应能切换处理范围。[页面回归](../../../test/dual-platform/browser-page.cjs) · [导入与重试回归](../../../test/dual-platform/ai-import-retry.test.cjs)

## 第三批　扩大状态模块的复杂度检查范围

现有六项规则分别限制圈复杂度 15、块嵌套 4 层、参数 5 个、回调嵌套 4 层、单函数 120 行、单文件 600 行。两项行数检查均跳过空行和注释。按相同参数试跑，[学习会话](../../../apps/web/study-sessions.js)和[浏览器存储适配](../../../apps/web/platform/browser.js)两份源码各项均为 0。两者分别承载计时器释放和存储冲突处理，适合在后续修改前锁定当前阈值。[现有规则](../../../apps/desktop/eslint.rules.mjs)

将两条路径加入现有六项规则的文件清单，同时更新原有试点测试和 JavaScript 指南。沿用四类超限样例，另外检查两项行数规则的阈值及跳过空行、注释的选项。`bank-page.js` 继续充当范围外对照。存储模块单独预检每行语句数仍有 17 处，此批只扩六项规则；单行语句试点继续覆盖原来的 9 个文件。[配置回归](../../../apps/desktop/test/lint-config.test.mjs) · [JavaScript 指南](../../../rules/javascript-style-guide.md)

## 执行顺序与验收命令

CSS 批可以独立实施。第二、三批都要修改 `eslint.rules.mjs`、`lint-config.test.mjs` 和 JavaScript 指南，建议第二批验收后再交给第三批。若交给多个子 agent，每批由一名负责人维护自己的改动和回归结果。

| 时机 | 目录 | 命令 |
| --- | --- | --- |
| 第一批 | `apps/desktop` | `node --test test/lint-css.test.mjs`、`npm run lint:css`，再做上述计算样式对照 |
| 第二、三批配置 | `apps/desktop` | `node --test test/lint-config.test.mjs`、`npm run lint:platform` |
| 第二批面板 | 仓库根目录 | `node --test test/dual-platform/ai-import-retry.test.cjs`，再运行下方的浏览器定向命令 |
| 第三批状态模块 | 仓库根目录 | `node --test test/dual-platform/source-loading.test.cjs test/dual-platform/browser-storage.test.cjs` |
| 三批联合 | `apps/desktop` | `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:web-platform`。共享资源进入桌面后，依次运行 `npm run build:test`、`npm run test:desktop` |

第二批的浏览器定向命令同时覆盖批量估算、就绪重试和上一轮的窄屏回归。命令从仓库根目录执行。

```powershell
node --test --test-name-pattern="AI 面板批量输入|启动检查完成后|AI 预览控制与题号范围" test/dual-platform/browser-page.cjs
```

规划阶段已跑通当前正式 `lint:css` 和两份状态模块回归。AI 面板的内存改名试验也将 5 处诊断清到 0，就绪重试、批量估算两项浏览器用例在主线和试验版本均通过。正式配置、联合回归和 WebView2 样式对照在实施时验收。

## 实施记录（2026-11-13）

本计划原文来自 `C:/Users/30728/.codex/worktrees/c12c/shiroha-quiz-desktop`，按用户要求在当前任务工作树实施，未修改来源工作树。执行基线为 `25747464a9e6886f003cb88e539748d1168455a8`，与当时本地 `main` 一致；未执行 fetch，不据此判断远程最新状态。

- 任务分支：`codex/lint-css-shorthand-js-scope`。
- 工作树：`C:/Users/30728/.codex/worktrees/08a3/shiroha-quiz-desktop`。
- 三个阶段按顺序分别由独立子 agent 负责，前一批停止编辑并交接后再启动下一批。三批属于同一实施任务，在当前工作树保留各批差异，没有从其他工作树复制未提交代码。
- 模型使用接口支持的 `gpt-6.1-terra / max`；子 agent 接口未提供 `max+` 或独立 `fast` 开关。
- 开始时工作树干净且没有依赖目录。安装前按进程命令行确认没有当前项目的运行进程，随后执行 `npm ci --prefer-offline --no-audit --no-fund`，`npm ls --depth=0` 与 esbuild 转换实跑通过；补跑 Husky `prepare` 成功。锁文件未修改，未新增依赖。
- 实施阶段用户当时没有授权提交或推送，验收后的成果暂时保留为未提交改动。后续用户明确要求合入本地 `main`，授权完成该次合并所需的提交，仍不包含推送。

### 第一批：CSS 冗余简写

负责人为 `batch1_css` 子 agent。正式启用 `shorthand-property-no-redundant-values`，逐项缩写计划中的 12 处声明，保留全部 10 处 `!important` 和现有注释，历史抑制清单未改动。fixture 覆盖方向有差异的合法简写、三类冗余简写、夹在值中的注释及只读检查。

先确认未启用规则时反例返回成功导致测试失败，再启用规则并清理源码。`node --test test/lint-css.test.mjs` 为 6/6，`npm run lint:css` 通过；两项新增浏览器间距回归与既有六档 AI 预览网格回归共 3/3 通过，改动 JavaScript 的定向 ESLint 通过。

Edge 修改前后 92 组计算样式逐项一致：六个断点 × 常规/折叠侧栏 × 首页七个节点，共 84 组；真实练习 AI 面板的 720/721px 两组；隔离 DOM 中三个兼容移动导航选择器的 720/721px 六组。每组均记录四边 `padding`、`margin` 和行列 `gap`。通知卡片使用插入的测试节点；兼容移动导航在当前页面没有对应节点，因此单独加载原样式验证。

原始记录保存在当前聊天的可视化目录 `C:/Users/30728/.codex/visualizations/2026/11/13/01a1d25c-9c8d-7e31-8cab-cf793fe9e8c9/`，文件为 `css-before.json`、`css-after.json` 与可重复采样的 `css-computed-capture.cjs`。前后 JSON 的 SHA-256 均为 `d09fb0e462b64e588fdf68dfaa672960934cd57a9b221ad2b031bd72e8c02653`。共享采样函数保存在 [css-computed-style.cjs](../../../test/dual-platform/css-computed-style.cjs)。

### 第二批：AI 导入面板变量遮蔽

负责人为 `batch2_ai_scope` 子 agent。仅重命名计划中的五处局部绑定及引用，保留工厂注入的依赖、批量输入的 `null` 状态和 `openSettingsOrRetry` 的分流。在精确文件路径启用 `no-shadow`，fixture 同时验证同名内层绑定被拒绝、改名后通过，以及 `ai-import-sessions.js` 仍在试点范围外；指南同步更新。

红灯先证明未启用规则时 fixture 没有预期诊断，再在原源码上确认恰好五处遮蔽；局部改名后清零。新增页面断言在改名前后均通过。配置测试 42/42、`lint:platform`、AI 导入与重试测试 91/91、计划中的浏览器定向回归 3/3、文档检查和差异检查均通过。

页面断言覆盖 31 道题按每批 30 道显示两次并实际分为 30+1；空、0 和超限批量值显示“—”并禁用开始；两个面板按钮各触发一次就绪重试，模型调用仍为 0，不可重试时均进入 AI 设置；补解析和核对模式都能切换范围并显示正确的选项文字。全部使用隔离样题和模拟 AI，没有调用真实收费服务。

### 第三批：状态模块复杂度范围

负责人为 `batch3_complexity` 子 agent。现有六项规则从三个模块扩到五个，阈值与跳过空行、注释的选项不变；[学习会话](../../../apps/web/study-sessions.js)与[浏览器存储](../../../apps/web/platform/browser.js)源码没有改动，定向 ESLint 为零错误、零警告，六项规则均零命中。

先扩大现有测试，确认原三个模块通过，而新增两个模块都因缺少复杂度检查出现预期红灯；随后仅修改文件清单并同步指南、现有注释中的模块数量。配置测试 47/47、`lint:platform`、源码加载与浏览器存储回归 25/25 均通过，后者包含两轮各 332 项既有业务断言。修改文件的 ESLint、文档检查与差异检查也通过。

回归沿用四类超限样例，并精确校验五个文件的六项规则参数、两项行数规则的跳过选项，以及 `bank-page.js` 的六项范围外状态。单行语句配置仍为原九个文件；另补 `platform/browser.js` 的范围外断言，避免本批误扩该规则。

### 联合验收

三批完成并停止编辑后，整合负责人在当前未提交工作树运行完整检查。类型检查通过；全量 lint 检查 164 个完整手写 JavaScript 文件、全部正式 CSS 范围、22 份文档及规则 fixture，结果通过。

`npm test` 首次在沙箱内运行时，资源生成测试被 esbuild 对临时目录上级路径的访问限制阻断，安装器完整性标签测试的 `icacls` 也被拒绝。保留原始日志，在正常本机权限下不改命令、不改断言重跑后通过：桌面测试 252 项中 251 项通过、1 项按既有逻辑跳过（Windows 临时目录不区分大小写，无法构造仅大小写不同的两个路径）；共享测试 488/488，通过合计 739 项。该环境跳过同样出现在全量 lint 的 fixture 中。

`npm run test:web-platform` 全量浏览器回归 219/219，通过且无跳过，包含本次新增和增强的样式、批量估算、模式范围切换与重试分流断言。新计划文件另按文档脚本同等规则检查 UTF-8、代码围栏和本地链接；指南由正式文档检查覆盖。

详细命令日志保存在当前工作树忽略目录 `apps/desktop/.reports/`：`final-typecheck.log`、`final-lint.log`、`final-test.log`（沙箱失败原始记录）、`final-test-host.log`（正常本机权限成功重跑）与 `final-web-platform.log`。

随后在正常本机权限下使用离线 Cargo 缓存执行 `npm run build:test`，约 5 分 16 秒完成。`npm run test:desktop` 的真实 WebView2 smoke 为 44/44，通过；其中原生窗口布局在 1280×860、900×640 和 1600×1000 三档分别覆盖常规与折叠侧栏。原生服务使用模拟凭据和本地服务，桌面数据与 WebView2 profile 均隔离在测试临时目录中。

额外复用共享采样函数，在真实 WebView2 157.0.4341.46、1280×860 视口下，对首页和导入页各取常规、折叠两种侧栏状态，共四组页面状态、十二个节点样本。按原加载顺序临时替换为基线五份 CSS，再与当前 CSS 的四边 `padding`、`margin` 和行列 `gap` 深比较，全部一致。样式恢复后关闭本次启动的进程，并清理已确认关闭的隔离 profile。

原生验收记录位于 `apps/desktop/.reports/final-build-test.log`、`final-desktop.log`、`final-desktop.json`、`final-native-css.log` 和 `css-shorthand-webview2.json`。补充对照脚本位于当前工作树忽略目录 `.reports/native-css-shorthand-check.mjs`。本次验证的 `native-test` EXE SHA-256 为 `a6c0d6f72c5d363911669593db53df8830e9c3c083a4d40eca81f6cf133a0627`，该构建仅用于本轮隔离验收。

首次验收时核对：锁文件、CSS 历史抑制清单、学习会话和浏览器存储源码均无差异；当时未提交、未推送。首次验收针对本任务分支的基线加未提交改动；执行期间本地 `main` 已前移至 `d603c2201e58c7b705468de8121faa23fa6e407d`，首次验收时尚未整合主线。

### 本地合并准备

用户随后明确要求合入本地 `main` 并重跑联合验收。由于三批原本在同一工作树按依赖顺序实施，现按批分别建任务分支、独立提交，保留共享文件的原始内容，不复制其他工作树的未提交文件：

- CSS 简写：`codex/lint-css-shorthand-batch`，提交 `5617aa1`。
- AI 导入面板：`codex/lint-ai-import-shadow-batch`，提交 `74a73d9`，基于第一批。
- 状态模块复杂度：`codex/lint-study-storage-complexity`，提交 `94d0cdd`，基于前两批。

整合分支 `codex/integrate-css-js-scope` 从本地 `main@d603c22` 建立，合入上述依赖链时五份共享文件自动合并，没有文本冲突。已核对主线的 `no-promise-executor-return`、`no-return-await` 与本任务的 `no-shadow`、六项复杂度规则和对应测试同时保留；合并后的配置测试 47/47、CSS 测试 6/6 和平台 lint 已通过。

整合提交为 `da44d97`，其两个父提交分别为 `d603c22` 与 `94d0cdd`。实施记录随后独立提交；完整联合验收针对包含整合结果和本记录的状态重新运行。

### 合并后联合验收

本次联合验收的源码与配置来自提交 `6ecd17c`，该提交包含整合结果及上述实施记录。`npm run typecheck`、全量 `npm run lint` 均通过；`npm test` 的桌面测试 251 项通过、1 项因 Windows 临时目录不区分大小写而按既有规则跳过，共享测试 488/488 通过；`npm run test:web-platform` 为 219/219，通过且无跳过。

同一 Edge 采样脚本重新对照改动前基线，六个响应式断点等共 92 组计算样式完全一致，结果保存在原可视化目录的 `css-merged.json`，SHA-256 为 `d09fb0e462b64e588fdf68dfaa672960934cd57a9b221ad2b031bd72e8c02653`。随后 `npm run build:test` 重新生成桌面资源并成功构建；真实 WebView2 smoke 为 44/44。额外在 WebView2 157.0.4341.46 复核首页、导入页的常规与折叠侧栏，共四组页面状态的计算样式与原始 CSS 一致。

本次日志保存在工作树忽略目录 `apps/desktop/.reports/`，前缀为 `merge-`；原生样式详细结果为 `merge-css-webview2.json`。本次 `native-test` EXE SHA-256 为 `fa3bdbceb038c1388d99696d29ef03ac58be09069c5a0490e8562772877ff53e`，仅用于隔离验收。锁文件、CSS 抑制清单及两份新增复杂度覆盖的业务源码均无变化。

本节仅记录已完成的验收结果，随后作为独立文档提交，并单独运行文档检查；它不改变已验收的源码或配置。整合结果按用户要求合入本地 `main`，不推送。
