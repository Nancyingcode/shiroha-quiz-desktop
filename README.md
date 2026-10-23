<div align="center">

<img src="assets/promo4.jpg" width="800" alt="Shiroha Quiz">
</div>

<br>

# Shiroha Quiz

Shiroha Quiz 是一个轻量、开源的刷题工具，支持自导入题库、练习、考试与多端使用。

> 你手里有 Word、Excel、TXT、JSON，或者题目和答案分开的文件。Shiroha Quiz 尝试把这些内容自动识别成可练习、可考试、可复盘的个人题库。

当前提供 Web、Windows 桌面与 Android 三种使用方式：

- **Web 版**：适合电脑整理题库，支持导入、练习、考试、错题、备份、AI 与 OCR。
- **Windows 桌面版（预览）**：Tauri 2 + WebView2 独立窗口，复用 Web 业务，新增 SQLite 本地数据、恢复点、原生 AI/WebDAV 与雾蓝桌面界面。
- **Android 原生版**：当前主推，Kotlin + Compose 原生实现，支持 AI、多空填空、背题/斩题、图片题和智能复习。

<img src="assets/shiroha_quiz_ui_assets_v2_cutout/illus_me_settings.webp" width="150" align="right" alt="看板娘" />

> [!IMPORTANT]
> **更新节奏**：最近工作稍微闲了一些，应该会开始恢复更新。问题反馈仍欢迎提交。

<br clear="right">

---

## 快速开始

| 你的情况 | 下载什么 | 入口 |
| --- | --- | --- |
| Android 手机 | 原生版 APK，文件名以 `-native-release.apk` 结尾 | [下载](https://github.com/reiqr/shiroha-quiz/releases/latest) |
| Windows 电脑，使用 Web 版 | Web ZIP，解压后双击 `打开Shiroha Quiz.cmd` | [下载](https://github.com/reiqr/shiroha-quiz/releases/latest) |
| Windows 电脑，体验桌面预览版 | 独立 EXE 或普通 / 离线 NSIS 候选安装包；尚未完成正式发行验收 | [构建与体验说明](apps/desktop/README.md) |
| 先体验一下 | 在线版，免安装 | [打开在线版](https://reiqr.github.io/shiroha-quiz) |

> 各端使用独立版本号，不是新旧关系。**下载时认文件名即可**，已发布制品以 [Releases/latest](https://github.com/reiqr/shiroha-quiz/releases/latest) 为准；桌面候选构建的状态见[桌面说明](apps/desktop/README.md)。

> **当前仍处于测试阶段**，不建议用于高风险正式考试场景。**重要题库请定期备份。**

---

## 此次 Windows 桌面升级

桌面版保留 Web 的题库导入、练习、考试、错题、收藏和学习记录，并补齐独立桌面应用的本地能力：

- **雾蓝界面与沉浸式标题栏**：统一导航和正文背景，支持窗口拖动、最小化、最大化与还原；关闭后记住有效的窗口尺寸和位置。
- **本地数据与按需加载**：题库及学习数据由 Rust / SQLite 保存，图片独立落盘；首页读取索引与摘要，题库预览、错题和收藏分页，练习及记录详情按需加载。
- **文件与恢复保护**：使用系统打开 / 保存对话框，导出先校验临时文件再替换目标；覆盖、重置和恢复前建立包含图片的恢复点，数据库损坏时可从恢复点或兼容备份修复并保留原数据。
- **原生 AI 与 WebDAV**：通过受控原生请求连接所配置的服务；记住的 AI Key / WebDAV 密码保存到 Windows 凭据管理器，未记住时仅在当前进程内存中保留。MinerU 仍沿用浏览器实现。
- **离线文档处理**：随桌面资源打包 PDF.js、MathJax、Tesseract 和中英文识别数据，支持本地文字 PDF 与扫描 PDF OCR；识别可取消后重试，结果仍需人工核对。
- **桌面交互**：导入页支持单个文件拖放，非文本编辑区域支持 Ctrl+S 保存；关闭窗口时检查保存、练习 / 考试及网络任务状态。

> 桌面版仍处于预览阶段：已完成本机隔离环境下的 WebView2 回归，并构建过普通 / 离线 NSIS 候选包；安装包未签名，自动更新尚未实现。干净系统安装、覆盖升级、卸载保留、真实系统对话框与长时间大文档等验收仍未完成。目前仅在 Windows 11 x64 + WebView2 155.0.4283.62 上验证，未确认 Windows 10 支持或最低运行时版本。详情见[桌面说明](apps/desktop/README.md)和[阶段验证记录](test/dual-platform/README.md)。

---

## 三端区别

| 维度 | Android 原生版 | Web 版 | Windows 桌面版（预览） |
| --- | --- | --- | --- |
| 使用方式 | 安装 APK，Android 8.0+ | 在线访问或解压后双击本地启动器 | 独立 EXE / 候选安装包，依赖 WebView2 |
| 数据存储 | 本地 SharedPreferences | 浏览器 LocalStorage | Rust / SQLite、独立媒体文件与恢复点 |
| 离线能力 | 除 AI、在线文档识别外可离线 | 基础功能可离线，扩展库可按需下载 | 内置 PDF / 公式 / 中英文 OCR 资源；远程服务需联网 |
| 文档识别 | MinerU 在线 OCR、DOCX 图片提取 | PDF.js 文字层解析、OCR 测试区 | 复用 Web 解析与核对流程，支持本地 PDF / OCR |
| 特色 | 背题、斩题、智能复习、暗夜模式、平板适配 | 题库清洗、OCR、AI 导入与单题解析 | 雾蓝界面、沉浸标题栏、本地恢复、原生网络与系统凭据 |
| 适合 | 手机日常刷题 | 电脑整理题库与快速使用 | 体验独立桌面窗口与本地数据能力 |

<details>
<summary><strong>展开查看三端详细差异</strong></summary>

<br>

### 刷题与考试

**三端都有**

- 支持随机练习、顺序练习、考试、错题复习、收藏和学习记录。
- 支持单选、多选、判断、填空（含多空）和简答题。
- 支持顺序练习进度、题目快速编辑、考试倒计时和答题卡。
- 答错题目可进入错题本，学习记录可用于后续复盘。

**Android 原生版额外支持（Web / 桌面版当前没有）**

- **即时练习 / 批量练习**：可选择立即判题、自动下一题，也可整组提交。
- **背题模式**：直接查看答案与解析，不计入普通练习记录。
- **斩题**：把已经掌握的题移出普通练习池，并可随时恢复。
- **智能复习**：根据错题状态安排到期复习。
- **选项打乱**：练习与考试可独立控制。
- **字号与紧凑模式**：题干、选项字号可调，适合长题阅读。
- **错题作用域**：可在当前题库 / 全部题库之间切换，并按掌握状态筛选。
- **优先未做题**：随机组题时优先抽取尚未练习过的题，数量不足再从已做题补足。
- **考试细化设置**：可按题型设置题量、分值和时长，并支持滑动切题。

**Web / 桌面版额外支持或实现不同**

- 考试结果可按题型汇总得分。
- 更偏桌面端快速刷题与题库整理，不提供背题、斩题和智能复习。

### 题库导入与文档处理

**三端都有**

- 支持 `docx`、`xlsx` / `csv`、`txt`、`json` 和粘贴文本导入。
- 支持“题目文件 + 答案文件”双文件导入。
- 自动识别题号、题干、选项、答案、解析、题型和分区。
- 支持导入预览、异常提示、手动修正和全文查找 / 替换。
- 支持普通 JSON、跨端备份和图片题数据互通。

**Android 原生版额外支持**

- **DOCX 内嵌图片提取**并绑定到题目。
- **材料题 / 共用题干、集中答案区**等复杂格式的专门解析与回归保护。
- **MinerU 在线 OCR**：支持扫描 PDF 识别、图片提取与人工绑定。

**Web / 桌面版额外支持**

- **PDF.js** 直接解析文字层 PDF。
- **OCR 测试区**：扫描 PDF 可转为文本或 DOCX 后再人工核对导入。
- 更适合在电脑上先做全文清洗，再进入识别预览。

### AI 功能

**三端都有**

- AI 导入核对、补解析和结构化结果优先。
- 练习页支持单题 AI 解析与连续追问。
- 确认后的 AI 解析可以保存回题库。
- 支持 DeepSeek、OpenAI 兼容接口和自定义接口。

**Android 原生版实现特点**

- **无答案题 AI 临时参考答案**：默认关闭，只用于本次判题，不写回题库，也不进入错题本。
- API Key 使用 Android Keystore 加密保存。

**Web / 桌面版额外支持**

- AI 可用于**整理原始题库文本**后再进入导入流程。
- 可连接 **Ollama / LM Studio** 等本机 OpenAI 兼容服务。
- 单题追问可产出可独立保存的完整解析草稿。

### 备份与跨端

**三端都有**

- 支持本地完整备份与恢复。
- Web、桌面与 Android 原生版题库格式互通。
- 图片题可通过 ZIP 保留素材并跨端导入。
- 支持 WebDAV 云备份与远程恢复。

**Android 原生版额外支持**

- 可选每天 / 每周自动 WebDAV 备份，并设置网络、充电和旧备份保留条件。

**Web / 桌面版实现特点**

- 支持 WebDAV 远程列表、SHA-256 校验，以及合并 / 覆盖恢复。

**桌面版本地恢复与凭据**

- 设置页可选择本机恢复点；数据库损坏时，启动恢复页可从恢复点或兼容备份修复。
- 记住的 AI Key / WebDAV 密码使用 Windows 凭据管理器；覆盖恢复、恢复点恢复或重置后，需重新配置服务凭据。

### 界面与平台能力

**Android 原生版**

- Kotlin + Jetpack Compose + Material3 原生界面。
- 支持浅色 / 暗夜模式、Shiroha 模式、平板侧边导航和系统返回键。
- 主要面向手机和平板日常刷题。

**Web 版**

- HTML + CSS + JavaScript，浏览器直接运行。
- 支持本地启动器和在线版，主要面向电脑端题库整理与快速使用。

**Windows 桌面版**

- Tauri 2 + WebView2，复用 Web 业务，使用独立的本地数据与原生服务适配。
- 雾蓝一体界面与沉浸式标题栏，保留练习 / 考试专注模式，并恢复有效窗口位置。

> 三端通过兼容的 JSON / ZIP 交换题库与备份，不会自动共享本机数据。已发布功能变化以 [CHANGELOG](./CHANGELOG.md) 和 [Releases](https://github.com/reiqr/shiroha-quiz/releases) 为准，桌面预览进展见[桌面说明](apps/desktop/README.md)。

</details>

---

## 当前能力

### 刷题与考试

- **题型**：单选、多选、判断、填空（含多空）、简答题。
- **练习**：随机练习、顺序练习、考试、错题复习、收藏与学习记录。
- **范围与进度**：支持题库分组、跨题库练习范围和顺序练习进度。
- **Android 原生特色**：即时/批量练习、随机练习优先未做题、背题、斩题、选项打乱、字号调整和智能复习。
- **考试**：支持倒计时、答题卡、交卷提醒和结果统计。
- **快速编辑**：练习中可直接修改题目并写回来源题库。
- **学习记录**：每轮练习或考试生成独立记录，支持逐题复盘与只看错题筛选。

### 题库导入

- **格式**：支持 `docx`、`xlsx` / `csv`、`txt`、`json`、文字层 `pdf` 和粘贴文本。
- **双文件导入**：支持“题目文件 + 答案文件”自动匹配。
- **自动解析**：识别题号、题干、选项、答案、解析、题型和分区。
- **核对与修正**：支持导入预览、异常提示、手动修正、全文查找/替换。
- **Android 原生版**：支持 DOCX 内嵌图片提取、材料题/共用题干和集中答案区等复杂格式。
- **Web / 桌面版**：支持 PDF.js 文字层解析，并提供扫描 PDF OCR 测试兜底；桌面内置离线识别资源。
- 原生解析器持续维护真实题库回归测试，复杂边界说明放在专项文档中。

### AI 辅助

- **AI 导入**：三端均支持 AI 辅助核对 / 补解析，优先使用结构化题目结果；Web / 桌面版还支持整理原始题库文本。
- **单题 AI**：练习页可按需解析与追问，确认后保存解析。
- **临时参考答案**：Android 原生版可选启用，默认关闭，不写回题库、不进入错题本。
- **接口**：支持 DeepSeek、OpenAI 兼容接口和自定义接口；Web / 桌面版也可连接 Ollama / LM Studio。

> AI 结果仅作辅助参考；使用外部 AI 服务时，题目文本会发送给你配置的服务商。API Key 不写入题库备份。

### 备份与跨端

- **本地备份**：支持完整数据备份和恢复。
- **跨端互通**：Web、桌面与 Android 原生版题库格式互通，图片题可通过 ZIP 保留素材。
- **WebDAV**：支持云备份与远程恢复，Android 原生版还可选自动备份。
- **本地恢复**：桌面版提供恢复点与损坏数据库恢复入口，恢复时保留原数据。
- **密钥存储**：Android 原生版 API Key 使用 Android Keystore 加密保存；桌面版记住的 AI Key / WebDAV 密码使用 Windows 凭据管理器。

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

### Android 原生版

1. 安装 `*-native-release.apk`。
2. 在 **导入** 页面选择文件或粘贴文本。
3. 在 **核对页** 检查识别结果，必要时手动修正或使用 AI 辅助。
4. 选择 **练习、考试、背题** 等模式开始使用。
5. 错题、收藏、学习记录和智能复习会保存在本机。

### 数据备份建议

- **重要题库导入后**及时导出备份。
- **换设备、清缓存、卸载 App 前**先备份。
- Web 版建议固定使用同一种访问方式，在线版、本地服务和 `file://` 的数据互不相通。
- Web JSON、桌面备份与 Android 原生备份可跨端导入；含图片题建议使用 ZIP。
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

- [最新 Release](https://github.com/reiqr/shiroha-quiz/releases/latest)
- [全部 Releases](https://github.com/reiqr/shiroha-quiz/releases)
- [在线体验](https://reiqr.github.io/shiroha-quiz)
- [CHANGELOG](./CHANGELOG.md)

每次正式发布通常提供 Android 原生 APK 与 Web ZIP。Windows 桌面版当前为预览工程，已提供 EXE 与普通 / 离线 NSIS 构建入口；具体可下载文件以 Release 附件为准，不把本地候选构建等同正式发布。近期功能变化以 Release 说明、CHANGELOG 和桌面阶段记录为准。

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
│   └── android/                    # Android 工程
│       └── app/src/native/         # 原生 Compose 源码
│           ├── ai/                 # AI
│           ├── importer/           # 导入解析
│           ├── document/           # 文档识别
│           ├── security/           # 密钥存储
│           ├── state/              # 状态管理
│           ├── sync/               # WebDAV
│           └── ui/                 # Compose UI
├── docs/                           # 文档索引见 docs/README.md
├── test/                           # 解析器、Web 与双端回归
├── assets/                         # 宣传素材
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

Android 工程仍保留两个 flavor：

| Flavor | 包名 | 技术路线 |
| --- | --- | --- |
| `web` | `com.yiqiu.shirohaquiz` | 历史 WebView 壳 |
| `native` | `com.reqir.shirohaquiz` | Kotlin + Jetpack Compose + Material3 |

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

### Android

```bash
cd apps/android
./gradlew assembleNativeRelease
```

Windows PowerShell：

```powershell
.\gradlew.bat assembleNativeRelease
```

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

解析器外部回归：

```powershell
.\run-regression.ps1
```

原生 JVM 单元测试：

```powershell
cd apps/android
.\gradlew.bat :app:testNativeDebugUnitTest
```

WebDAV 请求测试：

```powershell
node --test test/web-webdav/request.test.cjs
```

AI 练习回归位于 `test/web-ai-practice/`，需要 Node、Playwright 和可用的 Chromium / Edge。

相关说明：

- [桌面验证说明](apps/desktop/README.md#验证)
- [Web 与桌面双端阶段验证记录](test/dual-platform/README.md)
- [测试体系整理说明](docs/native/测试体系整理说明.md)
- [解析器回归测试说明](docs/native/解析器回归测试说明.md)
- [外部回归测试包说明](test/native-parser-regression/README.md)

---

## 开发状态与文档

历史开发计划已归档到 `docs/archive/`。当前功能状态以 README、CHANGELOG、Releases、桌面说明和原生开发进度为准；Web / 桌面的当前设计与实施计划保留在 `docs/superpowers/`。

- [文档索引](docs/README.md)
- [Windows 桌面说明](apps/desktop/README.md)
- [Web 与 Windows 桌面双端设计](docs/superpowers/specs/2026-10-23-web-desktop-dual-platform-design.md)
- [双端实施计划](docs/superpowers/plans/2026-10-23-web-desktop-dual-platform.md)
- [原生 Android 开发进度](docs/native/原生开发进度.md)
- [架构说明](docs/universal/架构说明.md)
- [解析器回归测试说明](docs/native/解析器回归测试说明.md)

---

## 参与贡献 / 提交反馈

欢迎通过 [Issue](https://github.com/reiqr/shiroha-quiz/issues/new/choose) 提交 Bug、题库兼容问题、导入失败样例、功能建议或文档修正。

提交时请注明平台（Android 原生版 / Web 版 / Windows 桌面版）；桌面问题请附上 Windows、WebView2 和应用版本，方便定位问题。

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CHANGELOG.md](./CHANGELOG.md)

---

## 贡献者

感谢以下贡献者：

- [@jiesou](https://github.com/jiesou) —— Web 练习页单题 AI 解析/追问与 WebDAV 同步相关贡献
- [@anupamme](https://github.com/anupamme) —— 指出 AI API Key 明文存储问题并提供最小修复思路

---

## 许可证

本项目采用 `GPL-3.0` 开源。
