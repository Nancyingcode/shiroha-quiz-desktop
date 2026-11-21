# Web 与 Windows 共享样式的 SCSS 接入设计

2026-11-21 · 用户已确认 · 审查基线 `d60a49a` · [实施计划](../plans/2026-11-21-web-scss-integration.md)

建议先用 Dart Sass 维护 AI 面板这一份样式表。SCSS 源码放在 `apps/web-scss/`，生成的 CSS 随仓库保存到现有路径 `apps/web/styles/ai-panels.css`。这样，改样式的开发者需要编译，使用本地启动器、GitHub Pages 或 Windows 客户端的人都直接取得同一份 CSS。

## 为什么先选 AI 面板

Web 入口按顺序加载八份共享 CSS，AI 面板排第七，后面还有表单和焦点修正。桌面生成器复制这八份资源，再把桌面主题放在最后。组件测试也会从真实 HTML 读取样式链接。选一个现成文件作编译边界，可以直接验证选择器和断点，免去调整链接次序、桌面资源清单和测试装载方式。[Web 入口](../../../apps/web/index.html) · [桌面生成器](../../../apps/desktop/scripts/prepare-web.mjs) · [组件测试装载](../../../test/dual-platform/styles.cjs)

`.ai-diagnostics-grid-v375 span`、`.ai-import-meta-grid-v99 span` 和 `.ai-preview-meta-grid-v991 span` 都用同样的四条声明显示字段标签。首批只提取这组声明为文件内的 `@mixin`，三个选择器仍在原位置展开。导入与预览面板分别使用四列和五列，两者的布局仍可独立调整。这提供了一个具体的收益判据：以后调整字段标签只改一处，同时三个界面的最终样式一致。[AI 面板 CSS](../../../apps/web/styles/ai-panels.css) · [上次样式拆分设计](2026-11-10-web-styles-split.md)

## 源码、产物与开发命令

| 项目 | 首批约定 |
| --- | --- |
| 手写入口 | `apps/web-scss/ai-panels.scss` 是该表唯一手写来源。保留现有注释、选择器、声明和媒体查询的相对顺序。主题颜色、间距等已通过 `var(--…)` 在运行时取值的部分继续使用 CSS 自定义属性。 |
| 静态产物 | `apps/web/styles/ai-panels.css` 的文件头标明来源和重建命令。编译器、SCSS 和 source map 都在发布目录之外。其余七份共享表与桌面专用的 `frontend/desktop.css` 继续手写。 |
| 工具 | 在现有 `apps/desktop` pnpm 工程添加 `sass` 开发依赖并锁定版本，复用 Node 24 和项目锁文件。源文件检查另选与现有 Stylelint 17 兼容的 SCSS 语法及规则配置，同样只作开发依赖。 |
| 生成 | 拟增 `pnpm run styles:build`。从固定入口编译，使用展开格式、UTF-8、LF、固定末尾换行，关闭 source map。仅为这个生成文件设置 Git 的 `text eol=lf`，保证 Windows 检出与 Linux CI 可以逐字节比较。 |
| 核对 | 拟增 `pnpm run styles:check`。用同一个编译函数在内存生成 CSS，与工作树中的文件逐字节比较。缺失、过期或手改均返回非零，给出路径和重建命令。两条命令都从 `apps/desktop` 运行。 |

编译完整成功后，生成命令才在目标目录写临时文件并替换目标。若内容相同就跳过写入。语法错误、写入失败或目标路径经过链接时保留已有 CSS；校验命令全程只读。单文件试点无需监听进程或打包器。今后如果第二个组件确需复用同一组声明，再用 `@use` 引入只定义 mixin 的局部文件。

## 接入开发、发布和检查

- **开发与桌面。** 开发者改 SCSS 后执行 `styles:build` 并一起交付源码和产物。在 `prepare:web` 的脚本入口先执行 `styles:check`，成功才调用现有资源生成器。Tauri dev、正式构建和测试构建都经过这个入口。保留生成器接收隔离 fixture 的接口；增加命令入口测试，确认失败时既有 `dist` 保全。[项目脚本](../../../apps/desktop/package.json) · [Tauri 配置](../../../apps/desktop/src-tauri/tauri.conf.json) · [资源生成回归](../../../apps/desktop/test/prepare-web.test.mjs)
- **静态发布。** 本地启动器照常提供 `apps/web`。Pages 当前直接上传该目录，须在上传前使用项目声明的 Node、pnpm 和冻结锁文件安装开发依赖，并在 `apps/desktop` 运行 `styles:check`。检查失败即停止本次上传，即使桌面 CI 尚未结束也能拦住陈旧产物。验收使用本地仓库子路径和临时制品。[Pages 工作流](../../../.github/workflows/pages.yml) · [本地启动器](../../../apps/web/serve.ps1)
- **源码和产物各查一遍。** SCSS 专项检查覆盖入口及后续局部文件，识别 `@mixin`、`@include` 和拼错的指令。原有 `lint:css` 继续检查浏览器实际加载的 CSS，包括共享变量、类名和选择器深度。AI 面板已有一条 `no-descending-specificity` 历史计数，留在 CSS 原路径；不要为新 SCSS 复制抑制清单。源码规则聚焦 SCSS 语法，最终级联规则由 CSS 检查承担。[Stylelint 配置](../../../apps/desktop/stylelint.config.mjs) · [历史计数](../../../apps/desktop/stylelint-suppressions.json)
- **全量和增量 CI。** 全量 lint 纳入 SCSS 检查和产物一致性检查。增量 PR 当前只识别 `.css`；补上对 SCSS 增删改名（含大小写）、试点 CSS 和生成脚本的识别，配置及锁文件改动走全量。测试覆盖只改局部 SCSS、只改生成 CSS 两种漏检路径。[全量 lint](../../../apps/desktop/scripts/lint-runner.mjs) · [增量 CI](../../../apps/desktop/scripts/lint-ci.mjs)

## 试点顺序与验收

1. **记录基线。** 在同一浏览器、字体与隔离测试数据下记录试点文件的字节数、CSSOM 规则顺序，以及诊断、导入预览、单题追问的计算样式。覆盖 720/721px、1180/1181px 两组断点，记录列数、标签字号和边距、长文本省略、键盘焦点与桌面主题色。浏览器和 WebView2 分别与各自基线比较。[页面回归](../../../test/dual-platform/browser-page.cjs) · [单题 AI mock 回归](../../../test/web-ai-practice/README.md)
2. **先建立生成链路。** 先用 fixture 写出缺失产物、手改 CSS、SCSS 语法错误和失败保全的回归，再接入生成与校验。按原顺序迁移整个 AI 面板文件，首次比较允许编译器规范化空白或等价的颜色写法，核对解析后的选择器、声明值、优先级及媒体查询顺序。记录输出体积变化及原因。之后每次重建以固定编译器的字节结果为准。
3. **提取一处重复样式。** 仅在前三处标签中使用同一 mixin，校验提取前后重新生成的 CSS 字节相同。用故意陈旧的 CSS 验证 Pages 上传前检查与桌面准备入口均会失败，重新生成后再验证通过。
4. **双端验收。** 在 `apps/desktop` 运行 `pnpm run typecheck`、`pnpm run lint`、`pnpm test`、`pnpm run test:web-platform`。从仓库根运行 `node test/web-ai-practice/runner.cjs` 使用 mock。检查本地静态子路径八份 CSS 均加载，AI 面板在断点前后与基线一致。桌面串行运行 `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test` 和 `pnpm run test:desktop`，核对离线 WebView2 中的共享样式、桌面覆盖顺序和同组计算样式。

通过条件是三处标签可由一处修改、双端计算样式无未解释差异、陈旧 CSS 无法进入发布或桌面生成。若收益不足，可把已验收的 CSS 恢复为手写来源，移除试点源码、生成标记及对应工具和检查，保持原资源 URL。是否迁移下一份样式表，按实际出现的重复规则和回归覆盖单独决定。
