# Web 控件与反馈样式 SCSS 迁移设计

2026-11-21 · 用户已确认 · 审查基线 `main` 的 `c4e1e21` · [实施计划](../plans/2026-11-21-web-controls-feedback-scss.md)

## 迁移范围

下一批迁移 `apps/web/styles/controls-and-feedback.css` 这一整份共享样式表。它承载对话框、分页和原生下拉、导入文件控件、表单焦点、练习暂停与训练复盘，也包含平台提示、桌面 AI 执行设置的隐藏态、题库详情、收藏操作和语言选择器。Web 已有对话框、下拉框和整页交互回归，Windows 冒烟也覆盖真实 WebView2 下拉和样式加载，可用来比对迁移前后表现。[现有样式](../../../apps/web/styles/controls-and-feedback.css) · [AI 面板试点记录](../plans/2026-11-21-web-scss-integration.md)

手写入口为 `apps/web-scss/controls-and-feedback.scss`，生成 CSS 随仓库保存到原路径。它继续作为 HTML 中第八份共享样式表，Windows 接着加载 `desktop.css`。以原有选择器、优先级、注释、规则顺序和运行时 CSS 自定义属性为迁移基线，尤其核对分页下拉的 `!important` 和窄屏表单焦点的跨文件覆盖。[Web 入口](../../../apps/web/index.html) · [桌面覆盖表](../../../apps/desktop/frontend/desktop.css)

导入表单、文件选择控件、练习与考试表单的最终聚焦规则都用了相同的 `border-color`、`background` 和内嵌 `box-shadow`，且三条声明均带 `!important`。本批只抽取这一组为文件内的 mixin，在三个原规则位置展开。各控件独有的描边、定位、层级和强制颜色规则留在原位置。[重复声明](../../../apps/web/styles/controls-and-feedback.css#L474)

只读试编译已用仓库锁定的 Dart Sass 验证。编译前后各有 182 个普通规则节点、14 个 `@` 规则节点和 638 条声明，其中 24 条带 `!important`。Stylelint 在应用历史抑制前均报告 11 条特异性顺序、4 条重复选择器。已观察到属性选择器引号和 `min()` 内层 `calc()` 的序列化差异，双端仍需比对实际 CSSOM 和计算值。[历史抑制计数](../../../apps/desktop/stylelint-suppressions.json)

## 迁移顺序

1. **采集基线。** 保存 `c4e1e21` 的原 CSS 和哈希，在隔离的 Edge、WebView2 上用同一组自建题库和状态记录 CSSOM、计算样式、布局及焦点。每端固定浏览器版本、字体和设备缩放比例，在同样的视口和界面状态下与迁移前结果比较。
2. **扩展现有生成入口。** 将当前 AI 面板条目和本批条目纳入同一份固定映射，生成脚本和增量 CI 从同处识别产物路径。复用已锁定的依赖、`styles:build` 和 `styles:check`，给新产物设定 Git LF。先编译并核对所有入口和目标，再逐文件以同目录临时文件替换有变化的产物。编译失败时保全现有文件，写入失败时报告目标路径，重跑可补齐失败项。只读检查负责拦住缺失或过期的任一产物。[生成入口](../../../apps/desktop/scripts/styles.mjs) · [增量 lint](../../../apps/desktop/scripts/lint-ci.mjs)
3. **先等价迁移，再提取 mixin。** 按原顺序搬入全部规则与注释，核对选择器、声明及优先级、`@media`、`@container`、`@supports`、关键帧和资源引用。逐项解释编译器产生的差异，记录 CSS 体积。完成等价迁移后再抽焦点环声明，要求抽取前后生成的 CSS 逐字节一致，并核对 AI 面板产物的哈希仍等于基线。
4. **验证门禁和双端。** 用临时夹具验证增量 PR 在仅改 SCSS、仅改或删除新增产物时都触发一致性检查。让新增 CSS 缺失或过期，确认 Pages 上传前检查与 `prepare:web` 能拦截。确认 `styles:check` 只读，第二份源码编译失败时两份旧 CSS 保全，桌面入口检查失败时既有 `dist` 保全。重建后运行公共检查和双端回归。[已有生成回归](../../../apps/desktop/test/styles.test.mjs) · [Pages 工作流](../../../.github/workflows/pages.yml) · [桌面资源入口](../../../apps/desktop/scripts/prepare-web.mjs)

## 双端验证方案

| 场景 | 两端各自对照的验收项 |
| --- | --- |
| 对话框 | 视口 480/481px。核对普通、危险确认和输入对话框的布局、长文本、遮罩、焦点循环、Escape 与关闭后的焦点恢复。切换减少动画偏好，对照对话框动画。 |
| 分页和原生下拉 | 分页容器内容宽度 440/441px。核对页码组切换、紧凑页大小下拉框的 32px 高度与 6px 圆角。验证普通下拉的鼠标、键盘、长名称及禁用项，记录 `base-select` 增强分支。在隔离夹具中屏蔽增强规则，对照回退到系统下拉的样式。 |
| 导入、练习和考试表单 | 视口 720/721px。用 Tab 聚焦输入框、下拉框、导入文本域和文件选择控件，核对焦点环、边框、背景和是否裁切。强制颜色模式核对内嵌系统描边。 |
| 复盘与专注布局 | 视口 600/601px 对照计时器换行、复盘题卡和选中态，1279/1280px 对照练习主卡宽度、右栏与暂停按钮。 |
| 同表其余界面 | 用现有回归检查题库详情和收藏操作、语言选择器、平台成功与失败提示，以及桌面 AI 执行设置隐藏态。 |

- **公共门禁。** 在 `apps/desktop` 运行 `pnpm run styles:check`、`pnpm run typecheck`、`pnpm run lint` 和 `pnpm test`。全量 lint 同时检查 SCSS 和生成 CSS。核对历史诊断对应的规则与选择器。
- **Web。** 运行 `pnpm run test:web-platform`，在 Edge 从本地仓库子路径加载真实页面，确认八份 CSS 均返回 HTTP 200 且 CSSOM 可用，补查直接打开本地 HTML 的样式加载。比较表中场景的规则顺序、几何尺寸与计算样式。[Web 整页回归](../../../test/dual-platform/browser-page.cjs) · [下拉框回归](../../../test/dual-platform/select-page.cjs) · [对话框回归](../../../test/dual-platform/dialog-page.cjs)
- **Windows。** 串行执行 `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test` 和 `pnpm run test:desktop`。比较 `dist` 与 Web 的两份生成 CSS 哈希，在隔离的离线 WebView2 中核对八份共享 CSS 和最后加载的桌面主题，按表中场景检查实际计算样式与键盘交互。[WebView2 冒烟](../../../apps/desktop/scripts/smoke.mjs)

验收以双端各自的基线为准。选择器、规则顺序、计算样式和交互均须等价，且陈旧产物能被门禁拦截。需要回退时，恢复原 `controls-and-feedback.css` 并撤回本批的 SCSS 入口、产物映射条目及 LF 设置，重新核对两端加载结果。
