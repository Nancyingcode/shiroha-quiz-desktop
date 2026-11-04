# 移除 Android 支持设计

日期：2026-11-04。状态：用户于 2026-11-05 确认并授权按本方案实施，保留旧安卓备份兼容，暂不提交或推送。执行记录见[实施计划](../plans/2026-11-05-remove-android-support.md)。第 2 节为移除前盘点。

## 1. 目标与设计结论

本仓库后续维护范围收敛为 **Web 与 Windows 桌面**：从当前主线移除 Android 原生应用和 Android WebView 壳的源码、构建与维护入口，继续维护 Web/桌面共享业务及已有备份兼容。

推荐采用“移除专属工程、保留历史数据入口”的方案。Android 不再作为当前受支持的平台；历史 Android JSON/ZIP 仍可按现有能力导入，现有含图片 ZIP 继续可导出。停止 Android 应用维护不应成为用户无法读取旧备份的原因。

本次不把 Android 独有的背题、斩题、智能复习、自动云备份等功能迁移到 Web/桌面，也不据此新增跨平台架构、公共 packages、数据库迁移、IPC 或生产依赖。

## 2. 已核对的现状

### 2.1 任务基线

- 负责人：当前 Codex 会话。
- 工作树：`C:/Users/30728/.codex/worktrees/ba67/shiroha-quiz-desktop`。
- 设计分支：`codex/docs-remove-android`，由当前 detached HEAD 绑定；初始工作树干净。
- 基线：`f7e1b2765b5fd16a7230ca738dc0eebca0658deb`，设计时 HEAD 与本地 `main` 一致。
- origin：`git@github.com:Nancyingcode/shiroha-quiz-desktop.git`。本地 `origin/main` 仍在 `f1000634c6dcd8b8ddd00449c02a80391594e405`；SSH 只读核对因连接权限失败，未确认服务器上的最新提交。实施或合并前重新核对目标基线。
- 本阶段不提交、不推送、不创建 PR 或发布；移除生效版本尚未指定。

### 2.2 工程与依赖关系

| 位置 | 当前事实 | 对设计的影响 |
| --- | --- | --- |
| [Android 工程](https://github.com/Nancyingcode/shiroha-quiz-desktop/blob/f7e1b2765b5fd16a7230ca738dc0eebca0658deb/apps/android/README.md)、[构建配置](https://github.com/Nancyingcode/shiroha-quiz-desktop/blob/f7e1b2765b5fd16a7230ca738dc0eebca0658deb/apps/android/app/build.gradle.kts) | 同时包含 `native` Compose 与 `web` WebView 两个 flavor；当前 Git 跟踪 193 个文件，其中 96 个 Kotlin 文件 | 移除范围覆盖整个 Android 工程，不能只删除原生 flavor |
| [原生解析器回归](https://github.com/Nancyingcode/shiroha-quiz-desktop/blob/f7e1b2765b5fd16a7230ca738dc0eebca0658deb/test/native-parser-regression/README.md)、[Runner 配置](https://github.com/Nancyingcode/shiroha-quiz-desktop/blob/f7e1b2765b5fd16a7230ca738dc0eebca0658deb/test/native-parser-regression/runner/build.gradle) | Kotlin JVM Runner 直接编译 Android 的 model/parser/score/validate 等源码；当前 manifest 有 69 个用例 | 直接删除 Android 源码会让这个独立入口失效，必须同时退出维护并保全样例 |
| [Web 共享业务](../../../apps/web/app.js) | `download()` 仍尝试调用 `window.ShirohaAndroid.saveJsonFile`；设置页展示“导出 Android 原生 ZIP” | 桥接分支需要移除；ZIP 能力要保留并调整显示名称 |
| [数据格式回归](../../../test/dual-platform/format.test.cjs)、[契约回归](../../../test/dual-platform/contracts.test.cjs) | 已有自建 Android v3 ZIP 样本，覆盖图片、多空、收藏、错题及学习记录；无须 Android 环境 | 这些属于现行 Web/桌面的旧数据兼容测试，应继续运行 |
| [桌面资源生成](../../../apps/desktop/scripts/prepare-web.mjs) | 只从 `apps/web` 准备共享资源，不引用 Android 工程 | 保持单一业务源码来源，不修改生成的 `dist` |
| [Windows CI](../../../.github/workflows/desktop.yml)、[桌面发布 CI](../../../.github/workflows/desktop-release.yml)、[Pages CI](../../../.github/workflows/pages.yml) | 当前均没有 Android 构建任务；Pages 发布 `apps/web` | 不虚构待删除的 Android CI，也不借本次重写发布流程 |
| [根 README](../../../README.md)、[文档索引](../../README.md)、[贡献指南](../../../CONTRIBUTING.md)、Issue 模板 | 当前仍推广 Android、提供 APK 入口或优先引导 Android 反馈 | 需要统一为本仓库的 Web/Windows 支持范围 |

以上数量是本次基线的盘点，不代表设备安装量、发行状态或真实用户数据情况；未读取真实题库、凭据和手机数据。

## 3. 移除与保留范围

| 对象 | 推荐处理 |
| --- | --- |
| `apps/android/` | 从当前工作树移除 Git 跟踪的工程内容，包括 native/web flavor、内置 Web 副本、Gradle Wrapper、测试和专属资源；Git 历史保留 |
| Android WebView 桥接 | 删除共享 `download()` 中的 `ShirohaAndroid.saveJsonFile` 专属分支；继续调用现有 `ShirohaPlatform.download` |
| `test/native-parser-regression/` 的执行设施 | 移除 Kotlin Runner、Gradle 配置、PowerShell 运行入口与 Python 对比执行工具，不留下指向已删除源码的可运行命令 |
| 原生解析器样例 | 将 `samples/`、`expected/`、`manifest.json` 保存到 `test/fixtures/legacy-android-parser/`，添加说明；原预期仅表示旧 Kotlin 实现的历史结果 |
| `docs/native/` | 归入现有 `docs/archive/native/`，保留原文，在归档入口说明停止维护的范围与基线；移动前核对同名文件，不覆盖已有归档 |
| 既有 `docs/archive/native/`、历史 CHANGELOG | 保留历史记录，不批量改写成当前支持状态 |
| Web/桌面的旧 Android JSON/ZIP 兼容 | 保留现有导入、导出、格式校验、图片解析、元数据和回归测试 |
| `test/dual-platform/` | 继续作为 Web/Windows 双端测试；不因名称包含“双端”而删除或改名 |
| Rust、桌面的 `native` / `native-test` / 原生服务 | 继续维护；这些术语不等于 Android，不进行关键词批量删除 |
| 共享资源、许可证和默认题库 | 保留 `apps/web`、桌面依赖和根 `assets` 中的现有内容；不扩大为通用素材清理 |
| 手机浏览器访问 Web | 保留响应式布局、触控、移动浏览器下载与复制兜底；本次不追加新的手机适配承诺 |
| 本机 SDK、JDK、Gradle 缓存、签名材料、忽略文件、已安装 APK | 不属于仓库源码移除范围，不扫描或清理这些内容 |
| 远端标签、Release/APK 附件、上游仓库 | 不删除、不修改；本次收敛的是本仓库今后的维护范围 |

不在当前树另存一份完整 Android 工程，也不新增长期 Android 分支；确需查阅旧实现时使用已记录的 Git 提交。后续恢复维护须作为独立任务重新评估。

## 4. 数据与备份兼容

### 4.1 保留已存在的数据契约

本次不修改以下内容的语义、版本或存储位置：

- 备份 `kind`，包括 `shiroha_quiz_full_backup` 和 `shiroha_quiz_web_native_backup`。
- 已支持的 `version`、`schemaVersion`、`crossPlatformSchemaVersion` 和导出来源标记。
- `crossPlatform`、`crossPlatformMeta`、`nativeQuestion`、图片引用、多空答案和学习记录中的兼容字段。
- `ExchangeFormat` 中已有的 `android_native_zip` 标识，以及相关内部函数、DOM ID 和 ZIP 文件命名。
- Web 浏览器存储键、桌面应用标识、SQLite 格式、恢复点和 WebDAV 远端目录。

这些历史名称可以继续存在于内部代码、格式文档和测试中，不能为了清除 Android 字样造成格式变化或扩大重构。旧备份校验、路径安全、凭据过滤和未知版本拒绝规则继续生效。

### 4.2 调整面向用户的 ZIP 名称

设置页的“导出 Android 原生 ZIP”改为 **“导出含图片备份 ZIP”**，同步修改说明与成功/失败提示。提示解释它保存题库、图片及现有可交换学习数据，沿用当前格式；普通 Web 完整 JSON 入口保留。

不将现有 ZIP 描述成覆盖全部平台状态的完整克隆。当前 ZIP 与 Web 完整 JSON 的载荷结构不同；Android 独有状态是否能展示、保留或往返，以现有字段处理和测试为准。本次不承诺新增智能复习等状态的支持，也不通过改文案掩盖已有差异。

复制文本、普通浏览器下载和桌面受控文件保存保持原流程。下载失败、用户取消保存和原生保存失败沿用现有反馈与数据保护，不退回 Android 桥接。

### 4.3 用户迁移说明

新增一份简短的 Android 停止维护与迁移说明，并从 README 的历史兼容说明链接到它：

1. 在仍可运行的旧应用内先导出 JSON 或含图片 ZIP，保留原始备份；不先卸载、清数据或覆盖唯一备份。
2. 在 Web 或 Windows 桌面通过现有导入/恢复入口选择该备份，核对覆盖与合并语义后操作。
3. 核对题库/题目数量、答案、图片、多空、错题、收藏及学习记录，再导出一份目标端备份。
4. 说明 Android 独有功能不会随迁移出现；迁移不自动同步本机数据，API Key 和 WebDAV 密码需重新配置。
5. Android WebView 壳使用其现有导出能力；不承诺它与原生应用的数据天然相通。无法在旧应用中导出时，说明当前没有自动读取 Android 私有存储的功能。

测试只使用自建备份与隔离 profile，不读取手机私有目录、不导出真实凭据、不调用真实收费 API。

## 5. 解析器测试与历史保全

Kotlin 解析器随 Android 工程退出当前维护范围，不为继续运行它而抽取新模块、保留 JDK 构建链或复制整套解析器到其他目录。

样例归档遵循以下边界：

- 原始文本、manifest 中的风险说明与旧预期一并保存，保留用例对应关系；不保留构建产物或运行输出。
- 新目录 README 明确标注“历史参考数据，非当前 Web 解析器通过清单”，不提供已失效的 Gradle 命令。
- 旧 Kotlin 与 Web 对题型、警告和复杂文本的处理可能不同，不把 69 个旧预期直接套成 JavaScript 的通过条件，也不放宽原有 Web 断言以迁就旧预期。
- 现有 Web/桌面解析、格式与 ZIP 安全回归保留。实施时先核对现有覆盖；本次调整影响到的导入/下载行为若缺少覆盖，补到现有 Node/浏览器测试入口，不新增第二套框架。
- 未迁移为可执行 Web 测试的历史样例明确记录为参考资料，不宣称 Web 已继承 Android 的全部复杂解析能力。完整解析能力迁移留待单独设计。
- `.gitattributes` 中原 samples/expected 的路径随归档更新，保持这些数据文件的既有用途标记。

## 6. 文档、规则与仓库入口

### 6.1 当前说明

- 根 README 改为 Web/Windows 双端介绍和下载对照，去除 Android 主推、APK 快速开始、三端对比及当前能力列表中的 Android 专属承诺；保留一处停止维护和旧备份兼容入口。
- 本仓库 Windows Releases 与现有 Web 入口继续区分；不将上游仓库停止 Android 维护作为事实，也不把上游 APK 继续列为本仓库推荐下载。
- 文档索引改为 Web/Windows 主线，Android 材料移至历史归档入口。
- 贡献指南、Bug/Feature 模板改为 Web 和 Windows 桌面反馈，收集浏览器或 Windows/WebView2 环境；不再提供 Android 作为当前维护选项。
- `docs/universal/架构说明.md` 按实际的 `apps/web` 与 `apps/desktop` 结构更新，不继续展示未实施的共享 packages 路线作为现状。
- 当前用户指南中关于 Android 的操作与支持矩阵改为历史兼容说明，覆盖导入格式、标准模板、导入策略和 WebDAV 使用说明；已有 Markdown/Word/PDF 同内容副本须逐项盘点，属于当前分发入口的副本同步更新或明确标为历史，不能保留互相矛盾的有效入口。题库模板和示例数据本身保持兼容。

### 6.2 工程规则与历史材料

- 根 `AGENTS.md` 移除 Android 工程职责、Gradle 门禁及 Android 原生解析器运行要求，改为 Web/Windows 和旧数据兼容的真实边界。
- 协作分支规划中的当前平台、负责人范围和未来任务举例同步收敛；已记录的历史分支、SHA 和交付事实保留。
- 旧设计/实施记录只增加历史状态说明及必要的链接修复，不改写当时决策和验证结论。因源码删除而失效的历史链接指向本次记录的删除前提交，当前操作入口则指向有效说明。
- `docs/AGENTS-适配说明.md` 等被 `lint:docs` 检查的文档，移除当前 Android 要求并修复指向已删除路径的链接；属于历史事实的段落保留其日期语义。
- `apps/web/question-bank.js` 的本地文件加载说明继续保留 `file://` 兜底原因，只调整 Android 专属表述；桌面 CSS 首行注释更新为实际保留的 Web/桌面边界。
- 设计确认包含上述 Android 专属源码及伴随注释的删除、所列过时 Android 表述的注释更新；不扩大为无关注释清理。

### 6.3 忽略规则与安全边界

不机械删除所有包含 Android/Gradle 的 `.gitignore` 条目。签名文件、本地配置、旧构建目录等保护条目继续保留，防止移除跟踪文件后遗留的本地材料意外进入提交。已确认纯粹失效且无保护用途的条目才随实现最小调整。

删除操作只针对审核后的 Git 跟踪路径。执行前核对绝对路径位于本任务工作树内，并检查符号链接/junction；发现未跟踪、忽略或用户改动时保留并报告，不用递归清理整个目录代替源码移除。

## 7. 推荐实施顺序

本节用于说明依赖关系；详细任务和红—绿—重构步骤在设计批准后写入实施计划。

1. **固定范围与兼容基线**：重新核对任务分支、目标提交和用户修改；运行旧备份及当前共享回归，补充此次下载桥接退出和 ZIP 文案行为的必要用例。
2. **保全历史资料**：移动解析样例和 Android 文档，修复相应引用；记录删除前 SHA 和原路径，防止移除源码后失去解释依据。
3. **移除专属实现**：删除已核对的 Android 跟踪文件及 Kotlin 回归执行设施，移除共享下载中的 Android 桥接；保留共享业务与备份格式。
4. **统一产品与开发入口**：更新 ZIP 文案、README、索引、指南、Issue 模板和工程规则，处理有效分发文档副本；检查忽略规则与历史链接。
5. **验证与交付**：按下节验证 Web/Windows 的导入、导出、生成和运行，逐项记录通过、既有失败及环境缺口；获授权后再按项目约定提交、合并。

允许按上述边界形成可追踪的变更单元；设计确认不自动授权 commit、push、PR、标签、远端发布或 SDK/缓存清理。推送 `main` 会触发 Pages，仍须单独授权。

## 8. 验收与验证

### 8.1 完成条件

1. 当前树不再跟踪 Android 应用工程或引用它编译的 Kotlin Runner；正常 Web/桌面开发不再依赖 Android SDK、JDK 或 Gradle。
2. 当前说明和反馈模板统一为 Web/Windows；历史材料与兼容格式中允许保留 Android 名称，不能用“全仓关键词为零”作为验收标准。
3. Web 和桌面能继续导入当前已支持的旧 Android JSON/ZIP；已有自建 fixture 的题库、图片、多空、错题、收藏和学习记录断言通过，未来版本仍明确拒绝。
4. ZIP 导出入口名称、说明及提示一致；导出的载荷与图片引用遵循原契约，不新增凭据或静默清除历史兼容字段。
5. 导出改走已有平台适配；浏览器下载/复制、桌面保存、取消和失败反馈可验证，Android 桥接对象不再被调用。
6. 原有 Web 解析和 ZIP 安全回归、桌面共享回归继续通过，历史 Kotlin 样例不冒充已通过的 Web 用例。
7. 当前文档和归档入口无新增失效本地链接；Android 专属文档不再从当前开发步骤引导用户运行已移除命令。
8. 未清理真实数据、签名材料、缓存或其他工作树；未修改备份版本、应用标识、数据库、CSP、权限、凭据策略与锁文件。

### 8.2 实施阶段的检查

先运行最小相关测试，再运行以下适用检查：

| 工作目录 | 检查 | 用途 |
| --- | --- | --- |
| 仓库根目录 | `node --test test/dual-platform/format.test.cjs test/dual-platform/contracts.test.cjs test/dual-platform/zip-safety.test.cjs test/dual-platform/json-import.test.cjs` | 旧备份、契约、图片、ZIP 安全与 JSON 导入 |
| `apps/desktop` | `npm run typecheck`、`npm run lint`、`npm test` | 桌面工具、平台契约、共享业务和文档门禁 |
| `apps/desktop` | `npm run test:web-platform`、`npm run test:documents` | 浏览器平台交互及保留的文档导入入口；缺少的导出交互先补入既有测试 |
| `apps/desktop` | `npm run build` | 共享 Web 资源生成与桌面构建；不得手改 `dist` |
| `apps/desktop` | `npm run build:test` 后执行 `npm run test:desktop` | 隔离 WebView2 运行回归，另补 ZIP 导入/保存和取消的人工验收 |
| 本次全部变更文档 | `npm run lint:docs` 加未列入文件的等价检查；Word/PDF 副本按对应生成与渲染流程检查 | UTF-8、代码围栏、本地链接、差异及实际阅读入口一致性 |

本设计不要求改 Rust；若实施中发现确需修改 Rust 源码或 Cargo 配置，先说明原因和扩大范围，再按根规范补 fmt、Clippy、测试及 feature 检查。WebDAV 请求、单题 AI 若实际受影响，补跑对应现有回归，不用本次收敛平台为由削减原有门禁。

不通过再次运行将被移除的 Android 构建来证明剩余平台有效。需要查验历史实现时，使用独立旧提交环境，不恢复为当前工程依赖。GUI、真实系统对话框、干净系统安装及发行验收按实际覆盖记录，不能以 Node 测试或构建成功代替。

### 8.3 设计阶段的验证边界

本次只新增本文，执行文档检查，不运行应用功能验收。当前工作树没有桌面 `node_modules`；文档检查脚本仅用 Node 内置模块，可直接执行，无须为设计任务安装依赖。

## 9. 回退与已确认范围

实现交付时保留删除前提交及变更记录。需要恢复 Android 工程时，从 Git 历史通过后续恢复变更处理，不改写已合入历史，也不以源码回退替代用户数据恢复。由于本方案不改持久化格式和标识，平台收敛本身不应触发数据迁移。

用户已于 2026-11-05 确认以下整体范围：

1. 本仓库同时移除 Android 原生应用与 WebView 壳的当前工程和维护入口，后续维护 Web/Windows。
2. 保留旧 Android 备份的现有读写兼容；ZIP 使用中性显示名称，内部格式保持不变。
3. Kotlin 回归执行设施移除，原始样例与预期留作历史参考，Android 文档归档，Git 历史保留。
4. Android 独有功能迁移、本机开发环境清理和远端旧发行包处置不纳入本次实现。

确认依据为[仓库开发规范](../../../AGENTS.md)第 2 节：涉及平台支持范围和跨模块行为变化，先批准设计，再编写实施计划与修改实现。
