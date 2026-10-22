# 阶段 A4：依赖决策记录

核对日期：2026-10-23。阶段 A 未新增生产依赖，两个锁文件不变。仅按既有 `package-lock.json` 执行 `npm ci --ignore-scripts --no-audit --no-fund`，随后 `npm ls --depth=0` 验证完整性。第一次沙箱安装异常退出，确认本次安装进程已结束、没有项目占用后，在正常本机环境重装成功。

## 1. 当前可复现基线

- npm：CLI 2.12.4、TypeScript 7.0.2、ESLint 10.13.0、`@eslint/js` 10.0.1、`@types/node` 24.19.2、`playwright-core` 1.64.1，来自现有锁文件。
- Cargo：应用 edition 2021，Tauri 2.12.5；锁文件已有传递依赖 `reqwest` 0.13.5，但应用没有原生 HTTP 命令。
- 阶段 A 校验仅用 Node 内置模块和已有工具；静态 Web 没有新增安装或打包要求。浏览器类型环境与 Node 脚本环境分开。

## 2. 后续采用方向

以下是按职责选定的候选和接入条件，不代表已经安装、完成适配或授予页面权限。具体依赖写入清单时，重新核对精确版本、feature、传递许可与当前工具链，记录实际锁定结果。

| 能力 / 阶段 | 选择与理由 | 许可、维护和体积影响 | 接入前必须验证 |
| --- | --- | --- | --- |
| SQLite / C3、C6 | 优先 `rusqlite` 0.40.2，按需启用 `bundled`、`backup`；Rust 独占连接，业务命令不暴露 SQL。适合单写入者与一致性快照，不引入 ORM | MIT；上游有版本发布与维护记录。bundled 编译 SQLite，增加原生编译和 EXE 体积，增量在接入前后同配置实测。不开 `bundled-full` / 动态扩展 | 事务、busy timeout、WAL 快照和中断恢复；该版本清单未声明 rust-version，须用项目工具链实际编译，不凭 edition 推断 MSRV |
| HTTP / D3、D4 | 优先复用已锁定的 `reqwest` 0.13.5，长生命周期 Client 复用连接；限定 AI/WebDAV 服务操作。关闭默认 feature 后仅开启所需 TLS/JSON/流式限额能力 | MIT OR Apache-2.0；Rust 1.85+。HTTP/TLS feature 会扩大依赖图和产物；具体 TLS 后端在 D 阶段通过 Windows 证书链测试确定，不提前引入两套后端 | 逐跳重定向、超时、取消、响应限额、TLS 失败；不能提供页面可选任意 URL/方法/鉴权头的代理 |
| Windows 凭据 / D2 | 优先 `keyring-core` 加 `windows-native-keyring-store` 1.1.0；避免引入全平台 CLI 聚合包。关闭默认 `search`，按明确绑定查取 | Windows store 为 MIT OR Apache-2.0，Rust 1.88+；新增库依赖 windows-sys/zeroize。上游已拆分 store，需关注后续 API 变更；禁用 search 可免去其 regex 依赖 | fake provider 和独立测试命名空间先完成；明确使用本机持久化，避免默认 Enterprise 语义；未记住只在内存，端点/账号变化不能继续使用旧秘密 |
| 前端桥接 / B1、C2 | 使用官方 `@tauri-apps/api/core` 的 `invoke` 和事件接口，保持 `withGlobalTauri: false`；只在桌面桥接打包 | Tauri 包许可 Apache-2.0 OR MIT。精确 API 版本在接入时与已锁定 Tauri 2 对照；桥接只含用到的模块，不扩大 Web 包 | 业务命令 allowlist、窗口范围、参数验证、事件清理、无裸模块和远程脚本；前端类型不替代 Rust 验证 |
| 桌面桥接打包 / B1 | 若需要 npm 模块，使用 esbuild 的浏览器 bundle 输出本地普通脚本；只打包桥接，不迁移整页 | 构建期候选，尚未选定版本或安装。其原生可执行文件增加开发依赖，不随应用作为运行时进程分发；加入前核对精确发行包许可和 Node 支持 | 输出不含运行时 eval、远程 import、Node API；记录 bundle 字节数；资源准备脚本保留安全清理与源目录不变断言 |
| 文件对话框 / C5 | 优先官方 Tauri dialog 的 Rust 侧 API；选择结果封装为窗口/会话/用途绑定的令牌 | 插件版本与 Tauri 2 对齐后再锁定；按届时精确清单核对许可及依赖。只增加所需对话框实现 | 不直接给前端通用 fs/shell/HTTP 权限；原生层核验真实路径、junction、覆盖确认、临时文件与替换失败保全 |

SQLite 候选依据：[0.40.2 清单](https://raw.githubusercontent.com/rusqlite/rusqlite/v0.40.2/Cargo.toml)、[一致性备份接口](https://docs.rs/rusqlite/0.40.2/rusqlite/backup/index.html)。HTTP 候选依据：[0.13.5 清单](https://raw.githubusercontent.com/seanmonstar/reqwest/v0.13.5/Cargo.toml)、[Client 文档](https://docs.rs/reqwest/0.13.5/reqwest/)。

凭据候选依据：[Windows store 1.1.0 清单](https://raw.githubusercontent.com/open-source-cooperative/windows-native-keyring-store/v1.1.0/Cargo.toml)、[持久化与命名规则](https://docs.rs/windows-native-keyring-store/1.1.0/windows_native_keyring_store/)、[Keyring 4 的拆分说明](https://docs.rs/keyring/4.2.0/keyring/)。桥接与构建依据：[Tauri 调用 Rust](https://v2.tauri.app/develop/calling-rust/)、[原生对话框](https://v2.tauri.app/plugin/dialog/)、[esbuild 浏览器打包](https://esbuild.github.io/getting-started/#bundling-for-the-browser)。

## 3. 安装与变更记录要求

安装前按命令行、工作目录或可执行文件路径核对项目进程。仅停止已确认属于当前工作树的进程；不能为了 Windows 文件锁结束其他项目的 Node/WebView2。安装后检查依赖完整性、锁文件差异、类型/lint/测试/构建，原生能力还需相应隔离测试。

不为阶段 A 预装 SQLite、HTTP、凭据、dialog 或打包器；不升级 Cargo edition，不调整应用标识，不新增原生 capability。安装候选的编译结果、体积、Win10 下限和实际权限验收属于其接入阶段，当前不作通过承诺。
