# Windows 桌面版 GitHub Release 支持设计

日期：2026-10-29。状态：用户已确认，已实现并完成本地验证，见[实施记录](../plans/2026-10-29-windows-github-release.md)；尚未创建 Release。

## 目标与现状

为当前仓库提供可重复的 Windows x64 桌面候选发布流程：校验版本、执行已有检查、保留普通与离线安装包、生成摘要，并上传到 GitHub Release 预发布草稿。维护者核验附件与安装结果后再公开发布。

- 负责人：当前 Codex 会话。
- 工作树：`E:/Codex/worktrees/ebdf/shiroha-quiz-desktop`。
- 基线：`24b68f5ab862ff94218fb909d4c4a36390ceb10d`，设计时 HEAD、`main`、`origin/main` 一致；实施前已通过 SSH 核对远端 `main` 同为此提交。
- 已从 detached HEAD 绑定 `codex/ci-windows-release` 任务分支。
- 当前 SSH 远程指向 `Nancyingcode/shiroha-quiz-desktop`。工作流发布到实际运行仓库，不写死上游 `reiqr/shiroha-quiz`。

[Windows 检查工作流](../../../.github/workflows/desktop.yml) 已执行 JavaScript、浏览器、Rust 两种 feature 的检查，以及 EXE、普通 NSIS、离线 NSIS 构建，但未保存 Actions 制品或上传 Release。[桌面说明](../../../apps/desktop/README.md)指出两种 NSIS 输出同名，后一次构建会覆盖前一次。根 README 的现有 Release 链接主要指向上游 Web/Android 发布，需要新增本仓库桌面下载入口。

本次范围为发布基础设施与说明，不增加应用内自动更新、代码签名、ARM64/x86 构建或新的 Windows 兼容承诺。保持应用标识、用户数据位置和安装模式；不改业务源码或持久化格式，不新增生产依赖。

## 触发与版本

新增 `.github/workflows/desktop-release.yml`，接受以下入口：

1. 推送 `desktop-v*` 标签后运行；实际标签必须通过完整格式和版本一致性校验。
2. 手动对已有桌面标签运行，用于失败后重试；例如使用 GitHub CLI 的 `--ref desktop-v0.1.0`。在普通分支上手动运行应明确失败，不自动从分支创建标签。

首期标签限定为 `desktop-v<major>.<minor>.<patch>`，三个数字均不允许多余前导零。示例 `desktop-v0.1.0`；是否为预发布由 Release 属性表达，不额外引入与安装器不一致的版本后缀。用户确认设计不表示已选择或授权发布 `0.1.0`。

构建前核对标签去除前缀后的版本与以下记录完全一致：`apps/desktop/package.json`、`package-lock.json` 的根包记录、`src-tauri/tauri.conf.json`、`Cargo.toml` 及 `Cargo.lock` 的应用包记录。只检查、不自动改版本或锁文件。缺字段、格式错误和不一致均在构建前失败。

整个运行固定到标签解析后的 commit SHA，记录标签和 SHA；上传前重新核对远端标签仍指向该提交。不能用浮动 `main` 的检查结果为标签制品背书。

## 复用检查和保留制品

给现有 `desktop.yml` 增加 `workflow_call` 入口及默认关闭的制品收集参数。Release 工作流调用同一提交内的该工作流，复用现有完整门禁和固定工具链。现有 PR、push main、手动检查入口保持原行为；发布入口不触发 Pages。

通过 Node.js 内置文件与摘要 API 实现小型制品脚本，沿用项目 ESM、JSDoc 和 checkJs。先用合成文件验证脚本，再接入实际构建：

1. `npm run build` 成功后保留独立 EXE。
2. `npm run build:nsis` 成功后立即复制并改名普通安装包。
3. `npm run build:offline` 成功后立即复制并改名离线安装包。
4. 核对全部附件存在、非空，生成 SHA-256、构建元数据和中文发布说明，再保存为本次 Actions 制品。

只从明确的正常 release 输出路径收集文件；不使用递归 `*.exe` 搜索，不包含 `native-test` 目录、测试 profile、题库、凭据、缓存或开发日志。普通包和离线包必须分别来源于对应构建步骤，不能在所有构建结束后复制同一个输出两次。

以版本 `0.1.0` 为例，最终附件为：

| 文件 | 用途 |
| --- | --- |
| `Shiroha-Quiz_0.1.0_windows-x64.exe` | 独立程序，需要系统已有 WebView2；不称为数据便携版 |
| `Shiroha-Quiz_0.1.0_windows-x64-setup.exe` | 普通 NSIS，缺少 WebView2 时联网准备运行时 |
| `Shiroha-Quiz_0.1.0_windows-x64-offline-setup.exe` | 带 WebView2 离线安装程序的 NSIS |
| `SHA256SUMS.txt` | 三个二进制附件及构建元数据的 SHA-256 |
| `release-metadata.json` | 标签、提交、版本、架构、运行标识和制品类型 |

输出使用当前运行独占的暂存目录；拒绝同名覆盖、越界路径和符号链接/junction。输出缺失或失败时终止收集，不清理用户文件。摘要以最终附件字节为准。发布说明保存在制品中并作为 Release 正文使用。

## GitHub Release 草稿

构建和测试 job 仅有 `contents: read`。仅依赖全部检查成功的上传 job 获得 `contents: write`，使用 GitHub Actions 自带的 `GITHUB_TOKEN`，无需新增个人访问令牌。上传 job 下载本次运行的制品，检查明确的附件名单、元数据和 SHA-256 后再上传。

通过 GitHub CLI 创建草稿，使用 `--draft --prerelease --latest=false --verify-tag`，正文通过 `--notes-file` 传入。仓库和标签使用独立参数与环境变量，不能把未经校验的输入插入 shell 程序。上述选项依据 [GitHub CLI 官方说明](https://cli.github.com/manual/gh_release_create)；权限划分依据 [GitHub Token 权限说明](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)，工作流复用依据 [GitHub 可复用工作流说明](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)。

同一标签串行执行，运行中不自动取消。已有同标签 Release（包括草稿）时明确失败，保留其正文与附件，不使用 `--clobber`。上传中断可能留下不完整草稿，应记录其地址；维护者核对后明确选择补齐附件或删除该草稿再重试。程序不把网络错误、权限错误当作“Release 不存在”。

草稿不是公开下载入口。维护者验收后手动公开为预发布；首期工作流不提供自动公开或自动切换正式版开关。当前桌面仍存在安装与运行环境验收缺口，因此保持预发布标识，不设置为 Latest。

## 下载说明与验收边界

根 README 增加本仓库 Windows 桌面 Releases 列表链接及文件选择说明，保留上游 Web/Android 下载入口。预发布下载使用 Releases 列表，不依赖 `/releases/latest`。首次公开前明确提示尚无公开附件，不能展示为已经可下载。

中文 Release 正文包括版本、提交、附件用途、摘要校验方法和以下现有边界：

- 安装包未签名，当前验证环境为桌面说明记录的 Windows 11 x64；Win10、最低 WebView2 版本、干净新装及升级等未验收项继续列明。
- 离线安装包内嵌 WebView2 安装程序；构建阶段仍需下载运行时。对应语义见 [Tauri Windows 安装说明](https://v2.tauri.app/distribute/windows-installer/)。
- 离线包不包含 Codex/CodeBuddy 的按需运行组件；组件首次准备、登录和 AI 服务仍需联网。
- 升级前导出备份并关闭应用；安装方式和数据保留沿用桌面说明。

CI 通过只证明相应自动检查和构建通过。隔离 Windows 用户/VM 中的正常制品新装、缺运行时断网安装、覆盖升级和卸载数据保留单独验收，不将草稿创建成功视为正式发行验收通过。

## 验证与交付

实施时先补充版本、附件收集、摘要和发布状态的失败用例，再实现脚本与工作流。最低覆盖：标签格式及版本不一致、同名覆盖、两种安装包来源区别、缺失/空文件、路径与链接边界、摘要篡改、标签提交变化、已有 Release 和失败上传不公开。GitHub 接口或 CLI 采用 mock，不为测试实际发布或操作真实账户。

完成后在 `apps/desktop` 运行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run build:nsis` 和 `npm run build:offline`。检查工作流 YAML 与权限/依赖关系，并保留已有 Rust 两种 feature 和浏览器门禁。按需要运行隔离桌面检查；安装验收单独记录。新增文档补充 UTF-8、围栏、本地链接与差异检查。

本地脚本验证不等同 GitHub 实际执行。远端端到端验证需要后续明确授权推送工作流与标签、运行工作流及创建草稿；若尚未授权，在交付中列明缺口，不擅自执行。

用户已确认本设计，按[根开发规范](../../../AGENTS.md)第 2 节创建中文实施计划并执行。设计阶段仅新增本文，后续实现和验证结果见实施记录。用户在本地验证完成后明确授权提交并合并到 `main`，暂不 push；创建标签、运行远端发布或改动远端设置仍未授权。
