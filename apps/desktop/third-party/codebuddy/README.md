# CodeBuddy 第三方组件记录

本目录记录 Shiroha Quiz 受管 CodeBuddy Code 组件的固定来源及已取得的许可文本。用户在 Harness 设置中按需准备组件，运行缓存与 Codex 分开；二进制不提交到源码仓库，也不进入题库或跨端备份。

| 项目 | 固定值 |
| --- | --- |
| 上游 | [腾讯 CodeBuddy Code](https://cnb.cool/codebuddy/codebuddy-code) |
| 版本与平台 | `2.175.0`，Windows x64 |
| 官方发行资产 | [codebuddy-code_Windows_x86_64.zip](https://acc-1258344699.cos.accelerate.myqcloud.com/@tencent-ai/codebuddy-code/releases/download/2.175.0/codebuddy-code_Windows_x86_64.zip) |
| 归档大小 | `94855403` 字节 |
| 归档 SHA-256 | `0e9c39f1af4639d63f6aadccc5075233e6d8e4c571c3941c93f5fad81d33d4d4` |
| 安装成员 | 根目录 `codebuddy.exe` |
| EXE 大小 | `182874624` 字节 |
| EXE SHA-256 | `bc404638e5e55af4030f93ed73dadc68a7ca2b7eb5df6613b07ab3510061b309` |
| 核对日期 | 2026-10-25 |

固定 ZIP 共 29 个成员。本应用仅解出原样的 `codebuddy.exe`，不安装其余 28 个 `vendor/` 下的 sandbox、删除工具及脚本。先校验完整归档，再按固定版本的成员头和压缩区间解码；同时限制解压长度并核对 EXE 摘要。缓存位于应用私有根目录的 `runtime/codebuddy/2.175.0/`，不执行官方安装脚本，不跟随 `latest`。

[LICENSE.txt](LICENSE.txt) 来自官方同版本 npm 包 [@tencent-ai/codebuddy-code 2.175.0](https://registry.npmjs.org/@tencent-ai/codebuddy-code/-/codebuddy-code-2.175.0.tgz)，保留原始文本和空白，未翻译或修改。文件为 1062 字节，SHA-256 为 `fc68abd7dfba71c364455b155afbf69ae2684350e163248f6069d8e6fd380c26`，内容是 Tencent Cloud 的 MIT 许可文本。

原生 ZIP 没有独立 LICENSE 或 NOTICE。npm 的 `package.json` 标注 `SEE LICENSE IN README.md`，而该包 README 没有许可章节。因此这里记录的是实际取得的同版本 npm 许可文本，不表示原生二进制所含全部第三方依赖、服务条款或第三方嵌入条件已经完成核对。发行验收应保留这一范围，后续取得原生分发许可材料时补齐来源及归属记录。

准备流程将本记录和 LICENSE.txt 同步保存到组件缓存，方便离线查看。组件更新须重新核对官方来源、归档及 EXE 摘要、固定解压布局和协议隔离验证。
