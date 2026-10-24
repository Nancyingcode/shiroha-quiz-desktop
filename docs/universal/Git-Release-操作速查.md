# Git & Release 操作速查

## 日常协作入口

分支起点、任务提交和多工作树整合以[协作开发分支规划](./协作开发分支规划.md)和[根开发规范](../../AGENTS.md)为准。先在任务分支完成实现与验证，再按授权提交和整合；不把每次修改视为自动提交或推送授权。

开始前可以先做以下只读核对：

```powershell
git status --short
git branch -vv
git worktree list
```

推送 `main` 会触发 Web 自动部署。下文的标签、Release 和撤销命令仅供对应任务查阅，需要独立授权并核对当前环境；它们不属于日常开发的必执行步骤。

---

## Commit 类型速查

| 类型          | 用途       | 示例                            |
| ----------- | -------- | ----------------------------- |
| `feat:`     | 新功能      | `feat: Android WebView 壳方案落地` |
| `fix:`      | 修复 bug   | `fix: 修复选项错位`                 |
| `style:`    | UI/样式调整  | `style: 调整刷题页面布局`             |
| `docs:`     | 文档修改     | `docs: 更新 README`             |
| `chore:`    | 配置/忽略等杂项 | `chore: 更新 .gitignore`        |
| `refactor:` | 重构       | `refactor: 拆分题库解析模块`          |

---

## 版本号规则

本项目使用三条并行的版本线：

| 版本线 | 格式 | 适用场景 |
| --- | --- | --- |
| 双端统一 | `v2.X.Y-beta` | 双端同时发布（含 APK + Web ZIP） |
| Web 版 | `v0.X.Y-alpha` | 仅 Web 端变更 |
| 原生 Compose 版 | `v0.X.Y-native` | 仅原生端变更 |

变更级别与位数对应：

- **第四位**（`v0.9.9` → `v0.9.9.1`）：小修复、文档微调
- **第二位**（`v0.9.9` → `v0.9.10`）：功能级变更
- **第一位**（`v0.9` → `v0.10`）：架构级变更

---

## 创建标签（Tag）

Tag 是 Git 层面的版本标记，独立于 Release。

```powershell
# 创建标签
git tag -a <tag> -m "<tag>"

# 推送标签到远端
git push origin <tag>

# 查看已有标签
git tag -l
```

---

## 创建 Release（基于已有的 Tag）

Release 是 GitHub 层面的发布，可以附带说明和附件。

### 方式一：一步到位（推荐）

创建 tag + 创建 release + 上传附件，一条命令搞定：

```powershell
gh release create <tag> "./apps/压缩包.zip" "./apps/xxx.apk" -t "<tag>" -n "版本说明"
```

多个附件用空格分隔，全部写在同一行。

### 方式二：分步操作（先打 tag，再建 release）

```powershell
# 第一步：打 tag 并推送
git tag -a <tag> -m "<tag>"
git push origin <tag>

# 第二步：基于已有 tag 创建 release（带附件）
gh release create <tag> "./apps/压缩包.zip" -t "<tag>" -n "版本说明"
```

### 方式三：草稿模式（先创建草稿，上传完再发布）

> **注意：** Release 发布后无法补传附件。不确定附件是否齐全时用此方式。

```powershell
# 第一步：创建草稿
gh release create <tag> -t "<tag>" -n "版本说明" -d

# 第二步：上传附件（可多次执行）
gh release upload <tag> "./apps/压缩包.zip" --repo reiqr/shiroha-quiz
gh release upload <tag> "./apps/xxx.apk" --repo reiqr/shiroha-quiz

# 第三步：发布草稿
gh release edit <tag> --draft=false
```

---

## 修改 Release 说明

```powershell
gh release edit <tag> -n "新的版本说明"
```

---

## 补传附件

> **重要：** Release 发布后默认不可补传。只有草稿状态才能上传附件。

如果确实需要补传，只能删除重建：

```powershell
# 1. 删除旧 release（不会删除 tag）
gh release delete <tag> --yes

# 2. 重建（带附件）
gh release create <tag> "./apps/压缩包.zip" "./apps/xxx.apk" -t "<tag>" -n "版本说明"
```

---

## 查看信息

```powershell
git status                        # 当前改动
git log --oneline -10             # 最近 10 条提交
git tag -l                        # 本地标签列表
gh release list                   # Release 列表
gh release view <tag>      # 查看某个 Release
```

---

## 撤销操作

```powershell
git restore 文件名                  # 撤销还没 add 的改动
git restore --staged 文件名         # 取消暂存
git rm -r --cached 文件夹名/        # 取消跟踪（不删除本地文件）
git tag -d <tag>            # 删除本地标签
git push origin :refs/tags/<tag>   # 删除远端标签
```

---

## 忽略文件

编辑 `.gitignore`，每行一条规则：

```text
文件夹名/          # 忽略整个文件夹
*.log             # 忽略所有 .log 文件
文件名.txt         # 忽略指定文件
```

加入 `.gitignore` = 永久排除。Git 不会检测这些文件的改动。

---

## 关键规则

| 规则                 | 说明                                 |
| ------------------ | ---------------------------------- |
| Tag 和 Release 是两回事 | Tag 是 Git 标记，Release 是 GitHub 发布页  |
| Release 发布后不可补传    | 创建时直接带附件，或用草稿模式                    |
| 压缩包不进源码仓库          | 放 `.gitignore`，只上传到 Release Assets |
| 附件同名优先改名           | 不要轻易覆盖，避免中途失败丢失旧文件                 |
| 不要删除 tag 重建        | 仓库有 tag 保护规则，删除后无法重建同名 tag         |
