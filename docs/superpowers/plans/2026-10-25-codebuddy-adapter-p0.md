# CodeBuddy 自有适配层补救 P0

日期：2026-10-25。对应[补救研究与设计](../specs/2026-10-25-codebuddy-adapter-containment.md)。用户要求继续研究自己的适配层；本轮已实现独立研究工具，未修改正式 Harness。

## 结论

**适配层能解决已复现的终态误判和额外上游请求；AppContainer 能阻止普通宿主直接访问 CLI 的本地 Gateway。** 这些能力不再全部依赖上游修复，但不等于真实订阅与正式发行已经验收。隔离不能抵御同用户主动加入同一 AppContainer 身份的程序，设计必须明确这一威胁边界。

## 1. 重新核对 stdout 后的修正

前轮摘要显示过滤场景的 result 与正常结果相同；本轮检查整个事件序列发现，过滤场景的最终 assistant 已变为拒答文本，而流文本与 result 仍是原 JSON。因此“三份正文一致”检查能拒收这个样例，无需硬编码拒答文案。

正常 stop、文本后 EOF、只有 `[DONE]` 三个场景则不同：归一化随机 ID（保持相等关系）、时间、耗时和 cwd 后，全部 10 个 stdout 事件完全相同，stderr 也为空。stdout 无法恢复丢失的上游完成证据，必须在 CLI 转换前核对原始响应。

## 2. 转发层与结果适配器

链路为：

```text
固定 CLI → 本任务受控转发器 → 本机假上游
             ↓ 完整原始 SSE 证明
CLI JSONL → 单轮状态机/正文一致性 → 传输候选
```

实现保存在 `test/codebuddy-cli-stdio/guard.mjs`，只支持测试用的固定回环上游，不含生产网络或凭据逻辑：

- 第一条请求在 await 网络前占用预算；后续请求一律本地拒绝。并发竞争测试确认三次合法请求中只有一次到达上游，另两次返回 409。
- 精确允许 `POST /chat/completions`、指定模型、stream 模式和随机能力头；拒绝未知路由、工具请求字段、非成功 HTTP、重定向和超限响应。
- 完整缓冲 SSE，要求唯一 choice、连续一致的 completion ID、正常 stop、`[DONE]`、无工具/错误/结束后数据。原始 UTF-8、响应大小和超时有界。
- 独立 proof 保存在转发器实例内，记录正文摘要。宿主严格核对单轮 JSONL 顺序、session/request/modelRequest 关联、流文本/assistant/result 一致性及取消状态。
- 关闭转发器或下游提前断连会取消上游；取消状态锁存，迟到内容不能重新变成 verified。

accepted 只证明传输候选一致且有完整上游结束证据；没有取代现有业务 JSON/schema、题目指纹和人工采纳规则。此 P0 不提供可由前端提交的证明对象，也不宣称已验收生产跨任务重放边界。

## 3. 真实 CLI + 假上游结果

使用与前轮相同 SHA-256 的 CodeBuddy Code 2.175.0，无厂商修改。最终十场景记录在 `.reports/codebuddy-cli-stdio/run-guarded-1792875495145/`：

| 场景 | 原直连上游请求数 | 经转发器后 | 采纳判定 |
| --- | --- | --- | --- |
| stop | 1 | 1 | 完整文本可作为传输候选 |
| length | 4 | 1 | 拒收 |
| content_filter | 1 | 1 | 拒收 |
| EOF | 1 | 1 | 拒收 |
| 仅 `[DONE]` | 1 | 1 | 拒收 |
| 非法 SSE JSON | 3 | 1 | 拒收 |
| Write 工具响应 | 2 | 1 | 拒收，目标文件未生成 |
| 宿主取消 / 超时 / interrupt | 每项 1 | 每项 1 | 取消锁存，上游连接在假服务清理前关闭 |

六个异常响应经转发器返回 422，实际 CLI 本次没有再次向转发器发送纠错请求；不能据此声称所有版本和错误都不重试。真正的单次上游保证来自请求前预算，以及单独的并发测试。

额外假平台 Token 场景位于 `.reports/codebuddy-cli-stdio/run-guarded-1792875483371/`：删除 `CODEBUDDY_API_KEY`，设置合成 `CODEBUDDY_AUTH_TOKEN`，CLI 仍完成请求，转发器收到匹配的 Bearer 头。只记录匹配布尔值。这验证了该固定代码路径不强制要求 API Key，**没有证明真实国内订阅登录、模型权益或扣分归属**。

## 4. AppContainer 原生隔离

测试在本机 Windows 11 `10.0.26200`、普通未提升用户令牌下进行。工具使用 require_escalated 是离开 Codex 沙箱，不是 Windows 管理员提权。使用每次唯一 profile/SID、临时实验目录和最小目录权限；capabilities 为空，未修改全局防火墙、LoopbackExempt 或系统信任，未修改厂商 EXE。

最小 fixture 证明同 profile 进程间回环可用、普通宿主直接连接超时、另一独立 profile 连接超时。进一步实测：同用户宿主仅凭 profile 名 Derive SID，再启动同 SID 进程，可成功访问。因此这是容器网络边界，**不是同用户恶意代码的强身份边界**。证据：`.reports/codebuddy-appcontainer-p0/run-3f96a272cba047c8add233eb8b274b7b/report.json`。

真实 CLI 初次在 Bun 原生模块加载时报错。仅将 `BUN_TMPDIR`、`TMPDIR` 指向专用实验目录并设置 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` 后成功，无需改厂商包或放开系统目录。证据：`.reports/codebuddy-appcontainer-p0/run-beb627e4519a42c7be5f1fa858ecdb2f/report.json`：

- CLI 与假模型服务均核对 `TokenIsAppContainer=true`。
- 同 profile 假模型收到 `POST /chat/completions`，CLI 返回完整 `{"ok":true}` 并退出 0。
- CLI 确实监听 `127.0.0.1`；同 profile 观察者访问 `/api/v1/info` 得到 200，访问无服务 ID 的服务代理入口得到 200/MISSING_SERVICE_ID。
- 宿主直接访问上述两路由均超时，排除了“服务没有启动”的假阳性。
- 实验子进程清理完成，profile 删除 HRESULT 为 0；25 个非 EXE 合成文件扫描假 Key 命中为 0。扫描范围不等于整机无落盘证明。

原生实验源码与报告位于忽略目录 `.reports/codebuddy-appcontainer-p0/`，没有进入产品；其临时目录 ACL 与 Low 完整性标签仅作用于实验目录。

## 5. 尚未替代的门槛

1. CLI 模型 URL、动态配置及后台请求可能优先于 BASE_URL。转发器存在不等于出口不可旁路。正式方案应限制 CLI 的网络能力，仅允许受控组件访问上游，再验证真实登录和模型访问所需路径。
2. 官方模型 URL 被改写为本地转发器后，401 的自动刷新行为可能改变。不能假定旧认证拦截器仍会正确刷新；必须明确过期后重新登录或实现受控刷新。
3. 同用户主动加入同 SID 的威胁未被解决。如果产品要求抵御这类主动代码，需要更强的独立账户/虚拟机/受信服务边界，不能仅加代理或随机 profile 名。
4. 本机 Windows 11 通过不代表 Windows 10、干净系统、代理/PAC、证书、安装升级和正式 Job/恢复屏障均已验收。
5. 本报告的 Node 研究阶段未登录真实账户、未消费积分、未加入生产 Node 或 SDK 依赖、未启用正式执行器。后续原生实现已完成用户授权的个人账户身份核对，仍未请求真实模型，见[原生实施记录](./2026-10-25-codebuddy-native-adapter.md)。

## 6. 联合验证与交付检查

AppContainer 与受控转发器的联合 stop/eof/tool 场景已通过，汇总在 `.reports/codebuddy-appcontainer-p0/joint-verification.json`：

| 场景 | 证据目录 | 结果 |
| --- | --- | --- |
| stop | `run-ec82231af6494bcdb452499b7b941f0b` | proof verified、stop 和正文摘要匹配，传输候选通过 |
| eof | `run-0c9b2c2b739c44fbb426ccd80d66256b` | proof rejected，CLI 返回执行错误，候选拒收 |
| tool | `run-2fbb8fe6b2f54129ab0aa866e9e95cff` | proof rejected，CLI 返回执行错误，候选拒收 |

三项上游均只收到一次请求；Node 和 CLI 均核对为 AppContainer 令牌，普通宿主访问 Gateway 两路由被阻止，同 profile 观察者可达。三个 CLI 退出码都为 0，判定依据始终为 proof 与完整事件，未误用退出码。每项 29 个非 EXE 文件的假凭据扫描零命中，随机能力值仅存在测试握手文件 `relay-ready.json`，没有进入 CLI 配置/日志。所有 profile 删除 HRESULT 为 0，所属 Job 进程清理完成。

Node 测试部署需要 `--preserve-symlinks`、`--preserve-symlinks-main`，避免 realpath 扫描没有权限的磁盘根目录；没有为此扩大根目录 ACL。这个设置只适用于本轮 Node 测试部署，正式原生 worker 不因此引入 Node 依赖。联合实验使用的 guard SHA-256 为 `d04ec9a31562341ce1624a4f7fcde75a3696c0599b6444339678fd25b7675ce4`，与本工作树文件一致。

28 项专项回归通过，覆盖原始 SSE、UTF-8/容量、一致性、工具事件、错误关联、重复/迟到终态、并发预算与关闭传播。先运行失败回归，修复消息开始/最终 assistant 的工具信号遗漏及取消锁存后转绿。10 场景 guarded 验证断言通过，可复现入口见[工具说明](../../../test/codebuddy-cli-stdio/README.md)。项目 `npm test`、`npm run typecheck`、`npm run lint` 通过，专项脚本另按项目 ESLint 配置检查；本轮没有依赖清单或锁文件变更，也没有生产代码或构建配置变更，不声称完成原生产品构建与发行验收。

本轮新建/变更文档另检查 UTF-8、围栏、本地链接和差异；不提交、不推送、不发布。用户随后已确认[具体原生实现增补](../specs/2026-10-25-codebuddy-adapter-containment.md#建议的正式实现增补已确认)，后续进展见[原生实施记录](./2026-10-25-codebuddy-native-adapter.md)；本研究 P0 不等于账户/网络/产品验收全部通过。

官方一手依据：[CLI 环境变量](https://www.codebuddy.cn/docs/cli/env-vars)、[SDK 参数](https://www.codebuddy.cn/docs/cli/sdk-typescript)、[Windows AppContainer 实现](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)、[回环限制](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/troubleshooting-uwp-firewall)。文档是候选依据，以上通过项来自明确列出的本机实验。
