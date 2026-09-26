# TermZero

Yunzai NG 的远程执行插件：把 `rj` / `rjp` / `rc` / `rcp` / `sc` / `md` 六条命令交给主人，用来在机器人所在的
机器上跑一段 JS、跑一条 Shell、看一个文件的源码、把一段 Markdown 渲成图。

六条命令**全部仅限主人**，是机器人权限最高的一组口子：任意 JS、任意 Shell、任意文件读取。装它即代表你
清楚这层风险。

本仓库是 [Yunzai NG](https://github.com/Yunzai-NG/yunzai-ng) 的可选插件，不随内核分发。

## 安装

克隆至主目录的 `plugins/` 下并自行编译：

```powershell
cd <主目录>\plugins
git clone https://github.com/Yunzai-NG/TermZero.git TermZero
cd TermZero
pnpm install
pnpm run build
```

随后在面板的插件页重载，或重启内核。`dist/` 不进 git，故**不编译就没有入口**。

出图版（`rjp` / `rcp` / `sc` / `md`）依赖一个渲染器插件（如 `renderer-puppeteer`）。没装渲染器时它们会
**自动回退到纯文本**，不会报错。

## 使用

触发词直接顶着内容写，中间的空格可有可无：

| 命令 | 说明 | 例 |
|---|---|---|
| `rj<代码>` | 执行一段 JS，回**文本** | `rj 1+1` |
| `rjp<代码>` | 执行一段 JS，回**图**（带颜色） | `rjp process.version` |
| `rc<命令>` | 执行一条 Shell 命令，回**文本** | `rc ls -al` |
| `rcp<命令>` | 执行一条 Shell 命令，回**图**（带提示符与颜色） | `rcp git log --oneline -5` |
| `sc<路径>` | 查看某个文件的源码（带行号），回**图** | `sc ./package.json` |
| `sc起~止<路径>` | 同上，只看指定行区间 | `sc10~40 ./src/index.ts` |
| `md<文件\|链接\|文本>` | 把 Markdown 渲染成**图** | `md ./README.md` |

### rj / rjp —— 跑 JS

代码在一个带绑定的异步作用域里执行，可直接用这四个名字：

- `e` —— 当前消息事件（`e.reply(...)`、`e.sender` 等）
- `ctx` —— 插件上下文（`ctx.http`、`ctx.logger`、`ctx.app` 等）
- `seg` —— 消息段构造器（`seg.image(...)`、`seg.at(...)` 等）
- `logger` —— 日志器

顶层 `await` 与顶层 `return` 都合法。单个表达式会被直接回显（`rj 1+1` → `2`），多句或含 `return` 的按
语句块执行。求值过程中抛的错会被抓住、回给你看，而不会被内核当成「命令崩了」。

### rc / rcp —— 跑 Shell

一次给出完整命令串，经系统 shell 执行：Windows 走 PowerShell，其余系统走 `$SHELL` 或 `/bin/sh`。
stdout、stderr、退出码都会收回。命令有超时（配置项，默认 60s），超时即杀掉进程并回报。

### sc —— 看源码

给一个**具体文件路径**（相对路径按机器人的工作目录解析）。带行区间时只渲染那几行，行号仍是文件里的
真实行号。路径是目录时，改为列出目录内容作为导航。单文件最多渲染 5000 行，超出截断。

### md —— 渲 Markdown

参数按此顺序识别：`http(s)` 链接则下载（有超时与体积上限），否则若是可读的本地文件则读取，再否则整段
当作 Markdown 原文渲染。所以 `md # 直接写一段` 也能出图。

## 配置

面板的插件配置页可改，分三组：

- **Shell 执行**：命令超时、输出编码（`utf8` / `latin1`）
- **输出限制**：文本回复上限（超出截断并提示改用出图版，`0` 为不限）、长图页高（超出分页）
- **Markdown 渲染**：下载超时、下载体积上限

## 设计取舍

坚持**零第三方依赖**，因此有两处刻意做减法：

1. **`sc` 只认一个具体路径**，不做「匹配到多个文件回消息选序号」的交互挑选 —— 那套要依赖框架的等待
   上下文，复杂度不划算。要浏览就传一个目录路径看清单。

2. **没有语法高亮。** `sc` 只做「等宽 + 行号 + 转义」；`md` 自带一个覆盖常见语法的 Markdown→HTML 转换器
   （标题、列表、引用、围栏/行内代码、粗斜体/删除线、链接/图片、分割线、GFM 表格）。要完整 CommonMark
   或代码着色，应另装渲染器插件。ANSI 上色（`rjp` / `rcp` 的颜色、`rj` 的 `inspect` 着色）同样是自带实现。

## 安全说明

- 六条命令全部 `.master()`，非主人一律不触发。
- 一切进入 HTML 的文本先转义再着色/渲染 —— 输出里的 `<script>` 只会「显示」出来，不会被执行。
- Markdown 链接只放行 `http(s)` 与相对路径，`javascript:` 一类协议被过滤成 `#`。
- 路径不做越界限制 —— 这本就是主人「看任意文件」的口子，门禁在 `.master()`。

## 开发

```powershell
pnpm run link:framework   # 链接框架源码包
pnpm run verify           # build + typecheck:test + lint + test 一条龙
```

## 许可

AGPL-3.0-or-later
