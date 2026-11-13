# 下一轮风格优化：展开状态切换，清理 AI 预览网格

三批实施及其后发现的工作流断言、窄屏网格溢出均已完成修复，最新验收结果见文末“后续问题修复”。

**建议按三批实施。** 第一批只动检查配置和回归样例；第二批展开保存队列和学习会话的 5 处密集语句；第三批清掉 AI 导入面板的 2 处重复选择器。三批完成后，每行语句数规则覆盖的 Web 文件将从 3 个增至 9 个，AI 面板的重复选择器历史计数从 2 降至 0。全程可复用现有开发依赖。

## 已验证的起点

2026-11-13 以本地已提交的 `main@7704dcf` 为基线。规划文档所在工作树为 `codex/lint-gate-batches@f90f149`，落后主线 5 个提交。实施时以届时核对的主线配置为准，尤其要保留 `7704dcf` 新增的 `prefer-promise-reject-errors`。上一轮的 `no-unused-expressions`、CSS 跨文件变量与命名检查均已生效。选择器最多四段已在全部手写 CSS 生效，两份老样式表分别保留 17 和 5 条历史计数。[上一轮建议](../../reviews/2026-11-12-eslint-stylelint-recommendations.md) · [ESLint 配置](../../../apps/desktop/eslint.rules.mjs) · [Stylelint 配置](../../../apps/desktop/stylelint.config.mjs) · [CSS 历史计数](../../../apps/desktop/stylelint-suppressions.json)

用项目锁定的 ESLint 10.13.0、Stylistic 5.10.0 对 163 个手写 JS 文件临时启用每行最多一条语句，全仓有 4,399 处诊断，其中 `app.js` 有 545 处。下面的扩围名单来自逐文件试跑。已有的六项复杂度和规模检查另有自己的范围，例如 `ai-results.js` 的单行语句数已合格，但按复杂度上限 15 检查仍有 9 处命中。[现有文件级检查](../../../apps/desktop/eslint.rules.mjs) · [项目 JavaScript 风格指南](../../../rules/javascript-style-guide.md)

## 第一批：给现有写法加上检查

| 范围 | 实施 | 验收 |
| --- | --- | --- |
| JS 单行语句 | 在现有试点中追加 `apps/web/` 下的 `ai-results.js`、`bank-editor.js`、`platform/index.js`、`text-answers.js`。这四个文件各有 0 处命中，无需改业务源码。 | 覆盖数由 3 增至 7。现有 fixture 对每个新增路径注入一行两条语句，须报告 `@stylistic/max-statements-per-line`；继续用试点外的 `bank-page.js` 作对照。[ESLint 试点测试](../../../apps/desktop/test/lint-config.test.mjs) |
| CSS 动画名 | 在 `stylelint.config.mjs` 中加入 `'no-unknown-animations': true`，沿用现有 `referenceFiles`。9 个手写 CSS 文件试跑为 0 处。 | 在内存中把启动卡片引用的 `splashCardIn` 改成 `splashCadrIn`，只出现 1 条新诊断。将正确名称通过、错误名称触发指定规则写入隔离 fixture，无需增加抑制计数。[启动卡片样式](../../../apps/web/styles/app-shell.css#L377) · [CSS 规则测试](../../../apps/desktop/test/lint-css.test.mjs) · [Stylelint 规则说明](https://stylelint.io/user-guide/rules/no-unknown-animations/) |

## 第二批：展开两处状态切换模块

| 模块 | 本轮改动 | 行为验收 |
| --- | --- | --- |
| [保存队列](../../../apps/web/platform/save-queue.js#L19) | 展开 3 处单行写法，包括保存失败后设置 `blocked` 并重新抛错，以及 `resume()` 检查 `pending` 后解除阻断。 | 连续编辑仍冻结各自的快照并按序写入。首写失败仍阻断后继写入，进行中的保存仍阻止恢复，显式重试后才继续。[浏览器存储与队列测试](../../../test/dual-platform/browser-storage.test.cjs) |
| [练习与考试会话](../../../apps/web/study-sessions.js#L18) | 展开两个 setter 中清理旧计时器的 `if`，共 2 处。 | 切换轮次时先清理旧计时器，再使旧请求失效。保留请求序号接受字符串和 BigInt 的既有语义。除现有序号用例外，用可记录调用的 `clearInterval` 核对旧计时器只被清理一次。[会话回归](../../../test/dual-platform/source-loading.test.cjs) |

两文件清零后再加入单行规则名单，使覆盖数由 7 增至 9；采用与第一批相同的违规 fixture。此批仅改语句排版，队列的 `await`、`catch`、`finally` 归属和会话清理顺序应逐项对照。同步更新 JavaScript 指南中的试点清单。[规则说明](https://eslint.style/rules/max-statements-per-line)

## 第三批：合并 AI 导入预览的两组重复样式

两组选择器都在 `ai-panels.css` 顶层，后一次声明只覆盖列宽。将最终生效的列定义放回首次声明，保留各自的 `display`、`gap` 和 `margin`。控制区采用三列 `minmax(230px,1fr) minmax(250px,1fr) minmax(170px,.55fr)`，概览区采用五列 `repeat(5,minmax(0,1fr))`。[首次定义](../../../apps/web/styles/ai-panels.css#L86) · [后续覆盖](../../../apps/web/styles/ai-panels.css#L124) · [对应页面元素](../../../apps/web/index.html#L259)

内存合并试跑后，该文件的 `no-duplicate-selectors` 从 2 降为 0，`no-descending-specificity` 仍为 1。实施时只移除前一项历史计数，再跑正式 `lint:css`；其他文件的计数保持原值。视觉验收使用同一份本地示例预览，在相同宽度下比较改动前后的 `getComputedStyle`，记录两处网格的实际列宽、间距和上下外边距。至少各取一个桌面宽度和窄屏宽度，并在桌面 WebView2 复核一次。[历史计数](../../../apps/desktop/stylelint-suppressions.json) · [重复选择器规则](https://stylelint.io/user-guide/rules/no-duplicate-selectors/)

## 验收入口与后续候选

规划阶段已在基线上跑通正式 `lint:css`，存储队列和源码加载两份回归共 23 项通过。两处网格的计算样式对照留到第三批实施时执行。

| 时机 | 工作目录与命令 |
| --- | --- |
| 每批开发 | 在 `apps/desktop` 运行 `node --test test/lint-config.test.mjs test/lint-css.test.mjs` 和 `npm run lint:css`。CSS 的负例由 `lint-css.test.mjs` 单独覆盖。 |
| 状态模块调整后 | 在仓库根运行 `node --test test/dual-platform/browser-storage.test.cjs test/dual-platform/source-loading.test.cjs`。 |
| 三批联合验收 | 在 `apps/desktop` 运行 `npm run typecheck`、`npm run lint`、`npm test` 和 `npm run test:web-platform`。共享资源进入桌面后，依次运行 `npm run build:test`、`npm run test:desktop`，补做上面的网格对照并记录结果。 |

后续若要继续扩大规则范围，可优先评估 CSS 的 `shorthand-property-no-redundant-values`。试跑命中 5 个文件共 12 处，例如 `padding:13px 13px` 可收为 `padding:13px`。JS 的 `no-shadow` 全仓有 66 处，AI 导入面板的 5 处已有独立提交 `12881bd`，待处理该面板时复用并核对主线的就绪与重试行为。两项留待本轮三个目标验收后排序。[CSS 实例](../../../apps/web/styles/ai-panels.css#L161) · [简写规则说明](https://stylelint.io/user-guide/rules/shorthand-property-no-redundant-values/)

## 实施记录

用户已授权连续完成三批。当前任务分支 `codex/lint-gate-batches` 从 `f90f149` 快进到 `7704dcf`，保留此前未提交的本计划。三批均由各自的 `gpt-6.1-terra` 子 agent 执行，推理档位使用接口支持的 `max`；接口没有独立的 fast 参数。批次共享 ESLint 配置、回归和指南，因此在当前工作树按顺序交接，主 agent 负责联合验收。

| 批次 | 负责人 | 实施与验证结果 |
| --- | --- | --- |
| 第一批 | `batch1` | 已完成。七个文件启用单行规则，CSS 启用动画名检查。规则启用前，四个新增 JS 路径及拼错动画名的负例均按预期失败；启用后两份配置回归共 44 项通过，CSS 单问题断言收紧后新增用例再次通过。正式 `lint:css`、相关文件 ESLint、文档检查及差异检查通过。 |
| 第二批 | `batch2` | 已完成。两份业务源码展开 5 处语句，语法树及注释与基线一致，单行规则覆盖增至 9 个文件。规则负例先红后绿，两份配置回归 46 项、两份业务回归 25 项通过；业务回归还包含两组各 332 项既有业务断言。新增用例验证进行中禁止恢复、失败阻断后继及显式重试，以及两种会话的旧计时器只清理一次。 |
| 第三批 | `batch3` | 已完成。合并两组重复规则并移除该文件重复选择器计数，保留特异性计数 1。两份配置回归 46 项、正式 CSS 检查通过；浏览器 1280px/600px 和原生 WebView2 1280px/900px 的两组网格列宽、间距和外边距均与基线严格相等，桌面对照还做了基线→当前→基线回切，等待侧栏过渡及尺寸稳定后比较。所有验证使用本地示例和隔离 profile，原生对照结束后已关闭自身进程并清理数据目录。 |

前三批对照时，浏览器 600px 下的控制网格容器约 472px，三列最小宽度连同间距约 678px，存在既有水平溢出；改动前后的测量相同。原生 900px 窗口按应用最小窗口宽度验收。浏览器与原生的详细测量保存在本工作树忽略目录 `apps/desktop/.reports/batch3-grid-web.json` 与 `batch3-grid-native.json`。该溢出的后续修复见文末。

### 前三批联合验收结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过。 |
| `npm run lint` | 通过。规则 fixture 62 项通过，1 项大小写路径用例因当前 Windows 临时目录不区分大小写而跳过。 |
| `npm test` 的桌面测试部分 | 首次在沙箱内运行 245 项，221 通过、23 失败、1 跳过。其中 22 项失败属于 esbuild 目录访问及 Windows 完整性标签权限限制；四份相关测试在沙箱外复跑共 47 项，46 通过，仅剩下述既有工作流断言。原命令仍为非零退出。 |
| `npm run test:shared` | 因前述既有失败会阻止 npm 串联共享回归，已单独执行，488 项全部通过。 |
| `npm run test:web-platform` | 首次 216 项中 214 通过、2 项超时。训练记录末页删除、考试保存失败后重试两个用例单独复跑均通过，测试与超时值保持原值。 |
| `npm run build:test` | 最终源码和 CSS 已重新生成并成功构建。 |
| `npm run test:desktop` | 最终构建的隔离原生冒烟 44 项全部通过，包含保存、重启、恢复、练习/考试、离线资源及本地文档导入。AI/WebDAV 使用测试替身。 |

前三批验收时剩余的失败位于 `apps/desktop/test/release.test.mjs:284`。断言用第一次出现的 `uses: actions/upload-artifact@` 检查发布步骤顺序，新增的测试日志上传步骤先于发布步骤，使断言失败。当时这份测试和 `.github/workflows/desktop.yml` 相对 `7704dcf` 的差异均为空，沙箱外复跑仍可重现。后续修复与最新结果见下一节。[发布回归](../../../apps/desktop/test/release.test.mjs#L284) · [现有工作流](../../../.github/workflows/desktop.yml)

完整命令日志保存在本工作树忽略目录 `apps/desktop/.reports/`，文件名以 `style-batches-` 开头。代码和执行记录保留在 `codex/lint-gate-batches` 的工作树中。

## 后续问题修复

用户随后授权修复上述两处遗留问题。先运行原工作流用例，复现错误匹配上传步骤的失败；再添加真实浏览器回归，在 AI 补解析面板的 600px 视口复现网格内容溢出。

工作流检查现在从步骤中定位 `windows-release-` 制品对应的上传 action，验证收集条件、缺少文件时失败的约定，以及构建、收集、校验、上传的顺序。回归额外验证两种错误工作流会被拒绝，即缺少发布制品上传步骤，以及将该步骤提前到构建前。[发布回归](../../../apps/desktop/test/release.test.mjs#L284)

AI 预览控制网格和自定义题号范围网格在视口不超过 1180px 时改为可收缩的单列布局，1280px 下仍为三列。新增浏览器回归通过实际导入打开 AI 补解析和 AI 核对面板，在 1280、1180、900、720、600、360px 下检查两个网格的内容宽度和输入控件边界。原生 WebView2 在实际 1280、1180、900px 窗口完成相同两种模式的检查，全部通过。[响应式样式](../../../apps/web/styles/ai-panels.css) · [浏览器回归](../../../test/dual-platform/browser-page.cjs#L205)

最新 `npm test` 已完整通过，桌面测试 244 项通过、1 项因 Windows 临时目录不区分大小写而跳过，共享测试 488 项全部通过。`typecheck`、全量 `lint`、最终 `build:test` 和原生桌面冒烟 44 项均通过。原生响应式检查使用隔离数据和本地样题，结束后关闭自身窗口并清理临时目录；结果保存在 `apps/desktop/.reports/followup-grid-native.json`。

浏览器并行首跑的 217 项中，两项既有练习计时用例出现预期 3 秒、实际 4 秒的断言失败。两项单独复跑通过；等待其他检查结束后，以 `node --test --test-concurrency=1` 串行执行原有四份浏览器测试文件，217 项全部通过，断言、用例超时和练习计时实现均保持原值。完整日志以 `followup-` 为前缀保存在本工作树的 `apps/desktop/.reports/` 忽略目录。
