/**
 * 模块职责：插件入口 —— 注册 rj/rjp（跑 JS）、rc/rcp（跑 Shell）、sc（看源码）、md（渲 Markdown）六条命令
 * 依赖方向：`@yunzai-ng/core` 的 `definePlugin`/`parseDuration`；本目录的 eval/shell/source/markdown/ansi/config
 * 生命周期：`setup` 时注册命令，随插件卸载由内核一并清理
 * 注意事项：**一条命令的「文本版」与「出图版」是两条独立命令，不是一个开关。** rj/rjp、rc/rcp 各自注册。
 *          用互斥的正则（`rjp` 用正向先行断言、`rj` 用 `(?!p)` 负向断言）保证一条消息只会命中其中一条，
 *          于是注册顺序无关紧要。断言不吃字符，故 `e.command.rest` 恰好是触发词之后的全部内容 —— 要执行的
 *          代码 / 命令 / 路径。
 *
 *          **六条命令全部 `.master()`。** 任意 JS / Shell 执行、任意文件读取是整个机器人权限最高的一组口子，
 *          准入名单必须明确，故只认主人，不设任何旁路。
 *
 *          **出图失败要有纯文本兜底。** `ctx.render()` 在没有任何可用渲染器（没装 puppeteer 插件）时抛错。
 *          直接把错误抛给内核只会在日志里留一句英文、使用者那边「没反应」。故所有出图版在渲染失败时回退到
 *          对应的纯文本 —— 主人要的是那段输出本身，有没有那张图是次要的。
 */

import { readFile, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { isAbsolute, resolve } from "node:path"
import process from "node:process"
import { definePlugin, parseDuration } from "@yunzai-ng/core"
import type { MessageEvent, PluginContext, RenderedImage } from "@yunzai-ng/types"
import { ansiToHtml } from "./ansi.js"
import { CONFIG_SCHEMA } from "./config.js"
import type { TermZeroConfig } from "./config.js"
import { runJs, stringify, stringifyError } from "./eval.js"
import { markdownToHtml } from "./markdown.js"
import { parseRange, readSource } from "./source.js"
import { promptLine, runShell } from "./shell.js"

/** 出图版共用的代码模板 */
const CODE_TEMPLATE = "code.html"

/** Markdown 出图模板 */
const MARKDOWN_TEMPLATE = "markdown.html"

/**
 * 本插件的版本，从自己的 `package.json` 读
 *
 * 用 `createRequire` 而非 `import ... with { type: "json" }`：后者要 import 断言，会连带把 `tsc` 的
 * target 顶上去，为一个版本号不值当。与 yenai-state 同法。**必须在 `definePlugin` 调用之前求值** ——
 * 下面 `version: PLUGIN_VERSION` 在模块加载时立即读它，用 `const` 声明在后会撞上暂时性死区。
 */
export const PLUGIN_VERSION: string = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version

/**
 * 六条命令的触发正则
 *
 * 全部用 `(?=[\s\S])` 收尾：既保证触发词后至少有一个字符（空触发没有意义），又因先行断言不消费字符，
 * 使命中的 `whole` 恰为触发词、`rest` 恰为其后内容。`rj`/`rc` 各加 `(?!p)` 与带 `p` 的版本互斥。
 * `sc` 的 `(\d+~\d+)?` 捕获可选行区间（落在 `captures[1]`）。
 */
const PATTERNS = {
  /** rjp：跑 JS，出图 */
  evalPic: /^rjp(?=[\s\S])/,
  /** rj：跑 JS，回文本 */
  evalText: /^rj(?!p)(?=[\s\S])/,
  /** rcp：跑 Shell，出图 */
  shellPic: /^rcp(?=[\s\S])/,
  /** rc：跑 Shell，回文本 */
  shellText: /^rc(?!p)(?=[\s\S])/,
  /** sc：看源码，出图（可带 `起~止` 行区间） */
  source: /^sc(\d+~\d+)?(?=[\s\S])/,
  /** md：渲 Markdown，出图 */
  markdown: /^md(?=[\s\S])/
} as const

export default definePlugin({
  name: "TermZero",
  version: PLUGIN_VERSION,
  description: "远程执行：rj/rjp 跑 JS、rc/rcp 跑 Shell、sc 看源码、md 渲 Markdown —— 均限主人",
  author: "LiuYunLingNai",
  configSchema: CONFIG_SCHEMA,

  setup(ctx) {
    const logger = ctx.logger

    /**
     * 出图并回复，渲染失败时回退到纯文本
     *
     * 见文件头第 3 条。`fallback` 是这条命令的纯文本形态 —— 没有渲染器时使用者唯一还能看到的东西。
     * @param e 消息事件
     * @param data 交给模板的数据
     * @param template 模板名
     * @param fallback 渲染失败时的纯文本
     * @returns 发送完成即结束
     */
    const replyPic = async (
      e: MessageEvent,
      template: string,
      data: Record<string, unknown>,
      fallback: string
    ): Promise<void> => {
      try {
        const img: RenderedImage = await ctx.render(template, data, {
          selector: "#container",
          type: "jpeg",
          quality: 90,
          multiPage: ctx.config.get().output.pageHeight
        })
        await e.reply(img)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        logger.warn(`出图失败，回退纯文本：${reason}`)
        await e.reply(truncate(fallback, ctx.config.get().output.maxTextLength))
      }
    }

    /* ─────────────────────────────── rj / rjp ─────────────────────────────── */

    ctx
      .command(PATTERNS.evalText, { desc: "执行一段 JS，回文本。作用域含 e / ctx / seg / logger" })
      .master()
      .action(async e => {
        const code = e.command?.rest ?? ""
        const { raw, error } = await runJs(code, { e, ctx })
        const text = error === undefined ? stringify(raw, false) : stringifyError(error, false)
        await e.reply(truncate(text || "（无输出）", ctx.config.get().output.maxTextLength))
      })

    ctx
      .command(PATTERNS.evalPic, { desc: "执行一段 JS，出图（带颜色）。作用域含 e / ctx / seg / logger" })
      .master()
      .action(async e => {
        const code = e.command?.rest ?? ""
        const { raw, error } = await runJs(code, { e, ctx })
        // 出图版开 ANSI 颜色：inspect 的着色经 ansiToHtml 上色
        const text = error === undefined ? stringify(raw, true) : stringifyError(error, true)
        const body = ansiToHtml(text || "（无输出）")
        await replyPic(e, CODE_TEMPLATE, { body }, stripAnsi(text) || "（无输出）")
      })

    /* ─────────────────────────────── rc / rcp ─────────────────────────────── */

    ctx
      .command(PATTERNS.shellText, { desc: "执行一条 Shell 命令，回文本" })
      .master()
      .action(async e => {
        const command = e.command?.rest ?? ""
        const result = await runShellFromConfig(ctx, command)
        await e.reply(truncate(shellPlain(result), ctx.config.get().output.maxTextLength))
      })

    ctx
      .command(PATTERNS.shellPic, { desc: "执行一条 Shell 命令，出图（带提示符与颜色）" })
      .master()
      .action(async e => {
        const command = e.command?.rest ?? ""
        const result = await runShellFromConfig(ctx, command)
        // 出图版：命令上方带一行仿真提示符，输出里的 ANSI 颜色转为 HTML
        const parts = [ansiToHtml(result.stdout), ansiToHtml(result.stderr)].filter(s => s !== "")
        if (result.error) parts.push(ansiToHtml(String(result.error.message)))
        const body = parts.join("\n") || "（无输出）"
        await replyPic(e, CODE_TEMPLATE, { title: promptLine(command), body }, shellPlain(result))
      })

    /* ─────────────────────────────── sc ─────────────────────────────── */

    ctx
      .command(PATTERNS.source, { desc: "查看某个文件的源码（带行号），可带 `起~止` 行区间；目录则列出内容" })
      .master()
      .action(async e => {
        const spec = parseRange(e.command?.rest ?? "", e.command?.captures[1] ?? "")
        const result = await readSource(spec)

        if (result.kind === "error") {
          await e.reply(result.message)
          return
        }
        if (result.kind === "dir") {
          const list = result.entries.length > 0 ? result.entries.join("\n") : "（空目录）"
          await e.reply(truncate(`${result.path}\n\n${list}`, ctx.config.get().output.maxTextLength))
          return
        }

        const fallback = result.lines.map(l => `${l.no}\t${stripHtml(l.html)}`).join("\n")
        await replyPic(
          e,
          CODE_TEMPLATE,
          { title: result.path, lines: result.lines, truncated: result.truncated },
          truncate(fallback, ctx.config.get().output.maxTextLength)
        )
      })

    /* ─────────────────────────────── md ─────────────────────────────── */

    ctx
      .command(PATTERNS.markdown, { desc: "把一段 Markdown / 一个本地文件 / 一个 http(s) 链接渲染成图" })
      .master()
      .action(async e => {
        const rest = e.command?.rest ?? ""
        let md: string
        try {
          md = await resolveMarkdown(ctx, rest)
        } catch (err) {
          await e.reply(`取 Markdown 失败：${err instanceof Error ? err.message : String(err)}`)
          return
        }
        const body = markdownToHtml(md)
        // 兜底就给原始 Markdown 文本 —— 没有渲染器时，源文比一句报错有用
        await replyPic(e, MARKDOWN_TEMPLATE, { body }, truncate(md, ctx.config.get().output.maxTextLength))
      })
  }
})

/**
 * 按当前配置跑一条 Shell 命令
 * @param ctx 插件上下文
 * @param command 命令串
 * @returns 执行结果
 */
async function runShellFromConfig(
  ctx: PluginContext<TermZeroConfig>,
  command: string
): ReturnType<typeof runShell> {
  const config = ctx.config.get()
  return runShell(command, {
    timeoutMs: parseDuration(config.shell.timeout, 60_000),
    encoding: config.shell.encoding
  })
}

/**
 * 把 Shell 执行结果拼成纯文本
 *
 * stdout 与 stderr 都要 —— 很多程序（编译器、git）把有用信息写在 stderr。有 error（非零退出/超时/
 * 命令不存在）时附一行错误说明。三者皆空时给个占位，免得回一条空消息。
 * @param result Shell 执行结果
 * @returns 纯文本
 */
function shellPlain(result: { stdout: string; stderr: string; error?: Error }): string {
  const parts = [result.stdout, result.stderr].filter(s => s !== "")
  if (result.error) parts.push(`[错误] ${result.error.message}`)
  return parts.join("\n") || "（无输出）"
}

/**
 * 按长度上限截断文本，超出时在末尾提示改用出图版
 * @param text 原文本
 * @param max 上限字符数；0 表示不截断
 * @returns 截断后的文本
 */
function truncate(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text
  return `${text.slice(0, max)}\n\n……输出过长（共 ${text.length} 字），已截断。完整内容请用出图版（rjp / rcp）`
}

/** 去掉字符串里的 ANSI 转义序列（纯文本兜底用，避免把 `[32m` 之类噪声发给平台） */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI 转义序列本就以控制字符 ESC(0x1b) 打头
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
}

/** 把一行已转义的 HTML 还原成纯文本（sc 的纯文本兜底用） */
function stripHtml(html: string): string {
  return html
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

/**
 * 解析 `md` 的输入：http(s) 链接下载、本地文件读取、否则当作原始 Markdown 文本
 *
 * 三条通路的优先级即此顺序。判本地文件用 `stat`：路径不存在（比如输入本就是一段 Markdown）时 `stat`
 * 抛错，落到「原始文本」通路，故一段随手写的 Markdown 也能直接出图，而非报「文件不存在」。
 * @param ctx 插件上下文
 * @param rest 触发词之后的输入
 * @returns Markdown 源文本
 * @throws 下载失败、超出体积上限时抛出
 */
async function resolveMarkdown(ctx: PluginContext<TermZeroConfig>, rest: string): Promise<string> {
  const config = ctx.config.get()

  if (/^https?:\/\//i.test(rest)) {
    const text = await ctx.http.get<string>(rest, {
      responseType: "text",
      timeout: parseDuration(config.markdown.fetchTimeout, 15_000)
    })
    // 下载后再校体积：真正的流式限流要串进 http 客户端，成本远超这条命令的价值，此处做软上限
    if (Buffer.byteLength(text, "utf8") > config.markdown.maxBytes) {
      throw new Error(`文档超过体积上限（${config.markdown.maxBytes} 字节）`)
    }
    return text
  }

  const abs = isAbsolute(rest) ? rest : resolve(process.cwd(), rest)
  try {
    const info = await stat(abs)
    if (info.isFile()) return await readFile(abs, "utf8")
  } catch {
    // 不是可读的本地文件，落到「当作原始 Markdown 文本」
  }
  return rest
}

