# 训练复盘 AI 解析实施计划

日期：2026-11-05；设计：[训练复盘中的 AI 解析](../specs/2026-11-05-training-review-ai-analysis.md)。用户已确认与错题本一致的预览并要求实施。

- 负责人：当前会话；分支：`codex/web-training-review-ai`；工作树：`C:/Users/30728/.codex/worktrees/5ef0/shiroha-quiz-desktop`。
- 基线：本地 `main` 和 `origin/main` 均为 `e0764bf2a8d795d3fe6c70972bfd5925a8c18814`；远程只读核对未完成，不据此声称服务器状态。
- 主要范围：`apps/web/app.js`、训练复盘及单题 AI 相关测试；沿用现有组件、数据格式及依赖。

## 步骤

1. 先添加隔离浏览器回归，确认当前复盘缺少 AI 入口；覆盖空解析、草稿保存、历史数据不变和异步切题边界。
2. 在复盘中复用错题本解析组件，为当前记录条目提供独立会话，在选题改变和离页时释放旧会话；保持来源核对和历史快照语义。
3. 更新受文案与组件结构影响的既有回归，补充来源缺失、现有解析、未配置和桌面惰性读取的验证。
4. 执行相关 Web、桌面测试和类型检查、lint、构建以及适用的隔离 WebView2 检查；记录环境缺口，不提交或推送。

## 验证记录

- `npm test`：桌面测试 136 项、共享测试 255 项通过。首次沙箱运行因 esbuild 无法读取测试临时目录而失败；在允许访问该目录的环境重跑通过。
- `npm run typecheck`、`npm run lint`、`npm run build` 均通过；新设计与计划另检查 UTF-8、代码围栏和本地链接。
- `npm run test:web-platform`：98 项通过；`test/web-ai-practice/runner.cjs`：52 项通过，并单独验证了 320px 草稿布局。
- `npm run build:test` 和 `npm run test:desktop`：隔离 WebView2 的 40 项检查通过，包括复盘中生成草稿、确认保存及页面重载后从来源题库读取。
- 测试使用自建题库、假凭据和本地模拟服务；未调用真实 AI。依赖按锁文件安装，`npm ls --all --offline` 通过；未修改锁文件。构建改写的自动生成权限文件已恢复到构建前状态。
