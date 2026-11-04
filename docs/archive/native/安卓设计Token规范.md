# 安卓设计 Token 规范

## 文档目的

这份文档用于统一 `Shiroha Quiz` 安卓原生版本的设计基础参数，避免后续页面边做边改、每页风格不一致。

它覆盖：

- 颜色
- 圆角
- 阴影
- 间距
- 字体
- 按钮
- 卡片
- 标签
- 选项态

这份规范会直接服务于后续的 Compose 主题和组件实现。

---

## 1. 视觉基调

整体方向：

- 主视觉：苹果卡片质感
- 平台交互：Material 3
- 页面氛围：轻、静、柔和、有高级感

目标不是做“像 iPhone 的安卓”，而是做“在安卓里也很自然的高级卡片式产品”。

---

## 2. 颜色 Token

### 背景层

- `bgApp = #F4F6FB`
- `bgElevated = #FBFCFE`
- `bgDeepFocus = #0E1627`

### 卡片层

- `cardGlass = rgba(255,255,255,0.78)`
- `cardSoft = rgba(255,255,255,0.90)`
- `cardMuted = #F7F9FD`

### 描边层

- `lineSoft = rgba(148,163,184,0.22)`
- `lineStrong = #D8E0EF`
- `lineSelected = #85A7FF`

### 文字层

- `textPrimary = #101828`
- `textSecondary = #667085`
- `textTertiary = #94A3B8`
- `textOnPrimary = #FFFFFF`

### 强调色

- `brandPrimary = #4F7CFF`
- `brandPrimarySoft = #EAF0FF`
- `brandSecondary = #6C8EEA`

### 状态色

- `stateSuccess = #17B26A`
- `stateSuccessSoft = #DDF7EA`
- `stateWarning = #F79009`
- `stateWarningSoft = #FFF7E8`
- `stateDanger = #F04438`
- `stateDangerSoft = #FEECEC`

### 考试模式补充

- `examSurface = #13203A`
- `examAccent = #89A7FF`
- `examTimer = #FFCD6B`

---

## 3. 圆角 Token

- `radiusXs = 10dp`
- `radiusSm = 14dp`
- `radiusMd = 18dp`
- `radiusLg = 24dp`
- `radiusXl = 30dp`
- `radiusPill = 999dp`

使用建议：

- 输入框：`14dp`
- 小标签：`999dp`
- 普通卡片：`24dp`
- 主 Hero 卡：`30dp`

---

## 4. 间距 Token

- `space4 = 4dp`
- `space6 = 6dp`
- `space8 = 8dp`
- `space10 = 10dp`
- `space12 = 12dp`
- `space14 = 14dp`
- `space16 = 16dp`
- `space18 = 18dp`
- `space20 = 20dp`
- `space24 = 24dp`
- `space28 = 28dp`
- `space32 = 32dp`

使用原则：

- 页面外边距优先 `20dp`
- 卡片内边距优先 `20dp`
- 卡片内模块间距优先 `12dp` 或 `16dp`
- 主内容块之间优先 `16dp`

---

## 5. 字体 Token

建议字体：

- 中文首选：`MiSans` 或 `HarmonyOS Sans SC`
- 兜底：`Noto Sans SC`

### 字号层级

- `display = 34sp`
- `headlineL = 28sp`
- `headlineM = 26sp`
- `titleL = 22sp`
- `titleM = 18sp`
- `bodyL = 16sp`
- `bodyM = 14sp`
- `bodyS = 12sp`
- `label = 13sp`

### 字重层级

- `weightBold`
- `weightSemiBold`
- `weightMedium`
- `weightRegular`

### 使用规则

- 页面标题：`display` 或 `headlineL`
- 题干：`headlineM`
- 卡片标题：`titleL`
- 正文：`bodyL`
- 辅助文案：`bodyM`
- 标签：`label`

---

## 6. 阴影与氛围 Token

整体原则：

- 不使用传统厚重阴影
- 更偏柔和光晕和层次感

建议层级：

- `shadowNone`
- `shadowSoft`
- `shadowFocus`

视觉策略：

- 卡片主要靠亮底 + 柔和描边 + 轻微分层
- 背景可带很淡的蓝白渐变和模糊光团

---

## 7. 按钮 Token

### 主按钮

用途：

- 开始刷题
- 提交答案
- 确认导入
- 开始考试

样式：

- 实心蓝底
- 白字
- 圆角 `999dp`
- 高度偏舒展

### 副按钮

用途：

- 查看解析
- 导入题库
- 再次筛选
- 更多操作

样式：

- 半透明白底
- 细描边
- 深色字

### 危险按钮

用途：

- 删除题库
- 清空记录

样式：

- 浅红底或红色描边
- 不要过度刺激

---

## 8. 卡片 Token

### Hero Card

用途：

- 首页当前题库主卡

特征：

- 大圆角
- 浅玻璃感
- 内边距大
- CTA 清晰

### Metric Card

用途：

- 错题数
- 最近成绩
- 今日进度

特征：

- 小卡片
- 信息短平快
- 数值为焦点

### Question Card

用途：

- 刷题页题干与选项容器

特征：

- 大字题干
- 单一视觉中心
- 下方操作区稳定

### Preview Card

用途：

- 导入预览单题

特征：

- 结构清楚
- 支持显示异常状态

---

## 9. 标签 Token

标签类型：

- 普通标签
- 强调标签
- 状态标签

使用示例：

- `第12题`
- `单选题`
- `顺序练习`
- `待确认`
- `已选`

规则：

- 标签文案要短
- 不堆满一整行
- 不让标签抢过主内容

---

## 10. 选项状态 Token

### 默认态

- 白底或浅卡底
- 弱描边
- 普通字重

### 已选态

- 浅蓝底
- 明显描边
- 选项字母圆点变强
- 文字字重略升

### 正确态

- 浅绿底
- 绿色描边
- 正确标签可出现

### 错误态

- 浅红底
- 红色描边
- 只在提交后出现

### 禁用态

- 降低对比
- 不影响正确答案信息展示

---

## 11. 输入区 Token

适用：

- 导入文本框
- 搜索框
- 文件导入说明区

规则：

- 输入框圆角统一
- 文字区边框轻
- 高级选项默认折叠
- 不做后台表格味

---

## 12. 动效 Token

### 页面切换

- 淡入
- 轻上浮

### 选项交互

- 120~180ms 快速反馈
- 边框和底色同时变化

### 结果展示

- 分段出现
- 不做夸张弹跳

---

## 13. 首批 Compose 实现映射

建议直接映射成这些基础组件：

- `ShirohaScaffold`
- `ShirohaHeader`
- `GlassCard`
- `MetricCard`
- `ActionPillButton`
- `StatusChip`
- `QuizOptionCard`
- `UploadPanel`
- `NoticeCard`

---

## 14. 当前结论

下一步工程实现必须严格遵守这套 Token。

原则只有一句：

- 先统一基础视觉语言，再做页面，不要每个页面自己长一套风格。
