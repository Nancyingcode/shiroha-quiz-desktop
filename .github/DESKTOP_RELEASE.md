# Windows 桌面版发布操作

桌面发布使用 [Windows Release 工作流](workflows/desktop-release.yml)，复用[现有 Windows 检查](workflows/desktop.yml)。当前目标为 Windows x64，工作流只创建预发布草稿；维护者完成附件与安装核验后再手动公开。实现依据见[设计](../docs/superpowers/specs/2026-10-29-windows-github-release.md)和[实施记录](../docs/superpowers/plans/2026-10-29-windows-github-release.md)。

## 用户下载

桌面附件位于[本仓库 Releases](https://github.com/Nancyingcode/shiroha-quiz-desktop/releases)。首次运行并公开草稿前，可能没有公开桌面附件；草稿只有有权维护发布的人可以查看。预发布不使用 `/releases/latest` 下载入口。Web/Android 仍通过根 README 的上游入口下载。

以 `0.1.0` 为例：

| 附件 | 使用方式 |
| --- | --- |
| `Shiroha-Quiz_0.1.0_windows-x64.exe` | 独立 EXE，系统需要已有 WebView2；数据仍写入应用数据目录，不是数据便携版 |
| `Shiroha-Quiz_0.1.0_windows-x64-setup.exe` | 普通安装包，缺少 WebView2 时联网下载 |
| `Shiroha-Quiz_0.1.0_windows-x64-offline-setup.exe` | 包含 WebView2 离线安装程序，构建阶段仍需联网 |
| `SHA256SUMS.txt` | 三个二进制附件和构建元数据的 SHA-256 |
| `release-metadata.json` | 版本、标签、源提交、架构与 Actions 运行记录 |

离线包不包含 Codex/CodeBuddy 的按需运行组件；组件首次准备、登录和 AI 服务仍需联网。安装包未签名，安装和升级限制见[桌面说明](../apps/desktop/README.md#候选安装包与人工升级)。

下载后在 PowerShell 核对摘要，例如：

```powershell
Get-FileHash -Algorithm SHA256 '.\Shiroha-Quiz_0.1.0_windows-x64-setup.exe'
```

将 Hash 与 `SHA256SUMS.txt` 中同名文件的摘要比较，忽略大小写。升级前先导出可读取的完整备份并关闭应用，升级后检查题库、媒体、收藏和学习记录。

## 维护者准备候选

以下命令是操作说明，不表示本次实现已经创建标签、推送或发布。应先获得相应授权并固定候选提交。

1. 将工作流与脚本合入并推送到仓库；手动运行入口要求工作流存在于默认分支。推送 `main` 仍会触发既有 Pages 部署，须同时核对 Web 发布授权。
2. 将桌面版本同步到 `apps/desktop/package.json`、`package-lock.json` 的顶层和根包、`src-tauri/tauri.conf.json`、`Cargo.toml` 与 `Cargo.lock` 中的应用包。保留锁文件中的其他依赖记录。
3. 对最终候选完成项目检查和适用验收，提交后再创建标签。标签只能是 `desktop-v<major>.<minor>.<patch>`，禁止多余前导零；当前流程始终保留预发布属性。
4. 经授权后使用 SSH 远程推送该标签。示例：

```powershell
$candidateCommit = '替换为已验证的完整提交 SHA'
git tag -a desktop-v0.1.0 $candidateCommit -m 'Windows 0.1.0 preview'
git push origin refs/tags/desktop-v0.1.0
```

标签推送触发校验、已有 Windows 检查、三种构建、附件保留和草稿上传。若使用 GitHub Actions 的 `GITHUB_TOKEN` 推送标签，可能不会触发后续 push 工作流；维护者使用正常有权推送的身份执行上述命令。不要为了触发发布扩大应用权限。

已有标签可在获得运行授权后手动启动新的一次运行：

```powershell
gh workflow run desktop-release.yml --repo Nancyingcode/shiroha-quiz-desktop --ref desktop-v0.1.0
```

若在普通分支手动运行，版本校验 job 会失败，不会创建标签或 Release。检查和上传均绑定事件提交；上传前再次核对远端标签指向，拒绝标签移动后的旧制品。

## 检查与草稿

构建复用现有 Node.js 24.17.0、Rust 1.99.1 和 `windows-2025`，执行现有 JavaScript、浏览器、Rust 两种 feature 检查及三种构建。普通安装包在离线构建前另存，避免同名文件被覆盖。正常 PR/main 检查默认不收集附件，也不创建草稿。

本次运行的制品名为 `windows-release-<run_id>-<run_attempt>`，保留 14 天，包含五个 Release 附件和 `release-notes.md`。暂存目录为 `apps/desktop/.reports/desktop-release/<run_id>-<run_attempt>/`；本地和 CI 均拒绝同名覆盖、链接路径、空文件、附件清单异常和摘要不符。独立 EXE 与安装包只来自正常 release 输出，测试 feature 制品不进入分发。

上传 job 下载本次制品并复核版本、元数据和摘要，确认不存在同标签 Release 后创建 `draft=true`、`prerelease=true`、`latest=false` 的草稿。草稿上传后再核对状态、附件名称、数量和大小。只有该 job 获得 `contents: write`，其余保持只读；使用自动提供的 `GITHUB_TOKEN`，不需要 PAT。

维护者在 Releases 页面核对草稿正文、提交、下载附件和 SHA-256，并在隔离 Windows 用户/VM 中验证正常制品的新装、缺运行时断网安装、覆盖升级与卸载数据保留。预发布可以如实列明尚未完成的验收，不能将 CI 构建成功描述成正式发行验收通过。确认后在 GitHub 页面手动公开草稿，保留预发布标识；此工作流不提供自动公开开关。

## 失败和重试

- 版本校验或构建失败：修复源代码并选择新的候选；不要把旧标签移到不同提交后复用原附件。
- 构建完成但草稿步骤失败：先查看错误及 Releases 页面，网络错误可能留下不完整草稿。现有正文和附件不会被自动覆盖、删除或公开。
- 已有同标签 Release（包括草稿）：工作流明确失败。维护者可核对后手动补齐草稿；若需删除草稿并重跑，须明确授权，不自动删除公开版本。
- 无已有草稿、希望重新构建：使用新的手动运行，或在 Actions 中选择 **Re-run all jobs**。不要只重跑失败 job；运行尝试号是制品和元数据的一部分，失败 job 重跑不能复用上次尝试的制品。
- Actions 制品过期：重新执行完整流程；不得从未知本地构建拼装同标签附件。

创建草稿后，GitHub 实际下载、公开预发布和干净系统验收仍须分别记录。当前工作流未包含代码签名、应用内自动更新或正式版本晋级。
