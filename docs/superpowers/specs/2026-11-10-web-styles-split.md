# Web 共享样式拆分设计

2026-11-10 用户确认本设计，审查基线为 `8514234`。实施步骤和验证结果见[实施计划](../plans/2026-11-10-web-styles-split.md)。SCSS 单独评估。

## 1. 从哪里拆

仓库的共享样式名为 `apps/web/styles.css`，共 8,488 行。Web 从一个本地链接加载它。桌面从同一份源码生成资源，在文档头部末尾追加 `desktop.css`，并给 `body` 加上 `desktop-mist-blue`。GitHub Pages 直接上传 `apps/web`，本地启动器也直接提供此目录里的文件。两条路径都能使用原生 CSS。仓库没有自有 Service Worker 样式预缓存清单。[共享样式](../../../apps/web/styles.css) · [Web 入口](../../../apps/web/index.html) · [桌面生成器](../../../apps/desktop/scripts/prepare-web.mjs) · [Pages 工作流](../../../.github/workflows/pages.yml) · [本地静态服务](../../../apps/web/serve.ps1)

同一个界面由多个区段陆续修正。首页统计从仪表盘排布演变为两列卡片，练习侧栏从答题区内移到宽屏边缘，表单焦点环还要处理早期规则引入的父元素裁切。第一步只在完整顶层规则之间切文件，各次修正保留相对位置。这样可以把按页面归并时产生的视觉变化，同单纯移动文件造成的遗漏分别定位。

## 2. 文件与加载顺序

保留根目录的 `styles.css` 承载基础样式，已有文档链接继续可用。其余七个文件平铺在 `apps/web/styles/` 下。下表顺序就是 HTML 中八个样式链接的顺序。行号对应审查基线，少数文件开头包含上一段末尾的空行。

| 原行号（含首尾） | 相对 `apps/web/` 的文件 | 定位与职责 |
| --- | --- | --- |
| 1–1017 | `styles.css` | 从 `:root` 到最后一个 `.report-grid` 媒体查询，含主题变量、页面骨架、通用卡片、表单、选项、导入报告的初始样式。 |
| 1018–3388 | `styles/responsive-artwork.css` | 从 `v24 shared visual refinement` 到 `MOBILE_PERF_END`，含页面插画、题库卡片、小屏表单和移动导航的历次调整。 |
| 3389–4430 | `styles/app-shell.css` | 从 `DESKTOP_LAYOUT_REBALANCE_START` 到 `DUAL_LAYOUT_REFINEMENT_END`，含内容宽度、侧边栏折叠、专注视图居中、启动画面和双端壳布局。 |
| 4431–5301 | `styles/dashboard-and-media.css` | 从 `HOME_DASHBOARD_REFLOW_START` 到 V29.8 长题干标记，含首页快捷卡、素材布局、表单操作列与 DOCX 题图。 |
| 5302–6974 | `styles/focus-panels-and-stats.css` | 从 `PRACTICE_EXAM_CARDS_START` 到 `HOME_STAT_NUMBER_CENTER_END`，含练习与考试辅助卡、右栏收起和定位，以及首页统计卡的后续布局。 |
| 6975–7797 | `styles/bank-and-study-tools.css` | 从 `FOCUS_NAV_AND_BANK_EDITOR_START` 到 `ROLE_ART_CENTER_RESTORE_END`，含题库编辑、导入查找与替换、题量、错题、收藏、备份和练习进度。 |
| 7798–7967 | `styles/ai-panels.css` | 从 `ISSUE_99_AI_IMPORT_START` 到最后一组窄屏 `.ai-diagnostics-*`，含 AI 导入、核对、配置和单题追问。 |
| 7968–8488 | `styles/controls-and-feedback.css` | 从 `.platform-status` 前的空行到最后的强制颜色焦点规则，含平台提示、对话框、分页、原生下拉增强、训练复盘和表单焦点修正。 |

### 容易随顺序改变的三个界面

- `responsive-artwork.css` 给表单标签加上溢出裁切，`controls-and-feedback.css` 为导入、练习和考试表单修正焦点，强制颜色模式下另有内嵌描边。标签、控件和焦点状态要一起测。
- `dashboard-and-media.css` 先排首页快捷卡，`focus-panels-and-stats.css` 又修改首页统计网格和数字位置。把所有首页规则提前会同时影响小屏与宽屏。
- `app-shell.css` 定义专注布局，`focus-panels-and-stats.css` 调整右栏，`bank-and-study-tools.css` 再修正专注时展开导航。达到 1280px 时，JS 还会按答题卡实际位置写入侧栏高度和偏移，退出专注或缩窄窗口也要验证。[专注侧栏逻辑](../../../apps/web/app.js)

每个片段一起搬迁原注释、选择器列表、变量、声明、媒体查询、`@supports`、关键帧与 `!important`。例如第 1、1779、2262 行的 `:root` 分次覆盖主题，后面还有断点内的变量；第 8076 行的分页下拉框须在后续全局表单规则生效时仍保持 32px 高、6px 圆角。初次搬迁保留文本顺序，后续维护时可把注释中指向旧行号的引用改为文件名和选择器。现有共享表中的 `url()` 是下拉箭头的内嵌 SVG；将来新增相对资源 URL 时，按引用它的 CSS 文件目录定位。

## 3. 两端怎样取得同一份 CSS

1. **Web。** 在现有 `<head>` 中连续写八个本地 `<link rel="stylesheet">`，使用 `./styles.css` 和 `./styles/…`。HTML 是共享加载顺序的唯一来源。浏览器可以直接发现各文件，本地启动、Pages 仓库子路径和桌面离线运行都沿用相对地址。分别检查请求成功和首屏绘制；一次访问将从一个共享 CSS 请求增加到八个。
2. **桌面。** 同步调整生成器的 `entries` 复制范围和 `requiredAssets` 必需文件。只允许基础入口及 `styles/` 内列入范围的本地 CSS，逐项检查是普通文件，并在触碰已有输出前拒绝缺失文件或链接路径。核对 HTML 引用与必需集合一致，集合只负责完整性。按 HTML 原顺序保留共享链接，最后追加桌面覆盖表。增量生成后移除过期片段。现有 dev/build 都执行 `prepare:web`。[资源生成](../../../apps/desktop/scripts/prepare-web.mjs) · [Tauri 构建入口](../../../apps/desktop/src-tauri/tauri.conf.json)
3. **测试。** 对话框、下拉框、设置操作三组组件测试用 `setContent` 建隔离页面，再用 `addStyleTag({ path })` 注入单个文件。共用一个读取真实 HTML 中有序共享链接的测试入口，依次注入相同文件；桌面主题样例最后追加桌面样式。整页回归通过本地 HTTP 服务真实加载所有链接，显式检查 HTTP 状态、样式表可用与实际计算样式。[对话框](../../../test/dual-platform/dialog-page.cjs) · [下拉框](../../../test/dual-platform/select-page.cjs) · [设置和焦点](../../../test/dual-platform/settings-action-page.cjs) · [整页测试](../../../test/dual-platform/browser-page.cjs)
4. **生成回归。** 测试先确认各链接实际存在且唯一，再比较完整顺序并检查每份输出与源文件一致。现有 `indexOf(共享) < indexOf(桌面)` 在共享路径缺失时也可能成立。增加缺少中间片段的用例，在已有有效输出上重试，断言生成失败且旧文件内容未变。保持原有越界、链接、清理及增量校验。[桌面生成测试](../../../apps/desktop/test/prepare-web.test.mjs)

## 4. 目录的取舍

本轮只需为七个新增样式片段设置一个目录。现有 `apps/web/data/`、`media/`、`libs/`、`platform/` 分别承载运行时题库、页面媒体、第三方离线库和平台适配。桌面专用标题栏和主题留在 `apps/desktop/frontend/`，生成结果由 `apps/desktop/dist/` 接收。npm 工具和锁文件继续集中在 `apps/desktop/`。这些边界符合各自的发布与检查方式。[桌面项目配置](../../../apps/desktop/package.json)

后续优先从依赖最少、已有行为回归的对话框或 AI 面板开始归并。每次选择一个组件，追踪其在八个片段、桌面主题和运行时注入中的所有覆盖，确认计算样式一致后，再决定是否需要 `components/` 或 `pages/` 子目录。现有 `app.js` 还会注入题库分组和数据工具样式，`question-view.js` 按需注入富题干规则。将它们移为静态规则会改变插入时机，应随对应组件独立验证。基于窗口尺寸计算的内联几何量仍由 JS 维护。[数据工具与题库分组](../../../apps/web/app.js) · [富题干渲染](../../../apps/web/question-view.js)

根目录的经典 JS 脚本已有顺序依赖。若未来确有维护成本，再按导入、练习或备份等模块逐组迁移目录，同时更新 HTML 引用、桌面白名单和测试桥接。CSS 拆分可以独立落地，无需先移动 JS、离线库或素材源文件。[已有 JS 模块设计](2026-11-05-web-app-js-split.md)

## 5. 本次 Stylelint 接入范围

在 `apps/desktop` 运行 `npm run lint:css`。开发依赖锁定为 Stylelint 17.16.0 和官方推荐配置 18.0.0，兼容项目声明的 Node 24 起点。命令只读检查 Web 根目录、后续 `apps/web/styles/` 片段和桌面 `frontend/` 内的 CSS。第三方库、生成的 `dist` 和 JS 字符串中的运行时样式不在检查范围。全量 `npm run lint` 包含这项检查，增量 PR 在 CSS 增删改名或内容变化时运行；基线文件变更会触发全量 lint。现有 pre-commit 继续检查暂存的 JavaScript。[项目脚本](../../../apps/desktop/package.json) · [Stylelint 配置](../../../apps/desktop/stylelint.config.mjs)

首次按官方推荐配置扫描，两个原始文件共计 507 条诊断。共享表含 235 条重复选择器、256 条特异性顺序和 2 条弃用关键字 `break-word`，桌面表分别为 2、12、0 条。拆分时按原行列和规则核对诊断，并迁移至片段基线；没有历史来源的新文件执行完整规则。跨文件的重复选择器和特异性关系不再由单文件规则报告，其数量和拼接等价、实页对照结果记录在实施计划中。只有实际修正过的规则才能记为已修复。

日常检查只读基线。修复历史诊断时下调相应计数；同一文件同一规则的命中一增一减时仍需审查具体声明。Stylelint 将批量抑制标为实验功能，升级前需重跑现有回归，确认 Windows 路径匹配、超额失败和新文件检查仍然有效。[历史计数](../../../apps/desktop/stylelint-suppressions.json) · [Stylelint 批量抑制说明](https://stylelint.io/user-guide/suppressions/)

## 6. 拆分实施与验收

物理拆分、按组件整理和 SCSS 各自具有独立的验收与回退边界。物理拆分的执行记录见[实施计划](../plans/2026-11-10-web-styles-split.md)。

1. **取基线。** 记录实施时的源提交，在固定浏览器版本、字体、视口与脱敏题库下采集首页、导入、题库管理、练习/考试专注、训练复盘、设置和弹窗的计算样式或截图。重点留存 720/721px 移动导航分界与 1279/1280px 专注右栏分界，以及键盘焦点、减少动画、强制颜色和桌面标题栏主题。
2. **切分。** 在同一批变更内移动连续规则，并接通 HTML、桌面生成器与测试。将 HTML 顺序下的八份源文本按原换行拼接，与拆分前的完整源文本比较，确认每个声明、注释和规则恰好出现一次。CI 保留完整性与顺序检查，一次性的基线比对结果记录在实施计划。
3. **双端验证。** 在 `apps/desktop` 运行 `npm run test:web-platform`、`npm test`、`npm run typecheck`、`npm run lint`。串行执行 `npm run prepare:web`、`npm run build`、`npm run build:test` 和 `npm run test:desktop`，生成阶段独占 `dist`。核对真实 Web 子路径下每个 CSS 的响应、离线 WebView2 中的样式，以及相同页面状态的基线差异。打开本地文件的基础练习也可作回归，PDF/OCR 使用项目启动器。记录覆盖的桌面环境、尺寸以及尚未验证的场景。[Web 启动器](../../../apps/web/打开Shiroha%20Quiz.cmd) · [桌面冒烟](../../../apps/desktop/scripts/smoke.mjs)
4. **回退。** 任一片段缺失或出现未解释的视觉差异时，先按断点和规则追溯原区段。若需撤回物理拆分，成组恢复完整 `styles.css`、HTML 单一链接、资源白名单和测试装载，再从源码重新生成桌面资源。Stylelint 可继续检查恢复后的样式表。

## 7. 将来是否采用 SCSS

若出现多处必须同步维护的同构规则，且 CSS 自定义属性不足以表达，再取一个已有回归的独立组件试点 Dart Sass。用 `@use` 管理需要共享的混入和函数，在一个入口显式控制生成顺序。主题颜色等需要随 `body.desktop-mist-blue` 在运行时覆盖的变量继续保留为 CSS 自定义属性。试点要比较编译前后选择器、特异性、输出次序和字节数。[Sass 模块文档](https://sass-lang.com/documentation/at-rules/use/)

采用之前先确定源码、生成 CSS 和发布目录。Pages、桌面准备脚本、组件测试及离线 Web 分发都应消费同一编译结果，本地使用者取得完整可运行的静态包。需要先明确现有用户直接打开 `apps/web` 时如何取得 CSS，再决定是否检入受校验的预编译 CSS，或统一生成独立发布目录。选择后再配置编译、产物一致性检查、SCSS lint 与失败保全。若试点收益有限，可继续维护以上原生 CSS 结构。
