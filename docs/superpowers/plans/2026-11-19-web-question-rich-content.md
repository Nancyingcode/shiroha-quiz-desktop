# 题目富文本和图片拆分实施计划

2026-11-19。以本地 `main` 的 `4d491b3` 为基线，在 `C:/Users/30728/.codex/worktrees/3bc4/shiroha-quiz-desktop` 的 `codex/web-question-rich-content` 分支执行第二批，负责人为当前会话。[第二阶段设计](../specs/2026-11-19-web-directory-app-split.md)

## 1. 固定现有行为

- 用长解析覆盖截断点落在内嵌图片数据中的情况，通过归一化结果核对公式、图片完整性和源题不变。
- 从实际 Web 导入、题目详情和备份按钮验证同一自建题的富文本与图片。对比预览图片顺序、导出图片去重结果、公式及备份版本。
- 沿用备份序列化已有用例，覆盖显式空图片数组、图片字段缺失、无效媒体和旧 Android JSON/ZIP 往返。在桌面生成用例先登记拟迁入的脚本路径，复现目录资源未接线。

## 2. 迁移纯计算并接线

- 将 `pickRichTextFieldV57` 至 `exportQuestionImagesForCrossExportV83` 的函数和富文本格式版本移入 `apps/web/questions/rich-content.js`。模块沿用本地经典脚本，供解析器、题目和题库视图、AI 解析保存及备份通过现有接口调用。
- 由 `app.js` 装配模块，并由现有跨端序列化入口决定图片字段的保留或删除。迁移时保留兼容顺序、正则、占位文本、限制值和输入所有权。
- HTML 加载顺序、桌面资源清单、测试桥接和文件级 lint 同批接通。桌面使用首批已有的嵌套资源允许列表。

## 3. 验证

- 先跑业务、备份格式、源码加载和桌面资源定向回归。再执行 typecheck、全量 lint、桌面和共享单测、Web 平台与文档导入回归。首批遇到并发超时的套件采用低并发重跑原范围。
- 串行准备桌面资源和构建正式版、隔离测试版。核对脚本字节及加载顺序，用隔离 WebView2 制品实际验证 DOCX 图片和公式的导入与重载，并确认其他桌面回归通过。

## 实施记录

- 迁出 18 个具名函数。入口从 6,068 行降至 5,825 行，直接声明的具名函数从 232 个降至 214 个。原有 200,000 字符限制归入模块内的具名常量，迁移前后的函数体比对确认其余逻辑一致。[应用入口](../../../apps/web/app.js) · [富文本与图片模块](../../../apps/web/questions/rich-content.js)
- 拆分前的长解析和 Web 导入、详情、备份用例通过。目录资源回归在新脚本加入出包清单前因目标文件缺失而失败，接线后资源测试 24 项通过，涵盖实际产物的脚本顺序、字节和未登记脚本的过滤。
- 业务、旧备份格式和加载顺序的定向回归 71 项通过。typecheck 与全量 lint 通过，lint 检查 170 份手写 JavaScript，规则回归 84 项通过，1 项按文件系统环境跳过。
- `pnpm run test:web-platform` 234 项通过，包含 HTTP 富文本题导入、公式实际排版、两图顺序与去重、原数据保全及 `file://` 加载。另执行 `pnpm run test:documents`，浏览器文档导入回归通过。
- `pnpm run prepare:web`、`pnpm run build` 和 `pnpm run build:test` 串行通过。生成脚本与 Web 源文件的 SHA-256 一致。隔离 WebView2 冒烟 44 项通过，包括 DOCX 图片和公式的实际导入、保存及重载。
- 根据首批的并发超时记录，在 `apps/desktop` 以 `node --test --test-concurrency=2` 分别运行 `test/*.test.mjs` 和 `../../test/dual-platform/*.test.cjs`。桌面 278 项通过，1 项按文件系统环境跳过。共享 504 项通过。
