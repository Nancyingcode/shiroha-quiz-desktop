# 错题原作答标记实施计划

依据：[已批准设计](../specs/2026-10-28-original-wrong-choice.md)。

负责人：当前 Codex 会话。工作树：`E:/Codex/worktrees/d869/shiroha-quiz-desktop`。
分支：`codex/web-original-wrong-choice`；基线：`a354020a85fc8ff77fa17e32901ee0741ddc42e1`（本地 main）。
范围：共享 Web 作答记录、选项样式、回归测试；不修改原生存储契约。用户在验证完成后明确授权提交并本地合并到 main，不推送。

1. 补充失败回归：错误选择保留、跨库隔离、答对不覆盖、练习/考试入口保存。
2. 复用 `lastAnswer` 保存错误作答，按批准示例更新标记与对照区。
3. 浏览器验证真实作答后进入错题本、重载及窄屏布局；桌面隔离测试验证持久化和展示。
4. 执行 npm 测试、typecheck、lint、浏览器回归、正式与测试构建、WebView2 冒烟；检查文档编码、链接、围栏与全部差异。

## 完成与验证

- 四步已完成，错误选择保存在既有 `lastAnswer` 字段中；正确复习不覆盖，重新答错更新。
- `npm test` 通过；新增边界检查后共享回归共 211 项通过。
- `npm run typecheck`、`npm run lint` 通过；本次两份文档额外完成 UTF-8、围栏及本地链接检查。
- `npm run test:web-platform`：34 项通过，覆盖三种提交入口、保存重载及 390px 窄屏。
- `npm run build`、`npm run build:test`、`npm run test:desktop` 均通过。隔离 WebView2 实际验证答错、答对复习、重载后仍显示原错误选项，并检查真实截图。
- 未记录选择的旧错题显示“未记录”；没有回填或猜测历史作答。合并前核对 main 仍为上述基线，工作树干净，沿用已通过的完整验证结果。
