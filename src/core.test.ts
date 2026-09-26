/**
 * 模块职责：source.ts 与 eval.ts 的测试 —— 行区间解析、JS 求值的三条通路与结果字符串化
 * 依赖方向：vitest；被测模块。eval 的 e/ctx 绑定用最小桩，用户代码不触碰它们即可
 * 生命周期：无状态
 */

import { describe, expect, it } from "vitest"
import type { MessageEvent, PluginContext } from "@yunzai-ng/types"
import { runJs, stringify, stringifyError } from "./eval.js"
import { parseRange } from "./source.js"

/** eval 绑定的最小桩：这几个测试里的用户代码都不读它们 */
const stub = {
  e: {} as unknown as MessageEvent,
  ctx: { logger: {} } as unknown as PluginContext<unknown>
}

describe("parseRange", () => {
  it("无区间时只给路径", () => {
    expect(parseRange("/a/b.ts", "")).toEqual({ path: "/a/b.ts" })
  })

  it("解析 起~止，且大小自动归位", () => {
    expect(parseRange("/a/b.ts", "34~12")).toEqual({ path: "/a/b.ts", from: 12, to: 34 })
  })
})

describe("runJs", () => {
  it("表达式通路：直接回显求值结果", async () => {
    expect((await runJs("1 + 1", stub)).raw).toBe(2)
  })

  it("语句块通路：顶层 return 合法", async () => {
    expect((await runJs("const a = 2; return a * 3", stub)).raw).toBe(6)
  })

  it("顶层 await 合法", async () => {
    expect((await runJs("await Promise.resolve(42)", stub)).raw).toBe(42)
  })

  it("运行期抛错收进 error 而非上抛", async () => {
    const { error } = await runJs("throw new Error('boom')", stub)
    expect(error).toBeInstanceOf(Error)
  })

  it("语法错误也收进 error", async () => {
    const { error } = await runJs("(((", stub)
    expect(error).toBeDefined()
  })
})

describe("stringify", () => {
  it("字符串原样返回", () => {
    expect(stringify("hi", false)).toBe("hi")
  })

  it("undefined 归一为空串", () => {
    expect(stringify(undefined, false)).toBe("")
  })

  it("对象走 inspect", () => {
    expect(stringify({ a: 1 }, false)).toContain("a: 1")
  })
})

describe("stringifyError", () => {
  it("Error 取其 stack", () => {
    expect(stringifyError(new Error("x"), false)).toContain("x")
  })
})
