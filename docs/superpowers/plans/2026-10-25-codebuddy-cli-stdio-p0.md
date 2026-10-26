# CodeBuddy CLI 直接管道验证

日期：2026-10-25。状态：11 个场景完成，**P0 未通过，未接入正式 Harness**。

后续进展：用户要求研究自有适配层后，已验证受控转发器可修复本轮复现的终态与额外请求问题，原生 AppContainer 也有实际隔离结果，见[适配层补救 P0](2026-10-25-codebuddy-adapter-p0.md)。本文件保留直接调用时的历史观察，不再将“必须等待上游修复”视为唯一后续方向。另补充：过滤样例的最终 assistant 与流/result 不一致，可由适配层拒收；EOF 与正常结果仍无法只从 stdout 区分。

## 范围与来源

用户要求阅读「规划 WorkBuddy 嵌入方案」探索总结并尝试 CLI 接入。该会话已授权路线 A 的 P0，通过后才接入 Harness。本次继续这一授权，验证固定 CodeBuddy Code 2.175.0 的 `-p` / `stream-json`，不改变产品设计，不启用正式适配器。

前轮材料位于 `E:/Codex/worktrees/64eb/shiroha-quiz-desktop`：`docs/superpowers/specs/2026-10-25-workbuddy-harness.md`、`docs/superpowers/plans/2026-10-25-codebuddy-harness-p0.md` 和 `2026-10-25-codebuddy-vscode-bridge-p0.md`。已读取对应会话及原始证据；不复制或修改来源工作树的未提交业务代码。

前轮发现：ACP 常驻模式存在未认证的本地服务代理入口；VS Code 后台命令丢失完整终态；独立 CLI 凭据保护未通过。此次检查直接 CLI 是否能够避开前两项，并单独记录认证缺口，不能用假 API Key 代替共享积分验证。

## 任务记录

- 负责人：当前 Codex 会话；两个只读子任务分别复核历史证据和官方文档。
- 分支：`codex/desktop-codebuddy-cli-probe`。
- 工作树：`E:/Codex/worktrees/ea83/shiroha-quiz-desktop`。
- 基线：`75cf89388468e966f753be452d5d84afeef781e5`，与本地 `main` 一致。SSH 查询远程 main 时 DNS 解析失败，未证明服务器最新状态；本次无合并或推送。
- 修改范围：独立验证脚本、中文记录；不修改 Web、Rust、IPC、生产依赖或锁文件。
- 制品：读取前轮已校验的官方 EXE，复制到本工作树忽略目录，运行前核对 SHA-256 `bc404638e5e55af4030f93ed73dadc68a7ca2b7eb5df6613b07ab3510061b309`；不全局安装、不修改厂商包。

## 验证顺序

1. 阅读现有材料和官方 CLI/无头模式文档，固定参数及隔离环境。
2. 建立真实 EXE + 本机假模型服务的独立探针；预先列出成功、截断、过滤、缺失结束、工具事件与取消场景。
3. 比较实际 stdout 的 result、assistant 和 partial events，不能仅凭退出码或可解析的 JSON 判成功。
4. 在挂起请求期间读取候选进程监听端口；只按本探针创建的 PID 终止进程树，核对连接关闭和退出。
5. 检查隔离目录中的合成正文与假凭据标记，核对额外请求、父目录规则和工具执行。
6. 用 SDK 发布源码复核双向 stdio 控制及认证生命周期；未满足门槛时保存失败证据，不登录真实账户或消耗积分。
7. 执行探针、语法检查、文档检查和差异检查，保留复现命令、证据与未覆盖项。

## 结果

**直接 CLI 能正常返回文本并支持中断，但当前固定版本不能直接接入本项目。** 相较前轮，本轮新增实证：普通 `-p` 仍启动 HTTP Gateway；即使输出 partial events，也不能从当前假模型传输路径可靠区分正常完成、内容过滤和缺失完成标记。

### 1. 制品与试验范围

- 实际运行官方 Windows EXE **2.175.0**，执行前再次核对上述 SHA-256。未升级制品、改写厂商包或全局安装。
- 直接调用 `-p --input-format text --output-format stream-json --include-partial-messages`；控制试验将输入改成 `stream-json`。均未使用 `--acp` 或 `--serve`。
- 所有模型请求走本机 OpenAI 兼容假服务，使用合成中文题目、假 Key、独立 HOME/配置/数据目录。没有登录腾讯账户、读取既有登录文件或消耗积分。
- `--tools ""`、显式空 MCP、严格 MCP、`--setting-sources none`、不持久化会话和关闭 trace/记忆/shell snapshot/函数 hooks/后台任务沿用已核对隔离开关。
- 同时设置 `--max-turns 1`、`CODEBUDDY_CODE_MAX_TURNS=1`、`CODEBUDDY_MAX_RETRIES=0`，并统计实际模型请求，不把参数当作单次请求保证。
- 代理指向不可用回环端口，模型地址明确指向本机；没有实施操作系统级网络封锁或整机网络审计。结论限定于本轮观察，不能推广为订阅服务所有模型都具有相同协议行为。

### 2. 实际观察

完整复测记录：`.reports/codebuddy-cli-stdio/run-1792874392485/`。以下请求数只计算该场景假服务收到的 `POST /chat/completions`；全部场景均未出现其他假服务路由。

| 场景 | 请求数 | 结果与含义 |
| --- | --- | --- |
| 正常 stop | 1 | 中文 JSON 正常返回，`success`、`is_error=false`，进程自然退出 0 |
| length | **4** | 每次服务端均报告长度截断，最终仍返回成功；单回合与重试参数没有阻止额外请求 |
| content_filter | 1 | 返回与正常场景相同的成功正文，缺失可区分的终态原因 |
| EOF | 1 | 文本后正常关闭流，无 finish_reason、无 `[DONE]`，仍返回成功 |
| 只有 `[DONE]` | 1 | 缺失 finish_reason，仍返回成功 |
| 非法 SSE JSON | **3** | 最终 `error_during_execution`、`is_error=true`，但进程退出码仍为 0；期间有额外模型请求 |
| Write 工具诱导 | **2** | 请求未声明工具，目标文件未生成，但 CLI 纠错后再请求模型并返回成功 |
| 宿主取消 | 1 | 结束所属进程树，连接在假服务主动清理前关闭，没有成功 result，进程退出 1 |
| 超时 | 1 | 同上；此处 1500 毫秒是本探针在请求挂起后的截止时间 |
| 假网关密码环境 | 1 | 普通 `-p` 下配置 `CODEBUDDY_GATEWAY_AUTH/PASSWORD` 后，未鉴权入口仍可到达；不等于已启用 `--serve` 的密码模式 |
| 双向 JSONL interrupt | 1 | 初始化、查询认证方法、无真实账户退出和中断控制均响应成功；`interrupted=true`，最终 `terminal_reason=aborted_streaming`，连接在清理前关闭，stdin 关闭后自然退出 0 |

正常、过滤、EOF、只有 `[DONE]` 四个场景的 assistant `stop_reason` 都是 null，partial events 都报告 `end_turn`，result 都是相同的成功文本且没有 `terminal_reason`。这说明 `--include-partial-messages` 的事件经过转换，不能直接作为原始上游完整结束的证明。

中断是不同情况：虽然 result 也写了 `subtype=success`、`is_error=false`，但保留了 `terminal_reason=aborted_streaming`，宿主能够据此拒收。因此不能说 CLI 取消没有明确标记，也不能只检查 `success` 字段。当前只覆盖一次双向中断和两个结束进程场景，不宣称已完成真实服务取消、并发竞态或 Windows Job 验收。

### 3. 直接 CLI 并未避开本地服务

所有 11 场景在假模型响应挂起时，都发现候选 EXE 自身监听 `127.0.0.1` 随机端口。探针仅访问这个 PID 的监听端口：

| 本地请求 | 提供的身份信息 | 实际响应 |
| --- | --- | --- |
| `GET /api/v1/info` | 公开固定头 `x-codebuddy-request: 1`，无秘密 | HTTP 200，`gatewayMode=local` |
| `GET /internal/hooks/services/invoke` | 无 Authorization、Cookie、固定头、服务 ID 或 body | HTTP 200，`MISSING_SERVICE_ID` |

第二项仅证明未经认证的请求已到达服务代理控制器的参数校验；没有提供真实账户或有效服务 ID，也没有证明真实账户已被利用。它足以否定“去掉 ACP、只用 print 就没有本地接口”的假设。普通 print 设置假密码环境没有改变这项观察，不能把其描述成已通过密码鉴权测试。

同版本发布源码也解释了原因：`DefaultModeStrategy` 和双向 `executeStreamMode` 均通过 `CliExecutor.sendRequest` 访问内部 HTTP `/internal/agent`。这是静态佐证，监听与路由表则来自真实 EXE。

### 4. 认证与 SDK 的新增发现

固定官方 `@tencent-ai/agent-sdk@0.3.290` 的 `lib/transport/process-transport.js` 第 445–455 行会合并父环境，并无条件设置 `CODEBUDDY_CREDENTIALS_IN_MEMORY='0'`。因此直接使用该 SDK 会覆盖调用方传入的 `1`；它不能作为当前纯内存凭据方案的实现。本轮没有安装或运行 SDK，只读核对其发布源码。

直接启动 EXE 的 JSONL 控制协议可用，已有 `initialize`、`get_auth_methods`、`authenticate`、`logout`、`interrupt`。本次只运行不需要真实登录的控制步骤。initialize 返回非空 account 是假 API Key 路径的组件行为，**不是 WorkBuddy 账户登录成功或积分身份验证**。探针只记录控制回复的白名单字段，不保存原始 account/token。

同版本源码存在纯内存认证存储分支，但实际订阅登录、刷新、退出、秘密日志和加密保存仍未通过动态验证。官方 SDK 的独立认证函数完成后会关闭进程，也不能直接保留该进程内存会话。当前本地接口门槛已经失败，未继续真实授权试验。

### 5. 数据、工具与清理边界

全部最终场景的隔离目录未发现合成提示词、假 Key 或响应正文的明文标记；Write 目标文件明确不存在，模型请求没有 tools 字段，也未发现父目录项目规则。仅证明这些具体样例，不推广为全部工具、网络或子进程能力均已验证隔离。

连接关闭状态在探针调用 `server.closeAllConnections()` **之前**记录，避免把假服务主动清理当成 CLI 取消成功。正常与双向中断场景自然退出；宿主取消/超时只结束本探针创建的 PID 及其子进程。原始合成证据保留在忽略目录，不清理来源工作树。

### 6. 复现与工程检查

可维护的[探针与说明](../../../test/codebuddy-cli-stdio/README.md)包含 11 场景和 `verify.mjs` 断言。复现命令：

```powershell
node test/codebuddy-cli-stdio/probe.mjs .reports/codebuddy-cli-stdio/runtime/codebuddy.exe
node test/codebuddy-cli-stdio/verify.mjs .reports/codebuddy-cli-stdio/run-1792874392485
```

第二条用于核对本次记录；重新运行时改成新目录。验证脚本成功表示所有已记录行为得到重现，**不表示被测 CLI 的缺陷已经修复或 P0 通过**。

检查结果：

- 真实 EXE + 假服务 11 场景及证据断言通过；专项脚本的 Node 语法检查与项目 ESLint 规则检查通过。
- `apps/desktop` 的 `npm run typecheck`、`npm run lint`、`npm test` 通过。该工作树最初无依赖，按既有锁文件安装前核对了占用进程，未发现当前工程的 Node/EXE 开发进程；未改依赖声明或锁文件。测试的符号链接场景在沙箱下被 EPERM 拒绝，在普通 Windows 权限环境复跑通过。
- 无 Web/Rust/IPC、资源生成或构建配置修改，不运行应用构建与 WebView2 功能验收；本轮不声称正式业务接入已验证。
- 文档检查、全部 3 份变更文档的 UTF-8/代码围栏/本地链接及差异检查通过；按本工作树 EXE 绝对路径确认无探针进程残留。无 commit、push、PR 或发布。

### 7. 接入判定和下一步

当前保留 CLI 方向及复现材料，**不向正式设置开放 CodeBuddy 执行器**。Codex 和直接 API 行为未修改。先前设计要求 P0 通过后才接入；本轮实测仍未满足门槛，因此不以“能返回一段文字”代替正式接入。

继续推进需要固定官方版本提供并通过验证：

1. 真正不启动通用 HTTP Gateway 的 stdio 模式，或完整受控且没有当前未认证入口的受支持宿主边界。
2. 不丢失过滤、截断和传输结束证据的终态契约，以及可核对的内部重试/额外模型请求控制。
3. 独立 Windows 宿主可使用的受保护登录，随后再验证同账号积分、实际模型与刷新/注销。

在本轮核对的官方文档中未找到关闭 print Gateway 的受支持参数，也未找到保证原样保留 finish_reason 的其他输出开关；这不等于不存在未公开实现。没有通过修改厂商包、读取诊断日志或复用其他客户端凭据来绕过这些缺口。

官方参考：[无头模式](https://www.codebuddy.cn/docs/cli/headless)、[CLI 参数](https://www.codebuddy.cn/docs/cli/cli-reference)、[环境变量与重试说明](https://www.codebuddy.cn/docs/cli/env-vars)、[TypeScript SDK](https://www.codebuddy.cn/docs/cli/sdk-typescript)。官方功能说明用于选择验证项，实际接入判定以上述固定制品的实验结果为准。
