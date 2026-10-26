# Harness 提供方切换实施计划

按用户明确提出的交互设计实施，设计见[单一提供方选择](../specs/2026-10-25-harness-provider-selection.md)。沿用当前 `codex/desktop-codebuddy-cli-probe` 分支与 `E:/Codex/worktrees/ea83/shiroha-quiz-desktop` 工作树，基线 `75cf89388468e966f753be452d5d84afeef781e5`；依赖当前尚未提交的 CodeBuddy 登录实现，不提交或推送。

同一功能紧密关联，子任务按文件分工在当前工作树协作，统一由主任务串行生成资源、运行 Cargo 和联合桌面验证。

- [x] 原生：先补保存选择、账户保留与禁止错误分派的回归，再实现 `select_adapter` 和提供方门禁。负责人 native_auth，只修改 `harness.rs`。
- [x] 前端：先补面板互斥、切换与迟到状态的回归，再调整 Harness 控制器及共享业务标签。负责人 native_protocol，维护 `frontend/harness.js`、共享 Harness 回归、`runtime.d.ts` 与 `apps/web/app.js`；native_container 协作维护共享业务标签和分派防护。
- [x] 主任务：调整 HTML 面板结构、CodeBuddy 显隐所有权与回归、桌面 smoke 脚本；联合检查类型契约和 IPC。脚本实现完成，桌面运行结果另行记录。
- [x] 检查：npm test/typecheck/lint、单题 AI 回归、Rust fmt/Clippy/test、正式与测试构建、隔离桌面 smoke。补充实际窗口布局观察，不进行真实登录或模型测试。
- [x] 记录结果与未接入能力，保留原数据和其他账户配置。

## 已完成的行为

`select_adapter {adapter,revision}` 在原生检查修订与空闲状态，成功后自动保存 `mode=harness` 和唯一活动提供方，保留 Codex 组件、模型、超时与订阅授权。提供方固定为 `codex/codebuddy/deepseek`；未开放的提供方不能触发 Codex 专属操作或模型执行。

前端选择开始时即冻结目标并阻断旧快照；保存失败继续显示所选面板，可重新选择或保存重试，不静默退回 Codex。保存中、失败后和迟到响应均有回归。统一由 Harness 控制器决定 API 与三个订阅面板的显隐；隐藏 CodeBuddy 面板不会取消其账户登录或清除会话。共享业务的名称、模型显示、隐私说明、清除和测试分派均取当前提供方，CodeBuddy/DeepSeek 不会误用保留的 Codex 配置。

重新初始化与尚未完成的选择重叠时，先停用旧执行状态；若状态查询因并发变更被丢弃，保持不可执行直到刷新确认。旧初始化的迟到错误不能覆盖新生命周期。相关三项回归均先复现失败，再验证修复。

## 检查记录

| 检查 | 当前结果 |
| --- | --- |
| `npm test` | 桌面 63 项、共享 177 项通过 |
| Harness 前端回归 | 59 项通过，包含面板互斥、选择保存、失败重试、迟到状态、初始化竞态与非 Codex 分派拒绝 |
| CodeBuddy 登录前端回归 | 10 项通过，包含隐藏面板后仍不擅自重新显示 |
| `npm run typecheck`、`npm run lint` | 最终修改后均通过 |
| Web 单题 AI 回归 | 32 项通过，使用 mock 服务，不调用真实模型 |
| Rust 默认组合测试 | 211 通过、4 忽略、0 失败 |
| Rust 全部 feature 组合测试 | 217 通过、5 忽略、0 失败 |
| Rust fmt、默认与全部 feature 的 Clippy | 均通过，Clippy 警告视为错误 |
| `npm run build:test` | 隔离测试构建通过 |
| 隔离桌面 smoke | 最终构建后 31 项通过，包含互斥面板、双账户保留、未开放提供方禁止执行，以及重启后恢复选择 |
| `npm run build` | 最终正式 release 构建通过 |
| 实际窗口布局 | 已重新打开当前工作树的正式客户端，依次选择 Codex → CodeBuddy → DeepSeek → Codex，始终只显示对应区域；回到 Codex 后仍显示已登录，无底部异常提示 |

本阶段只验证提供方选择与既有账户状态保留，不继续真实账户登录或模型测试。CodeBuddy 仍只支持个人账户连接，会话只在当前进程内保留；DeepSeek 订阅尚未接入；两者模型执行均未开放。客户端已停留在 AI 设置的 Codex 面板，保留原有登录状态。本阶段布局与切换验收已完成，不代表上述未开放能力已完成。
