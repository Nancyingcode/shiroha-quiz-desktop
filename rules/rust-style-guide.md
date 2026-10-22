# Rust 风格指南（工程实践版）

> 基准：Rust 2024 edition（rustc ≥ 1.85）、rustfmt / clippy 稳定版。
> 优先级：**官方默认风格 > 工具默认配置 > 本指南的补充约定**。
> 凡是可以由 `rustfmt` / `clippy` / 编译器判定的规则，都不应写进人工评审。

---

## 0. 三层规范，各管各的

| 层 | 载体 | 管什么 | 谁执行 |
| --- | --- | --- | --- |
| 格式 | `rustfmt` | 空格、换行、缩进、逗号、导入排序 | 机器，零讨论 |
| 正确性 / 坏味道 | `clippy` + 编译器 lint | `unwrap`、多余 `clone`、可读性陷阱 | 机器 + CI |
| 设计与命名 | Rust API Guidelines + 本指南 | 命名、签名、错误类型、trait 边界 | 人工评审 |

**核心原则：不要手写 rustfmt 能改的东西，也不要用 rustfmt 去争论设计。**

---

## 1. 工具链基线

### 1.1 固定工具链

```toml
# rust-toolchain.toml
[toolchain]
channel = "1.85"          # 与 MSRV 对齐，避免 "我本地能编"
components = ["rustfmt", "clippy"]
```

### 1.2 rustfmt：尽量只改默认值

官方风格就是 rustfmt 默认值（4 空格、100 列、块缩进、尾逗号），因此配置越少越好：

```toml
# rustfmt.toml
max_width = 100
tab_spaces = 4
use_field_init_shorthand = true
use_try_shorthand = true
newline_style = "Unix"
```

- `cargo fmt` 会自动读取 `Cargo.toml` 的 `edition`，无需重复配置。
- **不要**为了"好看"开启 nightly-only 选项（`imports_granularity`、`group_imports`、`wrap_comments` 等），它们会让贡献者在不稳定工具链上才能通过检查。
- 团队若坚持某种非默认风格（如 80 列），必须写进本文件并接受"与社区生态不一致"的代价。

### 1.3 Cargo lint 配置（Rust 1.74+，工作区统一）

```toml
# 根 Cargo.toml
[workspace.lints.rust]
unsafe_op_in_unsafe_fn = "deny"
missing_docs = "warn"
unused_must_use = "deny"

[workspace.lints.clippy]
all = { level = "deny", priority = -1 }        # 组用负 priority，单条才能覆盖
pedantic = { level = "warn", priority = -1 }
# 明确豁免，避免"永远红着"
module_name_repetitions = "allow"
must_use_candidate = "allow"
missing_errors_doc = "allow"
```

```toml
# 每个成员 crate
[lints]
workspace = true
```

### 1.4 CI 三件套

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```

> `-D warnings` 只放在 CI；本地保留 `warn`，否则重构期间寸步难行。

---

## 2. 格式规范（= rustfmt 默认风格）

### 2.1 硬性规则

| 规则 | 值 |
| --- | --- |
| 缩进 | 4 个空格，**禁止 Tab** |
| 最大行宽 | 100 字符（含缩进） |
| 换行列表 | 必须有**尾逗号** |
| 空行 | 0 或 1 行，禁止连续两个空行 |
| 行尾 | 禁止任何空白（含字符串字面量内部） |
| 排序 | 需要排序处使用 version sort（`x8` 在 `x16` 前，`u8` 在 `u16` 前） |

### 2.2 块缩进，不要视觉缩进

```rust
// ✅ 块缩进：改函数名时 diff 只动一行
some_function(
    first_argument,
    second_argument,
);

// ❌ 视觉缩进：右漂移 + 改名即全量 diff
some_function(first_argument,
              second_argument);
```

### 2.3 尾逗号

```rust
let config = Config {
    name: "demo".to_owned(),
    retries: 3,          // ← 换行列表末尾必须有逗号
};
```

### 2.4 注释

- 行注释 `//` 优于块注释 `/* */`；`//` 后必须有**一个空格**。
- 整行注释长度：**含 `//` 不超过 80 列**（长缩进时以 100 列上限为准）。
- 注释是完整句子：首字母大写、句号结尾；行尾注释可用短语。
- 文档注释用 `///`；`//!` 只用于 crate / module 级。
- **文档注释写在属性之前**：

```rust
/// 解析配置文件。
#[must_use]
pub fn parse(input: &str) -> Result<Config, ParseError> { /* ... */ }
```

### 2.5 属性

```rust
#[repr(C)]
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg(feature = "serde")]
pub struct Point {
    pub x: f32,
    pub y: f32,
}
```

- 一行一个属性；**多个 `derive` 必须合并成一个**。
- `#[foo = 42]` 等号两侧各一个空格。
- 参数过长的属性按函数调用方式换行。

### 2.6 不要做的事

- ❌ 手工对齐 `=`、`:`、行尾注释（rustfmt 会打回，评审纯噪音）。
- ❌ 用空行"分区"超过两级（用 `mod` 拆分，而不是注释横线）。
- ❌ 提交前不跑 `cargo fmt`。

---

## 3. 命名

### 3.1 基本表（RFC 430）

| 项 | 约定 | 示例 |
| --- | --- | --- |
| 模块 | `snake_case` | `http_client` |
| 类型 / trait / 枚举变体 | `UpperCamelCase` | `HttpClient`, `Display` |
| 函数 / 方法 / 局部变量 | `snake_case` | `parse_header` |
| 常量 / 静态量 | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES` |
| 宏 | `snake_case!` | `vec!`, `cfg_if!` |
| 泛型参数 | 简短 `UpperCamelCase` | `T`, `K`, `V`, `E` |
| 生命周期 | 短小写 | `'a`, `'de`, `'src` |
| Crate | 简短、无 `-rs` / `-rust` 前后缀 | `serde`, `tokio` |

### 3.2 缩写算一个词

- 类型：`Uuid`（非 `UUID`）、`Usize`（非 `USize`）、`Stdin`（非 `StdIn`）。
- 函数：`is_xid_start`、`btree_map`（非 `b_tree_map`）。
- 单个字母只能出现在词尾：`PI_2` 而非 `PI2`。

### 3.3 转换方法命名（高频错误区）

| 前缀 | 成本 | 所有权变化 |
| --- | --- | --- |
| `as_` | 免费（仅重解释） | 借用 → 借用 |
| `to_` | 有成本（分配 / 计算 / 校验） | 借用 → 借用，或借用 → 拥有 |
| `into_` | 可变 | 拥有 → 拥有（非 `Copy`） |

```rust
impl User {
    fn as_str(&self) -> &str { &self.name }        // 零成本视图
    fn to_uppercase_name(&self) -> String { ... }  // 分配
    fn into_inner(self) -> String { self.name }    // 消耗 self
}
```

### 3.4 getter 不写 `get_`

```rust
impl Config {
    pub fn timeout(&self) -> Duration { self.timeout }
    pub fn timeout_mut(&mut self) -> &mut Duration { &mut self.timeout }
}
```

仅在"只有一个显然可取的东西"时用 `get`（如 `Cell::get`）；容器式访问用 `get` / `get_mut` / `get_unchecked` 一族。

### 3.5 迭代器三件套

```rust
fn iter(&self) -> Iter<'_, T>;            // Item = &T
fn iter_mut(&mut self) -> IterMut<'_, T>; // Item = &mut T
fn into_iter(self) -> IntoIter<T>;        // Item = T
```

方法名与返回类型名必须对应：`into_iter` → `IntoIter`，`keys` → `Keys`。

### 3.6 词序一致

错误类型统一 **动词-宾语-Error**：`ParseAddrError` 而非 `AddrParseError`；同 crate 内不得混用两种词序。

### 3.7 Cargo feature 名

- 不写占位词：`std` 而非 `use-std` / `with-std`。
- feature 必须**可叠加**（additive），因此 `no-xxx` 这类否定名几乎总是错的。

---

## 4. 导入与模块

```rust
// 1) 标准库
use std::collections::HashMap;
use std::path::Path;

// 2) 第三方
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

// 3) 本 crate（绝对路径优先）
use crate::config::Config;
use crate::error::Result;

// 4) 父/当前模块
use super::helper;
```

- 分四组、组间空一行；组内按字母序。（rustfmt 默认不重排分组，需人工保持。）
- 禁止在非测试代码里 `use super::*;`；测试模块内可放宽。
- 模块文件用 `foo.rs` + `foo/` 目录，**不用** `foo/mod.rs`（2018 之后的推荐写法）。
- 公开 API 在 `lib.rs` 用 `pub use` 收敛，调用方路径稳定：

```rust
// lib.rs
mod client;
mod error;

pub use client::Client;
pub use error::{Error, Result};
```

---

## 5. 函数签名与 API 设计

### 5.1 参数：借用最泛化的类型

```rust
// ✅
fn load(path: &Path) -> Result<Config>;
fn parse(input: &str) -> Result<Ast>;
fn sum(values: &[i32]) -> i32;

// ❌ 强制调用方交出所有权 / 暴露具体容器
fn load(path: &PathBuf) -> Result<Config>;
fn parse(input: &String) -> Result<Ast>;
fn sum(values: &Vec<i32>) -> i32;
```

> `impl AsRef<Path>` 只在**确实要接受多种类型**时使用；它会带来单态化膨胀和更差的报错信息，不要无脑套。

### 5.2 返回：该给所有权就给

- 需要独立数据 → 返回拥有型（`String` / `Vec<T>`）。
- 只是在原有数据上"开窗" → 返回借用（`&str` / `&[T]`）。
- 隐藏实现细节 → `-> impl Iterator<Item = &T>`。
- **不要**返回 `&Vec<T>` 或 `&String` 作为公共 API。

### 5.3 构造与默认值

```rust
impl Client {
    pub fn new(base_url: Url) -> Self { /* ... */ }
    pub fn with_timeout(self, timeout: Duration) -> Self { /* builder 风格 */ }
}

impl Default for Config { /* 明确默认语义 */ }
```

- `new` 用于最常见构造；`with_xxx` 用于补充配置；`from_xxx` 用于转换构造。
- 多可选参数的构造优先 **builder**，而不是 6 个 `Option` 参数。
- 构建结果给 `#[must_use]`。

### 5.4 用类型表达约束

```rust
// ❌ bool 参数：调用处无法阅读
fn connect(host: &str, tls: bool);

// ✅ 枚举
enum Security { Tls, Plain }
fn connect(host: &str, security: Security);

// ✅ newtype 守住不变量：构造即校验
pub struct Port(u16);

impl Port {
    pub fn new(value: u16) -> Result<Self, PortError> {
        if value == 0 { return Err(PortError::Zero); }
        Ok(Self(value))
    }
    pub fn get(self) -> u16 { self.0 }
}
```

### 5.5 演进与稳定性

- 公开枚举 / 结构体加 `#[non_exhaustive]`，为将来加字段留路。
- trait 若不想被外部实现，用 **sealed trait** 模式。
- 不要为"只有一个实现"的抽象写 trait；trait 的成本是读者要多跳一层。
- 公共 API 变更遵循 SemVer；`0.x` 也应按 SemVer 理解（0.x.y 中 x 变更即破坏性）。

### 5.6 派生

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Key(String);
```

- **所有公开类型都 `derive(Debug)`**（手写 `Debug` 时避免泄露密钥）。
- `Copy` 只给确实"像整数"的小类型（≤ 2 个字）。
- `PartialEq` / `Eq` / `Hash` 三者要成套出现，否则容器行为诡异。
- 派生顺序（团队约定）：`Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash`。

---

## 6. 错误处理

### 6.1 库 vs 应用

| 场景 | 方案 |
| --- | --- |
| 库（给别人用） | `thiserror` 定义具体错误枚举，保留 `source` |
| 应用 / 二进制 | `anyhow::Result` 或自定义顶层错误 |
| 库的公共 API | **禁止** `Box<dyn Error>` / `anyhow::Error`（调用方无法匹配变体） |

```rust
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("failed to open config at {path}")]
    Open {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid config syntax")]
    Parse(#[from] toml::de::Error),
}
```

### 6.2 规则

- 可恢复错误一律 `Result` + `?`，由 `From` 自动转换。
- **禁止**用 `unwrap()` 处理外部输入；`expect("...")` 只能用于"逻辑上不可能失败"并写明原因。
- `panic!` 只用于违反程序不变量 / 编程错误，不能用于用户输入校验，不能跨 FFI 边界。
- 错误信息：小写开头、不带句号、包含定位信息（路径、字段名、具体值）。
- 不要 `unwrap_or_default()` 悄悄吞掉错误；要吞必须显式 `let _ = ...` 并注释。
- `main` 返回 `Result<(), E>`（`E: Debug`）即可，别写 `std::process::exit(1)` 散落各处。

### 6.3 Option 组合子替代嵌套分支

```rust
// ❌
let name = match user.nickname {
    Some(n) => n,
    None => user.email.clone(),
};

// ✅
let name = user.nickname.clone().unwrap_or_else(|| user.email.clone());

// ✅ 提前返回
let Some(raw) = map.get(key) else { return None };
let value = raw.parse()?;
```

---

## 7. 所有权与惯用法

- **能借就不 clone**；确实需要 clone 时，问一句"这里能不能改成借用/`Rc`/重排生命周期"。
- 迭代器链优先于索引循环：

```rust
// ✅
let total: u64 = items.iter().filter(|i| i.active).map(|i| i.amount).sum();

// ❌ 需要边界检查、易越界
let mut total = 0;
for i in 0..items.len() { if items[i].active { total += items[i].amount; } }
```

- 批量收集 `Result`：`let all: Vec<T> = iter.collect::<Result<_, _>>()?;`
- 可能借用也可能拥有 → `Cow<'_, str>`。
- 已知规模时 `Vec::with_capacity(n)`。
- 不要 `if flag == true`、不要 `return true; else { return false; }`。
- 单态分发优先：`impl Trait` > 泛型参数 > `Box<dyn Trait>`；只有需要异构集合或动态切换时才上 `dyn`。
- 闭包里捕获大对象时注意生命周期，必要时 `move`。
- `String` 拼接循环用 `push_str`，不要 `s = s + &x`（每次重分配）。

---

## 8. 文档

```rust
//! 轻量配置加载器。
//!
//! ```
//! let cfg = my_crate::Config::from_str("port = 8080")?;
//! assert_eq!(cfg.port, 8080);
//! # Ok::<(), my_crate::Error>(())
//! ```

/// 从 TOML 文本加载配置。
///
/// # Errors
/// 当输入不是合法 TOML，或必填字段缺失时返回 [`Error`]。
///
/// # Panics
/// 不会 panic。
pub fn from_str(input: &str) -> Result<Config, Error> { /* ... */ }
```

- crate 级 `//!`：一句话说明 + 最小可运行示例。
- 公开项必须有文档；靠 `missing_docs` lint 兜底。
- 固定小节：`# Examples`、`# Errors`、`# Panics`、`# Safety`（unsafe 函数**必须**有 `# Safety`）。
- 文档示例即 doctest，会编译运行；不希望运行时用 `no_run`，演示编译失败用 `compile_fail`。
- 用 intra-doc link ``[`Type`]`` 而不是裸文本，`cargo doc` 会检查断链（`#![deny(rustdoc::broken_intra_doc_links)]`）。

---

## 9. `unsafe`

```rust
/// # Safety
/// `ptr` 必须指向已初始化、对齐且长度不小于 `len` 的 `u8` 缓冲区。
pub unsafe fn read_raw(ptr: *const u8, len: usize) -> Vec<u8> {
    // SAFETY: 调用方按契约保证 ptr 有效且长度足够；此处只读，不跨界。
    unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec()
}
```

规则：

1. **每个 `unsafe` 块都要 `// SAFETY:` 注释**，说明"为什么这里满足安全前提"（用 `clippy::undocumented_unsafe_blocks` 强制）。
2. `unsafe fn` 内部也要写 `unsafe {}`（edition 2024 的 `unsafe_op_in_unsafe_fn` 默认警告，建议 `deny`）。
3. 把 `unsafe` 收缩到最小块，外面包一层安全抽象。
4. `unsafe` 代码配 Miri（`cargo +nightly miri test`）或 sanitizer 进 CI。
5. 不要用 `unsafe` 逃避借用检查；先证明安全版本不可行。

---

## 10. 测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_port_from_valid_input() {
        assert_eq!(Config::from_str("port = 8080").unwrap().port, 8080);
    }

    #[test]
    fn rejects_zero_port() {
        assert!(Config::from_str("port = 0").is_err());
    }
}
```

- 单元测试与被测代码同文件；集成测试放 `tests/`。
- 命名描述**行为**而非实现：`rejects_zero_port` 优于 `test_parse_2`。
- 用 `assert_eq!` 而非 `assert!(a == b)`，失败信息才有值。
- 表驱动处理多组输入：

```rust
#[test]
fn parses_all_valid_forms() {
    for (input, expected) in [("1", 1), ("0x10", 16), ("0b11", 3)] {
        assert_eq!(parse(input), Ok(expected), "input = {input}");
    }
}
```

- 断言消息里带上输入，否则 CI 红了你得复现一遍。
- 不测私有实现细节；测公开行为。
- 并发 / 时间相关逻辑用可控时钟或 `loom`，不要 `sleep` 赌时序。

---

## 11. Cargo 与项目结构

```toml
[package]
name = "my-crate"
version = "0.3.0"
edition = "2024"
rust-version = "1.85"        # MSRV，CI 单独跑一次
license = "MIT OR Apache-2.0"

[dependencies]
serde = { version = "1", features = ["derive"] }

[dev-dependencies]
pretty_assertions = "1"
```

- 多 crate 用 workspace，`[workspace.lints]` 统一 lint。
- `Cargo.lock`：可执行程序提交，库不提交。
- 依赖最小化：能用 `std` 就不加 crate；每个新依赖都要评估维护状态与许可证。
- 不写 `version = "*"`；默认用主版本范围 `"1"`。
- feature 可叠加、默认集最小；`default = ["std"]` 是常见正确写法。

---

## 12. 评审清单

复制到 PR 模板：

- [ ] `cargo fmt --check` 通过（无手工对齐、无行尾空白）
- [ ] `cargo clippy -D warnings` 通过，新增 `allow` 有理由
- [ ] 命名符合 §3（含 `as_/to_/into_`、getter、迭代器三件套）
- [ ] 公共 API 无 `&String` / `&Vec<T>` / `Box<dyn Error>` 泄漏
- [ ] 错误类型具体、可匹配、带 `#[source]`；无滥用 `unwrap`
- [ ] 公开类型 `derive(Debug)`；公开枚举考虑 `#[non_exhaustive]`
- [ ] 公开项有文档；`# Errors` / `# Safety` 齐全
- [ ] 每个 `unsafe` 块有 `// SAFETY:`
- [ ] 新增逻辑有测试，测试名描述行为
- [ ] 无无谓 `clone` / `collect` / `String` 拼接
- [ ] 新依赖已评估（体积、许可证、维护状态）

---

## 13. 参考

- The Rust Style Guide（格式的唯一权威）：<https://doc.rust-lang.org/nightly/style-guide/>
- Rust API Guidelines（命名与 API 设计）：<https://rust-lang.github.io/api-guidelines/>
- RFC 430 Naming Conventions：<https://github.com/rust-lang/rfcs/blob/master/text/0430-finalizing-naming-conventions.md>
- rustfmt 配置项：<https://rust-lang.github.io/rustfmt/>
- Clippy lint 列表：<https://rust-lang.github.io/rust-clippy/master/>
- Rust 2024 Edition 指南：<https://doc.rust-lang.org/edition-guide/rust-2024/>

---

### 附：只记 10 条

1. 格式全部交给 `rustfmt`，配置保持默认。
2. 4 空格、100 列、换行列表加尾逗号。
3. 参数用 `&str` / `&[T]` / `&Path`，不用 `&String` / `&Vec<T>` / `&PathBuf`。
4. 转换命名：`as_` 免费、`to_` 有成本、`into_` 消耗所有权。
5. getter 不写 `get_`；迭代器用 `iter` / `iter_mut` / `into_iter`。
6. 库用具体错误枚举（thiserror），应用用 anyhow；公共 API 不暴露 `Box<dyn Error>`。
7. 每个 `unsafe` 块写 `// SAFETY:`，并尽量缩小范围。
8. 公开类型 `derive(Debug)`，公开项写文档，unsafe 函数写 `# Safety`。
9. 能借不 clone，迭代器链优于索引循环。
10. CI 三件套：`fmt --check`、`clippy -D warnings`、`test`。
