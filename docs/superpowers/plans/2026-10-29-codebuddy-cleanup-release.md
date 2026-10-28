# CodeBuddy 子进程清理测试与 Windows 0.1.1 草稿

## 任务边界

- 负责人：当前 Codex 会话。
- 工作树：`E:/Codex/worktrees/ebdf/shiroha-quiz-desktop`。
- 分支：`codex/desktop-codebuddy-cleanup-ci`。
- 基线：`ca1c3d9a09c279b033c62e46e77bbf68d59abd87`；开始时已通过 SSH 核对本地、远端 `main` 一致。
- 用户已授权修复、验证、提交并推送 `main`，继续生成 Windows Release 草稿；不公开发布。用户选择保留 `desktop-v0.1.0`，将新候选升至 `0.1.1` 并创建 `desktop-v0.1.1`。
- 范围：CodeBuddy 容器测试夹具及诊断、应用版本和对应发布记录；不增加生产依赖，不放宽 AppContainer、Job 或发布门禁。

## 复现与判断

原候选的 [Release 运行](https://github.com/Nancyingcode/shiroha-quiz-desktop/actions/runs/40761989468)和 [main 检查](https://github.com/Nancyingcode/shiroha-quiz-desktop/actions/runs/40761961069)在 `windows-2025` 上均失败于 `successful_worker_exit_does_not_leave_an_owned_descendant`：等待后代 PID 的通道返回 `Disconnected`，282 项 Rust 测试通过、1 项失败、5 项按原规则忽略。两次均未执行打包，Release 草稿未创建。

复现命令为 `apps/desktop` 下先执行 `npm run prepare:web`，再运行 `cargo test --manifest-path src-tauri/Cargo.toml --locked harness_codebuddy_container::tests::successful_worker_exit_does_not_leave_an_owned_descendant -- --exact --nocapture`。预期直属 worker 成功退出后，后代仍存活，宿主清理 Job 后该后代退出且 profile 可以删除。

现有夹具为后代的三个标准流使用 `Stdio::null()`，需要额外打开 Windows `NUL` 设备；该访问不是测试进程树清理所需的能力。失败日志没有读取夹具 stderr，无法给出实际启动错误。本次先补诊断并核对本地表现，随后用已授权的测试管道启动后代，保留清理断言；最终以干净 GitHub Windows runner 上的相同测试确认兼容性。

## 执行与验证

1. 记录原有失败，补足启动失败诊断及后代存活断言，验证清理测试不会因后代提前退出而误通过。
2. 修正夹具的标准流，运行容器测试及 Rust 普通、`native-test` 两组 fmt、Clippy、测试。
3. 同步 package、锁文件应用记录、Tauri 与 Cargo 的应用版本至 `0.1.1`；保留其他依赖版本。
4. 运行桌面 npm 测试、typecheck、lint、正常构建和 Release 版本预检，核对文档与全部差异。
5. 独立提交修复和版本变更，验证目标 `main` 未前移后合入并推送；确认主线 Windows runner 上原失败测试通过后创建并推送 `desktop-v0.1.1`，继续核对两套工作流的完整结果。
6. 跟进完整 Release 工作流，核实草稿、预发布状态及五个附件；保留未公开状态。CI 不替代干净系统安装升级与交互式验收。

## 本地验证结果

本机 Windows 上原测试通过，未复现云端 `Disconnected`；以此前两次 `windows-2025` 失败作为原有回归红灯，不修改系统设备 ACL 模拟故障。修复仅位于 `#[cfg(test)]`：后代继承本夹具已有的标准流管道，启动失败先停止所属进程再收集 stderr；在宿主清理前新增后代仍存活的断言，防止后代提前退出造成误通过。未删除原断言、跳过测试或修改生产隔离能力。

- 容器最小测试集：8 项通过，2 项保持原有显式忽略。
- 清理回归连续 10 次通过，覆盖继承管道下直属 worker 先退出、后代仍存活以及 Job 清理完成。
- `cargo fmt --all -- --check`、普通和 `native-test` 两组 Clippy 均通过。
- 普通和 `native-test` 两组 `cargo test --locked` 均通过；每组 283 项单元测试、36 项集成测试通过，6 项按原规则显式忽略。未访问真实系统凭据或收费服务。
- npm 测试：桌面 99 项、共享 222 项，共 321 项通过；typecheck、lint（含现有 15 份文档检查）通过。
- `npm run build` 通过，生成正常 `0.1.1` EXE。未改运行时行为，本次不重复 GUI 验收；普通及离线安装包交由云端完整工作流重新构建。
- Release 预检通过五个版本文件中的全部应用版本记录；两份变更文档额外通过 UTF-8、代码围栏和本地链接检查。锁文件仅修改应用版本，无依赖变更。

日志位于本工作树 `apps/desktop/.reports/codebuddy-cleanup-*.log`，不纳入提交。发布候选仍须以已提交的最终 SHA 在 GitHub Actions 构建，不能使用本地验证产物替代。

测试修复独立提交为 `f378f97ae2e044dc94931a4f4ab0daa8657d7de0`，版本准备另行提交。最终候选提交与远端工作流结果以标签及 Release 构建元数据为准。
