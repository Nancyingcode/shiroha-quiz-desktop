# CodeBuddy CLI 直接管道探针

这是独立可行性试验，不属于正式 Harness。固定 Windows EXE 连接本机假模型服务，验证 `-p`、JSONL 终态、本地监听、双向控制和取消。使用 Node.js 24 自带模块，无新增依赖。

## 前提

- Windows，Node.js 24，系统 PowerShell 能查询 `Get-NetTCPConnection`。
- 官方 CodeBuddy Code **2.175.0** EXE，SHA-256 必须为 `bc404638e5e55af4030f93ed73dadc68a7ca2b7eb5df6613b07ab3510061b309`。
- 原始发行包：[Windows x64 ZIP](https://acc-1258344699.cos.accelerate.myqcloud.com/@tencent-ai/codebuddy-code/releases/download/2.175.0/codebuddy-code_Windows_x86_64.zip)，ZIP SHA-256 为 `0e9c39f1af4639d63f6aadccc5075233e6d8e4c571c3941c93f5fad81d33d4d4`。本脚本不下载、不全局安装、不改写制品。
- 允许子进程访问回环网络。受限沙箱可能返回 `connect EACCES`，此时脚本明确失败，不计为组件功能失败。

## 运行

从仓库根目录执行：

```powershell
node test/codebuddy-cli-stdio/probe.mjs C:/absolute/path/codebuddy.exe
node test/codebuddy-cli-stdio/verify.mjs .reports/codebuddy-cli-stdio/run-实际编号
```

不传 EXE 路径时，使用本工作树的 `.reports/codebuddy-cli-stdio/runtime/codebuddy.exe`。第二个可选参数可指定单场景，例如：

```powershell
node test/codebuddy-cli-stdio/probe.mjs C:/absolute/path/codebuddy.exe interrupt
```

`verify.mjs` 要求完整 11 场景记录；其成功表示**重现已记录行为，包括已知失败**，不表示 P0 通过。版本或环境导致行为改变时应重新审查证据，不能放宽断言绕过差异。

## 场景及判定

| 场景 | 假服务响应 / 操作 |
| --- | --- |
| `stop` | 正常文本、`finish_reason=stop`、`[DONE]` |
| `length` | 每次均返回长度截断，观察额外请求与最终结果 |
| `content_filter` | 文本后返回过滤原因 |
| `eof` | 文本后正常关闭 HTTP 流，不发结束原因或 `[DONE]` |
| `done_only` | 文本后只发 `[DONE]`，缺失结束原因 |
| `malformed` | 文本后发非法 SSE JSON |
| `tool` | 第一次要求 Write；后续返回正常文本 |
| `cancel` / `timeout` | 挂起响应，分别在 100 / 1500 毫秒后结束本探针子进程树 |
| `password` | 为普通 `-p` 配置假网关鉴权环境，复核其效果 |
| `interrupt` | 双向 JSONL 初始化、查询认证方法、无真实账户退出、合成任务、interrupt 控制 |

挂起请求时只查询当前候选 PID 的监听端口，检查 `/api/v1/info`（公开固定头）与 `/internal/hooks/services/invoke`（无鉴权、无服务 ID、无 body）；后者在缺失参数处返回，不使用真实账户或外部服务。使用合成文本与假 Key，不发送真实题库。

输出位于忽略目录 `.reports/codebuddy-cli-stdio/run-*`。stdout 只输出摘要，原始模型事件与合成请求保留为本地证据；控制回复只记录白名单字段，不保存 `account` 或 token。独立目录中的正文、假 Key 标记扫描只是局部明文检查，不能证明整机无落盘。扫描不会删除失败证据。

父进程显式构造环境，隔离 HOME、配置、数据、临时目录，关闭已有探针已核对的 trace、父规则、记忆、shell snapshot 等功能。网络代理指向不可用回环端口，模型明确指向本机；这不是操作系统级断网沙箱，也没有完成整机网络审计。

每场景有 25 秒看门狗及 4 MiB 输出上限，结束进程仅作用于本脚本创建的 PID。双向 interrupt 优先等待 CLI 自行退出，超时才结束所属进程树。脚本使用 `taskkill /T`，不代表正式 Windows Job 集成已经验收。

结果及后续条件见[验证报告](../../docs/superpowers/plans/2026-10-25-codebuddy-cli-stdio-p0.md)。上述直接管道试验不包含真实登录、令牌刷新、WorkBuddy 同账号扣分和正式业务接入；后续原生登录与受限真实请求的记录见下文。

## 自有适配层补救试验

`guard.mjs` 是测试专用的受控转发层，只允许固定回环假上游。它在发出请求前占用一次性预算，完整缓冲并验证原始 SSE，再将合格响应交给 CLI；宿主继续核对流文本、assistant 和 result 的一致性。`accepted` 仅表示传输候选合格，现有业务 JSON/schema 校验仍必须保留。证明只属于本次转发器实例，不是可由前端提交的公共对象。

```powershell
node --test test/codebuddy-cli-stdio/guard.test.mjs
node test/codebuddy-cli-stdio/probe.mjs .reports/codebuddy-cli-stdio/runtime/codebuddy.exe --guarded
node test/codebuddy-cli-stdio/verify-guarded.mjs .reports/codebuddy-cli-stdio/run-guarded-实际编号
node test/codebuddy-cli-stdio/probe.mjs .reports/codebuddy-cli-stdio/runtime/codebuddy.exe auth-token --guarded
```

默认 guarded 矩阵含 10 场景，排除只用于普通 print 的假密码场景；`auth-token` 是额外验证，只设假平台 Token，不设 API Key，只记录 CLI 到转发器的 Authorization 是否匹配。转发器发送给假上游的凭据另为固定假值，不把这条实验链描述成真实订阅调用。

能力值通过子进程环境 `CODEBUDDY_CUSTOM_HEADERS` 传递，不放在命令行。转发器拒绝其他路径、未授权请求、工具请求字段、超限数据、非成功 HTTP、重定向及不完整 SSE；关闭和下游提前断连会取消上游，取消状态不会恢复为 verified。它不负责阻止 CLI 绕过 BASE_URL 访问其他地址，因此必须另有网络隔离。

`container-relay-fixture.mjs` 用于同一 AppContainer 内的联合实验，与 `guard.mjs` 一起部署至专用临时目录，只支持 stop/eof/tool 合成场景。测试部署使用本机 Node；这不是引入 Node 生产依赖的决定。`relay-ready.json` 中的随机能力值是临时实验控制材料；正式实现应由原生宿主通过受限 IPC 传递，不复用测试文件方式。

设计、原生隔离边界与实测记录见[适配层补救设计](../../docs/superpowers/specs/2026-10-25-codebuddy-adapter-containment.md)及[补救验证报告](../../docs/superpowers/plans/2026-10-25-codebuddy-adapter-p0.md)。

## Rust 原生原型

模型执行原型位于 `apps/desktop/src-tauri/src/harness_codebuddy*.rs`，保留显式 `codebuddy-prototype` feature 和 example 验证入口；默认桌面构建现已接入连接测试、单题解析和追问，最新实现与验证范围见[正式执行计划](../../docs/superpowers/plans/2026-10-25-codebuddy-client-execution.md)。独立账户登录入口另见下文，不改变现有 API/Codex 执行配置。原生执行使用 Rust 宿主、匿名管道、容器 worker 与原始响应校验，不依赖 Node/C#/Python 运行时。

在仓库根目录执行：

```powershell
New-Item -ItemType Directory -Force .reports/codebuddy-native | Out-Null
cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --features codebuddy-prototype --example codebuddy-native-probe -- .reports/codebuddy-cli-stdio/runtime/codebuddy.exe .reports/codebuddy-native all
```

`all` 运行 17 类合成响应场景，场景名也可单独指定：`stop`、`analysis`、`followup`、`reasoning`、`empty_fields`、`gateway_fields`、`terminal_delta`、`legacy_function`、`unknown_extension`、`duplicate_field`、`length`、`refusal`、`eof`、`tool`、`cancel`、`timeout`、`parallel`。其中 `analysis` 和 `followup` 覆盖较长中文、换行和公式，`parallel` 含两个独立任务。

构建正式 release 后，可让同一离线验证器使用正式 EXE 的 worker 入口；无需登录或请求真实模型：

```powershell
cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --features codebuddy-prototype --example codebuddy-native-probe -- offline-worker apps/desktop/src-tauri/target/release/shiroha-quiz-desktop.exe .reports/codebuddy-cli-stdio/runtime/codebuddy.exe .reports/codebuddy-native all
```

指定 worker 路径仅用于显式原型 feature，不对 WebView 开放；生产固定复制当前程序。宿主遇到上游错误时保留固定错误码并立即清理，不再转换成 CLI 的通用失败；日志只显示场景、候选字节数、请求次数和固定错误码。

模型选择另有独立离线入口，顺序验证 `deepseek-v4.1-flash`、`hy4-preview`、`hy3`、`default`。它使用正式 EXE worker 与固定 CLI，每项只返回本地合成的完整 `stop` / `[DONE]` 响应，不登录、不调用真实模型：

```powershell
New-Item -ItemType Directory -Force .reports/codebuddy-native/model-selection | Out-Null
cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --features codebuddy-prototype --example codebuddy-native-probe -- offline-models apps/desktop/src-tauri/target/release/shiroha-quiz-desktop.exe .reports/codebuddy-cli-stdio/runtime/codebuddy.exe .reports/codebuddy-native/model-selection
```

该入口要求测试目录没有遗留 `codebuddy-run-*`，逐项核对 CLI 请求的 `body.model` 精确等于所选 ID、合成上游调用一次、候选正文一致，以及结束后运行目录为 0；任一项失败立即停止。输出只记录固定模型 ID、计数和判定，不代表真实账户拥有这些模型的使用权限。

宿主先验证完整原始响应，再生成纯正文 SSE 交给 CLI。`gateway_fields` 验证空结束原因、精确空函数占位及已知推理扩展；`terminal_delta` 验证末尾正文保全；带名称/参数的旧式调用、未知扩展与重复键分别由后三个新负例拒绝。推理/签名不进入候选，仍拒绝截断、非空工具/拒答及不完整终态；末尾正文不擅自去重。CLI EXE 仍固定上面的版本和哈希。每次使用独立 profile、只读程序目录和可写数据目录，完成后先收敛 Job/管道，再清理 profile/目录；失败不进入正常进程重试。输出仅为合成候选和固定状态码。

只验证真实个人账户登录、不发送模型请求的显式入口为：

```powershell
cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --features codebuddy-prototype --example codebuddy-native-probe -- login
```

用户需打开输出的官方登录链接；程序最多等待 5 分钟，不自动打开外部页面。令牌只留内存，完成身份核对后退出清除，不写凭据文件；链接中的临时 state 不应复制到报告。该命令需要真实账户交互，不属于默认回归；本轮已按用户明确授权启动核对并打开官方页面，结果见原生实施记录。模型出口代码已与此入口分离；真实账户权益、积分归属和模型响应仍须单独验收。

经用户明确授权，可运行 `codebuddy-native-probe live-connection <固定 CodeBuddy EXE> <隔离目录>`：先登录，再只进行一次连通性请求，输出上限 1024 token。`live` 则最多顺序进行连通性、合成单题解析和追问三项请求，后两项各为 2048 token；首次失败立即停止，无自动重试。它会消耗账户额度，不属于默认回归。宿主只构造固定合成消息，凭据不传入 CLI；日志只含已知字段类型/空值、终态、token 用量和已通过业务校验的候选，不记录推理正文。完整请求预算上限为 5120 输出 token，不代表实际用量或积分扣减。

历史真实验证只发出一次请求，当时连接输出上限为 64 token，终态为 `length`，服务端 usage 报告输入 87、输出 64、总计 151 token。宿主拒绝该结果，后两项未执行，内存会话已失效。调整后的 `live-connection` 后续经用户重新授权执行一次：服务返回 stop 与 `[DONE]`，输入 87、输出 146、总计 233 token，但 delta 存在未知字段，末尾 function_call 为有字段的对象，当前严格校验拒收且未重试。详细证据和未知语义见[模型兼容验证记录](../../docs/superpowers/plans/2026-10-25-codebuddy-model-compatibility.md#用户重新授权后的实际模型结果)。尚未核对积分扣减，也不能视为完整模型链路验收通过。

第二轮字段兼容修复后，经新的明确授权进行一次 1024 输出 token 上限的真实连接验证，已通过：候选精确为 `{"ok":true}`，仅一次请求，服务报告输入 87、输出 200、总计 287 token。本次确认 `extra_fields:null`、末尾 `function_call` 仅含空 name/arguments，以及中间空结束原因；末尾正文是后续分片，保留后正确拼成 JSON。内存会话已失效、任务目录为 0。详见[新版真实连接记录](../../docs/superpowers/plans/2026-10-25-codebuddy-model-compatibility.md#新版适配器的单次真实连接通过)；这不代表正式客户端接线、单题/追问或积分扣减已验收。

公网隔离对照是明确忽略的测试，普通 `cargo test` 不联网。仅在要验证当前网络时显式运行：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml harness_codebuddy_container::tests::public_egress_is_denied --lib -- --ignored --exact --nocapture
```

它只向固定官方域名的公网 IPv4 地址进行 TCP 握手，不发送应用载荷；宿主前后成功且容器返回访问拒绝才算通过。DNS 假地址、宿主不通或容器只超时均不能代替隔离证据。详细结果和未验收范围见[原生实施记录](../../docs/superpowers/plans/2026-10-25-codebuddy-native-adapter.md)。

## 桌面账户登录入口

AI 设置的 CodeBuddy 个人账户区域提供登录、重新打开当前授权页、复制链接、刷新、取消和退出。登录仅建立账户会话；组件就绪后由用户主动发起连接测试、单题解析或追问。登录入口不会运行上述 `live` 探针，也不会自动发出模型请求。会话仅留在当前进程，退出登录或关闭应用后清除，重启必须重新登录；Web 页面隐藏该区域。

界面仅调用受控 `codebuddy_control`：登录发送 `{kind:"login",revision:当前已确认修订号}`，其余 `status/open_login/cancel/logout` 仅发送 `kind`。原生端拒绝过期修订的登录，避免排队的旧登录在取消或退出后开始。只有等待授权时轮询；终态清除链接并停止轮询。

登录入口阶段的 release 与隔离测试构建、31 项桌面冒烟均通过，覆盖合成登录、取消、退出、原有配置保全及重启未登录。当时已在正式客户端观察到 CodeBuddy 个人账户登录成功，后续模型探针使用独立登录；该历史窗口已在正式执行交付时关闭，当前新版需要重新登录。详见[登录入口最终验证记录](../../docs/superpowers/plans/2026-10-25-codebuddy-native-adapter.md#登录入口最终验证记录)；账户登录成功不能替代真实模型验收。
