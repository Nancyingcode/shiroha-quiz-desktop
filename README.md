<div align="center">

<img src="assets/promo5.jpg" width="800" alt="Shiroha Quiz Desktop">
</div>

<br>

# Shiroha Quiz

Shiroha Quiz 是一个轻量、开源的刷题工具，支持自导入题库、练习、考试与多端使用。

> 你手里有 Word、Excel、TXT、JSON，或者题目和答案分开的文件。Shiroha Quiz 尝试把这些内容自动识别成可练习、可考试、可复盘的个人题库。

本仓库当前维护 Web 与 Windows 桌面两种使用方式：

- **Web 版**：适合电脑整理题库，支持导入、练习、考试、错题、备份、AI 与 OCR。
- **Windows 桌面版（预览）**：Tauri 2 + WebView2 独立窗口，复用 Web 业务，支持 Codex / CodeBuddy AI、SQLite 本地数据、恢复点、原生 AI/WebDAV 与雾蓝桌面界面。

<img src="assets/shiroha_quiz_ui_assets_v2_cutout/illus_me_settings.webp" width="150" align="right" alt="看板娘" />

> [!IMPORTANT]
> **更新节奏**：最近工作稍微闲了一些，应该会开始恢复更新。问题反馈仍欢迎提交。

<br clear="right">

---

## 快速开始

| 你的情况 | 下载什么 | 入口 |
| --- | --- | --- |
| Windows 电脑，使用 Web 版 | Web ZIP，解压后双击 `打开Shiroha Quiz.cmd` | [下载](https://github.com/reiqr/shiroha-quiz/releases/latest) |
| Windows 电脑，体验桌面预览版 | 独立 EXE 或普通 / 离线 NSIS 候选安装包；尚未完成正式发行验收 | [桌面 Releases](https://github.com/Nancyingcode/shiroha-quiz-desktop/releases) / [构建说明](apps/desktop/README.md) |
| 先体验一下 | 在线版，免安装 | [打开在线版](https://reiqr.github.io/shiroha-quiz) |

> 各端使用独立版本号，不是新旧关系。**下载时认文件名即可**，Web 制品以[上游 Releases/latest](https://github.com/reiqr/shiroha-quiz/releases/latest) 为准；Windows 桌面预发布使用本仓库 Releases 列表。首次公开草稿前可能尚无桌面附件，候选状态见[桌面说明](apps/desktop/README.md)。

> **当前仍处于测试阶段**，不建议用于高风险正式考试场景。**重要题库请定期备份。**

---

## 本次更新：WorkBuddy / CodeBuddy 接入

Windows 桌面预览版新增 **CodeBuddy Harness**。此次 WorkBuddy 接入在客户端中统一显示为「CodeBuddy」，通过固定版本的 CodeBuddy Code 组件执行 AI 任务。在「AI 设置」中选择「使用 Harness」及对应提供方，即可使用个人账户登录；原有 Codex 和直接 API 配置独立保留，Web 继续使用现有接口。

- **单题解析与连续追问**：结合本题文字、参考答案、当前作答与追问记录生成解析草稿，沿用现有练习界面；只有点击「保存到题库解析」才写回，不自动提交作答或修改答案。
- **独立模型选择**：默认 `deepseek-v4.1-flash`，也可选择 `hy4-preview`、`hy3` 或 `default`（服务端默认）。选择自动保存，切换模型不发起请求；可选项不代表当前账户一定有访问权限，`default` 不承诺对应某个固定模型。
- **官方个人账户登录**：在系统浏览器完成授权，不需要填写 API Key，不读取已有 WorkBuddy / CodeBuddy 客户端凭据。会话仅保存在当前应用进程内，关闭应用、退出或授权过期后需要重新登录，不进入题库或备份。
- **按需准备组件**：下载并校验固定 CodeBuddy Code `2.175.0` Windows x64 组件，归档约 95 MB，后续复用已校验缓存；组件与 Codex 分开管理。准备组件、登录及切换模型不会自动调用模型。
- **明确的执行范围**：当前开放连接测试、单题解析与追问，尚未开放 CodeBuddy 题库导入、批量核对和批量补解析。失败不自动重试，也不自动切换提供方或 API 计费。

**启用步骤**：打开「AI 设置」→ 选择「使用 Harness」和「CodeBuddy」并保存 → 按面板提示准备组件、完成官方个人账户登录 → 确认模型与就绪状态 → 按需测试连接，或进入练习页生成解析、继续追问 → 核对后保存解析。连接测试和解析、追问都会使用账户用量。

此次接入复用现有 AI 任务与人工确认流程。原生宿主负责账户、固定模型请求与结果校验，CLI 在无互联网权限的 Windows AppContainer 内运行，只通过受控管道请求宿主转发；真实令牌保留在宿主内存，不交给 CLI。每次只发送当前任务需要的文本上下文，不上传本地题库文件或图片，不开放文件修改、命令执行等模型工具。结果需通过完整响应、CLI 正文一致性与业务 JSON 校验；截断、超时或取消的结果不会写回题库。

> 2026-10-26 已在当前 Windows 环境和个人账户下，用 `deepseek-v4.1-flash` 完成一道自建单选题的真实解析、一次追问与人工保存验收，并核对生成草稿时数据不变、保存仅影响当前题解析及题库更新时间。其他模型的真实业务、其他题型、积分扣减归属及其他 Windows 环境尚未完成验收。单题与追问的输出上限各为 8192 token，执行时限为 120 秒；上限不代表实际消耗，也不保证任意题目都能完成。

接入细节见[客户端接入设计](docs/superpowers/specs/2026-10-25-codebuddy-client-execution.md)、[原生隔离设计](docs/superpowers/specs/2026-10-25-codebuddy-adapter-containment.md)、[实施与真实验收记录](docs/superpowers/plans/2026-10-25-codebuddy-client-execution.md)及[组件来源与许可记录](apps/desktop/third-party/codebuddy/README.md)。原有 Codex 仍支持题库整理、批量核对、单题解析与追问，配置方式见[Codex 使用说明](apps/desktop/README.md#codex-harness订阅执行现有-ai-任务)。

---

## Windows 桌面能力

桌面版保留 Web 的题库导入、练习、考试、错题、收藏和学习记录，并补齐独立桌面应用的本地能力：

- **雾蓝界面与沉浸式标题栏**：统一导航和正文背景，支持窗口拖动、最小化、最大化与还原；关闭后记住有效的窗口尺寸和位置。
- **本地数据与按需加载**：题库及学习数据由 Rust / SQLite 保存，图片独立落盘；首页读取索引与摘要，题库预览、错题和收藏分页，练习及记录详情按需加载。
- **文件与恢复保护**：使用系统打开 / 保存对话框，导出先校验临时文件再替换目标；覆盖、重置和恢复前建立包含图片的恢复点，数据库损坏时可从恢复点或兼容备份修复并保留原数据。
- **原生 AI 与 WebDAV**：通过受控原生请求连接所配置的服务；记住的 AI Key / WebDAV 密码保存到 Windows 凭据管理器，未记住时仅在当前进程内存中保留。MinerU 仍沿用浏览器实现。
- **离线文档处理**：随桌面资源打包 PDF.js、MathJax、Tesseract 和中英文识别数据，支持本地文字 PDF 与扫描 PDF OCR；识别可取消后重试，结果仍需人工核对。
- **桌面交互**：导入页支持单个文件拖放，非文本编辑区域支持 Ctrl+S 保存；关闭窗口时检查保存、练习 / 考试及网络任务状态。

> 桌面版仍处于预览阶段：已完成本机隔离环境下的 WebView2 回归，并构建过普通 / 离线 NSIS 候选包；安装包未签名，自动更新尚未实现。干净系统安装、覆盖升级、卸载保留、真实系统对话框与长时间大文档等验收仍未完成。目前仅在 Windows 11 x64 + WebView2 155.0.4283.62 上验证，未确认 Windows 10 支持或最低运行时版本。详情见[桌面说明](apps/desktop/README.md)和[阶段验证记录](test/dual-platform/README.md)。

---

## Web 与 Windows 桌面区别

| 维度 | Web 版 | Windows 桌面版（预览） |
| --- | --- | --- |
| 运行方式 | 浏览器、本地服务或在线版 | Tauri 2 + WebView2 独立窗口 |
| 数据 | 浏览器本地存储，各来源独立 | SQLite、媒体文件与恢复点 |
| 文档识别 | PDF.js、OCR 测试区 | 内置 PDF、公式与中英文 OCR 资源 |
| 服务与凭据 | 浏览器请求，受 CORS 限制 | 受控原生 AI/WebDAV，Windows 凭据管理器 |
| AI | 直接 API | 直接 API 与 Codex/CodeBuddy Harness |

两端复用 Web 题库、练习、考试、错题、收藏和记录业务，通过 JSON/ZIP 主动交换数据，不会自动共享本机数据。桌面安装和运行验收限制仍见[桌面说明](apps/desktop/README.md)。

### 旧 Android 备份

本仓库已停止 Android 原生版和 WebView 壳维护，保留旧 Android JSON/ZIP 的现有导入与导出兼容。设置页的图片 ZIP 入口现称“导出含图片备份 ZIP”，格式和版本保持不变。请先在旧应用备份，再核对迁移结果，见[停止维护与迁移说明](docs/universal/Android停止维护与迁移.md)。

---

## 当前能力

### 刷题与考试

- **题型**：单选、多选、判断、填空（含多空）、简答题。
- **练习**：随机练习、顺序练习、考试、错题复习、收藏与学习记录。
- **范围与进度**：支持题库分组、跨题库练习范围和顺序练习进度。
- **考试**：支持倒计时、答题卡、交卷提醒和结果统计。
- **快速编辑**：练习中可直接修改题目并写回来源题库。
- **学习记录**：每轮练习或考试生成独立记录，支持逐题复盘与只看错题筛选。

### 题库导入

- **格式**：支持 `docx`、`xlsx` / `csv`、`txt`、`json`、文字层 `pdf` 和粘贴文本。
- **双文件导入**：支持“题目文件 + 答案文件”自动匹配。
- **自动解析**：识别题号、题干、选项、答案、解析、题型和分区。
- **核对与修正**：支持导入预览、异常提示、手动修正、全文查找/替换。
- **Web / 桌面版**：支持 PDF.js 文字层解析，并提供扫描 PDF OCR 测试兜底；桌面内置离线识别资源。

### AI 辅助

- **AI 导入**：Web / 桌面支持 AI 辅助核对 / 补解析，优先使用结构化题目结果；Web / 桌面版还支持整理原始题库文本。
- **单题 AI**：练习页可按需解析与追问，确认后保存解析。
- **接口**：支持 DeepSeek、OpenAI 兼容接口和自定义接口；Web / 桌面版也可连接 Ollama / LM Studio。
- **桌面 Harness AI**：支持 Codex 订阅执行及 CodeBuddy 个人账户接入；CodeBuddy 当前限连接测试、单题解析和追问，Codex 另支持题库整理与批量任务。组件按需准备，结果仍需人工确认。

> AI 结果仅作辅助参考；使用外部 AI 服务时，题目文本会发送给你配置的服务商。API Key 不写入题库备份。

### 备份与跨端

- **本地备份**：支持完整数据备份和恢复。
- **跨端互通**：Web 与桌面交换题库，保留旧 Android 备份的现有兼容，图片题可通过 ZIP 保留素材。
- **WebDAV**：支持云备份与远程恢复；当前 Web / 桌面不提供 Android 式后台自动备份。
- **本地恢复**：桌面版提供恢复点与损坏数据库恢复入口，恢复时保留原数据。
- **密钥存储**：桌面版记住的 AI Key / WebDAV 密码使用 Windows 凭据管理器。

---

## 使用说明

### Windows 桌面版（预览）

1. 按[桌面说明](apps/desktop/README.md)准备 Windows / WebView2 环境并构建；候选安装包先在隔离 Windows 用户或虚拟机中体验。
2. 打开独立桌面窗口，在 **导入题库** 中选择文件、拖入单个文件或粘贴文本。
3. 在 **识别预览** 中核对题型、答案、解析与图片，确认后进入练习或考试。
4. 从 Web 迁移时，先在原浏览器导出完整 JSON / ZIP，再在桌面端导入；应用不会自动读取浏览器中的题库。
5. 升级前导出完整备份并关闭应用，升级后核对题库、图片、收藏和学习记录；恢复入口与失败处理见[候选安装包与人工升级](apps/desktop/README.md#候选安装包与人工升级)。

> 普通 NSIS 包在缺少 WebView2 时需要联网下载运行时；离线配置嵌入运行时安装程序，但构建阶段仍需联网。两种候选包均尚未完成干净系统安装验收。

### Web 版

1. 从 [Releases](https://github.com/reiqr/shiroha-quiz/releases/latest) 下载 Web ZIP 并解压。
2. 双击 `打开Shiroha Quiz.cmd`，脚本会启动本地服务并打开浏览器，无需预装 Python。
3. 在 **导入题库** 中粘贴文本或上传文件。
4. 在 **识别预览** 中核对题型、答案和解析后导入。
5. 进入 **练习** 或 **考试** 开始使用。

> 不建议直接双击 `index.html`。PDF/OCR 依赖 Web Worker 和 ES module，`file://` 下部分能力会失效，而且数据来源与启动器模式不同。

### 数据备份建议

- **重要题库导入后**及时导出备份。
- **换设备、清缓存、卸载 App 前**先备份。
- Web 版建议固定使用同一种访问方式，在线版、本地服务和 `file://` 的数据互不相通。
- Web JSON、桌面备份与已支持的旧 Android 备份可导入；含图片题建议使用 ZIP。
- 桌面开发与正式运行的数据相互隔离；跨设备迁移使用应用内 JSON / ZIP 导出，不要在运行时只复制 SQLite 主文件充当备份。
- 桌面恢复点保存在本机，不能替代设备外备份；恢复点和未引用图片目前保守保留，不自动清理。
- WebDAV 使用方式见 [WebDAV 云备份使用指南](docs/WebDAV云备份使用指南/Shiroha%20Quiz%20WebDAV%20云备份使用指南.md)。

---

## 导入格式与策略

推荐优先使用结构清晰的 `docx`、`xlsx` / `csv`、`txt` 或 JSON。旧版 `.doc`、`.xls`、`.xlsm` 建议先另存为新版格式。

基本流程：

```text
上传 / 粘贴
→ 自动解析
→ 识别预览
→ 人工核对
→ 导入题库
```

详细文档：

- [题库导入格式支持说明](docs/题库导入格式支持说明/Shiroha_Quiz_题库导入格式支持说明.md)
- [题库导入策略与使用指南](docs/题库导入策略与使用指南/Shiroha%20Quiz%20题库导入策略与使用指南.md)
- [题目导入解析方法说明](docs/题目导入解析方法说明/Shiroha%20Quiz%20题目导入解析方法说明.md)
- [标准题库格式示例](docs/标准题库格式示例/标准题库格式示例.md)
- [Excel 通用模板](docs/标准题库格式示例/Shiroha_Quiz_Excel题库导入通用模板.xlsx)

如果原始题库很乱，也可以先用 AI 做格式清洗，但建议只统一题号、选项、答案和解析格式，不修改题意、不编造答案。

---

## 下载与更新

- [Windows 桌面预发布与附件](https://github.com/Nancyingcode/shiroha-quiz-desktop/releases)
- [上游 Web ZIP 下载](https://github.com/reiqr/shiroha-quiz/releases/latest)
- [上游 Web 历史 Releases](https://github.com/reiqr/shiroha-quiz/releases)
- [在线体验](https://reiqr.github.io/shiroha-quiz)
- [CHANGELOG](./CHANGELOG.md)

Web 下载入口指向上游 Releases，请选择 Web ZIP；本仓库不再推荐 APK 下载。Windows 桌面版使用独立的 `desktop-v<版本>` 发布流程，检查通过后生成预发布草稿，维护者核验后才公开附件。下载 `windows-x64-setup.exe` 普通包，或 `windows-x64-offline-setup.exe` 离线安装包；独立 `windows-x64.exe` 需要系统已有 WebView2。每次附带 `SHA256SUMS.txt` 和构建元数据，选择及校验方法见[Windows 发布说明](.github/DESKTOP_RELEASE.md)。首次公开前可能尚无桌面附件；具体变化与验收范围以各次 Release 说明和桌面阶段记录为准。

Web ZIP 不包含约 88 MB 的 PDF.js / MathJax / Tesseract 离线扩展资源，可在 `apps/web/libs/` 下按需下载；联网时也可使用 CDN 兜底。桌面构建要求这些离线资源齐备并一同打包，运行时仅执行本地脚本。

---

> 以下为开发者内容。

## 仓库结构

```text
shiroha-quiz/
├── apps/
│   ├── web/                        # Web 业务源码，桌面端复用
│   │   └── platform/               # 平台契约与浏览器适配
│   ├── desktop/                    # Tauri 2 Windows 桌面工程
│   │   ├── frontend/               # 桌面样式、标题栏与原生适配
│   │   ├── scripts/                # 资源生成、检查与桌面验证
│   │   ├── src-tauri/              # Rust / SQLite、文件、网络与凭据
│   │   └── dist/                   # 自动生成资源，不手工维护
├── docs/                           # 文档索引见 docs/README.md
├── test/                           # 解析器、Web 与双端回归
├── assets/                         # 宣传素材
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```


---

## 本地运行

### Windows 桌面

需要 Node.js 24+、npm、Rust stable（Windows MSVC 工具链）、Visual Studio C++ 构建工具 / Windows SDK 和 WebView2 Runtime。安装依赖前先退出使用当前工程依赖的开发窗口及相关进程。

```powershell
cd apps/desktop
npm install
npm run dev
```

开发命令自动从 `apps/web` 生成桌面资源并启动窗口，无需额外启动 Web 本地服务。构建独立 EXE：

```powershell
npm run build
.\src-tauri\target\release\shiroha-quiz-desktop.exe
```

普通 / 离线候选安装包分别使用 `npm run build:nsis` 和 `npm run build:offline`。两者生成同名安装文件，连续构建前需另存前一份制品；完整路径、资源要求和验收限制见[桌面开发与构建说明](apps/desktop/README.md)。

### Web

```powershell
apps/web/打开Shiroha Quiz.cmd
```

也可以使用任意静态服务器：

```bash
npx serve apps/web
```

在线版：[https://reiqr.github.io/shiroha-quiz](https://reiqr.github.io/shiroha-quiz)

---

## 测试与回归

桌面与共享业务检查：

```powershell
cd apps/desktop
npm test
npm run typecheck
npm run lint
npm run test:web-platform
npm run test:documents
npm run build
npm run build:test
npm run test:desktop
```

`test:desktop` 使用 `build:test` 生成的隔离测试版，隔离数据库、媒体、浏览器 profile 和凭据，并使用 mock 服务。Rust 另需在 `apps/desktop/src-tauri` 执行 `cargo fmt --all -- --check`、`cargo clippy --all-targets -- -D warnings` 与 `cargo test`；具体 feature 检查见[桌面说明](apps/desktop/README.md)。后续命令从仓库根目录开始执行。

2026-10-23 整合记录中，实际 WebView2 25 项回归通过，覆盖窗口恢复、文档导入、OCR 识别中取消重试、迁移、分页和损坏数据库恢复；中文扫描样本在测试中模拟人工核对。上述隔离测试不替代干净系统安装、升级和正常发行环境验收，完整范围见[双端阶段验证记录](test/dual-platform/README.md)。

WebDAV 请求测试：

```powershell
node --test test/web-webdav/request.test.cjs
```

AI 练习回归位于 `test/web-ai-practice/`，需要 Node、Playwright 和可用的 Chromium / Edge。

相关说明：

- [桌面验证说明](apps/desktop/README.md#验证)
- [Web 与桌面双端阶段验证记录](test/dual-platform/README.md)
- [历史 Android 解析样例](test/fixtures/legacy-android-parser/README.md)

---

## 开发状态与文档

历史开发计划已归档到 `docs/archive/`。当前功能状态以 README、CHANGELOG、Releases和桌面说明为准；Web / 桌面的当前设计与实施计划保留在 `docs/superpowers/`。

- [文档索引](docs/README.md)
- [Windows 桌面说明](apps/desktop/README.md)
- [Web 与 Windows 桌面双端设计](docs/superpowers/specs/2026-10-23-web-desktop-dual-platform-design.md)
- [双端实施计划](docs/superpowers/plans/2026-10-23-web-desktop-dual-platform.md)
- [Android 历史资料](docs/archive/native/README.md)
- [架构说明](docs/universal/架构说明.md)

---

## 参与贡献 / 提交反馈

欢迎通过 [Issue](https://github.com/Nancyingcode/shiroha-quiz-desktop/issues/new/choose) 提交 Bug、题库兼容问题、导入失败样例、功能建议或文档修正。

提交时请注明平台（Web 版 / Windows 桌面版）；桌面问题请附上 Windows、WebView2 和应用版本，方便定位问题。

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CHANGELOG.md](./CHANGELOG.md)

---

## 致谢 (Acknowledgements)

本项目基于 [shiroha-quiz](https://github.com/reiqr/shiroha-quiz) 进行二次开发，感谢原作者 [reiqr](https://github.com/reiqr) 的开源贡献。

[![shiroha-quiz](https://github-readme-stats.vercel.app/api/pin/?username=reiqr&repo=shiroha-quiz)](https://github.com/reiqr/shiroha-quiz)

**原项目介绍：** 支持自定义题库导入、练习刷题、模拟考试与错题复习的轻量级刷题应用，并支持 AI 核对与 AI 解析。

**原项目开源协议：** [GPL-3.0](https://github.com/reiqr/shiroha-quiz/blob/main/LICENSE)

---

## 贡献者

感谢以下贡献者：

- [@jiesou](https://github.com/jiesou) —— Web 练习页单题 AI 解析/追问与 WebDAV 同步相关贡献
- [@anupamme](https://github.com/anupamme) —— 指出 AI API Key 明文存储问题并提供最小修复思路

---

## 许可证

本项目采用 `GPL-3.0` 开源。
