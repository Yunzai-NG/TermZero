/**
 * 模块职责：ansi.ts 的测试 —— 转义与 ANSI→HTML 的核心分支
 * 依赖方向：vitest；被测模块
 * 生命周期：无状态
 * 注意事项：着重验「先转义再着色」这条安全不变量与「非 SGR 序列丢弃」这条噪声处理。
 */

import { describe, expect, it } from "vitest"
import { ansiToHtml, escapeHtml } from "./ansi.js"

describe("escapeHtml", () => {
  it("把五个 HTML 敏感字符全部转义", () => {
    expect(escapeHtml(`<a href="x" data='y'>&`)).toBe("&lt;a href=&quot;x&quot; data=&#39;y&#39;&gt;&amp;")
  })
})

describe("ansiToHtml", () => {
  it("前景色包成带 color 的 span", () => {
    expect(ansiToHtml("\u001b[31mred\u001b[0m")).toBe(`<span style="color:#cd3131">red</span>`)
  })

  it("重置后不再残留 span", () => {
    expect(ansiToHtml("\u001b[1mA\u001b[0mB")).toBe(`<span style="font-weight:bold">A</span>B`)
  })

  it("先转义再着色：染色文本里的尖括号不会成为标签", () => {
    expect(ansiToHtml("\u001b[32m<script>\u001b[0m")).toBe(`<span style="color:#0dbc79">&lt;script&gt;</span>`)
  })

  it("非 SGR 序列（清屏等）被丢弃而非原样保留", () => {
    expect(ansiToHtml("\u001b[2Jhello")).toBe("hello")
  })

  it("256 色与真彩解析成具体颜色", () => {
    expect(ansiToHtml("\u001b[38;5;196mx\u001b[0m")).toContain("color:rgb(255,0,0)")
    expect(ansiToHtml("\u001b[38;2;10;20;30my\u001b[0m")).toContain("color:rgb(10,20,30)")
  })
})
