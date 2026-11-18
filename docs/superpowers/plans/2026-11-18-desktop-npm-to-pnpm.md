# Windows 桌面工程从 npm 迁移到 pnpm 的实施计划

**已实施。** 2026-11-18 在临时目录完成可行性验证后，于同日在独立工作树完成实际迁移并通过全部本地门禁。评估基线为 `5c02e80`。`apps/desktop` 的安装、检查和打包入口已切换到 pnpm；该基线上没有新的依赖、CI 或发布脚本变化。实际结果与未覆盖项见第 6 节。

## 1. 迁移范围与验证依据

迁移动机是让同一台 Windows 机器上的多个 Git 工作树复用依赖内容。评估时，8 个工作树中有 6 个已有桌面端依赖，主工作树的 `node_modules` 文件逻辑大小合计约 107 MiB。实际节省量和安装耗时仍待对照测量。

安装入口保留在 `apps/desktop`，建议固定 `pnpm@12.16.1`，沿用现有 Node 版本要求。该工程有 16 项直接开发依赖。仓库根目录保持现有结构，`apps/web/libs/ocr/core/package.json` 随第三方 OCR 资源分发，不纳入工作区安装。Web 继续静态发布，Rust 依赖由 Cargo 管理。[桌面清单](../../../apps/desktop/package.json) · [Pages 工作流](../../../.github/workflows/pages.yml)

| 已在 Windows 临时副本验证 | 对实施的影响 |
| --- | --- |
| Node 24.22.2、pnpm 12.16.1 成功导入 npm v3 锁。按包名和版本去重后，两份锁的 321 项依赖及 integrity 全部匹配 | 保留现有解析结果。实施时重新比较，单独说明有意引入的差异 |
| 首次冻结安装报 `ERR_PNPM_IGNORED_BUILDS`，唯一被拦截的是 `esbuild@0.28.2`。允许其构建脚本后，使用已填充的 store 离线安装成功，项目资源生成器成功产出桌面 `bridge.js` | 在项目内记录 esbuild 构建许可，干净安装后运行真实资源生成器 |
| `pnpm run` 设置的 `npm_execpath` 指向原生 `pnpm.exe`。将它作为脚本交给 Node 会报 `ERR_UNKNOWN_FILE_EXTENSION`。脚本名后的独立 `--` 会原样传给子脚本 | 调整 lint 和 Tauri 子进程的启动方式，逐项核对实际收到的参数 |
| 最小脚本中，`pnpm run build:nsis` 成功触发 `postbuild:nsis` | 真实安装包的 Windows 完整性标记，以及两种包的收集顺序，仍须按第 4 节验收 |

## 2. 锁文件与安装

1. 在独立工作树记录基线 SHA、Node/npm 版本和现有 npm 检查结果。新环境先安装固定版本的 pnpm，再确认 `pnpm --version` 输出 `12.16.1`。重建已有 `node_modules` 前，按路径或命令行确认并关闭占用该工作树的开发服务器、Node、esbuild 和 Tauri 进程。其他工作树可以继续工作。[pnpm 安装说明](https://pnpm.io/installation)
2. 在 `apps/desktop/package.json` 添加 `"packageManager": "pnpm@12.16.1"`。在同目录新增以下 `pnpm-workspace.yaml`，让配置只作用于桌面包。保留默认模块布局，按直接依赖名称访问 ESLint、Playwright 和 commitlint。[pnpm 构建许可](https://pnpm.io/cli/approve-builds)

   ```yaml
   verifyDepsBeforeRun: error
   allowBuilds:
     esbuild: true
   ```

3. 保留原 `package-lock.json`，从 `apps/desktop` 执行下面的命令。校验新锁的直接依赖和完整依赖图。按包名、版本和 integrity 比对，另外检查 Windows 可选二进制和 peer 依赖解析。范围依赖在本次基线中分别为 `@types/node@24.19.2` 与 `playwright-core@1.64.1`。实施时以当时基线为准。[pnpm 锁文件导入](https://pnpm.io/cli/import)

   ```powershell
   pnpm --version
   pnpm import
   pnpm install --frozen-lockfile
   pnpm run prepare:web
   ```

4. 另建尚无 `node_modules` 的验收副本，带上候选清单、pnpm 配置和新锁。使用上一步填充的 store 执行 `pnpm install --offline --frozen-lockfile`，确认下载好的依赖可以复用，且锁文件内容一致。将临时副本中某项直接依赖的声明改成与锁不一致，再确认冻结安装以非零退出。
5. 依赖对照通过后，与第 3 节的调用方和发布校验一起移除 npm 锁。最终由 `apps/desktop/pnpm-lock.yaml` 记录 JS 依赖。沿用原有依赖版本，避免把工具升级混入迁移。

## 3. 调用方、CI 与发布校验

| 改动入口 | 实施动作 | 对应回归 |
| --- | --- | --- |
| [桌面脚本](../../../apps/desktop/package.json)、[Tauri 配置](../../../apps/desktop/src-tauri/tauri.conf.json) | 切换 `test`、`build:test` 的内部 npm 调用，以及 Tauri 的 `beforeDevCommand`、`beforeBuildCommand`。保留四个安装包完整性后置脚本，更新 [故障提示](../../../apps/desktop/scripts/installer-integrity.mjs) 中的修复命令 | 共享测试仍被执行。开发和构建均生成资源。两种安装包的校验失败能向上传递 |
| [全量 lint](../../../apps/desktop/scripts/lint-runner.mjs)、[CI lint](../../../apps/desktop/scripts/lint-ci.mjs)、[开发冒烟测试](../../../apps/desktop/scripts/dev-smoke.mjs) | 用参数数组启动子进程。原生 pnpm 入口直接执行，JS 入口按需通过 Node 执行。移除 npm 专用参数分隔符，保留退出码、日志和仅清理本次开发进程树的行为 | 先补能重现原生入口失败的用例，再验证 JS 测试驱动、含空格路径和失败退出。确认 `--complete`、`--features native-test`、`--no-watch` 到达目标 |
| [Git hooks 测试](../../../apps/desktop/test/git-hooks.test.mjs)、[CSS 检查测试](../../../apps/desktop/test/lint-css.test.mjs) | 更新测试夹具中的 npm 调用。保留 Husky 的本地安装步骤，两个 Git hook 继续直接调用 Node。根目录下的共享测试仍从桌面端已声明的直接依赖加载工具 | 在临时 Git 仓启用 hooks，验证暂存区检查、合法和非法提交说明。CI 的 `HUSKY=0` 只适用于 CI 安装 |
| [Windows CI](../../../.github/workflows/desktop.yml)、[增量 lint 测试](../../../apps/desktop/test/lint-ci.test.mjs) | 先从桌面清单安装指定版本的 pnpm，再由现有 `actions/setup-node` 配置 `cache: pnpm` 和 `cache-dependency-path: apps/desktop/pnpm-lock.yaml`。显式冻结安装。更新 commitlint 和 build 的参数转发。让 `pnpm-workspace.yaml` 的增删改触发全量 lint | 验证锁文件和配置变化走全量，普通 PR 仍按已验证的基线选择检查。保留 `CI lint` 步骤名、历史基线识别及失败测试日志。缓存未命中时也须能安装。[pnpm 安装 Action](https://github.com/pnpm/action-setup) · [setup-node 缓存说明](https://github.com/actions/setup-node) |
| [发布版本校验](../../../apps/desktop/scripts/release-artifacts.mjs)、[发布工作流](../../../.github/workflows/desktop-release.yml)、[发布回归](../../../apps/desktop/test/release.test.mjs) | 移除对 npm 锁顶层和根包版本的读取。用 `desktop-vX.Y.Z` 标签核对 `package.json`、Tauri 配置、`Cargo.toml` 和 `Cargo.lock` 中的应用版本。JS 依赖一致性由冻结安装验证 | 在没有 `node_modules` 的夹具运行标签预检，并验证版本不一致时预检失败。更新命令与顺序断言，保留对提交、附件名和摘要的校验，以及草稿作业无安装依赖的运行方式 |

同步更新 [开发规范](../../../AGENTS.md)、[贡献指南](../../../CONTRIBUTING.md)、[桌面使用说明](../../../apps/desktop/README.md)、[JavaScript 指南](../../../rules/javascript-style-guide.md) 和 [发布操作说明](../../../.github/DESKTOP_RELEASE.md) 中仍用于日常操作的命令。检查活动测试说明里的示例。历史验收日志保留当时执行的命令，Web 源码中的 jsDelivr `/npm/` 资源地址继续沿用。

## 4. 验收顺序

以下命令从 `apps/desktop` 运行。每组分别记录提交、工具版本、结果和失败日志。同一工作树内，资源生成与 Rust 编译、打包按顺序执行。

| 阶段 | 命令或操作 | 通过条件 |
| --- | --- | --- |
| 脚本与发布回归 | `node --test test/lint-runner.test.mjs test/lint-dedup.test.mjs test/lint-ci.test.mjs test/lint-css.test.mjs test/git-hooks.test.mjs test/release.test.mjs` | 先看到旧实现对新增用例的失败，再用迁移后的脚本跑通。额外在 Windows 实际 pnpm 入口下执行 lint |
| 全量检查 | `pnpm run typecheck`、`pnpm run lint`、`pnpm test`、`pnpm run test:web-platform`、`pnpm run test:documents`、`node --test ../../test/web-webdav/request.test.cjs` | 类型、规则回归、共享测试及浏览器用例通过。检查日志能定位失败的子命令 |
| Rust 与桌面构建 | `pnpm run prepare:web`，随后执行现有 Windows CI 的 fmt、Clippy 与 Cargo 测试矩阵，再执行 `pnpm run build --target x86_64-pc-windows-msvc` | 保留默认与 `native-test` 的现有覆盖，锁定构建输出为 Windows x64。实际命令见 [Windows CI](../../../.github/workflows/desktop.yml) |
| WebView2 运行 | 在交互式 Windows 环境依次执行 `pnpm run test:dev`、`pnpm run build:test`、`pnpm run test:desktop` | 隔离 profile 下能够启动、加载资源并完成冒烟测试，退出后本次进程树完成清理 |
| 安装包与发布收集 | 基于同一次正常 x64 构建先留存独立 EXE，再运行 `pnpm run bundle:nsis` 并留存普通包，然后运行 `pnpm run bundle:offline` 并留存离线包，最后执行既有 finalize 校验 | 两次打包均运行各自的完整性后置脚本。普通包在同名文件被覆盖前留存。检查三个二进制附件、构建元数据与 SHA-256。使用本地夹具验证发布逻辑即可，无需推送标签 |

如需衡量迁移收益，在相同提交、Node 版本、磁盘卷与源配置下，分别用 npm 和 pnpm 测量第一次安装、已有缓存时的第二个空工作树安装。记录耗时与新增磁盘占用，pnpm 一侧计入共享 store。按目录累加文件长度会重复统计硬链接。测量使用独立缓存目录，保留日常开发缓存。

## 5. 回退与交付

遇到依赖意外漂移、Windows 子进程参数丢失、冻结安装或发布校验失败时，保留首次失败日志和候选 SHA，在迁移分支修复并重跑对应阶段。门禁全部通过后再交付合入。

如需回到 npm，使用迁移前可复现的提交或经授权的回退提交，成组恢复 npm 锁、包清单、Tauri 钩子、lint 和测试入口、CI 缓存配置、发布校验及现行说明。在干净的验收工作树中运行 `npm ci`、`npm run typecheck`、`npm run lint`、`npm test` 及受影响的构建和安装包检查。使用已有工作树时先确认其依赖无进程占用，保留其他工作树和共享 store。

交付记录应包含基线与候选 SHA、npm/pnpm 锁的对照结果、本地和 CI 检查结果、两种安装包的校验结果，以及尚待手动验证的项目。

## 6. 实际执行记录（2026-11-18）

基线提交 `5c02e80`，工作树分支 `codex/docs-desktop-pnpm-migration`。环境为 Node 24.22.2、pnpm 12.16.1、Rust/Cargo 1.99.1、Windows x64。未提交、未推送、未创建标签或发布。

- **锁文件与对照**：`pnpm import` 从原 `package-lock.json` 生成 `pnpm-lock.yaml`（lockfileVersion 9.0）。按 `name@version` 逐项对照，两份锁均为 321 项，integrity 全部一致，0 缺失、0 版本差异；16 项直接开发依赖齐全。Windows 可选二进制 `@esbuild/win32-x64@0.28.2`、`@tauri-apps/cli-win32-x64-msvc@2.12.4`、`@typescript/typescript-win32-x64@7.0.2` 一致；范围依赖解析为 `@types/node@24.19.2` 与 `playwright-core@1.64.1`。对照通过后移除 `package-lock.json`。对照脚本为一次性临时产物，未留存于工作树。
- **构建许可与资源生成**：`pnpm-workspace.yaml` 记录 `allowBuilds.esbuild: true`；冻结安装中 esbuild 的 `postinstall` 正常执行，`pnpm run prepare:web` 成功产出桌面 `bridge.js` 与 `dist`。
- **离线安装与锁一致性**：在独立空副本执行 `pnpm install --offline --frozen-lockfile --ignore-scripts` 成功且锁文件哈希不变；把一项直接依赖声明改成与锁不一致后，冻结安装以 `ERR_PNPM_OUTDATED_LOCKFILE` 非零退出。
- **回归先红后绿**：4 个新增用例（原生 pnpm 入口直接执行并转发参数、pnpm workspace 变更触发全量 lint、发布校验不依赖 npm 锁、CI 先装 pnpm 再冻结安装）在旧实现上 4/4 失败，迁移后 4/4 通过。
- **静态检查**：`pnpm run lint:docs`（22 份 UTF-8/围栏/本地链接）、`pnpm run typecheck`、`pnpm run lint`（75 通过、1 项按既有 Windows 大小写条件跳过）、`pnpm test`（桌面 265 项 + 共享 501 项，1 项既有跳过）、`pnpm run test:web-platform`（231）、`pnpm run test:documents`（1）、仓库根 `node --test test/web-webdav/request.test.cjs`（10）全部通过。
- **Rust**：`cargo fmt --all -- --check`、默认与 `native-test` 两种 feature 的 `cargo clippy --locked --all-targets -- -D warnings` 与 `cargo test --locked` 全部通过。
- **构建与 WebView2**：`pnpm run build --target x86_64-pc-windows-msvc` 成功生成 x64 正式 EXE；`pnpm run build:test` 后 `pnpm run test:desktop` 返回 `ok=true`，真实 WebView2 全部检查项通过，含导入、练习、考试、AI、OCR、迁移、恢复与三档窗口。
- **安装包**：基于同一次 x64 构建先留存独立 EXE，再依次 `pnpm run bundle:nsis`、`pnpm run bundle:offline` 留存普通包与离线包；两包完整性标记检查通过、字节不同。三件产物的路径、长度与 SHA-256 记录于 `apps/desktop/.reports/pnpm-migration-artifacts/artifacts.json`（该目录被 Git 忽略）。
- **未覆盖项**：本轮只验证本地 Windows 环境与本地夹具。推送 `main` 触发的 Web 发布、托管 CI 完整矩阵、干净系统新装/升级/卸载和正式发行均未本次验证；安装耗时与新增磁盘占用也未对照测量。回退时按第 5 节成组恢复 npm 入口，并保留其他工作树与共享 store。
