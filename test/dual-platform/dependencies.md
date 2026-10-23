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

## 4. 阶段 C 实际接入

本轮已在说明用途后添加 `rusqlite =0.40.2`（仅 bundled、backup）、`rfd =0.17.2`（关闭默认 feature）、serde/serde_json、sha2 0.10、base64 0.22 和 uuid v4；精确解析结果保存在 Cargo.lock。SQLite 用 C 库随 EXE 编译，无 ORM 或可加载扩展。使用 rfd 的 Rust API 直接取得系统选择结果，原因是只需内部文件选择，无需给页面安装通用 dialog/fs 插件代理；MIT 许可，Windows 使用原生对话框，不启用 Linux portal 依赖。该选择替代上表的候选 dialog 插件，仍需人工系统对话框验收。

桌面构建添加 `@tauri-apps/api =2.12.4`（Apache-2.0 OR MIT）、`esbuild =0.28.2`（MIT），均固定版本；只打包官方 invoke 和当前窗口 API，Web 静态入口不新增构建要求。本地 bridge.js 为 92,490 字节，保留许可注释；esbuild 的开发二进制不作为应用后台进程分发。现有 Node 24、Rust 1.99.1/MSVC 工具链已通过编译；不据此承诺最低 Rust 或 Win10 环境验证。

新增依赖会增大原生制品与开发目录。本轮正常 release EXE 为 62,165,504 字节，测试 feature 的 release EXE 为 62,144,512 字节，均包含现有离线资源；未保存同配置的旧原生制品作体积对照，因此不报告体积增量或性能收益。D 阶段 HTTP/凭据候选均未接入。

## 5. 阶段 D 实际接入

采用已锁定 `reqwest =0.13.5`（关闭默认功能，仅 native-tls、json）、`url =2.5.8`、`quick-xml =0.42.0`、Tokio 的 time/sync/macros，以及 Windows 专用 `windows-sys =0.61.2` 的 Credentials/Foundation API。reqwest、url、Tokio 为 MIT OR Apache-2.0，quick-xml 为 MIT，windows-sys 为 MIT OR Apache-2.0。Cargo.lock 记录新增 TLS 传递依赖；npm 锁文件不变。

凭据实现用现有 windows-sys 直接封装 CredReadW/CredWriteW/CredDeleteW，替代阶段 A 的 keyring 候选，避免额外跨平台注册层。固定本机持久化，接口由 fake provider 覆盖，unsafe 边界注明内存所有权与释放要求。HTTP 使用 Windows 系统 TLS，禁用自动重定向和代理，手工校验每跳；不新增通用 HTTP capability。XML 解析拒绝 DTD 并逐项校验 href。

本机 MSVC 编译和随机命名空间 Windows provider 回归通过；未据此宣称最低工具链、独立用户或 Win10/Win11 全矩阵通过。制品体积与最终检查记录见同目录 README 的阶段 D 节。
