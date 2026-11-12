# Shiroha Quiz 的 ESLint 与 Stylelint 优化建议

2026-11-12 在提交 `83981a7` 上使用项目锁定的 ESLint 10.13.0、ESLint Stylistic 5.10.0 和 Stylelint 17.16.0，只读试跑了 163 个手写 JavaScript 文件和 9 个 CSS 文件。建议先启用下表前两项，两项合计需要调整两处 JavaScript。所有候选规则均可使用现有开发依赖。[依赖与检查命令](../../apps/desktop/package.json)

| 建议顺序 | 规则 | 当前试跑结果 |
| --- | --- | --- |
| 第一批 | ESLint `no-unused-expressions` | 2 处，均为导出时用 `&&` 控制 DOM 赋值 |
| 第一批 | Stylelint `no-unknown-custom-properties` | 指定两个共享变量定义文件后为 0 处 |
| 可随第一批启用 | Stylelint `selector-class-pattern`、`custom-property-pattern` | 使用项目现有命名格式，两条规则各 0 处 |
| 按 JS 模块推进 | Stylistic `max-statements-per-line`，每行最多 1 条语句 | 4,399 处，分布在 122 个文件 |
| 从新 CSS 组件开始 | Stylelint `selector-max-compound-selectors`，上限 4 段 | 22 处，集中在两个历史样式文件 |

## 第一批配置

### 用显式判断表达 DOM 写入

在 `semanticRules` 中加入 `'no-unused-expressions': 'error'`。题库导出和学习记录导出都写了 `$('#export-output') && ($('#export-output').value = text)`。一次查询配合 `if` 就能看清哪一步需要元素存在；后面的下载应继续放在条件块外。[ESLint 配置](../../apps/desktop/eslint.rules.mjs) · [题库导出](../../apps/web/app.js#L2006) · [学习记录导出](../../apps/web/app.js#L2187) · [规则说明](https://eslint.org/docs/latest/rules/no-unused-expressions)

```js
const output = $('#export-output');
if (output) {
  output.value = text;
}
```

### 让拆分后的样式表能检查共享变量

训练复盘的答案对照区使用 `var(--blue3)`。这个变量定义在 `responsive-artwork.css` 的 `:root` 中，基础变量则定义在 `styles.css`。把两份文件都列入 `referenceFiles` 后，9 份样式表全部通过；将示例中的变量故意拼成 `var(--bule3)`，同一配置会准确报错。[基础变量](../../apps/web/styles.css#L1) · [主题变量](../../apps/web/styles/responsive-artwork.css#L762) · [答案对照区](../../apps/web/styles/controls-and-feedback.css#L407) · [规则说明](https://stylelint.io/user-guide/rules/no-unknown-custom-properties/)

```js
export default {
  extends: ['stylelint-config-recommended'],
  referenceFiles: ['../web/styles.css', '../web/styles/responsive-artwork.css'],
  rules: {
    'no-unknown-custom-properties': true,
  },
};
```

以上路径以现有 Stylelint 配置文件所在的 `apps/desktop` 为基准。若同时固定 CSS 命名，可在同一个 `rules` 对象中让 `selector-class-pattern` 和 `custom-property-pattern` 都使用 `'^[a-z][a-z0-9]*(-[a-z0-9]+)*$'`。它允许现有的 `.practice-side-v31`、`--field-radius` 和 `--blue2`，会指出 `.practiceSide` 之类的新写法。[Stylelint 配置](../../apps/desktop/stylelint.config.mjs) · [类名规则](https://stylelint.io/user-guide/rules/selector-class-pattern/) · [变量命名规则](https://stylelint.io/user-guide/rules/custom-property-pattern/)

实施时，混合大小写扩展名测试的临时目录也要复制 `responsive-artwork.css`。同一份测试样式可以同时使用 `var(--blue3)` 和 `var(--bule3)`，并断言只有拼写错误的引用触发 `no-unknown-custom-properties`。[CSS 门禁测试](../../apps/desktop/test/lint-css.test.mjs#L48)

## 分模块推进

**JavaScript 每行语句数。** 题库合并函数把用户确认、题目去重、保存和刷新写在一行。展开后，审查者可以沿着执行顺序看出用户取消会在哪里返回，以及保存成功后何时刷新。建议在 ESLint 的文件级配置中先对已零命中的 `quiz-core.js`、`training.js` 和 `practice-selection.js` 启用 `'@stylistic/max-statements-per-line': ['error', { max: 1 }]`，其余模块随业务修改逐个纳入。正式检查会因 warning 失败，试点范围应由文件配置控制。[题库合并](../../apps/web/app.js#L2004) · [CI 判定](../../apps/desktop/scripts/lint-ci.mjs#L162) · [规则说明](https://eslint.style/rules/max-statements-per-line)

**CSS 选择器层级。** 建议在新增组件样式对应的 Stylelint `overrides` 中设置 `'selector-max-compound-selectors': 4`。现有 22 处命中里，17 处在练习与统计面板，5 处在题库与学习工具。练习侧栏的折叠规则包含五段选择器，依次依赖页面状态、练习卡片、侧栏、统计卡和子元素。以后调整这个组件时，可以围绕按钮和面板本身简化选择器，同时验证展开、折叠两种状态下的可见性。[侧栏折叠样式](../../apps/web/styles/bank-and-study-tools.css#L464) · [练习与统计面板](../../apps/web/styles/focus-panels-and-stats.css) · [规则说明](https://stylelint.io/user-guide/rules/selector-max-compound-selectors/)
