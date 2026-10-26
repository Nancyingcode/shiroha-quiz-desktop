# CodeBuddy 原生适配器实施计划

日期：2026-10-25。依据[已确认设计](../specs/2026-10-25-codebuddy-adapter-containment.md)。用户回复“继续”，授权在既定威胁模型及首期仅内存登录下推进，不重复请求同一设计授权。

## 范围与协作

- 主任务负责整合、宿主/worker 管道协议、受控 HTTP 转发、探针与验证；两个子任务分别维护独立的容器模块和协议校验模块，另一只读子任务核对国内认证与模型路径。同一函数不并行修改。
- 沿用 `codex/desktop-codebuddy-cli-probe`，工作树 `E:/Codex/worktrees/ea83/shiroha-quiz-desktop`，基线 `75cf89388468e966f753be452d5d84afeef781e5`。前轮研究文件仍未提交；本次不提交、不推送、不发布。
- 新原生组件使用现有 Rust crate；仅增加 windows-sys 的必要 Win32 API feature，不增加 Node、Python、SDK 或第三方生产依赖。
- 原生模型执行组件通过内部 `codebuddy-prototype` feature 和显式 example 探针验证，默认构建不启用 CodeBuddy 模型执行入口。后续已授权独立账户面板及受控登录 IPC，范围见“客户端登录入口实施”；现有 API/Codex 执行配置、数据格式和旧执行器保持不变。

## 固定的内部契约

1. 宿主创建单次任务目录与无互联网 capability 的 AppContainer，复制并校验固定 CLI 和自身 worker。原生 CreateProcessW 只继承指定匿名管道，先绑定现有 Job 再恢复主线程。profile 与目录只属于本次任务，错误路径不得回退普通进程。
2. worker 使用同一程序的固定 `--codebuddy-worker` 入口，仅接受 AppContainer 令牌；首帧为宿主提供的有界 JSON。秘密通过管道传入内存；命令行只含固定角色参数。worker 在容器内启动固定 CLI，复用已有进程管理。
3. 容器内 HTTP 服务只允许唯一模型的 `POST /chat/completions`，校验任务能力头与合成 Bearer，禁止工具字段；请求通过管道交给宿主。宿主只开放语义为“本次模型请求”的回调，不接受 CLI 提供的目标 URL 或代理地址。
4. 宿主在调用上游前占用单次预算，原始 SSE 在宿主校验，私有完成证明留在宿主，不接受 worker 回传证明。只有校验成功的原始响应才返回 worker；最后消费证明核对 CLI 完整 JSONL。退出码不能单独产生候选。
5. 每次调用独占管道、预算、证明与取消状态；取消/超时先锁存，再终止 Job、回收管道和 profile。失败或迟到结果不能覆盖取消，也不能借用其他任务的证明。
6. 研究 probe 仅使用合成数据；官方登录与模型出口独立核对固定域名、路径、TLS、401 和内存授权交接。真实账户 token 留宿主，CLI 仅有单任务合成 token。未验收前不声称国内订阅或积分已接通。

## 原生原型阶段执行步骤

- [x] 协议校验移植：先失败回归，再实现 SSE/JSONL 有界解析、单轮关联及不可重复消费证明。
- [x] 隔离启动移植：profile/ACL、显式句柄列表、空网络权限、Job 与失败清理，复用既有进程逻辑。
- [x] 宿主/worker 转发：有界管道帧、固定 HTTP 请求、一次预算、取消优先、上游证明。
- [x] 原生联合探针：固定真实 CLI + 合成上游的正常、EOF、工具、取消、超时和跨任务并行通过；预算重用由单元测试覆盖，Gateway 回环隔离与公网 IPv4 出站分别有原生对照证据。
- [x] 国内认证与模型路径：固定路径组件、合成服务回归及真实个人账户身份核对已完成；真实模型与权益验证继续作为独立验收，不包含在本次身份授权内。
- [x] 原生原型阶段验证并记录：Rust fmt/Clippy/test、全 feature 组合、桌面 npm test/typecheck/lint/build、隔离构建与 smoke 通过，相关文档完成 UTF-8、围栏及链接检查；新增登录入口的联合检查另列于本文末节。

## 验收边界

本机原生假服务通过不替代真实账户、Windows 10、代理/PAC、升级及正式发行验收。AppContainer 不防同用户主动加入同 SID；不设置全局防火墙或回环豁免，不读取已有凭据文件，不修改第三方程序。初始验证只使用合成上游；后续授权依次扩展到个人账户身份核对、受限真实模型请求和独立账户登录入口，各阶段结果分别记录。真实令牌始终留在宿主内存，不传给 CLI。

## 认证路径调查

以下是公开分发的 CodeBuddy CLI **2.175.0 固定版本内部实现证据**，不是厂商承诺稳定的个人订阅认证 API。初始调查只读取隔离研究目录中的厂商 bundle 和产品配置；后续实际执行记录单列于下文。证据位于研究包 `dist/codebuddy-headless.js` 的 `ExternalLinkAuthenticationProvider`、`readLoginEnvelopeCode`、`calculateExpiresAt`、`alignLoginPageUrl`，以及 `product.json`、`product.internal.json`。

国内配置的 endpoint 是 `https://copilot.tencent.com`；继承的平台为 `CLI`、前缀为 `/plugin`，`cli-external-link` 提供器继承上述认证流程。下表的响应均指 HTTP JSON 正文；下列请求头是认证提供器显式设置的部分，不代表已验证服务端必需头的完整清单。

| 步骤 | 固定方法和路径 | 显式请求头与已观察的 JSON 字段 |
| --- | --- | --- |
| 创建登录 | `POST /v2/plugin/auth/state?platform=CLI`，正文 `{}` | `X-Domain: copilot.tencent.com`；四个 `X-No-*` 头禁止注入 Authorization、User-Id、Enterprise-Id、Department-Info；读取 `data.state` 和 `data.authUrl` |
| 等待令牌 | `GET /v2/plugin/auth/token?state=…` | 同一组四个 `X-No-*` 头，不显式设置 Bearer；成功依据为 `data.accessToken` 是非空字符串；等待码 `code: 11217` |
| 等待所选账户 | `GET /v2/plugin/login/account?state=…` | `Authorization: Bearer …`、`X-Domain`，禁止注入 User-Id、Enterprise-Id、Department-Info；读取 `data` 账户；等待码 `code: 12151` |
| 核对账户列表 | `GET /v2/plugin/accounts` | `Authorization: Bearer …`、`X-Domain`；读取 `data.accounts` 数组；厂商把 `pluginEnabled` 为真的账户纳入可用列表 |

四个禁止注入头的完整名字是 `X-No-Authorization`、`X-No-User-Id`、`X-No-Enterprise-Id`、`X-No-Department-Info`，值均为字符串 `true`。账户请求的 `X-Domain` 来自令牌 `domain`，缺失时使用配置 endpoint 的 authority；自有实现不得因此让响应字段改变目标 URL。`AuthStateHeaderComposer` 允许附加头，但该 bundle 未发现它的具体提供器；缺失时返回空对象。登录阶段不继承既有 CLI 会话、企业身份或任意环境自定义头。

轮询间隔为 1 秒，共用从登录开始计算的 5 分钟期限；账户轮询对 HTTP 401/403 最多额外重试一次。等待码可来自正常正文的 `code`，也可来自 HTTP 错误的 `response.data.code`。成功路径未要求固定的成功 `code`，因此不能臆造 `0` 或 `200` 的 JSON 成功码。登录 state 的服务端过期字段及独立过期码未见明确契约；5 分钟是客户端期限。

令牌消费者还使用 `refreshToken`、`tokenType`、`domain`、`expiresAt`、`expiresIn`、`refreshExpiresAt`、`refreshExpiresIn`。源码在绝对到期值缺失且相对时长存在时，计算 `Date.now() + 1000 * expiresIn`；即相对时长按秒、计算所得绝对值按毫秒。不能据此假定每个响应一定返回所有字段，也不能给缺失有效期伪造无限期。首期可不实现刷新：严格接收可验证的有效期，过期或字段不符合约束时要求重新登录。`lastRefreshTime` 是客户端补入的内存时间，不是必需响应字段。

账户消费者使用 `uid`、`type`、`enterpriseId`、`nickname`、`pluginEnabled`、`lastLogin`、`avatarUrl`/`avatar_url`。首期个人账户策略可以明确限制为浏览器最终所选账户的 `type` 去空白后忽略大小写等于 `personal`、`enterpriseId` 为空，并在可用账户列表中找到相同身份；该限制属于自有产品策略。不得静默采用 `accounts[0]`、切到企业账户或根据未知账户类型推断个人身份。

### 登录链接的证据边界

`alignLoginPageUrl` 使用的三个可信 origin 为 `https://www.workbuddy.cn`、`https://copilot.tencent.com`、`https://wb.tencentbuddy.com`。它们用于将已识别的登录站点对齐到实际 API origin，**不是拒绝未知登录域的白名单**：无法识别、解析失败或同 host 的 URL 会原样返回，之后认证提供器交给外部打开器。未找到该流程固定允许的登录路径，也没有证据证明三个 origin 是所有合法 `authUrl` 的全集。产品配置的 `internalDomain` 还包含预发布域，但那是环境分类配置，不能自动成为我们的打开规则。

实际原型采用更窄的打开规则：初始链接只接受 `https://copilot.tencent.com/login`，query 必须为 `platform=CLI` 和与本次 challenge 匹配的 state，拒绝用户信息、非默认端口及额外参数。本次实际初始化符合该规则，浏览器随后跳转到官方 `www.codebuddy.cn/login/` 页面；该浏览器跳转不改变原生 API 出口。固定 API origin/路径、TLS、禁止重定向、响应大小限制与内存凭据共同保持边界；本次成功身份核对不能替代真实模型和权益验收。

### 可独立验证的认证初始化

固定 `POST /v2/plugin/auth/state?platform=CLI` 可以作为独立的无账户初始化验证候选：源码请求正文只有 `{}`，明确禁止注入账户授权和身份，预期返回可解析核对的 `state`/`authUrl`，之后才进入浏览器交互和令牌轮询。该初始化不读取账户、不完成账户授权、不请求模型；它会创建服务端临时登录状态，不能称为无副作用的读取。厂商未公开此内部端点的计费契约，源码只能证明不经过模型调用，不能替服务端保证任何网络操作绝对不计费。

初始化验证范围仅为固定 TLS endpoint 的一次有界请求，禁用重定向，不继承 Cookie、凭据、用户/企业头或环境自定义头；只核对 URL 的 scheme/origin/path 和返回字段类型，不把完整 state/查询参数写入报告。初始调查未执行该初始化；后续主任务已执行并得到 HTTP 200、业务码 0、字符串 state，以及固定 `https://copilot.tencent.com/login` 的授权链接。该单次样本不能证明所有合法登录域或建立任意重定向权限。

## 原生验证记录

- 固定真实 CLI 与合成上游：正常候选只产生一次上游请求；EOF 和工具响应被拒绝；取消、超时均返回对应终态并清理任务目录。两个独立 AppContainer 并行任务分别得到自己的候选，未串用证明。
- 容器令牌实际网络 capability 数为 0；宿主与容器的回环双向隔离、只读程序目录、可写数据目录、显式句柄、Job 后代进程回收均有原生 fixture 覆盖。
- 显式公网探针：对 `www.codebuddy.cn` 解析出的公网 IPv4 `58.251.87.216:443`，宿主前后 TCP 连接成功，容器返回 Winsock 10013，应用数据发送量为 0。IPv6、其他 Windows 版本和代理/PAC 尚未验收。
- 真实 CLI 的首个 SSE chunk 同时含角色与文本时，会在 `message_start` 保存初始快照并在后续 delta 再发同一文本；原生校验器核对快照是最终文本的前缀，不重复累加，仍要求最终文本、assistant、result 与宿主上游摘要一致。
- 取消后的目录回收曾遇到 Windows 瞬时访问拒绝；现在只对 5/32/33/145 进行最长 3 秒的有界重试，每次重新检查目标路径，不改 ACL、不删除工作树外目录、不把永久失败伪装成成功。
- 个人账户登录：用户明确选择“现在验证登录”并在官方页面完成授权。前两次原生核对分别暴露等待态空对象解析和令牌 `domain` 语义误判，临时令牌随失败进程结束释放，未请求模型。修复后再次授权成功：所选账户为 personal、无企业身份，在官方可用账户列表中有唯一匹配的 uid，进程返回成功并主动失效内存会话。报告不记录 uid、昵称、令牌或完整 state。
- `domain` 经厂商实现核对后作为固定 TLS 服务返回的授权上下文头使用：最长 256 字节，仅可打印 ASCII、无空白/CRLF，空值回退固定 authority；它不能改变目的 URL、代理、环境或路径。已增加合成任意上下文头不改变出站目标，以及注入/超长拒绝的回归。
- 截至本节身份核对阶段，真实模型请求数为 0。固定模型出口的 HTTP/JSON 401、会话过期、取消、重定向和响应限长均使用合成服务验证；后续唯一一次真实请求见“用户授权的真实链路验证”，未通过模型结果验收。订阅模型可用性、积分扣减归属和端到端真实题目仍未验收。
- 完整并行回归还发现认证假服务的 Windows socket 时序问题：非阻塞 listener 的 accept 结果仍为非阻塞，单设 read timeout 后可能在首批字节到达前返回 10035 并断连。新增延迟发送测试先复现失败，再让 fixture 的已接受连接显式恢复阻塞；生产网络实现未改，不用串行锁、重试或忽略测试掩盖问题。

### 原生原型与身份核对阶段的检查

下表记录独立登录面板接入前的检查结果，不能作为新增入口的最终构建或窗口验收证据；新增入口的检查进度见本文末节。

| 检查 | 结果 |
| --- | --- |
| `npm test`、`npm run typecheck`、`npm run lint` | 通过 |
| `npm run build` | release 构建通过 |
| `npm run build:test`、`npm run test:desktop` | 隔离桌面冒烟通过；原生数据、原有 Harness、中文扫描 PDF/DOCX/XLSX、离线资源、重启与恢复均通过 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo clippy --all-targets --all-features --offline -- -D warnings` | 通过 |
| `cargo test --offline --all-targets` | 默认并行：193 通过、0 失败、4 忽略；忽略项为两个子进程 fixture、显式公网探针和既有 Windows 假凭据测试 |
| `cargo test --offline --all-targets --all-features` | 通过；覆盖 prototype、native-test 与 custom-protocol 组合，example 同时编译 |
| 真实 CLI + 合成上游 | 最终源码重编译复验六类场景全部通过，包含两个并行任务；任务目录清理后为 0 |
| 真实个人账户 | 此阶段身份核对通过，尚未请求模型；后续单次请求另列 |

桌面冒烟使用隔离 native-test 构建和假服务，不能计作 CodeBuddy 产品界面或真实订阅测试。固定版本内部 API 的维护风险、Win10/IPv6/代理/PAC、积分及正式发行仍待验收。

## 用户授权的真实链路验证

用户后续要求“帮我启动，我先登入，后面你测试相关功能”，授权先交互登录、再验证相关功能。本阶段新增显式 `live` example 入口，身份核对后保留同一进程内存会话，最多顺序请求三次固定合成内容：连通性、单题解析、带已验证上一答复的追问。连通性请求输出上限为 64 token，另两项各为 512 token；首次传输或业务校验失败立即停止，不自动重试。不读取真实题库，不保存令牌，也不启用正式模型执行入口。

执行前以单元测试确认宿主重建的上游正文只有固定合成消息，CLI 的系统提示、环境、工具和其他元数据不进入真实模型请求；每次仍经过容器 CLI、单预算转发与完整 SSE/JSONL 证明。登录与模型使用同一存活 runtime，任务取消/截止包裹真实请求，完成后失效会话。实际模型和积分结果与前述仅身份验证记录分开报告。

本次实际只执行一项连通性请求，默认模型返回 SSE 和 `[DONE]`，但终态为 `length`；响应 usage 显示输入 87、输出 64、总计 151 token。宿主按规则拒绝该结果，单题解析和追问未执行，没有自动重试或切换模型，不能报告真实模型链路通过。此后内存会话已失效。usage 只能证明服务端报告的 token 数，未核对账户积分扣减。诊断结构还包含 reasoning、工具、refusal 等字段名，不能据此断定实际使用了工具；后续须依据字段值和结束语义建立合成兼容样例，不能简单跳过校验。

## 客户端登录入口实施

依据用户“完成登陆入口后再结束任务”的明确授权与设计增补执行。分工：原生子任务只维护 `harness_codebuddy_login.rs`；前端子任务维护独立登录面板、资源生成接线与前端回归；主任务维护 main/lib、固定命令权限、Cargo feature、联合验证和交付记录。沿用当前分支，不提交。

- [x] 原生登录状态机：status/login/open_login/cancel/logout，严格 IPC 校验，固定官方浏览器打开，仅内存会话，取消/退出/过期/新登录的迟到结果隔离。
- [x] AI 设置的 CodeBuddy 账户面板：登录入口、授权链接、状态轮询、重开、复制链接、取消、退出；不启用未验收模型执行。
- [x] 自动回归与隔离桌面验证：真实窗口按钮行为、状态转换、退出及重启未登录，所有适用检查通过。
- [x] 构建并启动含登录入口的客户端，保留用户数据与现有 API/Codex 配置，让用户可在窗口内发起官方登录。

登录控制契约为 `codebuddy_control({request:{kind:"login",revision:当前已确认修订号}})`；其余四个动作只带 `kind`，额外字段、URL、路径和令牌均被拒绝。原生端先比较登录修订，再创建任务；取消/退出递增修订，排队的旧登录即使晚到也不能启动。同次登录的等待与终态可共用修订号，前端另用 generation 和请求序号隔离旧响应。状态只公开 `phase/revision/loginUrl/message/browserOpened/busy` 六字段，终态清除链接。

取消和退出不等待网络或系统浏览器返回。系统已认领的页面打开可能稍后才显示，但旧派发结果不能恢复授权。原生测试覆盖阻塞浏览器时仍可取消、退出，以及过期登录请求不能越过取消；前端新增回归覆盖登录修订冻结、取消后旧成功不复活、再次登录携带新修订，最小 9 项全部通过。

账户入口只建立当前进程内的个人会话，不启动 CLI 或模型请求，不保存到凭据管理器、文件、题库或备份。关闭应用后重新登录，过期后要求重新授权；现有 API/Codex 设置不随账户连接改变。Web 端保持隐藏，native-test 仅使用合成身份。

### 登录入口最终验证记录

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck`、`npm run lint` | 通过 |
| `npm test` 与登录回归 | 前一轮完整回归为桌面 61 项、共享 163 项通过；新增登录修订契约后，前端最小 9 项通过 |
| `cargo fmt --all -- --check` | 通过 |
| 默认与全部 feature 的 Clippy | 均通过，警告视为错误 |
| `cargo test --offline --all-targets --all-features` | 211 通过、5 忽略、0 失败；包含库测试 170 项、集成测试 35 项、example 6 项 |
| `npm run build`、`npm run build:test` | release 与隔离测试构建均通过 |
| `npm run test:desktop` | 31 项全部通过，包含 CodeBuddy 登录、取消、退出、原有配置保全与重启后 `signed_out` |
| 文档检查 | `lint:docs` 通过；本任务全部 7 份变更文档另检 UTF-8、围栏及本地链接 |

桌面冒烟的状态等待已改为 Node 端有截止时间的轮询，取得匹配状态的同一个快照后再断言，避免把异步 Promise 当成状态已满足的依据。上述 31 项结果来自修正后的最终复验；登录成功、取消、退出和重启状态均使用隔离 native-test 的合成身份，不打开真实授权页。

主任务按当前工作树 `target/release` 程序的精确路径启动客户端，并通过持续读取同一真实窗口确认登录入口已打开。实际窗口的 AI 设置中可见 CodeBuddy 个人账户卡片，点击登录后显示“已在浏览器打开官方授权页”；最终检查时仍停留在等待登录的界面，保留当前授权流程供用户继续。旧数据与 Codex 状态仍可见；本次最终窗口检查未复现底部通用存储报错，未据此认定该报错原因已经查明。

本次客户端实测只确认登录入口和官方授权页已启动，真实客户端的授权终态仍待用户手动完成；此前独立探针的身份核对成功不替代这一步。模型执行仍未开放，唯一一次真实模型请求仍为前述被拒绝的 `length` 响应，不能因账户入口和合成冒烟通过而宣称模型链路通过。
