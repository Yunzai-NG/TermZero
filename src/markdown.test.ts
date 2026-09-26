/**
 * 模块职责：markdown.ts 的测试 —— 块级与行内的常见语法，以及链接协议过滤这条安全线
 * 依赖方向：vitest；被测模块
 * 生命周期：无状态
 */

import { describe, expect, it } from "vitest"
import { markdownToHtml, renderInline } from "./markdown.js"

describe("renderInline", () => {
  it("行内代码内的字符保持字面且被转义", () => {
    expect(renderInline("`a<b>` 与 *斜*")).toBe("<code>a&lt;b&gt;</code> 与 <em>斜</em>")
  })

  it("粗、斜、删除线", () => {
    expect(renderInline("**粗** _斜_ ~~删~~")).toBe("<strong>粗</strong> <em>斜</em> <del>删</del>")
  })

  it("链接正常，图片正常", () => {
    expect(renderInline("[百度](https://baidu.com)")).toBe(`<a href="https://baidu.com">百度</a>`)
    expect(renderInline("![图](/a.png)")).toBe(`<img alt="图" src="/a.png">`)
  })

  it("javascript: 协议被过滤成 #", () => {
    expect(renderInline("[x](javascript:alert)")).toBe(`<a href="#">x</a>`)
  })
})

describe("markdownToHtml", () => {
  it("标题按 # 数分级", () => {
    expect(markdownToHtml("# 一\n\n### 三")).toBe("<h1>一</h1>\n<h3>三</h3>")
  })

  it("围栏代码块整体转义、不做行内渲染", () => {
    expect(markdownToHtml("```\n<x> *not italic*\n```")).toBe("<pre><code>&lt;x&gt; *not italic*</code></pre>")
  })

  it("无序列表", () => {
    expect(markdownToHtml("- a\n- b")).toBe("<ul>\n<li>a</li>\n<li>b</li>\n</ul>")
  })

  it("GFM 表格带对齐", () => {
    const html = markdownToHtml("| A | B |\n| :- | -: |\n| 1 | 2 |")
    expect(html).toContain("<table>")
    expect(html).toContain(`<th style="text-align:left">A</th>`)
    expect(html).toContain(`<td style="text-align:right">2</td>`)
  })

  it("引用块递归渲染", () => {
    expect(markdownToHtml("> 一句话")).toBe("<blockquote><p>一句话</p></blockquote>")
  })

  it("分割线", () => {
    expect(markdownToHtml("---")).toBe("<hr>")
  })

  it("段落内硬换行以 <br> 连接", () => {
    expect(markdownToHtml("第一行\n第二行")).toBe("<p>第一行<br>第二行</p>")
  })
})
