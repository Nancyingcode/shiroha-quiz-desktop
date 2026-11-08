# Airbnb JavaScript Style Guide → ESLint 可落地性对照

> 对照对象仓库：`shiroha-quiz-desktop`
> 对照来源：`C:/Users/30728/Downloads/style-guide.md`（Airbnb JavaScript Style Guide，4181 行，161 条编号规则，其中 91 条带 `eslint:` 标注）
> 本文只做盘点与分级，不含任何 ESLint 配置改动。

## 0. 结论速览

| 分类 | 含义 | 条目数 |
| --- | --- | --- |
| A 可直接写入 | ESLint 10 核心仍保留该规则，且与现有代码低冲突 | 41 |
| B 需 `@stylistic` | v10 已把格式化规则从核心彻底移除，只能靠插件 | 39 |
| C 写不进去 | 无对应核心规则，或属于语言语义、架构约定、人工判断 | 68 |
| D 可加但冲突 | 有规则，但与现有代码或项目约定直接冲突 | 13 |

优先级判断依据：现有检查面很小（20 个 `scripts/*.mjs` + 12 个 `test/*.mjs` + `eslint.platform.config.mjs` 白名单内的平台文件），所以「加规则的成本」应按这个面算，而不是按整个仓库代码量算。

## 1. 基线事实

| 项 | 现状 |
| --- | --- |
| ESLint 版本 | `apps/desktop/package.json` → `eslint 10.13.0`、`@eslint/js 10.0.1` |
| 核心格式化规则 | v10 已移除全部格式化规则（缩进、引号、分号、逗号、空格、`max-len` 等），风格类必须走 `@stylistic/eslint-plugin`，当前**未安装** |
| 配置 1 | `apps/desktop/eslint.config.mjs`：仅 `files: ['**/*.mjs']`，启用 `js.configs.recommended` + `no-var` + `prefer-const` + `no-unused-vars(argsIgnorePattern: '^_' )` |
| 配置 2 | `apps/desktop/eslint.platform.config.mjs`：覆盖 `apps/web/platform/**/*.js`、`apps/web/training.js`、`apps/desktop/frontend/**/*.js`、`test/dual-platform/**/*.cjs`，规则集合与配置 1 相同 |
| 实际执行 | `npm run lint:eslint` = `eslint scripts test eslint.config.mjs eslint.platform.config.mjs commitlint.config.mjs --max-warnings 0` |
| 不在检查内 | `apps/web` 历史 `app.js`、`scripts/lint-platform.mjs` 之外的平台文件、`docs/` |
| 未验证项 | `apps/desktop` 下 `require('eslint/package.json')` 解析失败（依赖未安装或未 hoist），本轮未真跑 `builtinRules` 名单，规则存在性以 ESLint 10 规则集事实判断，落地前应用第 6 节的命令复核一次 |

## 2. A 类：可以直接写入 ESLint 核心（41 条）

### 2.1 已被 `js.configs.recommended` 覆盖，无需重复声明

| Airbnb 条目 | 规则 |
| --- | --- |
| 2.1 | `no-const-assign` |
| 3.7 | `no-prototype-builtins` |
| 6.5 | `no-useless-escape` |
| 9.6 | `no-dupe-class-members` |
| 13.1 | `no-undef`（注意 `eslint.config.mjs` 的 globals 白名单比 `eslint.platform.config.mjs` 少 `structuredClone` / `navigator` / `Response` 等，`no-undef` 误报主要来自这里） |
| 15.5 | `no-case-declarations` |

### 2.2 已显式启用

| Airbnb 条目 | 规则 |
| --- | --- |
| 2.1 | `prefer-const` |
| 2.2 | `no-var` |
| 13.8 | `no-unused-vars`（`argsIgnorePattern: '^_'`） |

### 2.3 建议新增，零/低冲突

| Airbnb 条目 | 规则 | 备注 |
| --- | --- | --- |
| 3.1 | `no-new-object` | 无命中风险 |
| 3.3 / 3.4 | `object-shorthand` | 建议 `['error', 'always']` |
| 3.8 | `prefer-object-spread` | |
| 4.1 | `no-array-constructor` | **不在 recommended** |
| 4.7 | `array-callback-return` | 可配 `{ checkForEach: false }` 避免误伤 |
| 6.3 | `prefer-template` | 与 6.3 的 `template-curly-spacing` 分开处理 |
| 6.4 | `no-eval` | |
| 7.6 | `prefer-rest-params` | |
| 7.9 | `default-param-last` | |
| 7.10 | `no-new-func` | |
| 7.13 | `no-param-reassign` | 仅基础赋值项，见 7.12 的 D 类说明 |
| 7.14 | `prefer-spread` | |
| 8.1 | `prefer-arrow-callback` | |
| 8.2 | `arrow-body-style` | |
| 9.5 | `no-useless-constructor` | 不在 recommended |
| 10.4 | `no-duplicate-imports` | |
| 12.1 | `dot-notation` | |
| 12.3 | `prefer-exponentiation-operator` | |
| 13.1 | `no-undef` | 已由 recommended 提供，重点是补全 globals |
| 13.5 | `no-multi-assign` | |
| 15.1 | `eqeqeq` | 全仓实测 `==`/`!=` 仅 1 处（`test/release.test.mjs`），成本极低；可配 `{ null: 'ignore' }` |
| 15.6 | `no-nested-ternary` | 低风险，先跑基线 |
| 15.7 | `no-unneeded-ternary` | |
| 16.3 | `no-else-return` | |
| 18.4 / 18.5 / 18.6 | `no-warning-comments` | TODO/FIXME 规范唯一可机器化的部分，建议 `['warn', { terms: ['todo', 'fixme'], location: 'anywhere' }]`，与 `--max-warnings 0` 组合需注意会直接失败 |
| 22.2 / 22.3 / 22.6 | `no-new-wrappers` | |
| 22.3 | `radix` | |
| 29.1 / 29.2 | `no-restricted-globals` | 建议 `['error', 'isNaN', 'isFinite']`，强制 `Number.isNaN` / `Number.isFinite` |

## 3. B 类：写不进核心，只能通过 `@stylistic/eslint-plugin`（39 条）

这批是 style guide 里体量最大的部分，全部属于纯格式，v10 核心已删除。要落地必须新增 devDependency（当前未安装），或改由编辑器/格式化工具承担。

| Airbnb 条目 | 原规则 | 建议对应 |
| --- | --- | --- |
| 3.6 | `quote-props` | `@stylistic/quote-props` |
| 4.8 | `array-bracket-newline` | `@stylistic/array-bracket-newline` |
| 6.1 | `quotes` | `@stylistic/quotes` |
| 6.3 | `template-curly-spacing` | `@stylistic/template-curly-spacing` |
| 7.2 | `wrap-iife` | `@stylistic/wrap-iife` |
| 7.11 | `space-before-function-paren` + `space-before-blocks` | `@stylistic/space-before-function-paren`、`@stylistic/space-before-blocks` |
| 7.15 | `function-paren-newline` | `@stylistic/function-paren-newline` |
| 8.1 | `arrow-spacing` | `@stylistic/arrow-spacing` |
| 8.2 / 8.4 | `arrow-parens` | `@stylistic/arrow-parens` |
| 8.5 | `no-confusing-arrow` | `@stylistic/no-confusing-arrow` |
| 8.6 | `implicit-arrow-linebreak` | `@stylistic/implicit-arrow-linebreak` |
| 11.3 | `generator-star-spacing` | `@stylistic/generator-star-spacing` |
| 13.7 | `operator-linebreak` | `@stylistic/operator-linebreak` |
| 13.7 / 19.13 | `max-len` | `@stylistic/max-len` |
| 15.8 | `no-mixed-operators` | `@stylistic/no-mixed-operators` |
| 16.1 | `nonblock-statement-body-position` | `@stylistic/nonblock-statement-body-position` |
| 16.2 | `brace-style` | `@stylistic/brace-style` |
| 18.3 | `spaced-comment` | `@stylistic/spaced-comment` |
| 19.1 | `indent` | `@stylistic/indent` |
| 19.2 | `space-before-blocks` | 同上 |
| 19.3 | `keyword-spacing` | `@stylistic/keyword-spacing` |
| 19.4 | `space-infix-ops` | `@stylistic/space-infix-ops` |
| 19.5 | `eol-last` | `@stylistic/eol-last` |
| 19.8 | `padded-blocks` | `@stylistic/padded-blocks` |
| 19.9 / 19.20 | `no-multiple-empty-lines` | `@stylistic/no-multiple-empty-lines` |
| 19.10 | `space-in-parens` | `@stylistic/space-in-parens` |
| 19.11 | `array-bracket-spacing` | `@stylistic/array-bracket-spacing` |
| 19.12 | `object-curly-spacing` | `@stylistic/object-curly-spacing` |
| 19.14 | `block-spacing` | `@stylistic/block-spacing` |
| 19.15 | `comma-spacing` | `@stylistic/comma-spacing` |
| 19.16 | `computed-property-spacing` | `@stylistic/computed-property-spacing` |
| 19.17 | `func-call-spacing` | `@stylistic/function-call-spacing` |
| 19.18 | `key-spacing` | `@stylistic/key-spacing` |
| 19.19 | `no-trailing-spaces` | `@stylistic/no-trailing-spaces` |
| 20.1 | `comma-style` | `@stylistic/comma-style` |
| 20.2 | `comma-dangle` | `@stylistic/comma-dangle` |
| 21.1 | `semi` | `@stylistic/semi` |

特别提醒：

- Airbnb 的 2 空格缩进、单引号、强制分号、100 列上限、尾逗号，需要先确认与现有代码风格一致再启用。`eslint.config.mjs` 第 10 行单行就超过 300 字符，一上 `max-len: 100` 立刻变红。
- 项目目前**没有** Prettier，`AGENTS.md` 第 6 章明确「不声称已部署不存在的 Prettier、lint-staged、Hook 或 CI 门禁」。若不想引入插件，格式统一应改由编辑器承担，并同步修正该章表述。
- `one-var`（13.2）在 v9 起被列入废弃候选，v10 是否仍可用必须以第 6 节的 `builtinRules` 输出为准，暂不纳入任一批次。

## 4. C 类：ESLint 管不了（68 条）

### 4.1 语言语义与机制说明（无法静态检查）

1.1、1.2（原始值 vs 引用）、2.3（块级作用域）、14.1–14.4（提升语义）、15.2 / 15.4（`ToBoolean`）、15.9（`??` 语义）、22.5（bitshift 32 位）、7.4（块与函数声明的定义差异）、7.5（`arguments` 形参名，核心无对应规则）。

### 4.2 写法偏好，无规则可实现

3.2（计算属性名）、3.5（shorthand 属性分组置顶）、4.2（`push` 而非 `arr[len] = x`）、4.3 / 4.4 / 4.5 / 4.6（spread 与 `Array.from` 的选择，`prefer-spread` 只覆盖 `Function.prototype.apply`）、5.3（多返回值用对象而非数组）、6.2（长字符串不拆行）、7.7 / 7.8（默认参数语义与副作用）、8.3（多行表达式加括号）、12.2（变量访问用方括号）、13.3 / 13.4（const/let 分组、声明就近）、17.1 / 17.2（控制语句换行与选择表达式）、19.6（方法链缩进与前置点）、19.7（块后空行）、22.1 / 22.4（强制转换位置与 bitshift 注释）。

### 4.3 类、继承、访问器约定

9.1（用 `class`，不动 `prototype`）、9.2（`extends`）、9.3（返回 `this` 做链式）、9.4（`toString` 无副作用）、24.1（不强制写访问器）、24.2（不用 getter/setter，改用 `getVal()` / `setVal()`）、24.3（布尔用 `isVal` / `hasVal` 前缀）、24.4（`get`/`set` 成对且一致）。核心只有 `accessor-pairs`，语义不等于 24.2，强行配置只会得到误报。

### 4.4 模块与命名约定

10.1（统一 `import`/`export`）、10.2（禁通配 import）、10.3（禁 `export from` 转出）、10.5（不导出可变绑定）、10.6（单导出优先 default）、10.7 / 10.8（import 置顶与缩进，需 `eslint-plugin-import` 的 `import/first`、`import/order`）、10.9（禁 webpack loader 语法）、10.10（import 不带扩展名，与 Node ESM 强制 `./x.mjs` 显式扩展名直接矛盾）、23.5（不保存 `this` 引用）、23.6 / 23.7 / 23.8（文件名与默认导出一致、default 导出用 camelCase、构造器/库用 PascalCase）、23.9（缩写全大写或全小写）、23.10（常量大写的前置条件）。

### 4.5 不适用于本项目

18.1 / 18.2（注释形式与位置）、25.1（事件 payload 用对象字面量）、26.1–26.4（jQuery 相关，项目无 jQuery）、27.1（ES5 兼容表）、28.1 / 28.2（ES6+ 特性索引与 TC39 stage 3 要求，属于运行时与构建约束）、30.1 / 30.2（测试要求，属于流程而非 lint）。

## 5. D 类：技术上可加，但与现有代码或项目约定冲突（13 条）

| Airbnb 条目 | 规则 | 冲突证据与建议 |
| --- | --- | --- |
| 5.1 / 5.2 | `prefer-destructuring` | 现有 `const x = obj.x` 写法成片，需先统计命中量再决定 |
| 7.1 | `func-style: ['error', 'expression']` + `func-names` | 现有 `scripts/`、`test/` 几乎全是函数声明，重写面过大；建议只对新增文件或改用 `func-names` |
| 7.3 | `no-loop-func` | 语义窄于原条目（原条目是禁块内函数声明），启用后只能覆盖循环闭包场景 |
| 7.12 | `no-param-reassign` | 必须 `{ props: false }`，否则命中大量 `obj.x = ...` 式对象改写 |
| 9.7 | `class-methods-use-this` | `.mjs` 面基本无命中；若加入平台配置需 `exceptMethods` 例外 |
| 11.1 | `no-restricted-syntax`（禁 `for...of` / `for...in`） | 实测 `scripts` + `test` 里 **81 处** `for (const ... of ...)`，一上立刻 81 红；与现有脚本风格冲突 |
| 13.6 | `no-plusplus` | 循环里 `i++` 普遍，需先审计 |
| 14.5 | `no-use-before-define` | 必须 `{ functions: false, classes: false }`，否则命中现有函数提升写法 |
| 23.1 | `id-length`（min 2） | 会打到 `i`、`x`、`n`、`el` 等常见短名 |
| 23.2 | `camelcase` | Tauri/Rust 侧 snake_case 字段穿过 IPC，需 `properties: 'never'`，否则大面积误报 |
| 23.3 | `new-cap` | Tauri 的 `invoke` 与类型构造混用，需 `capIsNewExceptions` |
| 23.4 | `no-underscore-dangle` | `test/dual-platform/**/*.cjs` 使用 `__dirname`，必须 `allow: ['__dirname']` 或只对 `.mjs` 启用 |

## 6. 建议落地顺序与基线命令

### 6.1 四批推进

1. **第一批（可立即进 `rules`，几乎零命中）**：
   `eqeqeq`、`no-eval`、`no-new-func`、`no-new-wrappers`、`radix`、`no-new-object`、`no-array-constructor`、`object-shorthand`、`prefer-object-spread`、`prefer-template`、`prefer-exponentiation-operator`、`prefer-spread`、`prefer-rest-params`、`default-param-last`、`dot-notation`、`no-multi-assign`、`no-unneeded-ternary`、`no-duplicate-imports`、`no-restricted-globals: ['error', 'isNaN', 'isFinite']`、`array-callback-return`、`no-useless-constructor`。
2. **第二批（需加参数）**：
   `no-param-reassign`（`props: false`）、`no-use-before-define`（`functions: false, classes: false`）、`arrow-body-style`、`no-else-return`、`no-nested-ternary`、`prefer-arrow-callback`、`no-warning-comments`（`warn`，注意与 `--max-warnings 0` 的冲突）。
3. **第三批（需先批量改写或引入插件）**：
   `prefer-destructuring`、`no-plusplus`、`func-style`、`no-restricted-syntax`、`camelcase`、`id-length`、`class-methods-use-this`。
4. **永不加进核心**：B 类 39 条格式化规则（除非新增 `@stylistic`）+ C 类 68 条人工约定。

### 6.2 加规则前先跑基线

```
cd apps/desktop

# 1) 确认核心规则集合（决定 one-var 等边界规则的归属）
node -e "const r=require('eslint/use-at-your-own-risk').builtinRules; console.log([...r.keys()].sort().join(','))"

# 2) 确认当前 0 warning 基线
npx eslint scripts test eslint.config.mjs eslint.platform.config.mjs commitlint.config.mjs --max-warnings 0

# 3) 单条规则命中量统计（示例：eqeqeq）
npx eslint scripts test --rule '{"eqeqeq":"error"}' -f json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.reduce((a,f)=>a+f.errorCount,0))})"
```

先固化现有基线，再逐条加，避免把既有命中当成新回归。

## 7. 161 条逐条对照总表

分类标记：**A** 核心可写入 / **B** 需 `@stylistic` / **C** 写不进去 / **D** 可加但冲突。

### 7.1 Types / References

| 条目 | 主题 | 分类 | 规则或说明 |
| --- | --- | --- | --- |
| 1.1 | 原始类型按值访问 | C | 概念说明 |
| 1.2 | 复杂类型按引用访问 | C | 概念说明 |
| 2.1 | 优先 `const` | A | `prefer-const`（已启用）+ `no-const-assign`（recommended） |
| 2.2 | 用 `let` 不用 `var` | A | `no-var`（已启用） |
| 2.3 | 块级作用域 | C | 语言语义 |

### 7.2 Objects / Arrays

| 条目 | 主题 | 分类 | 规则或说明 |
| --- | --- | --- | --- |
| 3.1 | 对象字面量 | A | `no-new-object` |
| 3.2 | 计算属性名 | C | 无规则 |
| 3.3 | 方法简写 | A | `object-shorthand` |
| 3.4 | 属性值简写 | A | `object-shorthand` |
| 3.5 | shorthand 分组置顶 | C | 无规则 |
| 3.6 | 非必要不加引号 | B | `quote-props` |
| 3.7 | 不直接调用 `Object.prototype` 方法 | A | `no-prototype-builtins`（recommended） |
| 3.8 | 用对象 spread 取代 `Object.assign` | A | `prefer-object-spread` |
| 4.1 | 数组字面量 | A | `no-array-constructor` |
| 4.2 | 用 `push` 追加 | C | 无规则 |
| 4.3 | spread 复制数组 | C | 无规则 |
| 4.4 | 可迭代对象用 spread | C | 无规则 |
| 4.5 | 类数组用 `Array.from` | C | 无规则 |
| 4.6 | 映射用 `Array.from` | C | 无规则 |
| 4.7 | 回调显式 return | A | `array-callback-return` |
| 4.8 | 多行数组换行 | B | `array-bracket-newline` |

### 7.3 Destructuring / Strings

| 条目 | 主题 | 分类 | 规则或说明 |
| --- | --- | --- | --- |
| 5.1 | 对象解构 | D | `prefer-destructuring` |
| 5.2 | 数组解构 | D | `prefer-destructuring`（`array: true`） |
| 5.3 | 多返回值用对象 | C | 无规则 |
| 6.1 | 单引号 | B | `quotes` |
| 6.2 | 长字符串不拼接拆行 | C | 无规则 |
| 6.3 | 模板字符串 | A + B | `prefer-template` + `template-curly-spacing` |
| 6.4 | 禁 `eval` | A | `no-eval` |
| 6.5 | 不必要的转义 | A | `no-useless-escape`（recommended） |

### 7.4 Functions

| 条目 | 主题 | 分类 | 规则或说明 |
| --- | --- | --- | --- |
| 7.1 | 命名函数表达式优先 | D | `func-style` + `func-names` |
| 7.2 | IIFE 加括号 | B | `wrap-iife` |
| 7.3 | 块内不声明函数 | D | `no-loop-func`（语义偏窄） |
| 7.4 | block 与语句的定义差异 | C | 规范说明 |
| 7.5 | 形参不叫 `arguments` | C | 核心无对应规则 |
| 7.6 | 用 rest 取代 `arguments` | A | `prefer-rest-params` |
| 7.7 | 默认参数语法 | C | 无规则 |
| 7.8 | 默认参数避免副作用 | C | 无规则 |
| 7.9 | 默认参数放最后 | A | `default-param-last` |
| 7.10 | 禁 `Function` 构造器 | A | `no-new-func` |
| 7.11 | 函数签名空格 | B | `space-before-function-paren` + `space-before-blocks` |
| 7.12 | 不修改形参属性 | D | `no-param-reassign`（`props: false`） |
| 7.13 | 不重赋值形参 | A | `no-param-reassign` |
| 7.14 | 用 spread 调用变参 | A | `prefer-spread` |
| 7.15 | 多行签名缩进与尾逗号 | B | `function-paren-newline` |

### 7.5 Arrow Functions / Classes

| 条目 | 主题 | 分类 | 规则或说明 |
| --- | --- | --- | --- |
| 8.1 | 匿名回调用箭头函数 | A + B | `prefer-arrow-callback` + `arrow-spacing` |
| 8.2 | 单表达式省略 `return` | A + B | `arrow-body-style` + `arrow-parens` |
| 8.3 | 多行表达式加括号 | C | 无规则 |
| 8.4 | 单参数也加括号 | B | `arrow-parens: ['error', 'always']` |
| 8.5 | 避免 `=>` 与比较符混淆 | B | `no-confusing-arrow` |
| 8.6 | 隐式返回值换行位置 | B | `implicit-arrow-linebreak` |
| 9.1 | 用 `class`，不动 `prototype` | C | 无规则 |
| 9.2 | 用 `extends` 继承 | C | 无规则 |
| 9.3 | 返回 `this` 做链式 | C | 无规则 |
| 9.4 | 自定义 `toString` 无副作用 | C | 无规则 |
| 9.5 | 不多余的空构造器 | A | `no-useless-constructor` |
| 9.6 | 不重复类成员 | A | `no-dupe-class-members`（recommended） |
| 9.7 | 实例方法应使用 `this` | D | `class-methods-use-this` |

### 7.6 Modules / Iterators / Properties

| 条目 | 主题 | 分类 | 规则或说明 |
| --- | --- | --- | --- |
| 10.1 | 统一用模块 | C | 无规则 |
| 10.2 | 禁通配 import | C | 无核心规则（`import/no-namespace` 属插件） |
| 10.3 | 禁 `export ... from` 转出 | C | 无规则 |
| 10.4 | 同一路径只 import 一次 | A | `no-duplicate-imports` |
| 10.5 | 不导出可变绑定 | C | 无规则 |
| 10.6 | 单导出优先 default | C | 无规则 |
| 10.7 | import 置顶 | C | 需 `eslint-plugin-import` 的 `import/first` |
| 10.8 | 多行 import 缩进 | C | 需插件 |
| 10.9 | 禁 webpack loader 语法 | C | 无规则 |
| 10.10 | import 不带扩展名 | C | 与 Node ESM 强制显式扩展名冲突，本项目不适用 |
| 11.1 | 不用迭代器与 `for...of` / `for...in` | D | `no-restricted-syntax`，实测 81 处命中 |
| 11.2 | 暂不用 generator | C | 无规则 |
| 11.3 | generator 星号空格 | B | `generator-star-spacing` |
| 12.1 | 点号访问属性 | A | `dot-notation` |
| 12.2 | 变量访问用方括号 | C | 无规则 |
| 12.3 | 幂运算用 `**` | A | `prefer-exponentiation-operator` |

### 7.7 Variables / Hoisting

| 条目 | 主题 | 分类 | 规则或说明 |
| --- | --- | --- | --- |
| 13.1 | 必须声明，禁止隐式全局 | A | `no-undef`（recommended）+ `prefer-const` |
| 13.2 | 一个声明一个变量 | 待核 | `one-var`，v10 是否保留需以 `builtinRules` 为准 |
| 13.3 | const 与 let 分组 | C | 无规则 |
| 13.4 | 声明就近合理位置 | C | 无规则 |
| 13.5 | 不链式赋值 | A | `no-multi-assign` |
| 13.6 | 避免 `++` / `--` | D | `no-plusplus` |
| 13.7 | 赋值号前后不换行 | B | `operator-linebreak` + `max-len` |
| 13.8 | 禁未使用变量 | A | `no-unused-vars`（已启用） |
| 14.1 | `var` 提升与 TDZ | C | 语义说明 |
| 14.2 | 匿名函数表达式的提升 | C | 语义说明 |
| 14.3 | 命名函数表达式的提升 | C | 语义说明 |
| 14.4 | 函数声明的提升 | C | 语义说明 |
| 14.5 | 先定义后使用 | D | `no-use-before-define`（`functions: false`） |

### 7.8 Comparison / Blocks / Control Statements

| 条目 | 主题 | 分类 | 规则或说明 |
| --- | --- | --- | --- |
| 15.1 | `===` / `!==` | A | `eqeqeq`，实测仅 1 处命中 |
| 15.2 | `ToBoolean` 转换规则 | C | 语义说明 |
| 15.3 | 布尔用简写，字符串数字用显式比较 | C | 无规则 |
| 15.4 | 相等性与真值参考 | C | 参考资料 |
| 15.5 | `case` 内词法声明加块 | A | `no-case-declarations`（recommended） |
| 15.6 | 三元不嵌套 | A | `no-nested-ternary` |
| 15.7 | 去掉多余三元 | A | `no-unneeded-ternary` |
| 15.8 | 混用运算符加括号 | B | `no-mixed-operators` |
| 15.9 | `??` 语义 | C | 语义说明 |
| 16.1 | 多行块加花括号 | B | `nonblock-statement-body-position` |
| 16.2 | `else` 与 `}` 同行 | B | `brace-style` |
| 16.3 | `return` 后不写 `else` | A | `no-else-return` |
| 17.1 | 长条件换行，逻辑运算符前置 | C | 无规则 |
| 17.2 | 不用选择运算符替代控制语句 | C | 无规则 |

### 7.9 Comments / Whitespace / Commas / Semicolons

| 条目 | 主题 | 分类 | 规则或说明 |
| --- | --- | --- | --- |
| 18.1 | 多行用 `/** */` | C | 无规则 |
| 18.2 | 单行用 `//` 并置于上方 | C | 无规则 |
| 18.3 | 注释以空格开头 | B | `spaced-comment` |
| 18.4 | TODO / FIXME 前缀 | A | `no-warning-comments` |
| 18.5 | `// FIXME:` 标注问题 | A | 同上 |
| 18.6 | `// TODO:` 标注待办 | A | 同上 |
| 19.1 | 2 空格软缩进 | B | `indent` |
| 19.2 | 左花括号前 1 空格 | B | `space-before-blocks` |
| 19.3 | 关键字与括号间距 | B | `keyword-spacing` |
| 19.4 | 运算符两侧空格 | B | `space-infix-ops` |
| 19.5 | 文件末尾单个换行 | B | `eol-last` |
| 19.6 | 长方法链缩进与前置点 | C | 无规则 |
| 19.7 | 块后空行 | C | 无规则 |
| 19.8 | 块内不加空行 | B | `padded-blocks` |
| 19.9 | 不连续空行 | B | `no-multiple-empty-lines` |
| 19.10 | 括号内不加空格 | B | `space-in-parens` |
| 19.11 | 方括号内不加空格 | B | `array-bracket-spacing` |
| 19.12 | 花括号内加空格 | B | `object-curly-spacing` |
| 19.13 | 单行不超过 100 字符 | B | `max-len` |
| 19.14 | 块符号间距 | B | `block-spacing` |
| 19.15 | 逗号前无空格、后 1 空格 | B | `comma-spacing` |
| 19.16 | 计算属性括号内间距 | B | `computed-property-spacing` |
| 19.17 | 函数名与调用括号间无空格 | B | `func-call-spacing` |
| 19.18 | 键值冒号间距 | B | `key-spacing` |
| 19.19 | 行尾不残留空格 | B | `no-trailing-spaces` |
| 19.20 | 文件首尾不多余空行 | B | `no-multiple-empty-lines` |
| 20.1 | 逗号后置 | B | `comma-style` |
| 20.2 | 尾随逗号 | B | `comma-dangle` |
| 21.1 | 必须写分号 | B | `semi` |

### 7.10 Coercion / Naming / Accessors / Events / jQuery / ES / Standard Library / Testing

| 条目 | 主题 | 分类 | 规则或说明 |
| --- | --- | --- | --- |
| 22.1 | 语句开头做类型转换 | C | 无规则 |
| 22.2 | 字符串转换不用 `new String` | A | `no-new-wrappers` |
| 22.3 | `Number` 转换与 `parseInt` 基数 | A | `radix` + `no-new-wrappers` |
| 22.4 | bitshift 性能优化需注释 | C | 无规则 |
| 22.5 | bitshift 的 32 位行为 | C | 语义说明 |
| 22.6 | 布尔转换不用 `new Boolean` | A | `no-new-wrappers` |
| 23.1 | 不用单字母命名 | D | `id-length` |
| 23.2 | 对象/函数/实例用 camelCase | D | `camelcase` |
| 23.3 | 构造器/类用 PascalCase | D | `new-cap` |
| 23.4 | 不用前后下划线 | D | `no-underscore-dangle` |
| 23.5 | 不保存 `this` 引用 | C | 无规则 |
| 23.6 | 文件名与默认导出一致 | C | 无规则 |
| 23.7 | default 导出函数用 camelCase | C | 无规则 |
| 23.8 | 构造器/库用 PascalCase | C | 无规则 |
| 23.9 | 缩写全大写或全小写 | C | 无规则 |
| 23.10 | 常量大写的前置条件 | C | 无规则 |
| 24.1 | 不强制写访问器 | C | 无规则 |
| 24.2 | 不用 getter/setter | C | 核心无等价规则 |
| 24.3 | 布尔用 `is` / `has` 前缀 | C | 无规则 |
| 24.4 | `get` / `set` 成对且一致 | C | 无规则 |
| 25.1 | 事件 payload 用对象字面量 | C | 无规则 |
| 26.1 | jQuery 变量 `$` 前缀 | C | 项目无 jQuery |
| 26.2 | 缓存 jQuery 查询 | C | 项目无 jQuery |
| 26.3 | 层叠选择器 | C | 项目无 jQuery |
| 26.4 | 用 `find` 做作用域查询 | C | 项目无 jQuery |
| 27.1 | ES5 兼容表 | C | 属运行时约束 |
| 28.1 | ES6+ 特性索引 | C | 参考资料 |
| 28.2 | 不用未达 stage 3 的提案 | C | 属构建与运行时约束 |
| 29.1 | 用 `Number.isNaN` | A | `no-restricted-globals: ['error', 'isNaN', 'isFinite']` |
| 29.2 | 用 `Number.isFinite` | A | 同上 |
| 30.1 | 必须写测试 | C | 流程要求 |
| 30.2 | 测试覆盖与可读性要求 | C | 流程要求 |

## 8. 与项目规范的衔接

- `AGENTS.md` 第 6 章：「机械规则以实际配置的 ESLint、TypeScript、rustfmt、Clippy 和 Gradle 检查为准，不声称已部署不存在的 Prettier、lint-staged、Hook 或 CI 门禁」。引入 B 类插件或改用 Prettier 前，需同步修改该章表述，避免规则文档与配置脱节。
- 新增检查时按同章要求「同步维护命令与覆盖范围」：本文件若纳入门禁，需要把路径加入 `apps/desktop/scripts/check-docs.mjs` 的白名单（当前为 15 份固定文档），否则 `npm run lint:docs` 不覆盖本文件。
- 任何规则启用都属于改变 lint 门禁，需重跑 `apps/desktop` 的 `npm run lint`（含 `lint:eslint`、`lint:platform`、`lint:docs`），并确认 `--max-warnings 0` 下仍为 0 warning。

## 9. 待确认事项

1. ESLint 10 实际 `builtinRules` 名单（决定 `one-var`、`no-confusing-arrow` 等边界规则的归属）。
2. 是否接受新增 `@stylistic/eslint-plugin` 依赖；若不接受，B 类 39 条永久排除。
3. 项目是否要把现有代码风格对齐 Airbnb（单引号、2 空格、强制分号、100 列、尾逗号），还是保留现状只加非格式规则。
4. `no-warning-comments` 与 `--max-warnings 0` 的冲突处理（改为 `error`，或将其排除在门禁之外）。
