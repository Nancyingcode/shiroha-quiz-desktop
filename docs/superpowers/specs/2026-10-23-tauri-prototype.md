# Windows Tauri 最小原型设计

日期：2026-10-23

状态：最小原型已实现，核心桌面验证通过；扩展格式与中文扫描 PDF 验收见下文。

## 1. 目标与确认依据

用户已明确选择 Tauri，并要求按此前关于复用现有 Web 的讨论开发最小原型。本次要求作为按已有设计实施的确认；本文件将原型边界、实现约束和验收方法具体化，不另行重复请求确认。

目标是在 Windows 独立应用窗口中运行现有 Shiroha Quiz，提供可重复的开发和构建命令，并验证随包 PDF、OCR 资源的兼容性。首版重在验证桌面运行方式，不同时重写业务界面或迁移持久化。

## 2. 已有实现与约束

- 唯一 Web 源码位于 `apps/web`，由静态 HTML、CSS、JavaScript 和离线资源组成。
- `app.js` 将导航、题库导入、练习、考试、持久化和网络请求集中在单一 IIFE 中。原型保留这些行为。
- 数据通过 localStorage 保存，API Key 和 WebDAV 密码按现有选项存入 localStorage 或 sessionStorage。
- PDF 使用 PDF.js 的 ES module 与 Worker；OCR 使用 Tesseract.js 的 Worker、WASM 和语言包；公式使用 MathJax。相关资源已在 `apps/web/libs` 中。
- DOCX/XLSX 使用现有 ZIP/OOXML 解析和浏览器 `DecompressionStream`，不引入新的文档解析库。
- Web 页面存在内联 `onclick`，脚本存在本地资源失败后的 CDN 回退。桌面生产环境需要在不修改 Web 源码的条件下建立本地脚本边界。

现有代码入口：[Web 页面](../../../apps/web/index.html)、[应用逻辑](../../../apps/web/app.js)、[离线 OCR 说明](../../../apps/web/libs/ocr/README.txt)。

## 3. 范围

### 本次实现

1. 新增 `apps/desktop` 独立 Tauri 2 工程，Windows 使用 WebView2。
2. 复用 `apps/web`，通过资源准备脚本生成桌面专用 `dist`，不维护第二份 Web 源码。
3. 提供独立应用窗口、固定应用标识、开发启动与生产构建命令。
4. 建立资源准备脚本的自动化测试，以及新工程适用的测试、类型检查、lint 和构建入口。
5. 验证离线脚本、PDF Worker、OCR Worker/WASM/语言包，并记录实际验证范围。
6. 保留现有浏览器导入、练习、考试、备份及网络行为；桌面运行暴露的问题按原型兼容范围修复。

### 后续阶段

SQLite、图片文件化、原生文件和网络 IPC、Windows 凭据保护、自动更新、正式签名发布、托盘及文件关联不在本次范围。原型不承诺已消除 localStorage 配额、浏览器 CORS 或原有大题库性能限制。

## 4. 工程与资源流

```text
apps/web                         唯一业务源码与离线资源
    ↓ 资源准备脚本
apps/desktop/dist                自动生成的桌面前端资源
    ↓ Tauri frontendDist
apps/desktop/src-tauri           Windows 应用入口与安全配置
```

`dist` 为派生产物，禁止手工修改，不纳入源码维护。资源准备脚本应当：

- 仅从明确的 `apps/web` 来源生成资源，包含页面、样式、应用脚本、图片、题库数据和 PDF/OCR/MathJax 运行资源。
- 排除 Windows 启动脚本、PowerShell 下载/服务脚本、README 和 source map 等非运行资源。
- 保留第三方许可证文件，不以排除说明文件为由移除许可证。
- 每次重新生成时消除旧产物，但只允许清理已校验处于本工程下的目标目录；拒绝来源与目标重叠、越界目标或链接造成的越界访问。
- 保持输入文件不变；重复运行应生成相同内容。
- 将已知内联 `onclick` 转换为生成脚本中的事件绑定，保留点击行为和 `this` 语义，不使用 `eval` 或运行时 `Function` 构造器。
- 对超出转换支持范围的内联可执行内容显式失败，避免静默生成仍需放宽脚本策略的页面。

转换仅作用于生成目录，因此现有 Web 和 Android 发布流程不受影响。

## 5. 应用身份与运行方式

- 应用名使用 Shiroha Quiz。
- 应用标识固定为 `com.yiqiu.shirohaquiz.desktop`。后续变更标识前必须评估应用数据目录和迁移影响。
- 不新增自定义开发服务器；优先使用 Tauri CLI 对 `frontendDist` 提供的内置开发服务，约定端口 `51736`，实际 CLI 参数需验证，避免占用现有 Web 启动器的 `51735`。
- `beforeDevCommand` 等待 `npm run prepare:web` 完成后再启动窗口，确保资源首次生成和后续更新的顺序明确。
- 开发服务和生产资源都应采用可加载 ES module、Worker 和 WASM 的来源，不使用直接打开 `file://index.html` 的方式。
- 生产资源由 Tauri 加载，不依赖用户另行运行 Python 或 PowerShell 服务。
- 开发与生产采用不同来源，开发数据视为临时测试数据，用户体验与持久化验收使用 release 可执行文件。原有浏览器数据通过现有备份导入迁移，不扫描或读取用户浏览器资料目录。

新工程使用 npm。仓库没有应用级锁文件，因此此选择不替换已有包管理器；新增工程需要生成并维护自己的依赖锁文件。

## 6. 安全边界

原型不新增 Rust 业务命令，不开放文件系统、shell、HTTP 客户端或任意进程调用权限。Renderer 继续使用浏览器 API 读取用户主动选择的文件，不能通过新增桥接直接访问磁盘。

生产 CSP 仅允许本地可执行脚本，禁止 CDN JavaScript 执行和内联 JavaScript，不通过允许任意脚本来源或关闭 CSP 解决兼容问题。保留现有 CDN 回退代码时，其执行应受到生产 CSP 阻止；离线功能依靠完整随包资源。

按实际需要允许本地与 Blob Worker、WASM 编译、数据图片和动态样式。WASM 权限不应扩展为任意 JavaScript 动态执行权限。AI/WebDAV 继续由浏览器 `fetch` 调用用户配置的 HTTP/HTTPS 服务，保留浏览器跨域与证书检查；这不等于授予原生 HTTP 权限。

根规范中的 Electron 主进程/preload 表述在用户明确选择的 Tauri 方案中对应同一安全意图：特权能力留在受控原生边界，不能直接暴露给 Renderer。本次不新增该类特权桥接。

## 7. 验证与验收

### 自动化验证

资源准备脚本先写失败测试，再实现使测试通过。至少覆盖：

- 运行资源保留，CMD/PS1/README/source map 排除，许可证保留。
- 原始 Web 文件不变，输出可重复生成，旧输出被清理。
- 内联点击事件转换后的可执行语义、事件脚本引用与生产 CSP 约束。
- 越界或重叠目标拒绝，未知内联执行形式不会静默通过。
- PDF/OCR 关键文件存在并保持相对目录关系。

在 `apps/desktop` 按最终 `package.json` 执行 `npm test`、`npm run typecheck`、`npm run lint` 和 `npm run build`。静态资源准备成功不等于 Tauri 编译或桌面运行验证成功。

### Windows 运行验证

1. 启动独立窗口，确认导航和基本练习可用。
2. 使用隔离测试数据导入小题库，关闭后重开同一构建，确认 localStorage 数据可恢复。
3. 使用独立测试样本导入文字 PDF，确认本地 PDF.js 和 Worker 加载成功。
4. 断网或拦截外网后，对少量扫描 PDF 页面执行 OCR，确认本地 Worker、WASM 和语言包可用。
5. 检查公式、DOCX/XLSX 导入和 JSON/ZIP/DOCX 导出是否存在桌面特有兼容问题。
6. 验证生产页面不执行远程脚本或内联 JavaScript；调试控制台无关键资源加载错误。

浏览器测试可以验证部分资源和 DOM 行为，不能替代 WebView2 安装版测试。未具备相应运行条件时保留可重复步骤，并将未验证项列入结果。

## 8. 当前环境与完成标准

初始环境已具备 MSVC 构建工具和 WebView2 155；本次安装了用户级 Rust 1.99.1 最小工具链以及 rustfmt/clippy，未修改系统 PATH。

2026-10-23 完成 release EXE 构建；6 项单元测试、typecheck、lint、Rust 格式检查通过。隔离 WebView2 中的 9 项检查通过，覆盖实际 JSON 题库导入与练习、重启数据保留、公式、PDF 真 Worker、英文 Canvas OCR 和脚本/CSP 错误检查。中文扫描 PDF 全流程、DOCX/XLSX、各类导出和真实 AI/WebDAV 连通性未纳入本轮自动化验证，不据此承诺完整兼容。

完成报告分别列出：已实现文件、已通过的命令、无法执行或失败的命令及原因，以及 PDF/OCR 是通过实际 WebView2 验证还是仅完成静态/浏览器验证。不擅自提交、推送或发布。
