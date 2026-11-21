# Web 控件与反馈样式 SCSS 迁移实施计划

用户已确认[迁移设计](../specs/2026-11-21-web-controls-feedback-scss.md)。本次迁移使用现有工作树中的 `codex/shared-controls-feedback-scss` 分支，基线为 `main` 的 `c4e1e21`。

## 1. 保存原样式与双端基线

- [x] 记录 `controls-and-feedback.css` 的 Git blob 字节数、哈希、规则序列和现有 Stylelint 诊断，同时记录 AI 面板产物哈希。
- [x] 复用隔离 Web 与 WebView2 启动器，采集设计中约定的对话框、分页及下拉、表单焦点、训练复盘、专注布局与状态提示。按场景固定视口或分页容器宽度，记录浏览器版本、键盘焦点与强制颜色、减少动画的切换效果。

## 2. 扩展生成与校验

- [x] 先补第二个 SCSS 目标的回归，覆盖两个产物独立过期、第二份源码编译失败保全、增量 PR 只改或删除新增产物、桌面准备发现新增产物过期仍保留已有 `dist`。
- [x] 让 `styles:build`、`styles:check` 和增量 lint 复用两份样式的固定映射。全量编译和路径核对完成后按目标替换，保留同目录临时文件、无变更跳过写入和只读校验语义。
- [x] 为新增生成 CSS 设置 Git LF。复测只改 SCSS、只改产物和改映射的门禁，以当前 Pages 和桌面准备入口继续消费 `styles:check` 的结论。

## 3. 迁移规则并提取重复声明

- [x] 按原规则和注释的顺序创建 `apps/web-scss/controls-and-feedback.scss`，生成到原 CSS 路径。核对浏览器 CSSOM、优先级、断点、内嵌箭头和 Stylelint 历史诊断，记录序列化差异和体积。
- [x] 对三处最终焦点规则提取同一个文件内 mixin，比较提取前后生成 CSS 字节。核对 AI 面板产物哈希，更新[贡献指南](../../../CONTRIBUTING.md)中的样式编辑入口。

## 4. 验证与验收

- [x] 从 `apps/desktop` 运行 `pnpm run styles:check`、`pnpm run typecheck`、`pnpm run lint` 和 `pnpm test`。在隔离目录复演 Pages 上传前的同款检查及桌面预检失败后重建。
- [x] 运行 `pnpm run test:web-platform`。
- [x] 在 Edge 的真实 Web 子路径及本地 HTML 复测样式装载。按迁移前保存的场景比较计算样式与行为，检查分页容器 440/441px 和 480/481、600/601、720/721、1279/1280px 视口。
- [x] 串行运行 `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test` 和 `pnpm run test:desktop`。比较两份产物的 Web 与桌面字节，在离线 WebView2 中重新采样并记录双端结果。

## 5. 执行与验证记录

- 原文件的 Git blob 为 27,880 字节，SHA-256 为 `5badfcbe674264e5607066493e5383f28390719a8385182ae93516fc26909217`。展开格式和生成说明使产物增至 30,870 字节，SHA-256 为 `fc05e494cf7b3a9b98b68fb71f9480c104a0cb1c56460a9a4d33117b0eba81b8`。提取 mixin 前后 CSS 逐字节一致，AI 面板产物 SHA-256 为 `7dd5403de726f7506395eea73faedbec867bfe870233981e0181b1cd6b4315b5`，与基线一致。
- 核对了规则结构、声明顺序、24 处 `!important`、原有注释及下拉箭头的内嵌 URL。Stylelint 诊断按规则和选择器逐条对应，仍为 11 条特异性顺序、4 条重复选择器。
- 补充测试时旧实现有 6 项失败。接入后增量 PR 的 SCSS、产物增删改与映射用例通过。在隔离目录模拟 Pages 上传前门禁，新增产物缺失、过期均被 `styles:check` 与 `prepare:web` 拒绝。校验不写入 CSS，既有 `dist` 保全，重建后通过。
- `pnpm run styles:check`、`pnpm run typecheck` 和 `pnpm run lint` 通过。`pnpm test` 的桌面 Node 套件 306 项中 305 项通过，Windows 临时目录大小写相关用例跳过 1 项，共享套件 538 项全部通过。
- `pnpm run test:web-platform` 的 275 项全部通过。Edge 158.0.4370.33 在 Web 子路径和 `file://` 均加载八份 CSS。子路径下 46 组迁移前后采样一致，157 条顶层 CSSOM 规则顺序一致。序列化差别是两处 `var()` 逗号和一处 `@supports` 冒号后的空格。下拉回退样式使用屏蔽 `base-select` 增强规则的隔离夹具验证。
- 强制颜色基线中，导入页题库名称与识别模式的 `outline-style` 为 `none`，文件控件、导入文本域及练习和考试的采样控件有内嵌描边。对照按两端的实际基线执行。
- Windows 10 19045 的 `prepare:web`、release 构建和隔离测试构建均通过。`dist` 的两份生成 CSS 与 Web 逐字节相等。离线 WebView2 157.0.4341.60 实际加载八份共享样式及最后的 `desktop.css`，请求到的控件与反馈 CSS 与 Web 产物哈希相同。46 组采样一致，157 条顶层 CSSOM 规则与基线仅有同样三处空格差异。
- `pnpm run test:desktop` 的 65 项冒烟全部通过。双端采样、门禁复演和各套件日志保存在工作树的 `apps/desktop/.reports/scss-controls/`。
