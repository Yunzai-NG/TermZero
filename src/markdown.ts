/**
 * 模块职责：`md` 的核心 —— 一个零依赖的 Markdown → HTML 子集转换器
 * 依赖方向：仅复用 ansi.ts 的 `escapeHtml`
 * 生命周期：无状态，纯函数
 * 注意事项：**为什么不装 markdown-it。** 本插件坚持零第三方依赖，故自带一个
 *          覆盖常见语法的转换器：标题、有序/无序列表（含嵌套）、引用、围栏代码块、行内代码、粗体/斜体/
 *          删除线、链接、图片、分割线、GFM 表格、段落与硬换行。不支持的（脚注、任务列表勾选框、HTML 直通、
 *          定义列表等）会退化为纯文本呈现，不会报错。要「机器人把一段 Markdown 出成图」这个诉求，这个子集
 *          已足够；真要完整 CommonMark，应另装渲染器插件而非在这里堆规则。
 *
 *          **一切文本先转义。** 输入常来自远程文档或用户消息，`escapeHtml` 是第一道也是唯一一道 XSS 拦阻。
 *          代码块与行内代码同样转义 —— 它们要「显示」尖括号，而非让浏览器解释。链接的 `href` 只允许
 *          http/https/相对路径，`javascript:` 一类协议被过滤掉。
 *
 *          **块级先切分，行内后处理。** 先按空行与块标记把文本切成块（段落/列表/代码块…），逐块生成骨架，
 *          再对可含行内语法的文本跑一遍 {@link renderInline}。代码块不进行内渲染，故其中的 `*` 不会被误当成斜体。
 */

import { escapeHtml } from "./ansi.js"

/**
 * 过滤链接/图片的 URL，挡掉 `javascript:` 等危险协议
 * @param url 原始 URL
 * @returns 安全时返回转义后的 URL，否则返回 `#`
 */
function safeUrl(url: string): string {
  const trimmed = url.trim()
  // 允许 http(s)、协议相对、根相对、以及无协议的相对路径与锚点；其余（javascript:/data: 等）一律拦掉
  if (/^(https?:\/\/|\/\/|\/|\.{0,2}\/|#)/i.test(trimmed) || !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return escapeHtml(trimmed).replace(/"/g, "%22")
  }
  return "#"
}

/**
 * 渲染行内语法
 *
 * 处理顺序有讲究：**行内代码最先切出并占位**，因为代码里的 `*_[` 都该保持字面。转义在占位之后、
 * 其余替换之前统一做一次。
 * @param text 一段可含行内语法的纯文本（尚未转义）
 * @returns HTML
 */
export function renderInline(text: string): string {
  // 1) 抠出行内代码，替换成不可能与后续规则冲突的占位符
  const codes: string[] = []
  let work = text.replace(/`([^`]+)`/g, (_all, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })

  // 2) 转义其余文本
  work = escapeHtml(work)

  // 3) 图片先于链接（图片是 `!` 打头的链接的超集）
  work = work.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_all, alt: string, url: string) => {
    return `<img alt="${alt}" src="${safeUrl(url)}">`
  })

  // 4) 链接
  work = work.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_all, label: string, url: string) => {
    return `<a href="${safeUrl(url)}">${label}</a>`
  })

  // 5) 粗斜体。先三星（粗斜），再双星/双下划（粗），再单星/单下划（斜），最后删除线
  work = work
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\s][^_]*)_/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")

  // 6) 还原行内代码
  // eslint-disable-next-line no-control-regex -- 匹配上一步埋下的 NUL(0x00) 占位符
  work = work.replace(/\u0000(\d+)\u0000/g, (_all, n: string) => codes[Number(n)] ?? "")
  return work
}

/** 是否分割线 */
function isHr(line: string): boolean {
  return /^ {0,3}([-*_])(?: *\1){2,} *$/.test(line)
}

/**
 * 解析一段连续的表格文本
 * @param rows 表格的所有行（含表头与分隔行）
 * @returns 表格 HTML；不是合法表格时 undefined
 */
function renderTable(rows: string[]): string | undefined {
  if (rows.length < 2) return undefined
  const sep = rows[1] ?? ""
  if (!/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(sep)) return undefined

  /** 切一行为单元格 */
  const cells = (line: string): string[] =>
    line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map(c => c.trim())

  const aligns = cells(sep).map(spec => {
    const left = spec.startsWith(":")
    const right = spec.endsWith(":")
    if (left && right) return "center"
    if (right) return "right"
    if (left) return "left"
    return ""
  })

  /** 渲一行 */
  const row = (line: string, tag: "th" | "td"): string => {
    const out = cells(line)
      .map((c, i) => {
        const align = aligns[i] ? ` style="text-align:${aligns[i]}"` : ""
        return `<${tag}${align}>${renderInline(c)}</${tag}>`
      })
      .join("")
    return `<tr>${out}</tr>`
  }

  const head = row(rows[0] ?? "", "th")
  const body = rows.slice(2).map(r => row(r, "td")).join("")
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`
}

/**
 * 把 Markdown 转成 HTML
 * @param md 源文本
 * @returns HTML 片段（不含 `<html>` 外壳，由模板包裹）
 */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n")
  const out: string[] = []
  let i = 0

  /** 收集一段列表并递归渲染其项 */
  const takeList = (ordered: boolean): void => {
    const marker = ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-*+]\s+(.*)$/
    const tag = ordered ? "ol" : "ul"
    out.push(`<${tag}>`)
    while (i < lines.length) {
      const m = marker.exec(lines[i] ?? "")
      if (!m) break
      // 收集该项的续行（缩进的、非新列表项的行并入本项）
      const parts = [m[2] ?? ""]
      i++
      while (i < lines.length) {
        const next = lines[i] ?? ""
        if (next.trim() === "" || marker.test(next) || /^(\s*)[-*+]\s+/.test(next) || /^(\s*)\d+[.)]\s+/.test(next)) break
        parts.push(next.trim())
        i++
      }
      out.push(`<li>${renderInline(parts.join(" "))}</li>`)
    }
    out.push(`</${tag}>`)
  }

  while (i < lines.length) {
    const line = lines[i] ?? ""

    // 空行
    if (line.trim() === "") { i++; continue }

    // 围栏代码块 ``` 或 ~~~
    const fence = /^\s*(```+|~~~+)(.*)$/.exec(line)
    if (fence) {
      const close = fence[1] ?? "```"
      const lang = (fence[2] ?? "").trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(close)) {
        buf.push(lines[i] ?? "")
        i++
      }
      i++ // 吃掉结尾围栏
      const cls = lang ? ` class="lang-${escapeHtml(lang)}"` : ""
      out.push(`<pre><code${cls}>${escapeHtml(buf.join("\n"))}</code></pre>`)
      continue
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      const level = (heading[1] ?? "#").length
      out.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`)
      i++
      continue
    }

    // 分割线
    if (isHr(line)) { out.push("<hr>"); i++; continue }

    // 引用（连续的 > 行合并）
    if (/^\s*>/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(/^\s*>\s?/, ""))
        i++
      }
      out.push(`<blockquote>${markdownToHtml(buf.join("\n"))}</blockquote>`)
      continue
    }

    // 列表
    if (/^(\s*)[-*+]\s+/.test(line)) { takeList(false); continue }
    if (/^(\s*)\d+[.)]\s+/.test(line)) { takeList(true); continue }

    // 表格：当前行含 `|` 且下一行是分隔行
    if (line.includes("|") && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "")) {
      const buf: string[] = []
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        buf.push(lines[i] ?? "")
        i++
      }
      const table = renderTable(buf)
      if (table) { out.push(table); continue }
      // 不是合法表格，退回当普通段落处理（把已吃掉的行放回）
      i -= buf.length
    }

    // 段落：收集到下一个空行/块标记为止，行内以 <br> 连接
    const para: string[] = []
    while (i < lines.length) {
      const l = lines[i] ?? ""
      if (
        l.trim() === "" ||
        /^\s*(```+|~~~+)/.test(l) ||
        /^#{1,6}\s+/.test(l) ||
        /^\s*>/.test(l) ||
        /^(\s*)[-*+]\s+/.test(l) ||
        /^(\s*)\d+[.)]\s+/.test(l) ||
        isHr(l)
      ) break
      para.push(l)
      i++
    }
    out.push(`<p>${para.map(p => renderInline(p.trim())).join("<br>")}</p>`)
  }

  return out.join("\n")
}
