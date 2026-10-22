# 阶段 A2 共享业务与交换格式样本

日期：2026-10-23。全部样本为自建内容，仅在隔离内存中执行，不使用用户存储、题库或真实服务。

本轮记录：Node v24.17.0，23 个测试中 18 个正常通过、5 个已知缺口的执行型 TODO，普通失败 0、跳过 0。所测 `apps/web/app.js` SHA-256 为 `f690f30287054a65ac123e58005de3702b850db5107056d4235f8021295f63cb`；业务源码未修改。此记录不表示 5 个 TODO 已通过。

## 执行方式与边界

在仓库根目录执行：

```powershell
node --test test/dual-platform/business.test.cjs test/dual-platform/format.test.cjs
```

[加载器](../web-source.cjs) 每次读取完整的 [Web 源码](../../../apps/web/app.js)，只在测试副本中把最终 `init()` 替换为固定函数桥接。评分、解析、跨端转换、ZIP 生成与读取均执行真实实现，没有复制这些业务函数，也没有修改生产源码。测试的 DOM 仅提供评分默认值；存储与 FileReader 使用内存替身。意外访问其他 DOM 会直接失败。因没有启动页面，本组不证明 UI、文件选择对话框、浏览器启动、保存反馈或 WebView2 运行通过。

结果应分别报告正常通过和 `TODO`。`TODO` 内的目标断言仍实际执行并失败，Node 将其列为待办且不阻断阶段 A 的特征测试入口；不能将退出码 0 解释为无损迁移、秘密白名单或版本拒绝已实现。B/C 修复对应业务后移除该项 `todo`，保留目标断言成为正式回归。

## 固定样本与逻辑预期

| 样本 | 内容 | 独立预期及用途 |
| --- | --- | --- |
| [dataset.cjs](./dataset.cjs) 的 `webState()` | 2 库共 8 题，首库 7 题、次库 1 题 | 五类题型、多空别名、无答案、Markdown/公式、合法扩展；两个库 `same-id` 分别答案 A/B，不能合并；可作小题库启动/导入/保存固定输入 |
| 同文件的固定 PNG | 同一 1×1 PNG 重复引用 | 题干、选项、解析、结构化 images、错题历史快照、收藏元信息、历史记录都有引用；原生 ZIP 当前仅 1 份共享结构化资产，解压字节必须等于固定 Base64；不代表大图/扫描页性能 |
| 同文件的 `androidBackup()` | 1 库 1 多空题、1 张图片、各 1 条错题/收藏/学习记录 | version 3、schemaVersion 3、crossPlatformSchemaVersion 1，图片 `assets/pixel.png`；Web 读取与再导出需保留 ID、多空别名/作答、4 分得分、错题计数和收藏时间 |
| [dual-questions.txt](./dual-questions.txt) 与 [dual-answers.txt](./dual-answers.txt) | 分离的 3 题题目/答案文本；单选、多选、判断均从题号 1 开始 | 分组/题号/自动三种匹配得到 A、AC、A，题目原输入仍无答案；用于纯文本解析和双文件导入计时对照 |
| [material.txt](./material.txt) | 共享植树材料和 2 道单选题 | 材料分别绑定到两题，答案 A/B、选项独立；用于材料解析和导入计时对照 |

所有文字、ID、时间及 PNG 内容固定。PNG 通过 `PNG_BASE64` 解码成 bytes，不访问网络；测试生成的 ZIP 留在内存，不提交带动态 ZIP 时间戳的二进制。`webState()`/`androidBackup()` 每次生成独立输入；预期由手写题意、字段和常量定义，不用 `normalizeQuestion()` 的有损结果反向生成预期。性能测量应记录调用、机器、版本、样本字节数和多轮耗时；本组仅做正确性验证，没有生成启动/导入/保存性能结论。PDF、扫描中文 OCR 和大文件留给 E1/E3。

## 交换容器与已覆盖语义

| 形式 | 当前容器 | 验证范围 |
| --- | --- | --- |
| Web 完整 JSON | kind=`shiroha_quiz_web_full_backup`，schemaVersion=1，crossPlatformSchemaVersion=1；banks 与 webState/crossPlatform | Web 错题、收藏、记录、设置与元信息往返；原生视图计数、时间、答题详情；题目 ID 按库隔离 |
| 选中单库 JSON | 直接题库对象，含 questions | 无学习数据与设置；类型转换为 SINGLE/MULTIPLE/JUDGE/BLANK/SHORT；可被现有恢复器读取 |
| 选中多库 JSON | exportType=`question_banks`，schemaVersion=1，banks | 库顺序和 ID 保留；无 wrongBook/favorites/records/settings/webState/crossPlatform |
| Web 原生兼容图片 ZIP | backup.json + assets/*.png；kind=`shiroha_quiz_web_native_backup`，version=3，schemaVersion=1 | 实际 STORE ZIP 写入/解析/解压；图片资产字节和引用校验；恢复后检测无缺失结构化图片；题干/结构化图外置，选项与解析仍保留原内嵌 Data URI |
| Android 自建兼容 ZIP | backup.json + assets/pixel.png；kind=`shiroha_quiz_full_backup`，version/schemaVersion=3 | 按 [Android 序列化实现](../../../apps/android/app/src/native/java/com/yiqiu/shirohaquiz/state/QuizRepository.kt) 手写输入，验证 Web 读取并重新导出后的逻辑字段；没有执行 Android Kotlin 运行时或设备 UI |
| 历史输入 | 单库对象、裸题目数组、questionType/title/choices/answerKeys | 题型别名及答案可读；原题号保持；未声称覆盖所有历史版本 |

缺图变体保留 `assets/pixel.png` 且不给 assets，验证未解析计数非零、原路径不被伪装成已恢复图。结构化图片资产一致不证明选项/解析图片已在 Android 渲染，也不证明 ZIP 路径、膨胀、CRC 或重复条目安全边界全部通过。

评分覆盖单选、判断和多选的严格匹配，多空逐位置别名匹配、单空兼容比较、默认分/自定分与答题明细。简答练习实际使用人工自评，本组验证调用评分明细时传入确认结果后的 0/满分，不将文本比较误称为简答自动评分验收。未交卷会话、考试提交事件以及空答案题的 UI 提交限制不在本组范围。

## 敏感信息排除与已知待修复样例

假 AI Key、WebDAV 密码、MinerU Token 和系统凭据引用放入独立内存存储。完整 JSON、单/多题库 JSON、单库序列化、原生 ZIP 的 JSON 及本组转换日志均扫描假值；非敏感 AI 端点允许导出。该检查仅覆盖本组实际执行的转换/解析路径，没有调用真实 API，也不证明其他网络日志的脱敏行为。

| 待办测试 | 预期 | 当前实际 | 后续归属 |
| --- | --- | --- | --- |
| 启动归一化保全 | `upgradeState()` 后题目 `extensions` 与 `richContent` 等于原始输入 | `normalizeQuestion()` 重建固定字段，两个字段丢失 | B2/C3/C6 |
| JSON 题库扩展保全 | 恢复后题库 `extensions` 等于原始对象 | `normalizeBackupPayloadV23()` 丢弃扩展 | B2/C6 |
| 不支持版本 | version/schemaVersion/crossPlatformSchemaVersion=999 时明确拒绝 | Web 恢复器接受输入 | B2/C6 |
| 设置秘密白名单 | 混入 `settings.legacyCredentials` 的假值全部排除或拒绝 | 完整 JSON 直接导出 settings，包含假值 | B4/C6 |
| 导出不修改状态 | 生成原生 ZIP 后整份内存状态与导出前深比较相等 | 已删除题目的错题/收藏回退快照共用引用，图片 localPath 被改成 ZIP 的 assets 路径且 dataUrl 删除 | B4/C6 |

最后两项是输入保全/敏感边界缺口，阶段 A 不通过删除字段、伪造输出或改业务掩盖。新增契约校验通过也不能替代后续 B/C 将它接入真实导入、存储与导出路径。
