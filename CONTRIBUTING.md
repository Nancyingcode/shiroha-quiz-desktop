# Contributing

感谢你关注 `Shiroha Quiz`。

如果你在使用过程中遇到问题，或希望提出功能建议，欢迎通过 Issue 反馈。为了方便定位问题，请尽量按模板填写。

## 反馈问题

提交 Bug 时，建议说明：

- 你使用的是哪一端：Web 版或 Windows 桌面版。
- 出问题的具体操作步骤。
- 预期结果和实际结果。
- Shiroha Quiz 版本号、设备型号、Windows / WebView2 版本或浏览器版本。
- 如涉及题库导入，请尽量提供可脱敏的样例文件或文本片段。

旧 Android 应用已退出本仓库维护；旧备份导入问题请注明目标 Web / Windows 平台，并参考[迁移说明](docs/universal/Android停止维护与迁移.md)。

## 提交建议

提交功能建议时，建议说明：

- 这个功能想解决什么问题。
- 你希望它在哪一端使用。
- 你期望的使用流程。
- 是否会影响题库导入、刷题、考试、错题本、备份互通等核心功能。

## 参与开发

开始协作前，请阅读[协作开发分支规划](./docs/universal/协作开发分支规划.md)：以 `main` 为主线，每个任务使用独立分支和 worktree，多任务按依赖顺序整合并验证。推送 `main` 会触发 Web 发布；提交、推送、PR 和发布分别遵循[开发规范](./AGENTS.md)及用户授权。

如果你希望提交 Pull Request，请尽量保持改动范围清晰：

- Web 相关改动放在 Web 目录内。
- Windows 桌面相关改动放在 apps/desktop，业务仍复用 apps/web。
- 涉及题库导入解析时，请同步补充说明或测试样例。
- 不要提交个人信息、专有题库、密钥、缓存文件或构建产物。

项目名称统一使用 `Shiroha Quiz`。

### 代码检查与提交规范

JavaScript/TypeScript 修改遵循 [Airbnb JavaScript 项目适配指南](./rules/javascript-style-guide.md)。新增代码和修改逻辑逐步采用规范，保留本项目的 IIFE、Node ESM/CommonJS、数据格式与安全边界；[重构设计](./docs/superpowers/specs/2026-11-05-airbnb-javascript-refactor.md)和[已批准实施计划](./docs/superpowers/plans/2026-11-05-airbnb-javascript-refactor.md)记录后续门禁与迁移批次。用户已批准的 P0—P5 分阶段任务已完成；高风险状态的保留范围、实际验证与历史债务见实施计划。ESLint 覆盖范围以下文和实际配置为准。

开发工具统一安装在 `apps/desktop`，使用现有 npm 锁文件。安装依赖前，先关闭使用当前工作区依赖的开发服务和桌面窗口，详见[桌面开发说明](./apps/desktop/README.md#开发与构建)。

```powershell
cd apps/desktop
npm ci
npm run typecheck
npm run lint
npm test
```

`npm ci` / `npm install` 会通过 `prepare` 在仓库根目录安装 Husky hooks；已有依赖时可运行 `npm run prepare` 重新安装。每个 worktree 都需安装自己的依赖和 hooks。根目录没有 `package.json`，不要在根目录直接运行 npm 脚本。

本地提交时，`pre-commit` 对本次暂存的手写 `.js`、`.mjs` 和 `.cjs` 文件执行 ESLint（扩展名大小写均可）。它从 Git 索引读取文件全文，所以部分暂存也能检查实际提交的版本。首次提交使用相同流程。错误或警告会阻止提交，暂存内容和工作区修改均会保留。检查入口或所用规则与索引不一致时，需先处理这些工具文件的差异。`commit-msg` 继续检查提交说明。

历史范围采用[逐文件迁移清单](./apps/desktop/eslint.migration.mjs)：当前 132 个手写脚本均按完整文件进入增量门禁，`app.js` 和此前门禁外的测试工具已执行全部目标规则。其余历史文件中，41 个暂缓部分 Stylistic 规则，44 个仅暂缓已列明的少量未清零语义规则，清零的规则仍为 error；新文件不继承这些例外。`question-bank.js` 数据、第三方、原始 fixture 和生成资源明确排除。暂缓范围不保证新增同类违规会被阻断，修改时仍需人工按规范审查，后续逐规则/文件迁移后删除例外；不采用总告警预算或仅检查改动行。

在 `apps/desktop` 运行 `npm run lint:debt` 可查看上述历史文件的逐文件/规则数量、行列和消息。发现既有债务正常输出报告；缺失文件、语法错误、配置或规则执行失败返回非零，不能把失败当成零债务。可用 `npm run lint:debt -- --file apps/web/app.js` 单独查看语义诊断；`app.js` 的正式门禁同时检查格式。导入重复检查由 ESLint 核心规则提供；没有安装 import-x，不宣称检查缺失模块、导入循环或未使用模块。相关业务变更仍须执行对应回归。

`commit-msg` 使用 commitlint 的 `@commitlint/config-conventional` 校验提交信息，格式为 `type(scope): 描述`，其中 scope 可省略，描述支持中文。例如：

```text
feat(web): 支持题库详情预览
fix(desktop): 修复窗口位置恢复
docs: 补充开发说明
```

允许的 type 为 `build`、`chore`、`ci`、`docs`、`feat`、`fix`、`perf`、`refactor`、`revert`、`style`、`test`，标题最多 100 个字符。Git 自动生成的标准 merge/revert 信息遵循 commitlint 默认忽略规则。可在 `apps/desktop` 手动验证消息或提交范围：

```powershell
'fix(web): 修复题库预览' | npm run commitlint -- --verbose
npm run commitlint -- --from main --to HEAD --verbose
```

在 `apps/desktop` 运行 `npm run lint:css` 可单独检查 Web 根目录、`apps/web/styles/` 和桌面 `frontend/` 中的 CSS。命令只读，使用 Stylelint 官方推荐规则。现有样式按文件和规则记录历史诊断数量，没有历史来源的新文件从零开始检查。修复历史问题后同步下调对应计数；同一文件同一规则一增一减时，计数无法区分具体位置，审查时仍要核对变更。[拆分设计与基线](./docs/superpowers/specs/2026-11-10-web-styles-split.md) · [历史计数](./apps/desktop/stylelint-suppressions.json)

Windows CI 运行类型检查、测试和 `npm run lint:ci`。有可信基线的普通 PR 按变更检查 JavaScript，涉及 CSS 增删改名或内容变更时也执行 `lint:css`。检查配置或历史计数有变动、基线无法确认及推送 `main` 时执行全量 lint。开发者可以在 `apps/desktop` 运行 `npm run lint` 一并验证 JavaScript、CSS、规则回归和文档。PR 还校验 base 到 head 的提交说明。

## 贡献者与致谢

无论以何种形式参与，只要对项目有帮助，都会被记录在 [README 的「贡献者」章节](./README.md#贡献者)，例如：

- 提交 Pull Request —— 即使最终未合并，有价值的实现思路同样会被记录。
- 报告问题，尤其是安全相关的问题。
- 补充文档、测试样例或题库兼容样例。

## 报告安全问题

本项目涉及本地凭据存储（AI 接口密钥、MinerU Token、WebDAV 密码）、题库隐私和云端备份，发现相关问题时请注意：

- 建议先提交一份**概要说明**，讲清影响范围和触发条件，但**不要附带可直接复现利用的完整步骤或密钥样例**。
- 确认修复或达成一致后，再公开讨论细节。
- 请勿在公开内容中粘贴真实的 API Key、Token、密码，或含个人信息的题库文件。

凭据类问题特别提示：本项目所有凭据都不应出现在导出的备份文件、云端备份包或日志中。如果发现任何凭据出现在上述位置，请按安全问题的流程反馈。
