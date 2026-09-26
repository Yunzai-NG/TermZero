/**
 * 模块职责：`sc` 的核心 —— 读一个源码文件，可选行区间，产出带行号的 HTML
 * 依赖方向：`node:fs/promises`、`node:path`；HTML 转义复用 ansi.ts
 * 生命周期：无状态
 * 注意事项：**只认明确的文件路径，不做 glob 交互挑选。** 「匹配到多个文件就回消息选序号」那套交互挑选
 *          依赖框架的 awaitContext，要串 `e.prompt`、维护候选表，复杂度远超这条命令本身的价值；故本插件
 *          只接受一个具体路径，路径是目录时列出目录内容作为替代导航手段。取舍见 README。
 *
 *          **没有语法高亮。** 本插件零第三方依赖，不引 highlight.js 那类（还要走 CDN 资源包），故只做
 *          「等宽 + 行号 + HTML 转义」。要的是「把某个文件的内容原样、带行号地看清楚」，着色是锦上添花，
 *          缺了不影响达意。
 *
 *          **路径不做越界限制。** 与 rc/rj 一样，这是主人专属的「看任意文件」口子，限制在 `.master()`。
 *          但仍 `resolve` 成绝对路径，让报错信息里显示的是真实位置而非用户敲的相对片段。
 */

import { readdir, readFile, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import process from "node:process"
import { escapeHtml } from "./ansi.js"

/** 一行源码 */
export interface SourceLine {
  /** 行号（从文件真实行号计，非从 1） */
  no: number
  /** 已 HTML 转义的行内容 */
  html: string
}

/** 读取结果 */
export type SourceResult =
  | { kind: "file"; path: string; lines: SourceLine[]; truncated: boolean }
  | { kind: "dir"; path: string; entries: string[] }
  | { kind: "error"; message: string }

/** 单文件最多渲染的行数，避免误开一个几十万行的文件 */
const MAX_LINES = 5000

/**
 * 解析 `sc` 的参数：可选的 `起~止` 行区间与文件路径
 *
 * 触发词已被路由器吃掉（`e.command.rest` 只剩路径部分），但行区间是黏在 `sc` 后面的
 * （`sc12~34 file`），它落在 `e.command.captures[1]` 里。故区间从 captures 取，路径从 rest 取。
 * @param rest 触发词之后的文本（文件路径）
 * @param rangeCapture 正则捕获到的 `起~止`；无区间时为空串
 * @returns 起止行（1 基，含两端）；无区间时均为 undefined
 */
export function parseRange(
  rest: string,
  rangeCapture: string
): { path: string; from?: number; to?: number } {
  const path = rest.trim()
  const match = /^(\d+)~(\d+)$/.exec(rangeCapture.trim())
  if (!match) return { path }
  const a = Number(match[1])
  const b = Number(match[2])
  return { path, from: Math.min(a, b), to: Math.max(a, b) }
}

/**
 * 读取源码
 * @param spec 解析后的路径与区间
 * @returns 读取结果（文件内容 / 目录清单 / 错误）
 */
export async function readSource(spec: {
  path: string
  from?: number
  to?: number
}): Promise<SourceResult> {
  if (spec.path === "") return { kind: "error", message: "请给出要查看的文件路径" }
  const abs = isAbsolute(spec.path) ? spec.path : resolve(process.cwd(), spec.path)

  let info
  try {
    info = await stat(abs)
  } catch (err) {
    return { kind: "error", message: `打不开 ${abs}：${err instanceof Error ? err.message : String(err)}` }
  }

  if (info.isDirectory()) {
    try {
      const entries = await readdir(abs)
      return { kind: "dir", path: abs, entries }
    } catch (err) {
      return { kind: "error", message: `读目录失败：${err instanceof Error ? err.message : String(err)}` }
    }
  }

  let text: string
  try {
    text = await readFile(abs, "utf8")
  } catch (err) {
    return { kind: "error", message: `读文件失败：${err instanceof Error ? err.message : String(err)}` }
  }

  // \r\n / \r 归一到 \n，免得 Windows 换行在行号里多算一格
  const all = text.replace(/\r\n?/g, "\n").split("\n")
  const from = spec.from ?? 1
  const to = spec.to ?? all.length
  // 行号是 1 基，切片是 0 基
  const sliced = all.slice(Math.max(0, from - 1), to)
  const capped = sliced.slice(0, MAX_LINES)
  const lines: SourceLine[] = capped.map((content, i) => ({
    no: from + i,
    html: escapeHtml(content) || "&nbsp;"
  }))
  return { kind: "file", path: abs, lines, truncated: sliced.length > capped.length }
}
