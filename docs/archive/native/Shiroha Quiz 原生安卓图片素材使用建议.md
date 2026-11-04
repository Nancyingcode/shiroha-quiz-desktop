# Shiroha Quiz 原生安卓图片素材使用建议

> 本文用于整理 Shiroha Quiz 原生 Android / Compose 版本的图片素材接入建议。  
> 目标是让素材服务于页面状态、功能引导和空状态提示，而不是简单堆在页面里。

---

## 一、素材使用总原则

这批素材更适合做成一套 **状态插画系统**，而不是每个页面都固定放一张大图。

推荐使用方向：

```text
状态插画
页面引导图
空状态图
加载图
完成状态图
轻量提示图
```

不推荐使用方向：

```text
大背景图
每页固定大图
铺满页面的装饰图
复杂动画素材
强烈蓝色圆形气泡背景
```

原生 Android 版应该比 WebView 版更克制。素材主要用于增强状态表达，不应该抢占题干、选项、按钮和列表内容的空间。

---

## 二、资源命名建议

原始素材文件名包含中文、数字、短横线，不适合直接作为 Android 资源名使用。建议统一改为英文小写下划线命名。

| 原素材            | 建议资源名                      | 推荐用途              |
| -------------- | -------------------------- | ----------------- |
| 01-首页欢迎小头像.png | `illus_home_welcome.png`   | 首页欢迎、个人页头像、品牌识别   |
| 02-空状态插画.png   | `illus_empty_state.png`    | 无题库、无记录、无错题、搜索无结果 |
| 03-导入题库提示.png  | `illus_import_hint.png`    | 导入页顶部引导、导入成功、待核对  |
| 04-错题本提示.png   | `illus_wrongbook_hint.png` | 错题复习、薄弱项提醒、错题为空   |
| 05-刷题中提示.png   | `illus_practice_hint.png`  | 练习前设置、刷题中轻提示      |
| 06-加载状态.png    | `illus_loading_state.png`  | 解析中、加载中、生成预览中     |
| 07-睡眠状态.png    | `illus_rest_state.png`     | 完成练习、暂无任务、阶段性休息   |
| 08-思考状态.png    | `illus_thinking_state.png` | 考试模式、提交确认、思考提示    |

建议存放位置：

```text
apps/android/app/src/main/res/drawable-nodpi/
```

原因是这些素材是插画 PNG，不是 launcher icon，也不是矢量图标。放在 `drawable-nodpi` 中，可以避免 Android 按密度二次缩放，实际显示大小由 Compose 的 `Modifier.size()` 控制，更稳定。

---

## 三、页面分配建议

### 1. 首页 HomeScreen

推荐素材：

```text
illus_home_welcome.png
```

首页素材的作用是品牌识别和欢迎，不是内容主体。

建议放置位置：

```text
首页顶部欢迎卡
当前题库概览卡右侧
个人状态小头像
```

推荐尺寸：

```text
72dp ~ 96dp
最大不超过 120dp
```

推荐设计：

```text
GlassCard
左侧：Shiroha Quiz / 当前题库 / 今日状态
右侧：欢迎小头像
```

不建议首页放多张图，也不建议头像超过卡片高度。

---

### 2. 导入页 ImportScreen

推荐素材：

```text
illus_import_hint.png
```

导入页是最适合使用引导插画的页面，因为用户需要理解导入流程。

建议放置位置：

```text
导入页顶部说明卡
单文件导入入口附近
识别结果预览前的提示区域
```

推荐文案：

```text
先导入，再核对，最后创建题库
```

推荐尺寸：

```text
120dp ~ 148dp
```

导入解析中可以临时切换为：

```text
illus_loading_state.png
```

适合状态：

```text
正在读取文件
正在解析题库
正在生成识别结果
正在合并题目和答案
```

---

### 3. 练习页 PracticeScreen

推荐素材：

```text
illus_practice_hint.png
```

练习页要区分“未开始”和“答题中”。

#### 未开始练习时

可以显示较明显的练习引导图。

推荐尺寸：

```text
112dp ~ 136dp
```

适合位置：

```text
练习设置卡
开始练习按钮附近
题型/题量配置区域
```

#### 正在答题时

不建议常驻大图。

建议方式：

```text
隐藏插画
或缩小为 40dp ~ 48dp 的小头像
```

原因是答题中最重要的是题干、选项、答案提交和解析，插画不能挤压题卡区域。

#### 答题完成后

可以根据结果切换状态图：

| 场景        | 推荐素材                       |
| --------- | -------------------------- |
| 练习完成，表现稳定 | `illus_rest_state.png`     |
| 错题较多，需要复习 | `illus_wrongbook_hint.png` |
| 暂无题目      | `illus_empty_state.png`    |

---

### 4. 考试页 ExamScreen

推荐素材：

```text
illus_thinking_state.png
```

考试页应该比练习页更专注。

#### 考试设置页

可以显示思考状态图。

推荐尺寸：

```text
96dp ~ 128dp
```

推荐文案：

```text
配置考试参数，开始模拟
```

#### 考试进行中

尽量隐藏插画，因为考试中应优先显示题目、计时器、答题进度和提交按钮。

#### 提交确认

可以使用小号思考图。

推荐尺寸：

```text
64dp ~ 80dp
```

#### 考试完成

根据结果切换：

| 场景    | 推荐素材                       |
| ----- | -------------------------- |
| 成绩较好  | `illus_rest_state.png`     |
| 错题较多  | `illus_wrongbook_hint.png` |
| 未生成结果 | `illus_empty_state.png`    |

---

### 5. 题库详情页 BankDetailScreen

推荐素材：

```text
illus_empty_state.png
```

题库详情页是列表页，不建议常驻插画。只在以下情况显示：

```text
题库为空
搜索无结果
筛选后没有题目
题库导入失败后暂无内容
```

推荐尺寸：

```text
128dp ~ 156dp
```

推荐组件形式：

```text
EmptyStateCard
标题：这里还没有题目
说明：可以先去导入题库，或创建一个空题库
按钮：去导入题库
```

---

### 6. 我的页 MeScreen

推荐素材：

```text
illus_home_welcome.png
或
illus_rest_state.png
```

使用方式：

```text
顶部应用信息卡：小欢迎头像
版本说明 / 关于区域：不放图或放极小图
休息提示：睡眠状态图
```

推荐尺寸：

```text
64dp ~ 88dp
```

我的页不建议放大图，也不建议多个设置卡片都带图。

---

## 四、未来页面预留建议

如果后续原生版扩展出独立错题本、刷题记录、收藏题页面，可以按下面使用。

| 页面    | 推荐素材                                                | 用法          |
| ----- | --------------------------------------------------- | ----------- |
| 错题本   | `illus_wrongbook_hint.png`                          | 顶部提醒、错题为空状态 |
| 刷题记录  | `illus_rest_state.png`                              | 暂无记录、阶段性回顾  |
| 收藏题   | `illus_empty_state.png`                             | 空收藏状态       |
| 加载页   | `illus_loading_state.png`                           | 全局解析 / 加载状态 |
| 导入核对页 | `illus_import_hint.png` 或 `illus_loading_state.png` | 等待核对、正在生成预览 |

---

## 五、尺寸建议总表

| 使用场景    | 推荐尺寸          |
| ------- | ------------- |
| 首页欢迎头像  | 72dp ~ 96dp   |
| 顶部引导卡插画 | 112dp ~ 136dp |
| 导入页主插画  | 120dp ~ 148dp |
| 空状态插画   | 128dp ~ 156dp |
| 答题中小头像  | 40dp ~ 48dp   |
| 考试设置插画  | 96dp ~ 128dp  |
| 加载状态插画  | 96dp ~ 120dp  |
| 我的页头像   | 64dp ~ 88dp   |
| 提交确认小图  | 64dp ~ 80dp   |

简单原则：

```text
答题前可以大一点；
答题中必须小一点；
空状态可以居中；
列表页不要常驻大图；
工具页插画要克制。
```

---

## 六、Compose 组件封装建议

不要在每个页面里重复写 `Image()`。建议封装成统一的插画组件，方便后续统一控制大小、透明度、圆角和动画。

### 1. 页面顶部插画卡

适合首页、导入页、练习设置、考试设置。

```kotlin
@Composable
fun IllustrationHeroCard(
    title: String,
    subtitle: String,
    @DrawableRes imageRes: Int,
    modifier: Modifier = Modifier,
    imageSize: Dp = 112.dp,
    content: @Composable ColumnScope.() -> Unit = {}
)
```

推荐用于：

```text
首页欢迎卡
导入说明卡
练习设置卡
考试设置卡
```

---

### 2. 空状态插画组件

适合无题库、无错题、无记录、搜索无结果。

```kotlin
@Composable
fun EmptyStateIllustration(
    title: String,
    message: String,
    @DrawableRes imageRes: Int,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null
)
```

推荐用于：

```text
题库为空
错题为空
记录为空
搜索无结果
导入结果为空
```

---

### 3. 加载状态组件

适合文件读取、题库解析、生成预览。

```kotlin
@Composable
fun LoadingIllustration(
    text: String,
    @DrawableRes imageRes: Int = R.drawable.illus_loading_state
)
```

推荐动画：

```text
alpha 0.88 → 1.0
scale 0.98 → 1.02
```

不推荐动画：

```text
大范围 blur
复杂粒子
长时间旋转
多层阴影动画
频繁重组触发动画
```

---

## 七、动画使用建议

原生 Android 版可以有动画，但应该轻量。

推荐动画场景：

```text
启动页
加载中
导入解析中
完成状态
空状态淡入
```

不建议动画场景：

```text
每次页面切换都大幅动画
题卡选项频繁闪动
底部导航复杂动效
大图循环浮动
全屏粒子或模糊背景
```

推荐参数：

```text
动画时长：150ms ~ 300ms
scale 范围：0.98 ~ 1.02
alpha 范围：0.85 ~ 1.0
```

---

## 八、视觉风格建议

Shiroha Quiz 的整体视觉方向是：

```text
蓝白
轻量
云母 / 亚克力质感
卡片化
干净柔和
```

素材接入时建议：

```text
图片区域使用白色或极浅蓝白底
卡片边框使用浅蓝灰
阴影轻微即可
图片保持完整显示
不要使用明显边界
不要使用大蓝色圆形气泡
不要使用强烈紫色渐变
```

推荐卡片效果：

```text
白色或接近白色背景
浅蓝灰边框
轻微阴影
图片透明背景
文字层级清晰
```

不推荐：

```text
大面积纯蓝背景
深色阴影
高强度毛玻璃
图片后方强烈圆形色块
图片被裁切或压缩变形
```

---

## 九、资源压缩建议

素材进入原生项目之前建议先压缩。

推荐方式：

```text
PNG 保留透明背景
或 WebP lossless
```

如果对体积要求更高，可以使用：

```text
WebP quality 80 ~ 90
```

但要检查：

```text
边缘是否发糊
透明区域是否异常
浅色线条是否丢失
角色眼睛和线稿是否失真
```

推荐原则：

```text
透明图优先保证边缘清晰；
不要为了极限压缩牺牲线稿；
最终显示尺寸不大时，可适当降低分辨率；
每张素材最大边长可以控制在 512px ~ 768px。
```

---

## 十、推荐接入顺序

不要一次性把 8 张素材全部塞进所有页面。建议分阶段接入，方便测试和调整。

### 第一阶段：低风险接入

先接入：

```text
illus_home_welcome.png
illus_import_hint.png
illus_empty_state.png
illus_loading_state.png
```

原因：

```text
不影响答题主流程
主要用于首页、导入页和空状态
风险最低
```

### 第二阶段：学习场景接入

再接入：

```text
illus_practice_hint.png
illus_thinking_state.png
illus_wrongbook_hint.png
```

原因：

```text
这些会接近答题和考试主流程
需要测试是否影响题卡空间
```

### 第三阶段：完成 / 休息状态

最后接入：

```text
illus_rest_state.png
```

适合场景：

```text
今日练习完成
暂无刷题记录
暂无待复习错题
考试结束后
```

---

## 十一、最终推荐分配表

| 页面 / 状态              | 推荐素材                                              | 显示方式       |
| -------------------- | ------------------------------------------------- | ---------- |
| HomeScreen 首页        | `illus_home_welcome.png`                          | 顶部欢迎卡，小尺寸  |
| ImportScreen 导入页     | `illus_import_hint.png`                           | 顶部引导卡，中尺寸  |
| ImportScreen 解析中     | `illus_loading_state.png`                         | 加载状态，中小尺寸  |
| PracticeScreen 未开始   | `illus_practice_hint.png`                         | 练习设置卡，中尺寸  |
| PracticeScreen 答题中   | `illus_practice_hint.png`                         | 小头像或隐藏     |
| PracticeScreen 完成    | `illus_rest_state.png`                            | 完成状态卡      |
| ExamScreen 设置页       | `illus_thinking_state.png`                        | 考试设置卡，中小尺寸 |
| ExamScreen 考试中       | 不显示或极小图                                           | 保持专注       |
| ExamScreen 提交确认      | `illus_thinking_state.png`                        | 小尺寸        |
| BankDetailScreen 空状态 | `illus_empty_state.png`                           | 居中空状态      |
| MeScreen 我的页         | `illus_home_welcome.png` 或 `illus_rest_state.png` | 顶部小头像      |
| 错题提醒                 | `illus_wrongbook_hint.png`                        | 错题卡 / 空状态  |
| 刷题记录为空               | `illus_rest_state.png`                            | 空状态 / 回顾状态 |

---

## 十二、结论

这批素材最适合在原生 Android 版中作为：

```text
轻量状态插画系统
```

而不是作为：

```text
页面背景图或大面积装饰图
```

最终目标是：

```text
让每张图都有明确语义；
让素材帮助用户理解当前状态；
不挤压题目、选项、列表和按钮；
保持蓝白轻量风格；
避免大图堆叠和过度动画。
```

建议最终接入策略：

```text
首页欢迎
导入引导
练习前提示
考试思考
错题提醒
空状态
加载中
完成休息
```

这样可以让原生 Android 版既有 Shiroha Quiz 的角色识别度，又保持正式 App 的干净、稳定和流畅。
