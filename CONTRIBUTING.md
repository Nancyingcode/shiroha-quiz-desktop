# Contributing

感谢你关注 `Shiroha Quiz`。

如果你在使用过程中遇到问题，或希望提出功能建议，欢迎通过 Issue 反馈。为了方便定位问题，请尽量按模板填写。

## 反馈问题

提交 Bug 时，建议说明：

- 你使用的是哪一端：原生 Android App、Web 版，或后台 / 管理端。
- 出问题的具体操作步骤。
- 预期结果和实际结果。
- Shiroha Quiz 版本号、设备型号、Android 系统版本或浏览器版本。
- 如涉及题库导入，请尽量提供可脱敏的样例文件或文本片段。

如果是在手机安装包里遇到问题，通常请选择“原生 Android App”，不要写成 Web 版。

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
- 原生 Android 相关改动放在 Android 原生源码目录内。
- 涉及题库导入解析时，请同步补充说明或测试样例。
- 不要提交个人信息、专有题库、密钥、缓存文件或构建产物。

项目名称统一使用 `Shiroha Quiz`。

### 代码检查与提交规范

开发工具统一安装在 `apps/desktop`，使用现有 npm 锁文件。安装依赖前，先关闭使用当前工作区依赖的开发服务和桌面窗口，详见[桌面开发说明](./apps/desktop/README.md#开发与构建)。

```powershell
cd apps/desktop
npm ci
npm run typecheck
npm run lint
npm test
```

`npm ci` / `npm install` 会通过 `prepare` 在仓库根目录安装 Husky hooks；已有依赖时可运行 `npm run prepare` 重新安装。每个 worktree 都需安装自己的依赖和 hooks。根目录没有 `package.json`，不要在根目录直接运行 npm 脚本。

提交时，`pre-commit` 自动运行 `npm run lint`：ESLint 检查桌面脚本、测试、配置、Web 平台适配与桌面前端，文档检查验证 UTF-8、代码围栏和本地链接。任何错误或警告都会阻止提交；检查只读取文件，不自动修复或改写暂存区，首次提交适用同样的检查。历史 `apps/web/app.js`、`question-bank.js`、其他测试目录、第三方库与生成资源不在当前 ESLint 覆盖范围内；相关业务变更仍须执行对应回归。

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

Windows CI 继续运行相同的 ESLint 检查，并在 Pull Request 中校验 base 到 head 的提交信息；CI 通过 `HUSKY=0` 跳过本地 hooks 安装，单独执行检查。

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
