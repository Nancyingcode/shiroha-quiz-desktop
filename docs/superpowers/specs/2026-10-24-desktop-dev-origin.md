# 桌面开发来源校验修复设计

用户已批准：仅在调试模式允许 127.0.0.1:51736，补充回归测试并确认 npm run dev 可用。

## 问题与证据

Tauri CLI 开发服务实际使用 http://127.0.0.1:51736/，原生 authorize 仅接受 localhost。
在空白隔离目录运行开发构建，local_initialize 返回 permission_denied，发生在打开数据库之前。
页面因此进入 recovery_required 并保留 inert，导致导航及保存按钮无法使用。

## 最小修复与安全边界

将现有来源判断抽取为私有纯函数，以真实构建模式执行测试。
仅 debug_assertions 为真时，开发来源主机接受 localhost 或 127.0.0.1；协议仍为 HTTP，端口仍为 51736，窗口仍为 main。
发行来源判断保持原样；不修改 capabilities、CSP、IPC 契约、数据目录或凭据处理，不放行其他回环地址、任意端口或远程来源。
这是开发服务兼容修复；若未来取消该开发服务，应同时移除对应开发来源许可。

## 验证

先添加开发来源回归并确认旧逻辑失败，再实现修复。
分别在 debug、release 运行来源测试，覆盖合法打包来源、开发来源、错误协议和端口、远程及伪装主机、非主窗口。
新增 npm run test:dev，通过 npm run dev 启动带 native-test 的调试构建，以临时数据目录、假凭据和隔离 WebView2 profile 检查初始化、导航、保存及重载。
执行现有桌面、Rust、构建和 WebView2 门禁；不使用真实题库或外部收费服务。
