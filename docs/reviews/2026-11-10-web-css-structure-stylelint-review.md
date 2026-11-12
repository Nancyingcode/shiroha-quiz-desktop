# codex/web-css-structure-stylelint 分支审查报告

- 审查时间：2026-11-10
- 审查对象：`codex/web-css-structure-stylelint` @ `dea39ca`
- 工作树：`C:/Users/30728/.codex/worktrees/30fc/shiroha-quiz-desktop`（干净，无未提交改动）
- 对比基线：`main` @ `8514234`（merge-base 与 main 头一致，分支为单提交）
- 提交标题：`refactor(web): 拆分共享样式并接入 Stylelint`
- 规模：31 个文件，+9029 / −7530
- 结论：**有条件通过**。拆分一致性、失败保全和基线数字质量高；两处门禁/健壮性缺口建议合并前修复。

## 1. 改动构成

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 样式拆分 | `apps/web/styles.css`（8488 → 1017 行）、`apps/web/styles/*.css` ×7 | 按原始顶层规则连续区段切分，保留字节顺序 |
| Web 入口 | `apps/web/index.html` | 1 个样式链接 → 8 个，顺序即加载顺序 |
| 桌面资源生成 | `apps/desktop/scripts/prepare-web.mjs`、`apps/desktop/scripts/smoke.mjs` | 白名单复制、`validateSharedStyles`、样式链接顺序冒烟 |
| Lint 门禁 | `apps/desktop/package.json`、`stylelint.config.mjs`、`stylelint-suppressions.json`、`scripts/lint-runner.mjs`、`scripts/lint-ci.mjs` | 新增 `lint:css`，全量 lint 与增量 CI 接入 |
| 测试 | `test/lint-css.test.mjs`（新）、`test/lint-ci.test.mjs`、`test/prepare-web.test.mjs`、`test/git-hooks.test.mjs`、`test/dual-platform/{browser,dialog,select,settings-action}-page.cjs`、`test/dual-platform/styles.cjs`（新） | 基线抑制、增量触发、资源完整性、真实顺序注入 |
| 文档 | 设计 + 计划（新）、`AGENTS.md`、`CONTRIBUTING.md`、`docs/README.md` | 规则与索引同步 |
| 依赖 | `apps/desktop/package-lock.json`（+1154）、`apps/desktop/package.json` | 新增 devDependencies：`stylelint@17.16.0`、`stylelint-config-recommended@18.0.0` |

## 2. 已核对通过项

### 2.1 拆分区间与设计表完全吻合

| 原行号（含首尾） | 文件 | 实际行数 |
| --- | --- | --- |
| 1–1017 | `styles.css` | 1017 |
| 1018–3388 | `styles/responsive-artwork.css` | 2371 |
| 3389–4430 | `styles/app-shell.css` | 1042 |
| 4431–5301 | `styles/dashboard-and-media.css` | 871 |
| 5302–6974 | `styles/focus-panels-and-stats.css` | 1673 |
| 6975–7797 | `styles/bank-and-study-tools.css` | 823 |
| 7798–7967 | `styles/ai-panels.css` | 170 |
| 7968–8488 | `styles/controls-and-feedback.css` | 521 |
| 合计 | – | 8488 |

### 2.2 拼接字节一致

- 按 HTML 顺序拼接 8 份文件，SHA-256 = `09da9ff3624ad5fe19bebec57bd79ee52c39da1e29aef9a4caeaaee95d0b02ac`，与实施计划记录一致。
- 与 `main:apps/web/styles.css` 归一换行后比较，差异仅 3 处：注释里的旧行号引用改为文件名（`styles.css:3169-3175`、`styles.css:3172-3178`、`styles.css:8422-8448`）。无任何选择器、声明、媒体查询、`@supports`、关键帧增删。
- 复现提示：工作区为 CRLF、`git show` 输出为 LF，直接按字节比较会得到 `255447 vs 246936` 的假差异，必须先把换行归一。

### 2.3 Stylelint 基线与文档数字自洽

| 文件 | `no-duplicate-selectors` | `no-descending-specificity` | 其他 | 合计 |
| --- | --- | --- | --- | --- |
| `../web/styles.css` | 6 | 16 | – | 22 |
| `../web/styles/responsive-artwork.css` | 87 | 18 | `break-word` 2 | 107 |
| `../web/styles/app-shell.css` | – | 12 | – | 12 |
| `../web/styles/dashboard-and-media.css` | 60 | 16 | – | 76 |
| `../web/styles/focus-panels-and-stats.css` | 28 | 21 | – | 49 |
| `../web/styles/bank-and-study-tools.css` | 5 | 4 | – | 9 |
| `../web/styles/ai-panels.css` | 2 | 1 | – | 3 |
| `../web/styles/controls-and-feedback.css` | 4 | 11 | – | 15 |
| **共享合计** | **192** | **99** | **2** | **293** |
| `frontend/desktop.css` | 2 | 12 | – | 14 |

原始扫描 507 条（共享 493 + 桌面 14），拆分后 293 + 14；消失的 200 条 = 重复选择器 43 + 特异性顺序 157，与计划记录一致，且未被计入「已修复」。

### 2.4 HTML 与白名单一致

`apps/web/index.html` 恰好 8 个 `rel="stylesheet"` 链接，顺序与 `prepare-web.mjs` 的 `sharedStyles` 完全一致；`apps/web/styles/` 下只有 7 个已列入文件。共享表中 `url()` 仅 1 处内嵌 SVG 数据（`controls-and-feedback.css:124`），无相对资源路径，拆分不引入资源解析差异。

### 2.5 资源生成的失败保全扎实

`prepare-web.test.mjs` 覆盖 5 种坏输入并在已有有效输出上重试，逐次断言 `dist` 快照字节不变：缺文件、缺链接、链接被注释、链接移到 `body`、`head` 追加未知链接。另有过期片段清理断言（`styles/unlisted.css` → ENOENT）。

### 2.6 组件测试按真实顺序注入

`addSharedStyles` 从 `index.html` 解析链接并按序 `addStyleTag`，含越界路径校验（拒绝 `WEB_ROOT` 之外的目标）。这修掉了拆分后「只注入基础表导致组件样式测不到」的隐性失配，对话框、下拉框、设置操作三组测试统一走同一入口。

## 3. 必修项

### M1 两份新文档未纳入文档门禁

- 位置：`apps/desktop/scripts/check-docs.mjs:6-27`（`documents` 列表）。
- 现状：`docs/superpowers/specs/2026-11-10-web-styles-split.md` 与 `docs/superpowers/plans/2026-11-10-web-styles-split.md` 未列入。
- 影响：两份文档的 UTF-8 严格解码、代码围栏配对、相对链接可达性都未被校验；`docs/README.md` 只能间接证明文件存在。与 `AGENTS.md` 第 5 节「未列入的文件须补同等检查」直接冲突，而本次改动恰好同时修改了 `AGENTS.md` 与 `CONTRIBUTING.md`。
- 建议：在 `documents` 数组补充两条：

```js
  '../../docs/superpowers/specs/2026-11-10-web-styles-split.md',
  '../../docs/superpowers/plans/2026-11-10-web-styles-split.md',
```

- 验证：`apps/desktop` 下执行 `npm run lint:docs`。

### M2 组件测试的样式链接解析过窄，存在「漏注入仍通过」的通道

- 位置：`test/dual-platform/styles.cjs:7`，配合 `test/dual-platform/browser-page.cjs` 中的 `assert.equal(styles.length, 8)`。
- 现状：正则 `/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/gi` 只匹配「属性紧邻 + 双引号 + 固定顺序」。HTML 一旦加入额外属性（`media`、`data-*`）、改成单引号或调整属性顺序，`addSharedStyles` 会静默少注入；而 `browser-page` 的 `8` 取自真实 DOM，与该函数不联动，可能出现「DOM 有 8 个、组件测试只注入 7 份但断言恰好仍然通过」的情况。
- 建议：解析放宽到「任意属性顺序 + 单双引号」，并让 `addSharedStyles` 返回注入数量，由调用方断言数量等于解析出的链接数：

```js
const links = [...html.matchAll(/<link\b[^>]*>/gi)]
  .map(([tag]) => ({ rel: attr(tag, 'rel'), href: attr(tag, 'href') }))
  .filter((link) => link.rel.split(/\s+/).includes('stylesheet'));
```

- 验证：`npm run test:web-platform`。

## 4. 建议项

**S1 白名单出现四份。** `prepare-web.mjs` 的 `sharedStyles`、`prepare-web.test.mjs` 手抄一份、`smoke.mjs` 从 `requiredAssets` filter 推导、`browser-page.cjs` 硬编码路径数组。测试文件已 `import { requiredAssets }`，却没顺便复用 `sharedStyles`。建议导出 `sharedStyles`，测试与冒烟改为引用，避免加文件时漏改一处。

**S2 `validateSharedStyles` 不校验顺序。** 它校验数量、集合、唯一性与「样式链接必须在 head 内」，但没有比对顺序。顺序是唯一真源，若调换 8 个 `<link>`，单元测试全绿，只有桌面冒烟的顺序断言会挂。建议原地补 `styles.every((name, index) => name === sharedStyles[index])`；`prepare-web.test.mjs` 已用 `assert.deepEqual(links, [...sharedStyles, 'desktop.css'])`，两处保持一致即可。

**S3 未列入 `styles/` 的 CSS 的诊断信息不足（复核后修正前一轮表述）。** 生成器用 `continue` 跳过；由于 `validateSharedStyles` 会对照 `index.html`，若把新文件真正接入 HTML，生成会**硬失败**，只是错误信息统一为 `Web stylesheet references do not match the required shared assets`，不含具体文件名；只有「存在但未被引用」的惰性文件会被静默忽略，而这类文件在 Web 端同样无效。因此风险有限，建议只改善可诊断性：报出缺失/多余的具体 href，并在 `prepare-web.test.mjs` 断言错误信息包含该文件名。`styles/unlisted.css → ENOENT` 这条断言本身是「白名单外不复制」的合理契约，保留。

**S4 `.stylelintignore` 分支属预防性条目。** `lint-ci.mjs` 的 `affectsLintConfiguration` 增加了 `apps/desktop/.stylelintignore`，但仓库里没有该文件，`lint:css` 也没传 `--ignore-path`。Stylelint 默认会在 cwd 查找 `.stylelintignore`，所以该分支不算死代码；但要么真正建立该文件并写明生效范围，要么显式传 `--ignore-path`，避免「改了没生效」的错觉。当前 glob 已排除 `libs/`、`dist/` 等第三方与生成资源。

**S5 提交混杂了断言修正。** `smoke.mjs` 把题型下拉框圆角断言从 `6px` 改成 `14px`，属修正过时断言（计划给出了原始整表与拆分表双侧实测 14px / 弹层 8px 的依据），可以接受；但它与结构重构同处一个 `refactor(web)` 提交。建议在提交说明中点明，或拆成两个提交，回退边界更清晰。同一处新增的分页下拉 `32px` 高 / `6px` 圆角断言方向正确。

**S6 首屏阻塞请求 1 → 8 无绘制时序验证。** 设计已接受该成本，但 `browser-page` 只断言 HTTP 200 与 `cssRules` 非空，没有验证是否存在首屏样式抖动或重排。建议在真实子路径下补一次绘制时序/截图基线，或按设计第 7 节在发布侧产出合并产物。

**S7 文件边界是行段而非职责。** `app-shell.css`、`dashboard-and-media.css` 等名称只是近似职责标签；跨文件的选择器特异性与重复选择器已不再被单文件规则报告（这正是 200 条「消失诊断」的来源）。后续按组件归并时必须以「拼接顺序 + 计算样式对照」为准，不能凭文件名判断覆盖关系。

## 5. 亮点

- 失败保全完整：五种坏输入 + 过期片段清理，全部断言旧输出字节不变，是这次改动质量最高的部分。
- 无语义搬迁：保留原注释、`:root` 分次覆盖、媒体查询与 `!important`，只改三处过期行号引用。
- 基线诚实：293 / 14 与 235→192、256→99 的推导可复算，没有把「单文件规则不再报告」记成「已修复」。
- 测试与真实 HTML 顺序解耦：`addSharedStyles` 让样式来源只剩一处。

## 6. 未复验项与风险

- 本次未执行（沿用计划记录）：`npm test`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run build:test`、`npm run test:web-platform`（131 项）、`npm run test:desktop`（41 项）。
- 计划记录的浏览器实测为 Edge 157.0.4341.42、隔离 profile，覆盖 720/721、1279/1280、强制颜色与减少动画；桌面侧为隔离 WebView2 + 本机 mock，未覆盖干净系统安装/升级与真实外部服务。
- 合并前建议在整合分支重跑 Web 与桌面门禁：本分支同时改动 lint 配置、锁文件与资源生成器，单点验证不足以作为合并基线。

## 附录 A 复现命令

```powershell
# 分支与规模
git log --oneline main..codex/web-css-structure-stylelint
git diff --stat main...codex/web-css-structure-stylelint

# 拼接一致性（先归一换行，否则 CRLF/LF 会造成假差异）
git show main:apps/web/styles.css > orig.css
# 再按 index.html 顺序拼接 8 份文件并比较 SHA-256

# 基线数字：逐文件累加 stylelint-suppressions.json 的 count

# 文档门禁缺口
Select-String -Path apps/desktop/scripts/check-docs.mjs -Pattern '2026-11-10'
```

## 附录 B 结论摘要

| 项目 | 结论 |
| --- | --- |
| 拆分完整性（字节/顺序/注释） | 通过 |
| Web 与桌面加载顺序 | 通过 |
| 资源生成失败保全 | 通过 |
| Stylelint 基线数字 | 通过 |
| 文档门禁覆盖 | **不通过（M1）** |
| 组件测试注入健壮性 | **需改进（M2）** |
| 项目级验证复跑 | 未复验 |
