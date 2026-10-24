# GitHub Pages 初始化与故障验收

## 失败记录与复现

2026-10-24 的 [Pages 运行 40072097920](https://github.com/Nancyingcode/shiroha-quiz-desktop/actions/runs/40072097920) 在 `actions/configure-pages@v4` 失败，日志依次出现 `Get Pages site failed`、`Create Pages site failed`、`Resource not accessible by integration`，上传和部署步骤均未执行。

复现条件：仓库尚未启用 Pages，工作流使用默认 `GITHUB_TOKEN` 并设置 `enablement: true`。在隔离的测试仓库满足这些条件后运行相同工作流，即会尝试创建站点并因权限不足失败；不要关闭现有站点来复现。

预期：管理员先初始化 Pages，日常工作流仅上传并部署 `apps/web`。站点初始化和权限由 GitHub 服务端控制，本地测试不能复现其授权结果，必须通过远程工作流验收。

## 一次性设置

1. 仓库管理员打开 **Settings → Pages → Build and deployment**。
2. 将 **Source** 选择为 **GitHub Actions**，完成首次启用。当前仓库入口为 [Pages 设置](https://github.com/Nancyingcode/shiroha-quiz-desktop/settings/pages)。
3. 检查 `github-pages` 环境允许从 `main` 部署。
4. 获得发布授权后，重新运行失败的 Pages 工作流，或将修复合入并推送 `main`。这些操作会发布 Web 站点。

工作流不使用 `enablement: true`：该选项需要默认 `GITHUB_TOKEN` 以外的令牌，单纯增加工作流的 `pages: write` 无法完成首次初始化。不要为此向仓库添加高权限个人令牌。仅修改 YAML 不会启用服务器端站点。

官方说明：[configure-pages 输入要求](https://github.com/actions/configure-pages/blob/main/action.yml)、[自定义 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 验收

- 配置、上传和部署步骤均成功，不再出现创建站点的权限错误。
- 打开部署输出的 `page_url`，确认首页及其脚本、样式正常加载。
- 本地仅能检查 YAML、部署目录与文档；远程运行成功前不得标记为已恢复发布。

## 已完成的恢复验证

2026-10-24 已将当前仓库的发布源保存为 GitHub Actions，并重跑原失败任务。[第 2 次运行](https://github.com/Nancyingcode/shiroha-quiz-desktop/actions/runs/40072097920/attempts/2) 的配置、上传和部署步骤全部成功，发布提交为 `91fe9ce6337fe1ebaf3b356501b9e8d3b9e84b2f`。[线上首页](https://nancyingcode.github.io/shiroha-quiz-desktop/)的样式、图片及默认题库已通过浏览器检查。

该次重跑验证了服务器端初始化已恢复；使用的是原提交的工作流，本文件对应的工作流修改仍须在合入后通过新运行验证。
