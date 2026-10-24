# Codex 第三方组件记录

本目录保留 Shiroha Quiz 受管 Codex 组件的固定来源、许可证和归属说明。运行组件由用户进入 Harness 设置后按需准备，不将二进制提交到源码仓库，也不放入题库或跨端备份。

| 项目 | 固定值 |
| --- | --- |
| 上游 | [OpenAI Codex](https://github.com/openai/codex) |
| 版本 | `rust-v0.163.0` / Codex CLI `0.163.0` |
| 平台 | Windows x64 MSVC |
| 发行资产 | [codex-x86_64-pc-windows-msvc.exe](https://github.com/openai/codex/releases/download/rust-v0.163.0/codex-x86_64-pc-windows-msvc.exe) |
| 文件大小 | `341270320` 字节 |
| SHA-256 | `2692c8c7bb2cf8b0aefe638741fc90236f4b824c59578ce84994f9de58200993` |
| 核对日期 | 2026-10-25 |

[LICENSE](LICENSE) 和 [NOTICE](NOTICE) 来自上游固定标签，保留原始 UTF-8 内容、空白及归属说明，未翻译或修改。对应来源与 Git blob SHA 如下；可用 `git hash-object --no-filters` 逐字节复核：

| 文件 | 上游原文 | Git blob SHA |
| --- | --- | --- |
| LICENSE | [rust-v0.163.0/LICENSE](https://github.com/openai/codex/blob/rust-v0.163.0/LICENSE) | `4606e72e042564097e8780d66c1d4dcb611869bd` |
| NOTICE | [rust-v0.163.0/NOTICE](https://github.com/openai/codex/blob/rust-v0.163.0/NOTICE) | `2805899d56d0332d175cfc613c67d45d6f006db7` |

Shiroha Quiz 不修改官方 EXE。运行时采用本应用的独立配置、受限模型目录与进程管理；这些集成代码和资源的维护责任属于本项目。发行时应保留可读取的 LICENSE、NOTICE 与本来源记录；更新组件须同时复核上游许可、摘要及本项目的协议和工具权限验收，不直接跟随 latest。

操作方式见项目源码中的 `apps/desktop/README.md`，准备和缓存边界见 `docs/superpowers/specs/2026-10-25-managed-codex-runtime.md`。本记录也会随组件保存到运行目录，因此不使用依赖源码目录结构的相对链接。
