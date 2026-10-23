# 桌面开发来源修复实施计划

依据[已批准设计](../specs/2026-10-24-desktop-dev-origin.md)，在实际故障工作树 4376 实施，不提交或推送。

- [x] 抽取不改变行为的私有来源校验函数，添加 debug/release 边界测试并记录红灯。
- [x] 仅在调试模式增加精确开发来源主机 127.0.0.1，运行最小回归。
- [x] 添加可重复的 npm run test:dev，验证隔离开发启动、导航、保存和重载。
- [x] 完成 npm test、typecheck、lint、cargo fmt/clippy/test、release 来源测试、build、build:test、test:desktop。
- [x] 检查全部变更文档的 UTF-8、围栏与链接，记录验证结果和实际覆盖范围。

## 验证记录（2026-10-24）

- 红灯：新增来源回归在 http://127.0.0.1:51736/ 上失败，其他三组权限测试通过。
- 绿灯：修复后 debug 与 release 各四组来源测试全部通过，release 仍拒绝两个开发来源。
- npm test：桌面 39 项、共享 70 项通过；typecheck、lint（含 lint:docs）通过。
- Rust：fmt、Clippy（all-targets 且警告视为错误）通过；cargo test 共 45 项通过，1 项既有 Windows 凭据实测按原配置忽略。
- npm run test:dev：7 项通过。实际使用 npm run dev 加 native-test 和 no-watch，来源为 http://127.0.0.1:51736/，原生初始化成功、inert 解除、三页导航可用，保存修订 0 → 1，重载仍为 1，无页面异常或外网请求，隔离目录已清理。
- npm run build、npm run build:test 成功；npm run test:desktop 共 26 项通过。
- README、本设计和本计划完成 UTF-8、围栏和本地链接校验，差异无空白错误。

本次仅验证隔离数据和假凭据，不对真实题库、真实服务或实际 Windows 凭据迁移作验收声明。
修复位于 4376 工作树，未提交或推送；原有自动生成权限文件的换行差异未清理。
