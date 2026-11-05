# WebDAV 请求回归

运行前需具备项目要求的 Node.js 24+，并已按 `apps/desktop/package-lock.json` 安装桌面开发依赖。共享[源码加载器](../dual-platform/source-tools.cjs)复用该处锁定的 ESLint 解析语法节点，避免引号、空白或分号变化影响函数定位；因此本入口不再支持仅有 Node 18、未安装桌面依赖的独立运行方式。没有新增 npm 包，但这里新增了对既有桌面开发依赖的运行前提。

准备依赖时遵守[根规范](../../AGENTS.md#6-依赖规则与-git)中的项目进程占用检查要求；已有依赖时不必重新安装。在仓库根目录运行：

```powershell
node --test test/web-webdav/request.test.cjs
```

测试读取 Web 端实际请求与诊断函数，使用模拟 fetch，不访问真实服务，不使用真实凭据。

覆盖 #131：HTTPS 页面请求 HTTP WebDAV 时确实调用 fetch；成功响应正常返回；网络失败只推断可能的混合内容拦截；超时和 HTTP 状态码保持原有诊断；定时器在各路径均清理。

这些测试验证应用行为。浏览器是否允许混合内容、服务端 CORS 配置和真实服务连通性仍以使用环境为准。
