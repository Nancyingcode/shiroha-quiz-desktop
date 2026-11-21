# AI 面板 SCSS 接入实施计划

2026-11-21 用户确认按[接入设计](../specs/2026-11-21-web-scss-integration.md)实施。执行和验证由当前任务负责。分支 `codex/shared-ai-panel-scss`，工作树 `C:/Users/30728/.codex/worktrees/21c4/shiroha-quiz-desktop`，起点为本地 `main` 的 `d60a49a`。预期目标分支为 `main`。

## 1. 采集原样式基线

- [x] 保存 HEAD 中原有 AI 面板 CSS 的字节数、SHA-256。在隔离 Edge 中从 720、721、1180、1181px 视口采集 CSSOM、真实页面的共享链接顺序、诊断网格、导入与预览网格、追问输入、字体与键盘焦点。
- [x] 对照原生 CSS 在桌面主题中的表现。在同一个隔离测试程序中替换 AI 面板规则做 A/B 对照，并单独确认实际打包文件的加载结果。

## 2. 建立生成与门禁

- [x] 先写回归，复现缺少 CSS、手改 CSS、SCSS 语法错误和链接路径，以及过期 CSS 时桌面入口必须保全已有 `dist`。补增量 CI 用例，覆盖只改 SCSS 局部文件、只改生成 CSS 及生成脚本变化。
- [x] 开发依赖定版后更新 pnpm 锁文件。在 `apps/desktop/scripts` 建立一个 Sass 编译入口，供 `styles:build` 和 `styles:check` 共享。生成 UTF-8、LF 和固定文件头，成功后通过同目录临时文件替换，内容相同时跳过写入。
- [x] 增加 SCSS 语法及指令检查。全量 lint 执行源码 lint 和一致性检查，增量 CI 按路径触发，已有 CSS 检查继续覆盖最终产物。桌面准备入口与 Pages 上传前执行一致性检查。

## 3. 迁移 AI 面板

- [x] 复制原始样式到 `apps/web-scss/ai-panels.scss`，先编译原规则。检查编译后的规则数量、顺序、选择器和声明，与原版比较断点、覆盖、体积及实际计算样式。
- [x] 提取诊断、导入和预览字段标签的四条重复声明。比较提取前后编译字节，要求完全一致。
- [x] 更新开发说明，记录修改入口、重建目录和只读检查命令。沿用现有静态资源路径和桌面主题加载次序。[贡献指南](../../../CONTRIBUTING.md)

## 4. 双端验证

- [x] 在 `apps/desktop` 执行 `pnpm run typecheck`、`pnpm run lint` 和 `pnpm run test:web-platform`。运行现有单题 AI mock 回归。确认静态子路径八份 CSS 均能加载，试点断点两侧与基线计算样式一致。
- [x] 运行 `pnpm test` 的桌面和共享回归，复测环境超时项。
- [x] 复现 Pages 上传前的本地检查和桌面准备检查拒绝过期产物，重建后通过。检查发布目录中只有运行所需的样式。
- [x] 串行运行 `pnpm run prepare:web`、`pnpm run build`、`pnpm run build:test`、`pnpm run test:desktop`，核对实际 WebView2 的离线样式加载、桌面覆盖和断点表现。记录通过数、跳过项和环境范围。

## 5. 样式与构建核对记录

- 原文件按 Git blob 计 11,845 字节，SHA-256 为 `4cb4be01d81cef57bcbf83292d29dddd2895286f3741e95f3d12aeb78cc5f817`。展开格式和生成说明使产物增加到 14,117 字节，SHA-256 为 `7dd5403de726f7506395eea73faedbec867bfe870233981e0181b1cd6b4315b5`。抽取 mixin 前后生成文件逐字节相等。
- Edge 158.0.4370.33 在隔离的仓库子路径加载八份 CSS，状态均为 HTTP 200。对照 AI 面板 109 条顶层 CSSOM 规则，选择器、顺序和声明一致，序列化文本的唯一差异是单题 AI 渐变中逗号后的空格。两组断点两侧的计算样式、元素尺寸和键盘焦点一致。采样记录见工作树的 `apps/desktop/.reports/scss-pilot/web-before.json` 和 `web-after.json`。
- Dart Sass 1.108.2、`postcss-scss` 4.0.9 和 `stylelint-scss` 7.5.0 已通过 pnpm 冻结安装。一次性编译禁用 Sass 可选监听器的安装脚本。
- 在临时发布树执行 Pages 同款 `pnpm run styles:check`。手改产物后校验失败且文件字节保留，Windows 文件锁导致原子替换失败时旧文件与目录也保留。解除锁定后重建，校验通过且哈希与 Web 产物一致。桌面入口测试确认过期样式不会改写既有 `dist`。
- `pnpm run typecheck`、`pnpm run lint` 通过。Web 页面套件 275 项中 273 项首次通过，练习暂停和训练记录筛选两项在并行构建期间等待控件超时，按原断言单独重跑均通过。单题 AI mock 58 项全部通过。完整输出保存在工作树的 `apps/desktop/.reports/scss-pilot/`。
- 桌面 Node 套件 303 项中 301 项通过，1 项因 Windows 临时目录不区分大小写而跳过，1 项启动清理夹具的 Node 子进程超时。超时项按原断言单独重跑通过。另行执行的完整共享套件 538 项全部通过。
- Windows 10 19045 上的 `pnpm run prepare:web`、`pnpm run build` 和 `pnpm run build:test` 通过，`dist/styles/ai-panels.css` 的哈希与 Web 静态文件一致。
- WebView2 157.0.4341.60 在隔离测试版中加载八份共享 CSS，再加载 `desktop.css`。实际请求的 AI 面板 CSS 与 Web 文件逐字节一致。保持其他样式表和主题位置，替换这一表的规则做 A/B 对照。720、721、1180、1181px 模拟视口的计算样式、尺寸和键盘焦点一致。报告见 `apps/desktop/.reports/scss-pilot/webview2.json`。
- `pnpm run test:desktop` 的 65 个检查全部通过，包括离线资源、专注布局和使用回环 mock 的原生 AI。桌面验收使用 Windows 10 上的隔离测试版，Pages 门禁使用本地临时发布树。桌面回归报告见 `apps/desktop/.reports/scss-pilot/desktop-smoke.log`。
