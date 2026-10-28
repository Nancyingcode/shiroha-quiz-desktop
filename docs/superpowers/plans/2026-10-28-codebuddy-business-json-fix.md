# CodeBuddy 业务 JSON 兼容修复与验证

日期：2026-10-28。负责人：当前 Codex 会话。分支：`codex/desktop-codebuddy-business-json`；工作树：`E:/Codex/worktrees/afc4/shiroha-quiz-desktop`；开发基线与合并前本地 main：`ace6e29229dded418eb8ff591675062da6c116b0`。未 fetch，不据此断言远程最新状态。

验收完成后，用户明确要求合并到 `main`，授权本次修复的任务提交与本地合并提交；不推送、不发布。目标工作树为 `E:/Projects/shiroha-quiz-desktop`，合并前已核对工作树干净且 main 未前移；单任务直接保留来源提交与 merge 关系，无需额外整合分支。

## 问题与证据

用户提供的截图显示 CodeBuddy 已登录，连接测试区域报告 `codebuddy_business_json`；用户确认选择 `deepseek-v4.1-flash`。历史原始响应未保留，不能从错误码判断是代码围栏、JSON 语法、字段类型还是长度问题，也不能声称已复原这一次真实响应。

源码与回归确认两处缺口：

- Web 单题解析已有完整 JSON 围栏与一层字符串编码兼容，而 CodeBuddy 原生业务校验只解析裸 JSON。包含完整有效对象的格式包装会被提前拒收，前端没有机会解析。新增回归在旧实现中复现该拒收。
- 连接测试、单题解析、追问的语法、字段与长度失败共用一个诊断码，错误文案只提解析和追问。连接测试提示词也未明确要求不带围栏、不加字段。

本次属于既有业务解析兼容与诊断修复，沿用[正式执行设计](../specs/2026-10-25-codebuddy-client-execution.md)。不改变 IPC 参数、权限、模型、预算、登录或持久化格式。

## 修复范围

- 先完成原始上游终态校验及 CLI 原文一致性校验，再在业务层识别一个完整的 JSON 围栏（无标签或 JSON 标签）及一层 JSON 字符串编码。返回校验后同一对象的裸 JSON，前端连接测试和单题界面消费同一结果。
- 原样保留业务文本中的公式、换行、Unicode、文本内围栏与人工核对字段；不从混合说明中截取对象，不补齐截断，不猜测字段，不自动重试。
- 重复键（含转义同名与嵌套重复）、多对象、围栏不完整、对象之外的说明、错误类型、缺失业务字段与超长文本仍拒绝。字符串最多解码一层。
- 连接提示词明确要求唯一的 `{"ok":true}`。Codex 提示词保持原样。
- 固定诊断区分 JSON 格式、正文长度、连接结果、解析字段与追问字段；不输出模型正文、动态字段名、凭据或服务端原始错误。
- 隔离 native-test 的合成响应统一带完整 JSON 围栏，使既有连接、解析、追问及人工保存 smoke 覆盖修复路径。真实 CLI 离线探针追加四个格式包装场景。

## 验证记录

- 红测试：完整有效的围栏对象被旧原生实现拒绝；旧连接提示词缺少格式约束；旧实现无法区分字段失败。
- 修复后的原生针对性回归与 CodeBuddy 前端回归通过。
- `npm test`、`npm run typecheck`、`npm run lint` 通过；npm 首次在沙箱中遇到链接和 Hook fixture 权限限制，本机以同一断言重跑通过。
- 默认 `cargo test` 通过：299 通过、5 忽略。首次沙箱运行的 41 项回环、AppContainer 和链接权限失败，在本机重跑通过。
- 默认/全部 feature 的 Clippy 通过（`-D warnings`）；全部 feature 与全部 target 的 Rust 测试 310 通过、6 忽略。
- `npm run build` 正式 release 与 `npm run build:test` 均通过。WebView2 35 项全部通过，CodeBuddy 的连接、解析、追问、取消、人工保存与重启保全均经过带围栏合成响应路径。
- 新正式 EXE worker 与固定真实 CodeBuddy CLI 的 21 类离线场景全部通过，包括 4 类新增包装、长解析/追问、拒收截断/断流/工具/重复字段、取消/超时与两任务隔离。20 个单任务场景各一次合成上游回调；结束后隔离任务目录为 0。组件文件大小及 SHA-256 与固定 2.175.0 清单一致。
- Web 单题 AI 端到端：31 通过、1 失败。失败项 `practice-review-ai-wrong-overview` 仍断言旧的“你的答案：B 5”文案，当前主线已显示逐项选项卡、“当时选择”和“当时错误答案”。`apps/web` 与 `test/web-ai-practice` 对 HEAD 无差异，该失败不经过本次修改的桌面 Harness。保留原断言与失败记录，不将其计为通过。

用户已明确授权本轮真实 Flash 验收：最多一次连接、一次合成题解析、一次追问；连接上限 1024、解析/追问各 8192 输出 token，每次 120 秒截止，失败即停、不自动重试。实际完成三次请求，各一次、零重试，均在截止前成功；授权不能扩展为更多请求。

独立验收构建使用生产 feature，仅覆盖应用 identifier、产品名与窗口标题。identifier 为 `com.yiqiu.shirohaquiz.codebuddy-json-20261028`，不与正式题库共用目录。正式 EXE 已恢复并校验 SHA-256：`a00f5283e38552727fef44c5238c105e5a4fdd50c87fac7b982bbc6a52a03aa7`；独立验收 EXE SHA-256 为 `0c0f95389ec8c26ade776a7a2cada40495e438080ae0badf706255c47f8d4a44`。已启动并核对“CodeBuddy 修复验收 · 独立数据”窗口；账户登录由用户完成。

真实 `deepseek-v4.1-flash` 验收结果：

- 连接：界面显示“测试执行成功，结果已通过校验”。连接前后持久化条目均为 0，摘要相同。
- 解析：普通导入器导入一道自建算术题“1 + 1 = ?”，参考答案 A（2）；总提交模式选择 B（3），点击一次 AI 解析。结果正确给出 A，并解释 B 错误，界面显示高置信与题库答案一致。
- 追问：发送一次“为什么 B 不对？请保留完整解析，并用一句话说明。”；成功显示答复及完整修订解析，界面提示解析草稿已更新、需确认后保存。
- 未点击真实结果的保存或重新生成。合成题导入后的 406 条持久化记录在作答、解析、追问后摘要均为 `9fa927008a5120d5804efdb88eacb5cb6e1360a42274bccc4ac86a2bd61c1f22`，没有自动写入题库。真实验收未访问正式题库；人工保存与重启保全由前述隔离 smoke 覆盖。
- 本次真实流程未复现 `codebuddy_business_json`。历史响应仍未知，不能断言所有服务端输出都会符合业务格式；对不完整、歧义或字段不合法的结果仍明确拒收。

## 已安装客户端交付

三项真实验收通过后，用户明确批准替换 `E:/software/Shiroha Quiz/shiroha-quiz-desktop.exe` 并重新打开。替换前核对旧程序没有运行进程；只备份并替换该 EXE，不迁移题库或账户目录。

- 旧 EXE 备份：`E:/software/Shiroha Quiz/shiroha-quiz-desktop.before-codebuddy-json-20261028.exe.bak`，SHA-256 为 `dce31dacb9eadf6945351fcce42f9562c52088c74b42541006ade5bfd641bbfe`。
- 替换后 EXE 的 SHA-256 与上述正式构建一致。按安装路径启动并核对“Shiroha Quiz”窗口已加载首页；原快捷方式的目标路径未改变。
- 正式客户端只做启动与首页加载检查，不再执行模型请求，也不使用真实题库追加测试。

本地构建与证据仅放忽略目录：正式 EXE 在 `apps/desktop/.reports/codebuddy-json/release/`；探针、Rust、Web 与构建日志在 `apps/desktop/src-tauri/.reports/codebuddy-json/`。不含真实题库、模型原文、授权链接或凭据。
