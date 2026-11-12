# codex/shared-ai-startup-readiness 代码审查报告

- 审查时间：2026-11-11
- 审查对象：`codex/shared-ai-startup-readiness`，单一提交 `f1aff38 fix(shared): 启动时恢复 AI 就绪状态`
- 对比基线：本地 `main`（`d731a52`）
- 变更规模：22 个文件，+1593/−95。Web 8 个、桌面前端 4 个、Rust 3 个、测试 3 个、文档 3 个
- 设计/计划：[设计文档](../superpowers/specs/2026-11-11-ai-startup-readiness.md)、[实施计划](../superpowers/plans/2026-11-11-ai-startup-readiness.md)
- 审查方式：`git diff main...分支` 全量只读比对，配合关键函数上下文取证与设计文档、仓库规范对照
- 未执行：`npm test`、`npm run typecheck`、`npm run lint`、`cargo test`、`npm run test:desktop`。计划文档第 6 节声称的门禁通过结论本次未复核，本文所有判断均基于静态阅读

## 1. 总体结论

方向正确：把「就绪核验」从设置页副作用提升为共享的后台检查，原生侧新增只读的 `check_readiness`，前端新增 `ensureReady()` / `retryReadiness()`，并用 generation、配置 revision、账户 revision 三层拒绝迟到结果，符合设计意图，也确实修掉了「不进设置页就不能用 AI」的根因。

但存在 3 个 P1 缺陷，其中 P1-2 会让冷启动首次请求稳定报出错误原因，P1-1 让 CodeBuddy 恢复后的重试入口完全失效，P1-3 让恢复后的新生命周期拿不到有效检查。建议修复 P1 后再合入。

| 级别 | 数量 | 结论 |
| --- | --- | --- |
| P1 | 3 | 需修复后合入 |
| P2 | 4 | 状态语义与优先级问题，建议同批修复 |
| P3 | 8 | 可维护性、覆盖与文档一致性 |

## 2. P1 缺陷

### P1-1 CodeBuddy 恢复后「重试检查 / 刷新登录状态」自锁

位置：`apps/desktop/frontend/harness.js`（`status()`、`retryReadiness()`、设置页 refresh 绑定）、`apps/web/ai-question-panels.js`、`apps/web/ai-import-panel.js`

- `status()` 中 `canRetry = readinessRetryable && !(readiness === 'blocked' && current.adapter === 'codebuddy')`，CodeBuddy 的 blocked 永不暴露 `readinessRetryable`，业务面板因此只渲染「前往 AI 设置」。
- `retryReadiness()` 首段 `if (readiness === 'blocked' && (!readinessRetryable || current.adapter === 'codebuddy')) return Promise.resolve();`，直接空转。
- 设置页刷新按钮绑定为 `readiness === 'idle' ? refreshStatus() : api.retryReadiness()`，在该状态下正好走进空转分支，点击无任何反馈。
- 全局唯一可行的路径退化为 CodeBuddy 卡片自身的 `readCli('refresh')`（`allow_after_restore = true`），而业务面板已经把用户引导到设置页，形成死路。这与设计 §6「CodeBuddy 继续使用独立账户恢复屏障，主动刷新后重新接入」不一致。

建议：CodeBuddy 的 blocked 重试改走 `refreshStatus()`（原生 `refresh_cli`），或在 `retryReadiness()` 内按 adapter 分派到 `refreshStatus()`；同时让 `status()` 的 `canRetry` 与之保持一致，面板按钮与状态字段不再互相矛盾。

### P1-2 等待在途检查后，把自己的检查结果误判为「配置已变化」

位置：`apps/web/ai-transport.js`（`requestAiChatV99` 的 harness 分支）

```js
const configurationChanged = current.adapter !== execution.adapter || current.mode !== execution.mode
  || current.model !== execution.model || current.timeoutSeconds !== execution.timeoutSeconds
  || current.revision !== execution.revision || current.accountRevision !== execution.accountRevision;
if (configurationChanged || ...) throw new Error('题目或 AI 配置已变化，请重新发起请求。');
```

原生 `check_readiness` 成功路径本身会推进 revision：`update_subscription()` 在 `subscription` 变化时 `revision += 1`，而 `subscription` 是进程内状态、冷启动恒为 `false`，因此首次冷启动检查必然推进一次；`!state.config.verified` 时还会再推进一次。于是「等待检查完成 → 重取快照」这条被设计明确要求的路径，在冷启动首次请求上几乎必然判定 `configurationChanged`，抛出与实际不符的错误。

当前 UI 在 `checking` 期间禁用生成按钮，掩盖了多数入口；但设计 §6 明确该等待路径用于「点击与状态变化交错」，一旦命中（重试检查窗口内触发追问、批量、复盘生成），用户看到的是误导性错误。

建议：等待后只比对业务字段（adapter / mode / model / timeoutSeconds / accountRevision）加 `isCurrent()`，修订一致性交给 `execute()` 内部处理——那里传入的就是刚取的 `current` 快照，不会误判。

附带问题：该分支要求所有调用方传 `isCurrent`，缺省即抛「已变化」，属隐式契约。建议在 transport 内对缺失 `isCurrent` 给出可诊断错误，或将其声明为必填。

### P1-3 `initialize()` / `cancelAll()` 未复位 `readinessPromise`、`readinessRetry`

位置：`apps/desktop/frontend/harness.js`

`checkReadiness` 首行 `if (readinessPromise) return readinessPromise;`，`ensureReady()` 返回 `readinessRetry || checkReadiness(false)`。若 `initialize({ restored: true })`（数据恢复、`clearStoredState` 中的二次 initialize、`storage.reset` 链路）发生在检查在途时：

- 旧 Promise 仍被持有，其 epoch 已被 `generation += 1` 作废，结果不会应用；
- 新生命周期的 `ensureReady()` 只会拿到这份失效 Promise；
- 再次 `checkReadiness` 又因 `readinessPromise` 存在直接返回。

结果是本次启动不再真正发起检查，readiness 停在 `initialize` 写入的值，表现为「必须手动重试或重启」，与本分支要修的缺陷同类。

建议：`initialize()` 与 `cancelAll()` 显式清空 `readinessPromise / readinessRetry / readinessId`，与 `readiness / readinessReason / readinessRequested` 的复位保持一致。

## 3. P2 缺陷

1. CodeBuddy 核验失败会降级组件状态。`harness.rs` 失败分支执行 `codebuddy_runtime.verified = false; codebuddy_runtime.state = RuntimeState::Unprepared`。网络抖动或账户临时失败会显示成「组件未准备」，把用户推向重新准备组件，与设计 §5「组件缺失 / 校验失败 / 检查失败分别显示」相反。建议失败只清 `verified` 与 `ready`，`runtimeState` 保留组件文件本身的真实状态，并补充 `codebuddy_status()` 展示一致性核对。
2. `status()` 取值顺序让 readiness 压过更高优先级的阻塞原因。早退分支 `if (mode === 'harness' && adapter ok && readiness !== 'idle')` 排在 `settingsLoading / settingsFailure / authorizationBlock / codexReading` 之前，退出登录清理未完成这类必须处理的状态会被替换成「检查未完成」，与设计「能力不支持、当前受阻按原有恢复方式处理」的顺序相反。
3. `check_readiness` 失败码到前端状态的映射缺少回归。`requiresConfirmation`（`harness_restore_required`、`codebuddy_restore_required`）与 `requiresSettings`（`harness_runtime`、`harness_runtime_integrity`、`codebuddy_runtime_unavailable`、`codebuddy_runtime_integrity`、`harness_auth_cleanup`）两组中只有前者与 `network_unavailable` 被测试覆盖。`harness_busy`（与设置页自动准备撞车）、`timeout`、`invalid_input` 会落进 `error` 分支，而 `activateRuntime()` 又因 `readiness !== 'idle'` 提前返回，该路径上设置页的自动准备不会再被触发。
4. `checkReadiness` 的静默早退没有出口。`settingsLoading || settingsFailure || current.busy || pendingMutations || active.size || businessBusy()` 时直接 `return Promise.resolve()`，冷启动若原生仍在忙，`ensureReady()` 立即 resolve 且只置 `readinessRequested = true`；补检查仅发生在 `observeAuthorization` 的 authTimer 内，若不在观察循环中就永不检查，UI 退回「需处理 / 前往设置」，且没有暴露「其实还没检查过」这一事实。

## 4. P3 问题

5. `harness_runtime::check_existing` 的 `Component::Codex` 分支没有生产调用点。生产只以 `Component::CodeBuddy` 调用（`check_existing_codebuddy`），Codex 受管缓存的字节数与摘要校验实际未参与启动检查，只有单测在跑该分支；而设计 §4 写的是 Codex 同样「复用路径、文件锁、版本、大小与摘要校验」。建议接上该分支，或删除并让测试改跑 CodeBuddy，避免设计与实现不符。
6. `check_existing_with` 只做了 `reject_links(root)` 与目录 canonicalize，未对目标文件本身复用安装路径的链接与类型校验。需确认 `valid_cache` 是否拒绝符号链接；如未拒绝，建议与 `install_component_directory` 对齐。
7. `native-test` 夹具把 `fake-codebuddy-cached` 写进 `prepare_component`，而 `native-test` 下 `check_existing_codebuddy` 只认这个标记文件。桌面冒烟因此只覆盖夹具分支，`harness_runtime::check_existing` 的真实校验仅有 Rust 单测覆盖。
8. 条件表达式重复，违反 [`AGENTS_condition_rules.md`](C:/Users/30728/.dsh/global-rules/AGENTS_condition_rules.md) 第 1、5 条。`(state === 'error' || state === 'blocked') && retryable` 在 `apps/web/ai-import-panel.js` 出现 2 次、`apps/web/ai-question-panels.js` 出现 3 次；`readiness === 'error' || readiness === 'blocked'` 在 `apps/desktop/frontend/harness.js` 出现 4 次以上。建议 `aiAvailabilityV99` 直接返回 `canRetry` / `needsSettings`，`harness.js` 增加 `readinessFailed()` 谓词。`checkReadiness` 内 `readiness = 'error'; if (requiresConfirmation) ... else if (requiresSettings) readiness = 'idle';` 属于先赋值再覆盖的多分支状态赋值，建议改为显式 `if / else` 或抽状态转换函数。
9. 结果区渲染残留空容器。`result && !configured` 且 `state === 'checking'` 时会多渲染一个既无设置也无重试按钮的空 actions 容器。
10. `confirmedAfterRestore` 由渲染进程自报。`check_readiness` 的 `confirmed_after_restore = true` 意味着任何页面脚本都能解除 Codex 恢复确认。当前与设计一致（该屏障防误自动恢复，不是安全边界），但若后续把它当隔离手段，需要原生侧绑定不可伪造的显式用户动作。
11. 文档一致性。计划第 1 节写「未授权提交、推送」，但分支已有提交 `f1aff38`，第 6 节未记录该提交；`Status.restore_required` 在 `codebuddy_status()` 恒为 `false`，建议在设计中点明该字段只对 Codex 有意义。
12. 类型模型混用。`HarnessStatus` 同时承载原生字段与前端派生的 `readiness` / `readinessRetryable`，`snapshot()` 可能来自任一侧，建议拆成 `NativeHarnessStatus` 与 `HarnessRuntimeStatus`。

## 5. 做对的部分

- `check_readiness` 复用 `ensure_idle` / `start` 加 `readonly` 标位，UUID 所有权与 `cancelled` 预标记齐备，取消与迟到结果由 `generation`、`revision`、`accountRevision` 三层拒绝。
- 30 秒看门狗加「取消 → 确认终态」双向确认，确认不了就保持阻塞，不因超时直接放行执行。
- 检查路径只读：不下载、不修复、不覆盖，`checking_existing_component_never_creates_or_repairs_cache` 提供了兜底。
- `subscription` 成功后清 `readiness_requires_user`，`inspect` 也能解除；「同进程页面重载不能当冷启动」由 `automatic_readiness_cannot_bypass_restore_in_same_process` 覆盖。
- 面板原地刷新覆盖错题、复盘、导入，且保留输入焦点与选区，`aria-busy` / `aria-live` 处理到位。
- `isCurrent` 的上下文校验区分题库指纹、作答快照、追问草稿三类，是全分支质量最高的部分。

## 6. 修复优先顺序与建议补充的回归

修复顺序：P1-2（错误判断与错误文案）→ P1-1（CodeBuddy 恢复死路）→ P1-3（生命周期残留）→ P2-1 / P2-2（状态语义与优先级）→ P3 其余。

建议补充的回归：

1. 检查成功推进 revision 后仍能正常发出请求（覆盖 P1-2，断言不会抛「配置已变化」）。
2. CodeBuddy blocked 状态下的重试路径，断言按钮可点且最终重新就绪（覆盖 P1-1）。
3. `initialize({ restored: true })` 与在途检查并发后，新一轮 `ensureReady()` 能真正发起检查（覆盖 P1-3）。
4. `harness_busy`、`timeout`、`invalid_input` 三种失败码的 readiness 状态映射与再触发路径。
5. CodeBuddy 核验失败后 `runtimeState` 不被降级为 `Unprepared`。

## 7. 未验证事项

- 计划文档第 6 节列出的门禁结果（Rust 全量、clippy、typecheck、lint、桌面 196 项、共享 340 项、WebView2 冒烟 44 项）本次未复核。
- 安装版、真实账户、操作系统重启后的首次启动行为仍未验收，与计划自述一致。
