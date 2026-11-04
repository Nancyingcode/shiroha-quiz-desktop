# 历史 Android 解析样例

2026-11-05 随 Android 工程退出维护，从 `test/native-parser-regression/` 原样保全。

这里是历史参考数据，**不是当前 Web 解析器通过清单**。`manifest.json` 保存 69 个用例的输入、预期路径和风险说明；`samples/` 为原文，`expected/` 为旧 Kotlin 解析器的预期结果。文件字节与删除前基线一致。

删除前源码及运行器见 [f7e1b27 的原目录](https://github.com/Nancyingcode/shiroha-quiz-desktop/tree/f7e1b2765b5fd16a7230ca738dc0eebca0658deb/test/native-parser-regression)。当前树不再提供 Kotlin Runner、Gradle 或 PowerShell 执行入口，不需要安装 Android SDK/JDK。

Web/Windows 的有效回归入口为 [test/dual-platform](../../dual-platform/README.md)。旧 Android JSON/ZIP 的兼容样本与可执行断言仍在 [format.test.cjs](../../dual-platform/format.test.cjs) 和 [contracts.test.cjs](../../dual-platform/contracts.test.cjs)。不要将旧 Kotlin 的预期直接当作 Web 的能力承诺。
