# Shiroha Quiz Windows 原型

本工程使用 Tauri 2 和 WebView2，在独立 Windows 窗口中运行现有 Web 版。当前产物是 release 可执行文件，不包含安装器、代码签名或自动更新。

## 环境要求

- Windows，以及较新的 Microsoft Edge WebView2 Runtime。
- Node.js 24 或更新版本、npm。
- Rust stable，使用 Windows MSVC 工具链。
- Visual Studio Build Tools 的 C++ 构建工具和 Windows SDK。

先在 PowerShell 中进入本目录：

```powershell
cd E:\Projects\shiroha-quiz-desktop\apps\desktop
```

仓库位于其他位置时，替换上述路径。本机 Rust 使用 `--no-modify-path` 安装；若当前终端找不到 `cargo`，且 Rust 安装在默认位置，可仅为当前 PowerShell 会话补充 PATH：

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

已经能够运行 `cargo --version` 的环境无需执行此步骤。

## 开发与构建

安装或更新依赖前，先退出使用本工程依赖的开发窗口和相关进程，避免 Windows 文件锁造成依赖目录不完整。仅停止能够确认属于本工程的进程。

```powershell
npm install
npm run dev
```

开发命令先生成前端资源，再使用 Tauri CLI 内置开发服务启动窗口，端口为 `51736`。不需要另行启动 Web 目录中的 Python 或 PowerShell 服务。

构建 release 可执行文件：

```powershell
npm run build
.\src-tauri\target\release\shiroha-quiz-desktop.exe
```

输出路径为 `src-tauri/target/release/shiroha-quiz-desktop.exe`。构建命令使用 `tauri build --no-bundle`；首次构建需要下载 Rust 依赖并完成编译。

## 资源与数据

[Web 页面](../web/index.html)和[应用脚本](../web/app.js)仍是唯一业务源码。资源准备脚本从 `apps/web` 生成本工程的 `dist`，排除 CMD、PS1、README 和 source map，并保留运行库与许可证；内联点击处理器仅在生成目录中转换。不要手工编辑或维护第二份 Web 源码。

开发和构建会自动准备资源。修改 Web 源码后，也可单独重新生成：

```powershell
npm run prepare:web
```

应用标识固定为 `com.yiqiu.shirohaquiz.desktop`。桌面题库与学习数据使用 Rust 独占的 SQLite，图片按内容哈希保存，普通保存通过业务增量 IPC 提交；不会在原生服务失败时回退 localStorage 写入。AI/WebDAV 请求与凭据仍沿用浏览器实现，跨域与证书限制仍然适用；尚未接入原生网络或系统凭据库。

正常发行数据位于 `%LOCALAPPDATA%/com.yiqiu.shirohaquiz.desktop/local-data`，开发数据使用同级 `development`。目录内包含 `library.sqlite3`、WAL、媒体、恢复点和进程写入锁；不要在运行时只复制 SQLite 主文件充当备份。覆盖、重置及恢复前会先创建并验证包含媒体的恢复点；设置页可读取并选择恢复点。恢复点和未引用媒体目前均保守保留，不自动删除，磁盘空间不足时操作失败并保留原数据。

原生打开/保存通过系统对话框选择文件，页面仅获得有时效的分块访问令牌。保存先写同目录临时文件，回读验证大小与 SHA-256 后替换目标；取消或替换失败不报告保存成功。共享 JSON/ZIP 仍是交换格式，数据库文件不是跨端导出格式。

开发与生产来源不同，数据互不共享。同来源旧原型数据在空目标库启动时显示迁移确认，迁移保留旧主状态、独立配置、凭据和未知键；数据成功后 SQLite 成为活动来源。凭据迁移尚未实现，不会清理旧密码或 Key。目标已有数据时不自动覆盖；需要合并旧数据时先导出备份再主动导入。外部 Web 数据须在原浏览器导出完整备份，再在桌面窗口导入；应用不会扫描浏览器资料目录。

首页读取题目索引和记录摘要，不读取全部正文与图片；题库预览、错题和收藏每页 50 条，练习/考试读取选定题目，历史记录展开时读取明细。统计和跨库选题仍覆盖全部索引；完整导出读取全部正文。离开页面释放未修改且未被练习/考试使用的题目缓存。

数据库损坏时，启动恢复页提供“查找本机恢复点”和“选择兼容备份修复数据”。确认后先在 `generations/<UUID>` 建立并校验恢复副本，再原子更新 `active.json`；原数据库、WAL、媒体和旧活动代均保留。请保留完整数据目录，不要只删除主库强制初始化。设置页也提供恢复入口，健康数据库继续使用常规恢复点恢复。验证结果和发行环境边界见[阶段 C 记录](../../test/dual-platform/README.md)。

## 雾蓝一体视觉

桌面使用[雾蓝一体样式](./frontend/desktop.css)：导航与正文共用连续浅蓝背景，首页以留白和细线区分版本信息、快捷入口及统计，题干与表单保留浅色阅读面。普通页面收起导航时正文位置保持稳定；练习和考试沿用既有专注模式，临时展开导航时使用实色背景。

资源准备脚本在共享样式之后注入本地 `desktop.css`，并为生成页面添加桌面标识。仅维护 `frontend/desktop.css`，不要编辑 `dist/desktop.css`；Web 与 Android 的共享源码不变。生成前会检查样式文件和 HTML 入口，输入无效时保留既有输出。范围与验收记录见[视觉设计](../../docs/superpowers/specs/2026-10-23-desktop-mist-blue-design.md)和[实施计划](../../docs/superpowers/plans/2026-10-23-desktop-mist-blue.md)。

桌面 smoke 会实际调整本次测试子进程的原生窗口，覆盖 1280×860、900×640 和 1600×1000 的首页、导入、练习及考试，记录实际 WebView2 视口。它检查页面溢出、菜单边界、收起时正文位置、专注模式按钮可达与退出恢复，截图写入 `.reports/mist-blue-*.png`。

### 沉浸式标题栏

标题栏与雾蓝背景连续融合，图标和应用名仅在顶部出现，左侧导航从「首页」开始。标题空白处可拖动，双击最大化或还原；右侧保留最小化、最大化/还原、关闭按钮，支持键盘操作。Windows 原生最大化按钮的悬停贴靠面板不保证与自定义按钮等价。

标题栏模板与脚本维护于 `frontend/titlebar.html`、`frontend/titlebar.js`，由资源准备脚本注入生成页面。标题栏使用拖动、最小化、最大化切换、最大化状态读取和关闭五项权限；阶段 C 另逐项增加受控本地数据与文件业务命令。官方桥接打包为本地脚本，保持 `withGlobalTauri: false`，CSP 与存储来源不变。视觉设计及历史验收记录见[标题栏设计](../../docs/superpowers/specs/2026-10-23-desktop-immersive-titlebar.md)和[实施计划](../../docs/superpowers/plans/2026-10-23-desktop-immersive-titlebar.md)。

修改窗口配置后，请停止并重新运行 `npm run dev`，让原生窗口和生成资源一起更新。

## 验证

在本目录运行：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run build:test
npm run test:desktop
```

`npm test` 包含资源过滤、内联事件转换和路径安全检查。其中的 Windows junction 用例可能受到沙箱创建链接权限限制，应在正常本机终端运行并记录结果，不通过跳过断言掩盖失败。`lint` 同时检查本次工程文档的 UTF-8、代码围栏和本地链接。

`npm run test:desktop` 需要先执行 `npm run build:test`，使用 `target/native-test/release` 中带隔离 feature 的 EXE。测试根必须是 runner 本次创建且带隔离标记的临时目录，同时隔离 SQLite、媒体与 WebView2 profile，并阻止出站。正常 `npm run build` 不接受测试根覆盖，正常发行制品的运行验收须使用隔离 Windows 用户或虚拟机；本轮未执行该项。原生凭据/网络尚未接入，不访问系统凭据。仅完成静态资源生成不能证明 PDF/OCR 已在 WebView2 中通过。

2026-10-23 已在本机 WebView2 155.0.4283.62 验证：7 项单元测试、类型检查、lint 及 release 构建通过；10 项实际桌面检查通过，包括启动不加载隐藏插画、进入导入页后插画正常显示、JSON 题库通过界面导入与练习、关闭重开后的题库保留、MathJax、PDF.js 真 Worker，以及本地 Tesseract 英文 OCR。OCR 样本为 Canvas 生成的 `TEST`，该结果不代表中文扫描 PDF 全流程或大文件性能已验证。测试截图生成于 `.reports/prototype.png`。

人工验收时，使用无敏感内容的小题库和 PDF 样本，检查独立窗口、练习、关闭重开后数据恢复，以及断网后的文字 PDF 导入和少量扫描页 OCR。再检查公式、DOCX/XLSX 导入与备份导出；控制台应无关键本地资源加载错误，生产环境不应执行 CDN 或内联脚本。

设计范围和后续边界见[设计文档](../../docs/superpowers/specs/2026-10-23-tauri-prototype.md)与[实施计划](../../docs/superpowers/plans/2026-10-23-tauri-prototype.md)。

## 双端改造阶段 A

双端改造以[双端设计](../../docs/superpowers/specs/2026-10-23-web-desktop-dual-platform-design.md)和[详细实施计划](../../docs/superpowers/plans/2026-10-23-web-desktop-dual-platform.md)为准。此节保留阶段 A 历史记录；当前运行状态以本文“资源与数据”和阶段 C 验证记录为准。

`npm test` 现在同时执行桌面测试与 `test:shared`；共享测试也可从仓库根目录运行 `node --test test/dual-platform/*.test.cjs`。正常特征测试与已知缺陷的执行型 TODO 分开统计，退出 0 不表示所有迁移缺口已经修复。`typecheck` 增加独立浏览器配置，`lint` 增加平台和共享测试检查，文档检查覆盖双端依据和阶段记录。

环境、命令结果、失败归属、样本与性能边界见[阶段 A 验证记录](../../test/dual-platform/README.md)。依赖安装、构建与测试仍遵守前述进程核验和隔离要求。

## 启动优化与性能复测

桌面资源生成器移除 Web 版固定时长的启动遮罩及其专属预加载图片，非首页插画改用浏览器原生懒加载。首页图片保持即时加载；业务脚本、题库、持久化格式、Web/Android 源码均不改变，也没有通过关闭 GPU、裁剪功能或强制回收工作集降低读数。

在本目录运行 `npm run bench:desktop`，或指定可执行文件与报告路径：

```powershell
npm run bench:desktop -- .reports/baseline.exe .reports/performance-baseline-retest.json
npm run bench:desktop -- src-tauri/target/native-test/release/shiroha-quiz-desktop.exe .reports/performance-after.json
```

旧版 EXE 需要在重新构建前另行保留；接入原生数据后的比较制品必须均支持相同测试隔离，不要将正式原生构建直接传给 runner。脚本每版启动 5 次，第一次创建隔离 profile、后四次复用，保留默认题库与 1280×860 窗口；记录进程启动至页面 load 完成、启动遮罩消失的耗时，随后空闲 5 秒并采集主进程及全部 WebView2 子进程。进程创建时间和路径用于排除 PID 复用；脚本只关闭自己启动的窗口。成功时清理临时 profile，报告保存在 `.reports`，失败时保留诊断数据。本轮 C 未重跑性能基准，下表为原型阶段历史结果。

2026-10-23，Ryzen 9 5950X、32 GB 内存、WebView2 155.0.4283.62，旧版与新版在同一轮串行复测的中位数：

| 指标 | 旧版复测 | 优化后 | 差距 |
| --- | ---: | ---: | ---: |
| 启动至页面 load | 723 ms | 718 ms | 基本持平 |
| 启动至遮罩消失 | 3627 ms | 743 ms | 减少 79.5% |
| 完整进程树工作集 | 523.6 MiB | 510.9 MiB | 减少 12.7 MiB（2.4%） |
| 完整进程树私有提交 | 317.2 MiB | 285.3 MiB | 减少 31.9 MiB（10.1%） |
| 首页资源请求数 | 16 | 8 | 减少 50% |

优化后 5 次可见启动耗时为 737–961 ms，工作集为 503.0–515.2 MiB，私有提交为 274.8–288.7 MiB。启动改善主要来自取消固定等待，内存改善有限。工作集含可共享页面，跨进程求和会重复计数；私有提交也不等同驻留物理内存。测量开启 CDP 调试连接、未清空操作系统文件缓存，不能视为重启电脑后的冷启动或大题库/PDF/OCR 负载结果。

此前单独测得的旧版工作集中位数为 477.9 MiB，本轮为 523.6 MiB，反映进程工作集回收和系统状态的波动。本表使用同轮旧新版结果比较，不将节省量描述为所有环境下的固定值。初测、旧版复测及优化后原始记录分别为 `.reports/performance-before.json`、`.reports/performance-baseline-retest.json` 与 `.reports/performance-after.json`。
