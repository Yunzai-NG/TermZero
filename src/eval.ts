/**
 * 模块职责：`rj` / `rjp` 的核心 —— 在带 `e` / `ctx` / `seg` 绑定的作用域里执行一段 JS
 * 依赖方向：`node:util` 的 inspect；类型来自 `@yunzai-ng/types` 与 `@yunzai-ng/core`
 * 生命周期：无状态，每次命令构造一次
 * 注意事项：**用 `AsyncFunction` 而非 `eval` 递归回退。** 一种常见写法是先同步 `eval`，撞上
 *          `SyntaxError: await/Illegal return/Unexpected` 再把代码包进 async 函数重试。改用
 *          `new AsyncFunction(...)` 后，顶层 `await` 与顶层 `return` 天然合法，回退只剩一种：
 *          先按「表达式」编译（`return (代码)`，让 `rj 1+1` 直接回显 `2`），编不过再按「语句块」
 *          编译。少了那圈基于错误信息文本的正则判断 —— 那种判断跨 Node 版本很脆。
 *
 *          **绑定作为函数实参传入，不靠词法作用域。** `new AsyncFunction("e","ctx","seg","logger", 代码)`
 *          把这四个名字做成形参，于是 lint 不会把它们误判为「未使用」，也不必 eval 直接读闭包变量。
 *          用户代码里因此可写 `e.reply(...)`、`await ctx.http.get(...)`、`seg.image(...)`。
 *
 *          **这是主人专属的任意代码执行口子。** 命令注册时已 `.master()`，本模块不再自查权限 ——
 *          权限是路由器的职责，重复自查只会让人以为这里还有第二道门。
 */

import { inspect } from "node:util"
import { seg } from "@yunzai-ng/core"
import type { MessageEvent, PluginContext } from "@yunzai-ng/types"

/** `async function(){}` 的构造器，用于把字符串编译成异步函数 */
const AsyncFunction = Object.getPrototypeOf(async function () {
  /* 取其 constructor */
}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>

/** 一次执行的结果 */
export interface EvalResult {
  /** 求值得到的原始返回值 */
  raw?: unknown
  /** 求值过程中抛出的错误 */
  error?: unknown
}

/** 执行时注入用户代码的绑定 */
export interface EvalBindings {
  /** 当前消息事件 */
  e: MessageEvent
  /** 插件上下文 */
  ctx: PluginContext<unknown>
}

/**
 * 执行一段 JS
 *
 * 先按表达式编译（隐式 `return`），失败再按语句块编译。两条通路都在 `try` 里执行，
 * 抛出的错误收进结果而非上抛 —— 上抛会被内核当成「命令处理器崩了」记一条噪声日志，
 * 而这里的错误恰恰是要回给主人看的正常产物。
 * @param code 待执行代码
 * @param bindings 注入的绑定
 * @returns 执行结果（`raw` 与 `error` 至多其一有值）
 */
export async function runJs(code: string, bindings: EvalBindings): Promise<EvalResult> {
  const { e, ctx } = bindings
  // seg 直接来自 @yunzai-ng/core，与 e / ctx 一起作为形参注入，用户代码可写 seg.image(...)
  const names = ["e", "ctx", "seg", "logger"]
  const values = [e, ctx, seg, ctx.logger]

  let fn: (...args: unknown[]) => Promise<unknown>
  try {
    // 表达式通路：`rj 1+1` → `return (1+1)` → 回显 2
    fn = new AsyncFunction(...names, `return (${code})`)
  } catch {
    // 不是单个表达式（语句块 / 顶层 return / 含分号的多句），按原样编译
    try {
      fn = new AsyncFunction(...names, code)
    } catch (err) {
      return { error: err }
    }
  }

  try {
    return { raw: await fn(...values) }
  } catch (err) {
    return { error: err }
  }
}

/**
 * 把任意返回值转成可读文本
 *
 * 字符串原样给出（这是最常见的情形，套一层 inspect 的引号反而碍眼）；`undefined` 归一为空串；
 * 其余交给 `node:util` 的 `inspect`。`colors` 由调用方按「出图还是发文」决定：出图版要颜色，
 * 交给 `ansiToHtml` 上色；发文版关掉，免得平台上一堆 `[32m` 噪声。
 * @param value 返回值
 * @param colors 是否输出 ANSI 颜色
 * @returns 文本
 */
export function stringify(value: unknown, colors: boolean): string {
  if (typeof value === "string") return value
  if (value === undefined) return ""
  return inspect(value, { colors, depth: 4, breakLength: 120, maxArrayLength: 200 })
}

/**
 * 把错误转成可读文本
 * @param err 错误
 * @param colors 是否输出 ANSI 颜色
 * @returns 文本（Error 取其 stack）
 */
export function stringifyError(err: unknown, colors: boolean): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`
  return stringify(err, colors)
}
