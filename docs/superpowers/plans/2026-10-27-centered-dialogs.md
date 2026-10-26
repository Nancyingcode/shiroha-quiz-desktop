# 居中弹框实施计划

- 设计：[清透蓝白居中弹框](../specs/2026-10-27-centered-dialogs.md)，已获本会话用户批准。
- 负责人：本会话；分支：`codex/web-centered-dialogs`。
- 工作树：`E:/Codex/worktrees/d049/shiroha-quiz-desktop`。
- 基线：`472dd046c94e8baad1d68dd3f1423114e8f15958`，与本地 main 相同；未联网刷新远端。
- 范围：共享 Web 弹框组件、调用点及相应回归，资源由现有流程生成；用户后续已授权提交并合并到 main，不推送。

## 步骤

1. 添加真实浏览器弹框回归，确认缺少组件时失败。
2. 实现无依赖的异步模态组件及样式，转换调用点，核对取消路径、保存锁与快捷键。
3. 将已有自动接受原生框的回归迁移为操作真实居中框，运行相关测试。
4. 运行 npm test、typecheck、lint、Web/AI 回归、build、build:test 和 test:desktop；记录结果与环境限制。

## 实施与验证记录

- 已转换共享业务 38 个原生弹框调用，逐一检查均等待结果；组件无新增依赖。
- 补充总提交连击保护，以及退出确认期间自动交卷后保留成绩界面的会话校验。
- `npm test`、`npm run typecheck`、`npm run lint` 通过。
- `npm run test:web-platform` 已包含新增弹框浏览器回归，28 项通过。
- Web AI runner 使用机器现有 Playwright 与 Edge、mock 网络运行，32 项通过；不调用真实 AI 服务。
- 新增设计与计划已独立检查 UTF-8、代码围栏及本地链接。
- `npm run build`、`npm run build:test`、`npm run test:desktop` 最终均通过。WebView2 实际确认水平/垂直居中、Esc 取消和重新打开；截图位于 `apps/desktop/.reports/centered-dialog.png`。
- 桌面完整 smoke 同时覆盖原生 mock AI/WebDAV、练习考试、重启、迁移与损坏库恢复，以及本地 PDF/OCR、中文扫描 PDF、DOCX、XLSX 导入保存重载；没有用浏览器结果代替 WebView2 结果。
- Windows 受限环境无法完成依赖安装、浏览器启动及符号链接用例；使用正常权限重跑后通过，使用隔离测试 profile 和自建题库。
- 验证完成后，按用户授权在任务分支独立提交并本地合并到 main，不推送；正式安装、升级和真实服务验收不在本次范围。
